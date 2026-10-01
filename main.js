'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, powerMonitor, dialog } = require('electron');
// Privileged media scheme must register before app ready.
const privateMediaProtocol = require('./src/personal/privateMediaProtocol');
privateMediaProtocol.installPrivilegedScheme();
// Must run before ready so Chromium starts without automation flags / Electron UA.
require('./src/browser/browserIdentity').installEarlyIdentity();
const passwordManager = require('./src/security/passwordManager');
const lockManager = require('./src/security/lockManager');
const authThrottle = require('./src/security/authThrottle');
const browserManager = require('./src/browser/browserManager');
const spaceManager = require('./src/spaces/spaceManager');
const recentManager = require('./src/storage/recentManager');
const activityLog = require('./src/storage/activityLog');
const privateFilesManager = require('./src/personal/privateFilesManager');
const recentFilesManager = require('./src/personal/recentFilesManager');
const privateClipboard = require('./src/personal/privateClipboard');
const secureNotes = require('./src/personal/secureNotes');
const vaultBackup = require('./src/personal/vaultBackup');
const { getAvailableServices } = require('./src/personal/serviceRegistry');
const { canAccessPrivateFiles } = require('./src/personal/accessGate');
const {
  validateSpaceId,
  validateCategory,
  validateImportCategory,
  validateRelativePath,
  validateFilename,
  validateSourcePathList,
} = require('./src/personal/ipcValidation');
const {
  getHomeUrl,
  setLastUnlockedAt,
  getLastUnlockedAt,
  getPrivacySettings,
  updatePrivacySettings,
} = require('./src/storage/settingsManager');

/** Default private vault for Personal Space UI (isolated from Work/Guest roots). */
const DEFAULT_PRIVATE_SPACE_ID = 'personal';

let loginWindow = null;
let authenticated = false;

function createLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return loginWindow;
  }

  loginWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 560,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: 'SafeNest',
    backgroundColor: '#0a0c10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loginWindow.loadFile(path.join(__dirname, 'renderer', 'login', 'login.html'));
  loginWindow.once('ready-to-show', () => {
    if (!loginWindow || loginWindow.isDestroyed()) return;
    loginWindow.maximize();
    loginWindow.show();
  });
  loginWindow.on('closed', () => {
    loginWindow = null;
    if (!authenticated) {
      app.quit();
    }
  });

  return loginWindow;
}

function lockMeta() {
  const space = spaceManager.getActiveSpace();
  return {
    spaceName: space?.name || 'SafeNest',
    spaceId: space?.id || null,
    lastUnlockedAt: getLastUnlockedAt(),
  };
}

function notifyLockState(extra = {}) {
  const win = browserManager.getBrowserWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('lock:changed', {
      ...lockManager.getState(),
      ...lockMeta(),
      ...extra,
    });
  }
}

async function captureWindowForLock() {
  const win = browserManager.getBrowserWindow();
  if (!win || win.isDestroyed()) {
    return null;
  }
  try {
    const image = await win.capturePage();
    if (!image || image.isEmpty()) {
      return null;
    }
    return image.toDataURL();
  } catch {
    return null;
  }
}

/**
 * @param {{ reason?: string, immediate?: boolean }} options
 */
async function lockVault(options = {}) {
  const reason = options.reason || 'MANUAL_LOCK';
  const immediate = Boolean(options.immediate);

  if (!authenticated) {
    return { ok: false, error: 'Not authenticated.' };
  }
  if (lockManager.isLocked()) {
    // Keep auth UI from lingering if a second lock arrives while already locked.
    browserManager.closeAuthWindows();
    return { ok: true, locked: true };
  }

  const privacy = getPrivacySettings();
  const isPanic = reason === 'PANIC_LOCK';
  let blurBackground = null;
  if (!immediate && !isPanic && privacy.privacyBlur !== false) {
    blurBackground = await captureWindowForLock();
  }

  // Panic: jump off the live page before the lock screen so unlock lands on Home.
  if (isPanic) {
    browserManager.showDashboard();
  }

  const shouldWipeWeb =
    (isPanic && privacy.clearBrowsingDataOnPanic !== false) ||
    (!isPanic && privacy.clearBrowsingDataOnLock === true);
  if (shouldWipeWeb) {
    await browserManager.clearWebBrowsingData();
  }

  lockManager.lock();
  // Hides BrowserView and closes any Google auth windows.
  browserManager.setContentVisible(false);

  // Always clear private clipboard on panic; otherwise follow privacy toggle.
  if (isPanic || privacy.clearClipboardOnLock !== false) {
    privateClipboard.clear();
  }
  if (privacy.clearRecentFilesOnLock || isPanic) {
    recentFilesManager.clearAll();
  }

  // Notify renderer to tear down photo/video viewers + sensitive UI state.
  notifyLockState({
    blurBackground: isPanic ? null : blurBackground,
    reason,
    clearPrivateMedia: true,
    clearPrivateClipboard: isPanic || privacy.clearClipboardOnLock !== false,
    clearNotesEditor: true,
  });
  activityLog.record(reason);
  return { ok: true, locked: true, reason };
}

