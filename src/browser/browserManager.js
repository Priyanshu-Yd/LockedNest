'use strict';

const path = require('path');
const { BrowserWindow, BrowserView, session } = require('electron');
const spaceManager = require('../spaces/spaceManager');
const recentManager = require('../storage/recentManager');
const { attachNavigationGuards, getBlockedPageUrl, isInternalUrl } =
  require('./navigationGuard');
const { toHttpsUrl } = require('../domains/hostnameUtils');
const { safeLogUrl } = require('./urlSafety');
const privateFilesManager = require('../personal/privateFilesManager');
const {
  privateVaultForBrowserSpace,
  getCategoryDir,
} = require('../personal/privateSpacePaths');
const privateMediaProtocol = require('../personal/privateMediaProtocol');
const {
  buildChromeUserAgent,
  buildFirefoxUserAgent,
  isGoogleAuthUrl,
  isChatGptGoogleLoginUrl,
  isChatGptSignedInUrl,
  requestHeadersForUrl,
  applyUserAgentForUrl,
  userAgentForUrl,
  injectStealth,
  installEarlyIdentity,
} = require('./browserIdentity');

installEarlyIdentity();

/** @type {(() => boolean) | null} */
let vaultUnlockedChecker = null;
/** @type {((info: { spaceId: string, relativePath: string, name: string }) => void) | null} */
let downloadCompleteHandler = null;

let browserWindow = null;
/** @type {Map<string, Electron.BrowserView>} */
const viewsBySpace = new Map();
let activeViewSpaceId = null;
let contentAttached = false;
/** @type {'dashboard'|'browser'|'settings'|'files'|'photos'|'videos'|'downloads'|'clipboard'} */
let shellMode = 'dashboard';
const configuredSessions = new Set();

/**
 * WebContents IDs that belong to the active ChatGPT Google OAuth flow.
 * Only these receive Firefox compatibility identity via webRequest.
 * @type {Set<number>}
 */
const authWebContentsIds = new Set();

/**
 * Dedicated authentication BrowserWindows (never normal site popups).
 * @type {Set<Electron.BrowserWindow>}
 */
const authWindows = new Set();

/** @type {Electron.BrowserWindow | null} */
let googleAuthWindow = null;

/** @type {Promise<{ok: boolean, error?: string}> | null} */
let googleAuthInFlight = null;

/**
 * Internal auth-flow context. Never exposed to renderer/web content.
 * @type {{
 *   purpose: string,
 *   spaceId: string,
 *   sourceWebContentsId: number | null,
 *   authWindow: Electron.BrowserWindow | null,
 *   webContentsIds: Set<number>,
 * } | null}
 */
let googleAuthContext = null;

/** @type {((reason: string) => void) | null} */
let lockShortcutHandler = null;

const TOOLBAR_HEIGHT = 64;
/** Keep in sync with `.side-nav` width in personal.css */
const SIDE_NAV_WIDTH = 196;

function browserSpaceIdForPartition(partition) {
  const spaces = spaceManager.listSpaces().spaces || [];
  const match = spaces.find((space) => space.partition === partition);
  return match?.id || activeViewSpaceId || 'whatsapp';
}

function getSessionForPartition(partition) {
  const vaultSession = session.fromPartition(partition, { cache: true });
  if (!configuredSessions.has(partition)) {
    vaultSession.setUserAgent(buildChromeUserAgent());
    // BrowserView partitions must not resolve vaultprivate:// media.
    privateMediaProtocol.denyMediaProtocolOnSession(vaultSession);
    // Auth-window Firefox identity is scoped by webContentsId. Google hosts
    // also use Firefox headers as a compatibility workaround. Everything else
    // keeps Chrome-like identity (needed for WhatsApp Web).
    vaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      callback({
        requestHeaders: requestHeadersForUrl(
          details.url,
          details.requestHeaders,
          authWebContentsIds.has(details.webContentsId)
        ),
      });
    });

    // Default download directory for this partition (never OS Downloads).
    try {
      const defaultVault = privateVaultForBrowserSpace(
        browserSpaceIdForPartition(partition)
      );
      if (defaultVault.ok) {
        privateFilesManager.ensureSpaceLayout(defaultVault.vaultId);
        const downloadDir = getCategoryDir(defaultVault.vaultId, 'downloads');
        if (downloadDir) {
          vaultSession.setDownloadPath(downloadDir);
        }
      }
    } catch {
      // will-download handler below remains authoritative
    }

    vaultSession.on('will-download', (_event, item) => {
      if (vaultUnlockedChecker && !vaultUnlockedChecker()) {
        item.cancel();
        return;
      }
      const browserSpaceId = browserSpaceIdForPartition(partition);
      const mapped = privateVaultForBrowserSpace(browserSpaceId);
      // Unknown / unmapped spaces must NOT silently fall back to personal.
      if (!mapped.ok) {
        item.cancel();
        console.warn(
          `[SafeNest] blocked download: no private vault mapping for space ${browserSpaceId}`
        );
        return;
      }
      const vaultId = mapped.vaultId;
      const dest = privateFilesManager.prepareDownloadDestination(
        vaultId,
        item.getFilename()
      );
      if (!dest.ok) {
        item.cancel();
        console.warn('[SafeNest] blocked download: unsafe destination');
        return;
      }
      // Force path — suppresses the system Save dialog.
      item.setSavePath(dest.absolutePath);
      item.once('done', (_e, state) => {
        if (state === 'completed' && typeof downloadCompleteHandler === 'function') {
          downloadCompleteHandler({
            spaceId: vaultId,
            relativePath: dest.relativePath,
            name: dest.filename,
          });
        }
      });
    });

    configuredSessions.add(partition);
  }
  return vaultSession;
}

function getVaultSession() {
  const space = spaceManager.getActiveSpace();
  return getSessionForPartition(space.partition);
}

function layoutContentView() {
  if (
    !browserWindow ||
    browserWindow.isDestroyed() ||
    !contentAttached ||
    !activeViewSpaceId
  ) {
    return;
  }
  const view = viewsBySpace.get(activeViewSpaceId);
  if (!view) {
    return;
  }
  const [width, height] = browserWindow.getContentSize();
  const x = SIDE_NAV_WIDTH;
  view.setBounds({
    x,
    y: TOOLBAR_HEIGHT,
    width: Math.max(width - x, 0),
    height: Math.max(height - TOOLBAR_HEIGHT, 0),
  });
}

function markAuthWebContents(webContents) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }
  authWebContentsIds.add(webContents.id);
  if (googleAuthContext) {
    googleAuthContext.webContentsIds.add(webContents.id);
  }
  webContents.setUserAgent(buildFirefoxUserAgent());
}

function unmarkAuthWebContents(webContents) {
  if (!webContents) {
    return;
  }
  try {
    const id = webContents.id;
    authWebContentsIds.delete(id);
    if (googleAuthContext) {
      googleAuthContext.webContentsIds.delete(id);
    }
  } catch {
    // webContents may already be destroyed
  }
}

function clearGoogleAuthContext() {
  if (googleAuthContext) {
    for (const id of googleAuthContext.webContentsIds) {
      authWebContentsIds.delete(id);
    }
  }
  googleAuthContext = null;
  googleAuthWindow = null;
}

function closeAuthWindows() {
  for (const win of [...authWindows]) {
    if (!win.isDestroyed()) {
      unmarkAuthWebContents(win.webContents);
      win.close();
    }
  }
  authWindows.clear();
  clearGoogleAuthContext();
  googleAuthInFlight = null;
}

function attachAuthLockShortcuts(webContents) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }
  webContents.on('before-input-event', (_event, input) => {
    if (!lockShortcutHandler || input.type !== 'keyDown') {
      return;
    }
    const key = String(input.key || '').toLowerCase();
    if (input.control && input.shift && !input.alt && !input.meta) {
      if (key === 'p') {
        lockShortcutHandler('PANIC_LOCK');
        return;
      }
      if (key === 'l') {
        lockShortcutHandler('MANUAL_LOCK');
      }
    }
  });
}