function unlockVault(password) {
  if (!authenticated) {
    return { ok: false, error: 'Not authenticated.' };
  }
  if (!lockManager.isLocked()) {
    return { ok: true, locked: false };
  }

  const input = authThrottle.validatePasswordInput(password);
  if (!input.ok) {
    return input;
  }
  const throttle = authThrottle.checkAllowed();
  if (!throttle.ok) {
    activityLog.record('UNLOCK_RATE_LIMITED');
    return throttle;
  }

  const result = passwordManager.verifyPassword(password);
  if (!result.ok) {
    authThrottle.recordFailure();
    activityLog.record('UNLOCK_FAILED');
    const again = authThrottle.checkAllowed();
    if (!again.ok) {
      activityLog.record('UNLOCK_RATE_LIMITED');
      return again;
    }
    return result;
  }

  authThrottle.recordSuccess();
  lockManager.unlock();
  setLastUnlockedAt(new Date().toISOString());
  activityLog.record('UNLOCK_SUCCESS');

  // Restore browser content only if we were in browser mode.
  if (browserManager.getShellMode() === 'browser') {
    browserManager.setContentVisible(true);
  }

  notifyLockState({ blurBackground: null });
  return { ok: true, locked: false };
}

const trackedWebContents = new WeakSet();

function attachInputHandlers(webContents) {
  if (!webContents || webContents.isDestroyed() || trackedWebContents.has(webContents)) {
    return;
  }
  trackedWebContents.add(webContents);

  webContents.on('before-input-event', (_event, input) => {
    if (!authenticated) {
      return;
    }

    const key = String(input.key || '').toLowerCase();
    if (
      input.type === 'keyDown' &&
      input.control &&
      input.shift &&
      !input.alt &&
      !input.meta
    ) {
      if (key === 'p') {
        void lockVault({ reason: 'PANIC_LOCK', immediate: true });
        return;
      }
      if (key === 'l') {
        void lockVault({ reason: 'MANUAL_LOCK', immediate: false });
        return;
      }
    }

    lockManager.noteActivity();
  });

  webContents.on('focus', () => lockManager.noteActivity());
}

function openShellAfterAuth() {
  authenticated = true;
  lockManager.reset();
  lockManager.startWatching();
  setLastUnlockedAt(new Date().toISOString());
  activityLog.record('UNLOCK_SUCCESS');

  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close();
  }

  const win = browserManager.createBrowserWindow();
  attachInputHandlers(win.webContents);
  // Auth windows are separate BrowserWindows; capture Ctrl+Shift+L/P there too.
  browserManager.setLockShortcutHandler((reason) => {
    void lockVault({
      reason,
      immediate: reason === 'PANIC_LOCK',
    });
  });
  win.on('focus', () => lockManager.noteActivity());
  win.on('closed', () => {
    authenticated = false;
    browserManager.setLockShortcutHandler(null);
    lockManager.reset();
  });
}

function requireAuth() {
  if (!authenticated) {
    return { ok: false, error: 'Not authenticated.' };
  }
  if (lockManager.isLocked()) {
    return { ok: false, error: 'Your Nest is locked.' };
  }
  return null;
}

function requireUnlocked() {
  return requireAuth();
}

function getDashboardPayload() {
  const { spaces, activeSpaceId } = spaceManager.listSpaces();
  const lockState = lockManager.getState();
  const unlocked = authenticated && !lockState.locked;

  // While locked, do not expose allowlists, recents, activity, or private stats.
  if (!unlocked) {
    return {
      spaces: spaces.map((space) => ({
        id: space.id,
        name: space.name,
        color: space.color,
        domains: [],
      })),
      activeSpaceId,
      activeSpace: {
        id: activeSpaceId,
        name: spaceManager.getSpaceById(activeSpaceId)?.name || 'Nest',
        domains: [],
      },
      recent: [],
      autoLock: lockState.autoLock,
      options: lockState.options,
      locked: true,
      lastUnlockedAt: getLastUnlockedAt(),
      activity: [],
      websiteCount: 0,
      services: [],
      privateSpaceId: DEFAULT_PRIVATE_SPACE_ID,
      privateStats: { files: 0, photos: 0, videos: 0, downloads: 0 },
      browserSpaceCount: spaces.length,
      recentFiles: [],
      privacy: getPrivacySettings(),
      clipboard: { empty: true },
    };
  }

  const services = getAvailableServices(spaces);
  let privateStats = { files: 0, photos: 0, videos: 0, downloads: 0 };
  privateFilesManager.ensureSpaceLayout(DEFAULT_PRIVATE_SPACE_ID);
  const statsResult = privateFilesManager.getStats(DEFAULT_PRIVATE_SPACE_ID);
  if (statsResult.ok) {
    privateStats = statsResult.stats;
  }
  return {
    spaces,
    activeSpaceId,
    activeSpace: spaceManager.getSpaceById(activeSpaceId),
    recent: recentManager.getRecentAllowed(),
    autoLock: lockState.autoLock,
    options: lockState.options,
    locked: false,
    lastUnlockedAt: getLastUnlockedAt(),
    activity: activityLog.getEvents(80).map((event) => ({
      ...event,
      label: activityLog.labelFor(event.type),
    })),
    websiteCount: spaceManager.countAllowedWebsites(),
    services,
    privateSpaceId: DEFAULT_PRIVATE_SPACE_ID,
    privateStats,
    browserSpaceCount: spaces.length,
    recentFiles: recentFilesManager.getRecent(DEFAULT_PRIVATE_SPACE_ID, 12),
    privacy: getPrivacySettings(),
    clipboard: privateClipboard.getStatus(),
  };
}

function requirePrivateAccess(spaceId) {
  const access = canAccessPrivateFiles({
    authenticated,
    locked: lockManager.isLocked(),
    spaceId,
  });
  if (!access.ok) {
    return access;
  }
  return null;
}