function authPopupWindowOptions(parentContents) {
  return {
    width: 520,
    height: 740,
    minWidth: 420,
    minHeight: 560,
    title: 'Sign in — SafeNest',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    alwaysOnTop: true,
    webPreferences: {
      session: parentContents.session,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  };
}

/**
 * Nested window.open inside an auth window: keep OAuth in the same window when
 * possible. about:blank children are allowed as auth windows so opener flows work.
 */
function continueAuthInSameWindow(webContents, spaceId) {
  return {
    onPopup(details) {
      const popupUrl = typeof details.url === 'string' ? details.url : '';
      console.log(
        `[VaultBrowse] auth window.open: ${popupUrl ? safeLogUrl(popupUrl) : '(empty)'} disposition=${details.disposition}`
      );
      if (!popupUrl || popupUrl === 'about:blank') {
        return {
          action: 'allow',
          outlivesOpener: false,
          overrideBrowserWindowOptions: authPopupWindowOptions(webContents),
        };
      }
      if (!spaceManager.isUrlAllowedInSpace(popupUrl, spaceId) && !popupUrl.startsWith('about:')) {
        console.warn(`[VaultBrowse] blocked auth popup: ${safeLogUrl(popupUrl)}`);
        return { action: 'deny' };
      }
      if (!webContents.isDestroyed()) {
        webContents.loadURL(popupUrl, { userAgent: buildFirefoxUserAgent() });
      }
      return { action: 'deny' };
    },
  };
}

/**
 * Track a child window created during an active Google auth context only.
 */
function trackAuthChildWindow(popup, spaceId) {
  if (!googleAuthContext || googleAuthContext.spaceId !== spaceId) {
    // Not an auth flow — close unexpected windows created outside auth context.
    if (!popup.isDestroyed()) {
      popup.close();
    }
    return;
  }

  authWindows.add(popup);
  const popupContents = popup.webContents;
  markAuthWebContents(popupContents);
  attachAuthLockShortcuts(popupContents);
  attachNavigationGuards(
    popupContents,
    () => spaceId,
    (url, reason) => {
      console.warn(`[VaultBrowse] blocked auth popup ${reason}: ${safeLogUrl(url)}`);
    },
    continueAuthInSameWindow(popupContents, spaceId)
  );
  popupContents.on('did-create-window', (child) => {
    trackAuthChildWindow(child, spaceId);
  });
  popup.once('ready-to-show', () => {
    if (!popup.isDestroyed()) {
      popup.show();
      popup.focus();
    }
  });
  popup.on('closed', () => {
    unmarkAuthWebContents(popupContents);
    authWindows.delete(popup);
  });
}

function finishGoogleAuthSuccess(spaceId) {
  if (googleAuthWindow && !googleAuthWindow.isDestroyed()) {
    googleAuthWindow.close();
  }
  clearGoogleAuthContext();

  const view = viewsBySpace.get(spaceId);
  if (!view || view.webContents.isDestroyed()) {
    return;
  }
  const home = spaceManager.getSpaceHomeUrl(spaceId) || 'https://chatgpt.com/';
  view.webContents.loadURL(home, { userAgent: buildChromeUserAgent() });
  if (browserWindow && !browserWindow.isDestroyed() && activeViewSpaceId === spaceId) {
    sendShell('browser:url', home);
  }
}

function wireGoogleAuthWindow(authWin, spaceId) {
  const wc = authWin.webContents;
  markAuthWebContents(wc);
  attachAuthLockShortcuts(wc);
  attachNavigationGuards(
    wc,
    () => spaceId,
    (blockedUrl, reason) => {
      console.warn(`[VaultBrowse] blocked Google auth ${reason}: ${safeLogUrl(blockedUrl)}`);
    },
    continueAuthInSameWindow(wc, spaceId)
  );

  wc.on('did-create-window', (child) => {
    trackAuthChildWindow(child, spaceId);
  });

  const logNav = (phase, nextUrl) => {
    console.log(`[VaultBrowse] Google auth ${phase}: ${safeLogUrl(nextUrl)}`);
  };

  wc.on('will-navigate', (_event, nextUrl) => {
    logNav('navigate', nextUrl);
  });
  wc.on('will-redirect', (_event, nextUrl) => {
    logNav('redirect', nextUrl);
  });
  wc.on('did-fail-load', (_event, code, desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) {
      return;
    }
    console.warn(
      `[VaultBrowse] Google auth failed load (${code}): ${desc} @ ${safeLogUrl(validatedURL)}`
    );
  });
  wc.on('did-navigate', (_event, nextUrl) => {
    logNav('did-navigate', nextUrl);
    if (isChatGptSignedInUrl(nextUrl)) {
      finishGoogleAuthSuccess(spaceId);
    }
  });

  authWin.once('ready-to-show', () => {
    if (!authWin.isDestroyed()) {
      authWin.show();
      authWin.focus();
    }
  });
  authWin.on('closed', () => {
    unmarkAuthWebContents(wc);
    authWindows.delete(authWin);
    if (googleAuthWindow === authWin) {
      clearGoogleAuthContext();
    }
  });
}

function isAbortError(error) {
  const message = error && error.message ? String(error.message) : String(error || '');
  return message.includes('ERR_ABORTED') || message.includes('(-3)');
}

/**
 * Open ChatGPT's Google login in one dedicated auth window.
 * Only called from the recognized ChatGPT OAuth start URL.
 */
async function openGoogleAuthWindow(spaceId, startUrl, sourceWebContents) {
  // Source validation: only ChatGPT space + known Google OAuth start URL.
  if (spaceId !== 'chatgpt' || !isChatGptGoogleLoginUrl(startUrl)) {
    console.warn(
      `[VaultBrowse] refused auth window for non-OAuth source: space=${spaceId} url=${safeLogUrl(startUrl)}`
    );
    return { ok: false, error: 'Not a ChatGPT Google login request.' };
  }

  if (googleAuthInFlight) {
    if (googleAuthWindow && !googleAuthWindow.isDestroyed()) {
      googleAuthWindow.focus();
    }
    return googleAuthInFlight;
  }

  googleAuthInFlight = (async () => {
    const space = spaceManager.getSpaceById(spaceId);
    if (!space) {
      return { ok: false, error: 'Space not found.' };
    }

    const partitionSession = getSessionForPartition(space.partition);
    let sourceId = null;
    try {
      sourceId = sourceWebContents && !sourceWebContents.isDestroyed() ? sourceWebContents.id : null;
    } catch {
      sourceId = null;
    }

    if (!googleAuthWindow || googleAuthWindow.isDestroyed()) {
      const authWin = new BrowserWindow({
        width: 520,
        height: 740,
        minWidth: 420,
        minHeight: 560,
        title: 'Google sign-in — SafeNest',
        backgroundColor: '#ffffff',
        autoHideMenuBar: true,
        alwaysOnTop: true,
        show: true,
        webPreferences: {
          session: partitionSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
        },
      });
      googleAuthWindow = authWin;
      authWindows.add(authWin);
      googleAuthContext = {
        purpose: 'chatgpt-google-oauth',
        spaceId,
        sourceWebContentsId: sourceId,
        authWindow: authWin,
        webContentsIds: new Set(),
      };
      wireGoogleAuthWindow(authWin, spaceId);
    } else {
      if (googleAuthContext) {
        googleAuthContext.sourceWebContentsId = sourceId;
      }
      googleAuthWindow.show();
      googleAuthWindow.focus();
    }

    const authWin = googleAuthWindow;
    const wc = authWin.webContents;
    console.log(`[VaultBrowse] Google auth loading: ${safeLogUrl(startUrl)}`);
    const ua = buildFirefoxUserAgent();
    wc.setUserAgent(ua);
    try {
      await authWin.loadURL(startUrl, { userAgent: ua });
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn('[VaultBrowse] Google auth load error:', error && error.message ? error.message : error);
        return { ok: false, error: error.message || 'Load failed.' };
      }
    }
    return { ok: true };
  })().finally(() => {
    googleAuthInFlight = null;
  });

  return googleAuthInFlight;
}

function setContentVisible(visible) {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return;
  }
  contentAttached = Boolean(visible) && shellMode === 'browser' && Boolean(activeViewSpaceId);
  if (contentAttached) {
    const view = viewsBySpace.get(activeViewSpaceId);
    if (view) {
      browserWindow.setBrowserView(view);
      layoutContentView();
    }
  } else {
    closeAuthWindows();
    browserWindow.setBrowserView(null);
  }
}

function isContentVisible() {
  return contentAttached;
}

function sendShell(channel, payload) {
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.webContents.send(channel, payload);
  }
}

function getActiveContentView() {
  if (!activeViewSpaceId) {
    return null;
  }
  return viewsBySpace.get(activeViewSpaceId) || null;
}

/**
 * Classify a content-view window.open target.
 * Permission to open ≠ authentication treatment.
 * @returns {'auth' | 'normal' | 'deny'}
 */
function classifyContentPopup(spaceId, popupUrl) {
  if (spaceId === 'chatgpt' && isChatGptGoogleLoginUrl(popupUrl)) {
    return 'auth';
  }
  if (!popupUrl || popupUrl === 'about:blank') {
    return 'deny';
  }
  if (!spaceManager.isUrlAllowedInSpace(popupUrl, spaceId)) {
    return 'deny';
  }
  return 'normal';
}