function registerIpc() {
  ipcMain.handle('auth:status', () => passwordManager.getPasswordStatus());

  ipcMain.handle('auth:createPassword', (_event, password, confirmPassword) => {
    if (typeof password !== 'string' || typeof confirmPassword !== 'string') {
      return { ok: false, error: 'Invalid password input.' };
    }
    if (password !== confirmPassword) {
      return { ok: false, error: 'Passwords do not match.' };
    }
    const result = passwordManager.createPassword(password);
    if (result.ok) {
      openShellAfterAuth();
    }
    return result;
  });

  ipcMain.handle('auth:verifyPassword', (_event, password) => {
    const input = authThrottle.validatePasswordInput(password);
    if (!input.ok) {
      return input;
    }
    const throttle = authThrottle.checkAllowed();
    if (!throttle.ok) {
      activityLog.record('UNLOCK_RATE_LIMITED');
      return throttle;
    }
    const result = passwordManager.verifyPassword(password);
    if (result.ok) {
      authThrottle.recordSuccess();
      openShellAfterAuth();
    } else {
      authThrottle.recordFailure();
      activityLog.record('UNLOCK_FAILED');
      const again = authThrottle.checkAllowed();
      if (!again.ok) {
        activityLog.record('UNLOCK_RATE_LIMITED');
        return again;
      }
    }
    return result;
  });

  ipcMain.handle(
    'auth:changePassword',
    (_event, currentPassword, newPassword, confirmPassword) => {
      const gate = requireAuth();
      if (gate) return gate;
      if (
        typeof currentPassword !== 'string' ||
        typeof newPassword !== 'string' ||
        typeof confirmPassword !== 'string'
      ) {
        return { ok: false, error: 'Invalid password input.' };
      }
      const result = passwordManager.changePassword(
        currentPassword,
        newPassword,
        confirmPassword
      );
      if (result.ok) {
        activityLog.record('PASSWORD_CHANGED');
      }
      return result;
    }
  );

  ipcMain.handle('browser:getHomeUrl', () => getHomeUrl());

  ipcMain.handle('browser:nav', (_event, action) => {
    const gate = requireAuth();
    if (gate) return gate;
    lockManager.noteActivity();
    switch (action) {
      case 'back':
        browserManager.goBack();
        break;
      case 'forward':
        browserManager.goForward();
        break;
      case 'reload':
        browserManager.reload();
        break;
      default:
        return { ok: false, error: 'Unknown navigation action.' };
    }
    return { ok: true, url: browserManager.getCurrentUrl() };
  });

  ipcMain.handle('browser:getUrl', () => {
    if (!authenticated || lockManager.isLocked()) return '';
    return browserManager.getCurrentUrl();
  });

  ipcMain.handle('browser:navigateTo', (_event, rawUrl) => {
    const gate = requireAuth();
    if (gate) return gate;
    if (typeof rawUrl !== 'string') {
      return { ok: false, error: 'Invalid address.' };
    }
    let target = rawUrl.trim();
    if (!target) {
      return { ok: false, error: 'Enter a website address.' };
    }
    if (!/^https?:\/\//i.test(target)) {
      target = `https://${target}`;
    }
    lockManager.noteActivity();
    return browserManager.navigateContent(target);
  });

  ipcMain.handle('browser:openSpace', (_event, spaceId, url) => {
    const gate = requireAuth();
    if (gate) return gate;
    if (typeof spaceId !== 'string') {
      return { ok: false, error: 'Invalid space.' };
    }
    const result = browserManager.openSpace(spaceId, typeof url === 'string' ? url : undefined);
    if (result.ok) {
      activityLog.record('SPACE_SWITCHED', {
        spaceId,
        spaceName: spaceManager.getSpaceById(spaceId)?.name,
      });
      const view = browserManager.getContentView();
      if (view) {
        attachInputHandlers(view.webContents);
      }
    }
    return result;
  });

  ipcMain.handle('browser:openRecent', (_event, domain) => {
    const gate = requireAuth();
    if (gate) return gate;
    if (typeof domain !== 'string') {
      return { ok: false, error: 'Invalid domain.' };
    }
    const result = browserManager.openRecentDomain(domain);
    if (result.ok) {
      const view = browserManager.getContentView();
      if (view) {
        attachInputHandlers(view.webContents);
      }
    }
    return result;
  });

  ipcMain.handle('shell:showDashboard', () => {
    const gate = requireAuth();
    if (gate) return gate;
    return browserManager.showDashboard();
  });

  ipcMain.handle('shell:showSettings', () => {
    const gate = requireAuth();
    if (gate) return gate;
    return browserManager.showSettings();
  });

  ipcMain.handle('shell:showPersonal', (_event, section) => {
    const gate = requireAuth();
    if (gate) return gate;
    return browserManager.showPersonalSection(section);
  });

  ipcMain.handle('personal:listFiles', (_event, spaceId, category, relativePath) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    const cat = validateCategory(category);
    if (!cat.ok) return cat;
    const rel = validateRelativePath(relativePath, { allowEmpty: true });
    if (!rel.ok) return rel;
    return privateFilesManager.listFiles(space.value, cat.value, rel.value);
  });

  ipcMain.handle('personal:getStats', (_event, spaceId) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    return privateFilesManager.getStats(space.value, { force: false });
  });

  ipcMain.handle('personal:createFolder', (_event, spaceId, category, relativeParent, folderName) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    const cat = validateCategory(category);
    if (!cat.ok) return cat;
    const parent = validateRelativePath(relativeParent, { allowEmpty: true });
    if (!parent.ok) return parent;
    const name = validateFilename(folderName);
    if (!name.ok) return name;
    const result = privateFilesManager.createFolder(
      space.value,
      cat.value,
      parent.value,
      name.value
    );
    if (result.ok) {
      activityLog.record('FOLDER_CREATED', {
        spaceId: space.value,
        category: cat.value,
        type: 'folder',
      });
    }
    return result;
  });

  ipcMain.handle('personal:renameFile', (_event, spaceId, category, relativePath, newName) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    const cat = validateCategory(category);
    if (!cat.ok) return cat;
    const rel = validateRelativePath(relativePath, { allowEmpty: false });
    if (!rel.ok) return rel;
    const name = validateFilename(newName);
    if (!name.ok) return name;
    const result = privateFilesManager.renameFile(
      space.value,
      cat.value,
      rel.value,
      name.value
    );
    if (result.ok) {
      activityLog.record('FILE_RENAMED', {
        spaceId: space.value,
        category: cat.value,
        type: result.item?.type || 'other',
      });
      recentFilesManager.removeMatching(space.value, cat.value, rel.value);
      if (result.item) {
        recentFilesManager.record({
          spaceId: space.value,
          category: cat.value,
          relativePath: result.item.relativePath,
          name: result.item.name,
          action: 'renamed',
        });
      }
    }
    return result;
  });

  ipcMain.handle('personal:deleteFile', (_event, spaceId, category, relativePath) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    const cat = validateCategory(category);
    if (!cat.ok) return cat;
    const rel = validateRelativePath(relativePath, { allowEmpty: false });
    if (!rel.ok) return rel;
    const result = privateFilesManager.deleteFile(space.value, cat.value, rel.value);
    if (result.ok) {
      activityLog.record('FILE_DELETED', {
        spaceId: space.value,
        category: cat.value,
        type: result.type || 'other',
      });
      recentFilesManager.removeMatching(space.value, cat.value, rel.value);
    }
    return result;
  });

  ipcMain.handle('personal:importFiles', async (_event, spaceId, category) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    const cat = validateImportCategory(category);
    if (!cat.ok) return cat;

    const win = browserManager.getBrowserWindow();
    const picked = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
      title: 'Import into your Nest',
      properties: ['openFile', 'multiSelections'],
    });
    if (picked.canceled || !picked.filePaths?.length) {
      return { ok: false, error: 'Import cancelled.', cancelled: true };
    }

    const sources = validateSourcePathList(picked.filePaths);
    if (!sources.ok) return sources;

    const result = privateFilesManager.importFilesFromSources(
      space.value,
      cat.value,
      sources.value
    );
    if (result.ok) {
      for (const item of result.imported) {
        activityLog.record('FILE_ADDED', {
          spaceId: space.value,
          category: cat.value,
          type: item.type,
        });
        recentFilesManager.record({
          spaceId: space.value,
          category: cat.value,
          relativePath: item.relativePath,
          name: item.name,
          action: 'imported',
        });
      }
    }
    return result;
  });

  ipcMain.handle('personal:importDroppedFiles', (_event, spaceId, category, filePaths) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    const cat = validateImportCategory(category);
    if (!cat.ok) return cat;
    const sources = validateSourcePathList(filePaths);
    if (!sources.ok) return sources;

    const result = privateFilesManager.importFilesFromSources(
      space.value,
      cat.value,
      sources.value
    );
    if (result.ok) {
      for (const item of result.imported) {
        activityLog.record('FILE_ADDED', {
          spaceId: space.value,
          category: cat.value,
          type: item.type,
        });
        recentFilesManager.record({
          spaceId: space.value,
          category: cat.value,
          relativePath: item.relativePath,
          name: item.name,
          action: 'imported',
        });
      }
    }
    return result;
  });

  ipcMain.handle('personal:getMediaUrl', (_event, spaceId, category, relativePath) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    const cat = validateCategory(category);
    if (!cat.ok) return cat;
    const rel = validateRelativePath(relativePath, { allowEmpty: false });
    if (!rel.ok) return rel;

    const allowed =
      cat.value === 'photos'
        ? new Set(['image'])
        : cat.value === 'videos'
          ? new Set(['video'])
          : new Set(['image', 'video']);

    const media = privateFilesManager.resolveMediaFile(
      space.value,
      cat.value,
      rel.value,
      allowed
    );
    if (!media.ok) {
      return { ok: false, error: media.error || 'This item cannot be accessed.' };
    }

    recentFilesManager.record({
      spaceId: space.value,
      category: cat.value,
      relativePath: media.item.relativePath,
      name: media.item.name,
      action: cat.value === 'videos' ? 'played' : 'opened',
    });

    return {
      ok: true,
      url: privateMediaProtocol.buildMediaUrl(space.value, cat.value, rel.value),
      item: media.item,
    };
  });

  ipcMain.handle('personal:getRecent', (_event, spaceId) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    return { ok: true, recent: recentFilesManager.getRecent(space.value, 20) };
  });

  ipcMain.handle('personal:openRecentFile', (_event, spaceId, category, relativePath) => {
    const space = validateSpaceId(spaceId);
    if (!space.ok) return space;
    const gate = requirePrivateAccess(space.value);
    if (gate) return gate;
    const cat = validateCategory(category);
    if (!cat.ok) return cat;
    const rel = validateRelativePath(relativePath, { allowEmpty: false });
    if (!rel.ok) return rel;

    const listed = privateFilesManager.resolveMediaFile(space.value, cat.value, rel.value, null);
    // For non-media, just verify existence via list parent / resolveSafePath
    if (!listed.ok) {
      const check = privateFilesManager.resolveSafePath(space.value, cat.value, rel.value, {
        requireExisting: true,
      });
      if (!check.ok) {
        recentFilesManager.removeMatching(space.value, cat.value, rel.value);
        return { ok: false, error: 'This file is no longer available.' };
      }
      return {
        ok: true,
        item: {
          spaceId: space.value,
          category: cat.value,
          relativePath: rel.value,
          name: rel.value.split('/').pop(),
          type: privateFilesManager.classifyExtension(
            `.${(rel.value.split('.').pop() || '').toLowerCase()}`
          ),
        },
      };
    }
    return { ok: true, item: listed.item };
  });

  ipcMain.handle('personal:getServices', () => {
    const gate = requireAuth();
    if (gate) return gate;
    const { spaces } = spaceManager.listSpaces();
    return { ok: true, services: getAvailableServices(spaces) };
  });

  ipcMain.handle('clipboard:get', () => {
    const gate = requireAuth();
    if (gate) return gate;
    return privateClipboard.getText();
  });

  ipcMain.handle('clipboard:set', (_event, text) => {
    const gate = requireAuth();
    if (gate) return gate;
    return privateClipboard.setText(text);
  });

  ipcMain.handle('clipboard:clear', () => {
    const gate = requireAuth();
    if (gate) return gate;
    return privateClipboard.clear();
  });

  ipcMain.handle('clipboard:status', () => {
    const gate = requireAuth();
    if (gate) return gate;
    return privateClipboard.getStatus();
  });

  ipcMain.handle('privacy:get', () => {
    const gate = requireAuth();
    if (gate) return gate;
    return { ok: true, privacy: getPrivacySettings(), clipboard: privateClipboard.getStatus() };
  });

  ipcMain.handle('privacy:update', (_event, partial) => {
    const gate = requireAuth();
    if (gate) return gate;
    const result = updatePrivacySettings(partial || {});
    if (result.ok && typeof result.privacy.clipboardRetentionSeconds === 'number') {
      privateClipboard.setRetentionSeconds(result.privacy.clipboardRetentionSeconds);
    }
    return result;
  });

  ipcMain.handle('notes:list', () => {
    const gate = requireUnlocked();
    if (gate) return gate;
    return secureNotes.listNotes(DEFAULT_PRIVATE_SPACE_ID);
  });

  ipcMain.handle('notes:get', (_event, id) => {
    const gate = requireUnlocked();
    if (gate) return gate;
    return secureNotes.getNote(DEFAULT_PRIVATE_SPACE_ID, id);
  });

  ipcMain.handle('notes:create', (_event, title, body) => {
    const gate = requireUnlocked();
    if (gate) return gate;
    const result = secureNotes.createNote(DEFAULT_PRIVATE_SPACE_ID, title, body);
    if (result.ok) {
      activityLog.record('NOTE_CREATED');
    }
    return result;
  });

  ipcMain.handle('notes:update', (_event, id, title, body) => {
    const gate = requireUnlocked();
    if (gate) return gate;
    const result = secureNotes.updateNote(DEFAULT_PRIVATE_SPACE_ID, id, title, body);
    if (result.ok) {
      activityLog.record('NOTE_UPDATED');
    }
    return result;
  });

  ipcMain.handle('notes:delete', (_event, id) => {
    const gate = requireUnlocked();
    if (gate) return gate;
    const result = secureNotes.deleteNote(DEFAULT_PRIVATE_SPACE_ID, id);
    if (result.ok) {
      activityLog.record('NOTE_DELETED');
    }
    return result;
  });

  ipcMain.handle('backup:exportWithPassword', async (_event, password) => {
    const gate = requireUnlocked();
    if (gate) return gate;
    if (typeof password !== 'string') {
      return { ok: false, error: 'Password required.' };
    }
    const verified = passwordManager.verifyPassword(password);
    if (!verified.ok) {
      return { ok: false, error: verified.error || 'Incorrect password.' };
    }
    const win = browserManager.getBrowserWindow();
    const save = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, {
      title: 'Export encrypted vault backup',
      defaultPath: `SafeNest-backup-${new Date().toISOString().slice(0, 10)}.vbak`,
      filters: [{ name: 'SafeNest Backup', extensions: ['vbak'] }],
    });
    if (save.canceled || !save.filePath) {
      return { ok: false, cancelled: true };
    }
    const created = vaultBackup.createEncryptedBackup(password);
    if (!created.ok) {
      return created;
    }
    try {
      fs.writeFileSync(save.filePath, created.buffer);
    } catch {
      return { ok: false, error: 'Could not write backup file.' };
    }
    activityLog.record('BACKUP_EXPORTED', { files: created.fileCount });
    return { ok: true, path: save.filePath, fileCount: created.fileCount };
  });

  ipcMain.handle('backup:importWithPassword', async (_event, password) => {
    const gate = requireUnlocked();
    if (gate) return gate;
    if (typeof password !== 'string') {
      return { ok: false, error: 'Password required.' };
    }
    const verified = passwordManager.verifyPassword(password);
    if (!verified.ok) {
      return { ok: false, error: verified.error || 'Incorrect password.' };
    }
    const win = browserManager.getBrowserWindow();
    const picked = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
      title: 'Restore encrypted vault backup',
      properties: ['openFile'],
      filters: [{ name: 'SafeNest Backup', extensions: ['vbak'] }],
    });
    if (picked.canceled || !picked.filePaths?.[0]) {
      return { ok: false, cancelled: true };
    }
    let buffer;
    try {
      buffer = fs.readFileSync(picked.filePaths[0]);
    } catch {
      return { ok: false, error: 'Could not read backup file.' };
    }
    const restored = vaultBackup.restoreEncryptedBackup(password, buffer);
    if (!restored.ok) {
      return restored;
    }
    privateFilesManager.ensureAllLayouts();
    secureNotes.ensureNotesDir(DEFAULT_PRIVATE_SPACE_ID);
    privateFilesManager.invalidateStats();
    activityLog.record('BACKUP_RESTORED', { files: restored.restored });
    return { ok: true, restored: restored.restored };
  });

  ipcMain.handle('lock:getState', () => ({
    ...lockManager.getState(),
    ...lockMeta(),
  }));

  ipcMain.handle('lock:lock', () =>
    lockVault({ reason: 'MANUAL_LOCK', immediate: false })
  );

  ipcMain.handle('lock:panic', () =>
    lockVault({ reason: 'PANIC_LOCK', immediate: true })
  );

  ipcMain.handle('lock:unlock', (_event, password) => {
    return unlockVault(password);
  });

  ipcMain.handle('lock:setAutoLockMinutes', (_event, minutes) => {
    const gate = requireAuth();
    if (gate) return gate;
    const value = Number(minutes);
    if (!Number.isFinite(value)) {
      return { ok: false, error: 'Invalid timeout.' };
    }
    const allowed = lockManager.AUTO_LOCK_OPTIONS.some((opt) => opt.value === value);
    if (!allowed) {
      return { ok: false, error: 'Unsupported timeout.' };
    }
    lockManager.setAutoLockTimeoutMinutes(value);
    return { ok: true, ...lockManager.getState(), ...lockMeta() };
  });

  ipcMain.handle('lock:noteActivity', () => {
    if (authenticated && !lockManager.isLocked()) {
      lockManager.noteActivity();
    }
    return { ok: true };
  });

  ipcMain.handle('dashboard:get', () => {
    if (!authenticated) {
      return { spaces: [], recent: [], activity: [], locked: true };
    }
    return getDashboardPayload();
  });

  ipcMain.handle('spaces:list', () => {
    const gate = requireAuth();
    if (gate) return gate;
    return { ok: true, ...spaceManager.listSpaces() };
  });

  ipcMain.handle('spaces:create', (_event, name, domains) => {
    const gate = requireAuth();
    if (gate) return gate;
    if (typeof name !== 'string') {
      return { ok: false, error: 'Invalid space name.' };
    }
    const result = spaceManager.createSpace(
      name,
      Array.isArray(domains) ? domains : []
    );
    if (result.ok) {
      activityLog.record('SPACE_CREATED', { spaceName: name.trim() });
    }
    return result;
  });

  ipcMain.handle('spaces:switch', (_event, spaceId) => {
    const gate = requireAuth();
    if (gate) return gate;
    if (typeof spaceId !== 'string') {
      return { ok: false, error: 'Invalid space.' };
    }
    const result = spaceManager.setActiveSpace(spaceId);
    if (result.ok) {
      activityLog.record('SPACE_SWITCHED', {
        spaceId,
        spaceName: spaceManager.getSpaceById(spaceId)?.name,
      });
    }
    return result;
  });

  ipcMain.handle('domains:add', (_event, spaceId, domain, allowSubdomains) => {
    const gate = requireAuth();
    if (gate) return gate;
    if (typeof spaceId !== 'string' || typeof domain !== 'string') {
      return { ok: false, error: 'Invalid domain input.' };
    }
    const result = spaceManager.addDomainToSpace(
      spaceId,
      domain,
      Boolean(allowSubdomains)
    );
    if (result.ok) {
      activityLog.record('DOMAIN_ADDED', { domain: result.domain, spaceId });
    }
    return result;
  });

  ipcMain.handle('domains:remove', (_event, spaceId, domain) => {
    const gate = requireAuth();
    if (gate) return gate;
    if (typeof spaceId !== 'string' || typeof domain !== 'string') {
      return { ok: false, error: 'Invalid domain input.' };
    }
    const result = spaceManager.removeDomainFromSpace(spaceId, domain);
    if (result.ok) {
      activityLog.record('DOMAIN_REMOVED', { domain, spaceId });
      browserManager.checkCurrentUrlStillAllowed();
    }
    return result;
  });

  ipcMain.handle('activity:clear', () => {
    const gate = requireAuth();
    if (gate) return gate;
    activityLog.clear();
    return { ok: true };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another VaultBrowse is already running, or a crashed run left a stale
  // SingletonLock under userData. Prefer focusing the existing instance.
  console.error(
    '[VaultBrowse] Another instance is already running (or a stale lock exists).'
  );
  console.error(
    `[VaultBrowse] If no window is visible, quit leftover Electron processes and remove:\n  ${path.join(app.getPath('userData'), 'SingletonLock')}`
  );
  app.quit();
} else {
  app.on('second-instance', () => {
    let win = browserManager.getBrowserWindow() || loginWindow;
    // On macOS the app can stay alive with zero windows after close.
    // A second `npm start` must bring UI back, not silently no-op.
    if (!win || win.isDestroyed()) {
      if (!authenticated) {
        win = createLoginWindow();
      } else {
        win = browserManager.createBrowserWindow();
      }
    }
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    spaceManager.listSpaces();
    spaceManager.ensureWebSpace();
    privateFilesManager.ensureAllLayouts();
    secureNotes.ensureNotesDir(DEFAULT_PRIVATE_SPACE_ID);
    privateMediaProtocol.setAccessChecker(() => ({
      authenticated,
      locked: lockManager.isLocked(),
    }));
    privateMediaProtocol.registerMediaProtocol();
    browserManager.setVaultUnlockedChecker(
      () => authenticated && !lockManager.isLocked()
    );
    privateClipboard.setRetentionSeconds(getPrivacySettings().clipboardRetentionSeconds);
    browserManager.setDownloadCompleteHandler((info) => {
      activityLog.record('FILE_ADDED', {
        spaceId: info.spaceId,
        category: 'downloads',
        type: privateFilesManager.classifyExtension(
          `.${(info.name.split('.').pop() || '').toLowerCase()}`
        ),
      });
      recentFilesManager.record({
        spaceId: info.spaceId,
        category: 'downloads',
        relativePath: info.relativePath,
        name: info.name,
        action: 'downloaded',
      });
    });
    lockManager.setOnAutoLock(() => {
      void lockVault({ reason: 'AUTO_LOCK', immediate: true });
    });
    // OS lock must not leave the Google auth window visible. Unlocking Windows
    // must never unlock VaultBrowse — only password unlock does.
    powerMonitor.on('lock-screen', () => {
      browserManager.closeAuthWindows();
      const privacy = getPrivacySettings();
      if (privacy.lockOnWindowsLock && authenticated && !lockManager.isLocked()) {
        void lockVault({ reason: 'AUTO_LOCK', immediate: true });
      } else {
        // Still close auth UI; do not leave Google windows visible on OS lock.
        privateClipboard.clear();
      }
    });
    createLoginWindow();
  });

  app.on('window-all-closed', () => {
    lockManager.stopWatching();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      authenticated = false;
      lockManager.reset();
      createLoginWindow();
    }
  });
}