/**
 * Normal BrowserView popups: allowlisted targets load in the same view with
 * Chrome-like identity. They never become auth windows / Firefox / alwaysOnTop.
 */
function handleNormalContentPopup(webContents, spaceId, details) {
  const popupUrl = typeof details.url === 'string' ? details.url : '';
  const kind = classifyContentPopup(spaceId, popupUrl);

  if (kind === 'auth') {
    void openGoogleAuthWindow(spaceId, popupUrl, webContents);
    return { action: 'deny' };
  }

  if (kind === 'deny') {
    if (popupUrl && popupUrl !== 'about:blank') {
      console.warn(`[VaultBrowse] blocked popup: ${safeLogUrl(popupUrl)}`);
    }
    return { action: 'deny' };
  }

  // Normal allowlisted popup — Chrome identity, same view, not auth-tracked.
  if (!webContents.isDestroyed()) {
    const ua = buildChromeUserAgent();
    webContents.setUserAgent(ua);
    webContents.loadURL(popupUrl, { userAgent: ua });
  }
  return { action: 'deny' };
}

function wireContentEvents(view, spaceId) {
  const wc = view.webContents;
  wc.setUserAgent(buildChromeUserAgent());

  const interceptGoogleLogin = (event, url) => {
    if (spaceId === 'chatgpt' && isChatGptGoogleLoginUrl(url)) {
      event.preventDefault();
      void openGoogleAuthWindow(spaceId, url, wc);
      return true;
    }
    applyUserAgentForUrl(wc, url);
    return false;
  };

  wc.on('will-navigate', interceptGoogleLogin);
  wc.on('will-redirect', interceptGoogleLogin);

  attachNavigationGuards(
    wc,
    () => spaceId,
    (url, reason) => {
      console.warn(`[VaultBrowse] blocked ${reason}: ${safeLogUrl(url)}`);
    },
    {
      onPopup(details) {
        return handleNormalContentPopup(wc, spaceId, details);
      },
    }
  );

  // Intentionally no did-create-window → auth tracking on content views.
  // Normal popups are denied + loaded in-place above.

  wc.on('dom-ready', () => {
    injectStealth(wc);
  });

  wc.on('page-title-updated', (_event, title) => {
    if (browserWindow && !browserWindow.isDestroyed() && activeViewSpaceId === spaceId) {
      browserWindow.setTitle(`${title} — SafeNest`);
      sendShell('browser:title', title);
    }
  });

  const onUrl = (_event, url) => {
    applyUserAgentForUrl(wc, url);
    if (browserWindow && !browserWindow.isDestroyed() && activeViewSpaceId === spaceId) {
      sendShell('browser:url', url);
    }
    if (!isInternalUrl(url)) {
      try {
        const host = new URL(url).hostname;
        if (spaceManager.isHostnameAllowedInSpace(host, spaceId)) {
          recentManager.recordVisit(host, spaceId);
          sendShell('recent:updated', recentManager.getRecentAllowed());
        }
      } catch {
        // ignore
      }
    }
  };

  wc.on('did-navigate', onUrl);
  wc.on('did-navigate-in-page', onUrl);
}

function getOrCreateViewForSpace(spaceId) {
  if (viewsBySpace.has(spaceId)) {
    return viewsBySpace.get(spaceId);
  }

  const space = spaceManager.getSpaceById(spaceId);
  if (!space) {
    return null;
  }

  const view = new BrowserView({
    webPreferences: {
      session: getSessionForPartition(space.partition),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  wireContentEvents(view, spaceId);
  viewsBySpace.set(spaceId, view);
  return view;
}

function setShellMode(mode) {
  shellMode = mode;
  if (mode !== 'browser') {
    setContentVisible(false);
  }
  sendShell('shell:mode', { mode, spaceId: activeViewSpaceId });
}

function getShellMode() {
  return shellMode;
}

function openSpace(spaceId, targetUrl) {
  let space =
    spaceId === 'web'
      ? spaceManager.ensureWebSpace()
      : spaceManager.getSpaceById(spaceId);
  if (!space) {
    return { ok: false, error: 'Space not found.' };
  }

  spaceManager.setActiveSpace(spaceId);
  closeAuthWindows();
  const view = getOrCreateViewForSpace(spaceId);
  if (!view) {
    return { ok: false, error: 'Could not open space browser.' };
  }

  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.setBrowserView(null);
  }

  activeViewSpaceId = spaceId;
  shellMode = 'browser';
  contentAttached = true;
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.setBrowserView(view);
    layoutContentView();
  }

  let url = targetUrl;
  if (!url) {
    url = spaceManager.getSpaceHomeUrl(spaceId);
  }
  if (!url) {
    return { ok: false, error: 'This space has no allowed websites yet.' };
  }

  if (!spaceManager.isUrlAllowedInSpace(url, spaceId) && !isInternalUrl(url)) {
    return { ok: false, error: 'This website is no longer allowed.' };
  }

  const userAgent = userAgentForUrl(url);
  view.webContents.setUserAgent(userAgent);
  view.webContents.loadURL(url, { userAgent });
  sendShell('shell:mode', { mode: 'browser', spaceId, url });
  sendShell('browser:url', url);

  try {
    const host = new URL(url).hostname;
    recentManager.recordVisit(host, spaceId);
  } catch {
    // ignore
  }

  return { ok: true, spaceId, url };
}

function showDashboard() {
  shellMode = 'dashboard';
  setContentVisible(false);
  sendShell('shell:mode', { mode: 'dashboard', spaceId: activeViewSpaceId });
  return { ok: true };
}

/**
 * Clear cookies/cache/storage for the open-Internet space only.
 * WhatsApp / Work / ChatGPT partitions are left alone.
 */
async function clearWebBrowsingData() {
  const space = spaceManager.getSpaceById('web') || spaceManager.ensureWebSpace();
  if (!space?.partition) {
    return { ok: false, error: 'Internet space not available.' };
  }
  try {
    const vaultSession = getSessionForPartition(space.partition);
    await vaultSession.clearStorageData();
    await vaultSession.clearCache();
    // Drop in-memory view so the next open loads a clean session page.
    const view = viewsBySpace.get('web');
    if (view) {
      try {
        if (browserWindow && !browserWindow.isDestroyed()) {
          const attached = browserWindow.getBrowserView();
          if (attached === view) {
            browserWindow.setBrowserView(null);
            contentAttached = false;
          }
        }
        if (view.webContents && !view.webContents.isDestroyed()) {
          view.webContents.destroy();
        }
      } catch {
        // ignore
      }
      viewsBySpace.delete('web');
    }
    if (activeViewSpaceId === 'web') {
      activeViewSpaceId = null;
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not clear browsing data.' };
  }
}

function showSettings() {
  shellMode = 'settings';
  setContentVisible(false);
  sendShell('shell:mode', { mode: 'settings', spaceId: activeViewSpaceId });
  return { ok: true };
}

const PERSONAL_MODES = new Set([
  'files',
  'photos',
  'videos',
  'downloads',
  'clipboard',
  'notes',
  'browserHub',
]);

function showPersonalSection(section) {
  const mode = String(section || '');
  if (!PERSONAL_MODES.has(mode)) {
    return { ok: false, error: 'Unknown personal section.' };
  }
  shellMode = mode;
  setContentVisible(false);
  sendShell('shell:mode', { mode, spaceId: activeViewSpaceId });
  return { ok: true, mode };
}

function showAccessRemoved() {
  const view = getActiveContentView();
  if (view && !view.webContents.isDestroyed()) {
    shellMode = 'browser';
    contentAttached = true;
    if (browserWindow && !browserWindow.isDestroyed()) {
      browserWindow.setBrowserView(view);
      layoutContentView();
    }
    view.webContents.loadURL(getBlockedPageUrl('removed'));
  }
}

function createBrowserWindow() {
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.focus();
    return browserWindow;
  }

  spaceManager.listSpaces();

  browserWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'SafeNest',
    backgroundColor: '#0a0c10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  shellMode = 'dashboard';
  contentAttached = false;
  activeViewSpaceId = null;

  browserWindow.on('resize', layoutContentView);
  browserWindow.on('closed', () => {
    closeAuthWindows();
    for (const view of viewsBySpace.values()) {
      try {
        if (view.webContents && !view.webContents.isDestroyed()) {
          view.webContents.destroy();
        }
      } catch {
        // ignore
      }
    }
    viewsBySpace.clear();
    browserWindow = null;
    activeViewSpaceId = null;
    contentAttached = false;
    shellMode = 'dashboard';
  });

  browserWindow.loadFile(
    path.join(__dirname, '..', '..', 'renderer', 'shell', 'shell.html')
  );

  browserWindow.once('ready-to-show', () => {
    if (!browserWindow || browserWindow.isDestroyed()) return;
    browserWindow.maximize();
    browserWindow.show();
  });

  return browserWindow;
}

function getBrowserWindow() {
  return browserWindow;
}

function getContentView() {
  return getActiveContentView();
}

function navigateContent(url) {
  const view = getActiveContentView();
  if (!view || view.webContents.isDestroyed()) {
    return { ok: false, error: 'No browser view open.' };
  }
  const spaceId = activeViewSpaceId;
  if (!spaceManager.isUrlAllowedInSpace(url, spaceId) && !isInternalUrl(url)) {
    view.webContents.loadURL(getBlockedPageUrl('blocked'));
    return { ok: false, error: 'This website is not allowed.' };
  }
  const userAgent = userAgentForUrl(url);
  view.webContents.setUserAgent(userAgent);
  view.webContents.loadURL(url, { userAgent });
  return { ok: true, url };
}

function openRecentDomain(domain) {
  const host = String(domain || '').toLowerCase();
  const match = spaceManager.getAllDomainsFlat().find((entry) => entry.domain === host);
  if (!match) {
    return { ok: false, error: 'This website is no longer allowed.', code: 'NOT_ALLOWED' };
  }
  return openSpace(match.spaceId, toHttpsUrl(host));
}

function goBack() {
  const view = getActiveContentView();
  if (view && view.webContents.canGoBack()) {
    view.webContents.goBack();
  }
}

function goForward() {
  const view = getActiveContentView();
  if (view && view.webContents.canGoForward()) {
    view.webContents.goForward();
  }
}

function reload() {
  const view = getActiveContentView();
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.reload();
  }
}

function getCurrentUrl() {
  const view = getActiveContentView();
  if (view && !view.webContents.isDestroyed()) {
    return view.webContents.getURL();
  }
  return '';
}

function getActiveSpaceId() {
  return activeViewSpaceId || spaceManager.getActiveSpace()?.id || null;
}

function checkCurrentUrlStillAllowed() {
  const url = getCurrentUrl();
  if (!url || isInternalUrl(url)) {
    return { ok: true };
  }
  const spaceId = activeViewSpaceId;
  if (!spaceManager.isUrlAllowedInSpace(url, spaceId)) {
    showAccessRemoved();
    return { ok: false, removed: true };
  }
  return { ok: true };
}

function setLockShortcutHandler(handler) {
  lockShortcutHandler = typeof handler === 'function' ? handler : null;
}

function setVaultUnlockedChecker(checker) {
  vaultUnlockedChecker = typeof checker === 'function' ? checker : null;
}

function setDownloadCompleteHandler(handler) {
  downloadCompleteHandler = typeof handler === 'function' ? handler : null;
}

function isAuthWebContentsId(id) {
  return authWebContentsIds.has(id);
}

function getGoogleAuthContextSnapshot() {
  if (!googleAuthContext) {
    return null;
  }
  return {
    purpose: googleAuthContext.purpose,
    spaceId: googleAuthContext.spaceId,
    authWindowOpen: Boolean(
      googleAuthContext.authWindow && !googleAuthContext.authWindow.isDestroyed()
    ),
    trackedWebContents: googleAuthContext.webContentsIds.size,
    authWebContentsTotal: authWebContentsIds.size,
  };
}

module.exports = {
  TOOLBAR_HEIGHT,
  SIDE_NAV_WIDTH,
  getChromeUserAgent: buildChromeUserAgent,
  getFirefoxUserAgent: buildFirefoxUserAgent,
  isGoogleAuthUrl,
  safeLogUrl,
  getVaultSession,
  createBrowserWindow,
  getBrowserWindow,
  getContentView,
  setContentVisible,
  isContentVisible,
  navigateContent,
  openSpace,
  openRecentDomain,
  showDashboard,
  clearWebBrowsingData,
  showSettings,
  showPersonalSection,
  showAccessRemoved,
  setShellMode,
  getShellMode,
  getActiveSpaceId,
  checkCurrentUrlStillAllowed,
  goBack,
  goForward,
  reload,
  getCurrentUrl,
  setLockShortcutHandler,
  setVaultUnlockedChecker,
  setDownloadCompleteHandler,
  closeAuthWindows,
  isAuthWebContentsId,
  getGoogleAuthContextSnapshot,
  openGoogleAuthWindow,
  classifyContentPopup,
};
