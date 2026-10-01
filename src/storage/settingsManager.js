'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_PRIVACY = Object.freeze({
  lockOnWindowsLock: true,
  clearClipboardOnLock: true,
  clearRecentFilesOnLock: false,
  clearBrowsingDataOnLock: false,
  clearBrowsingDataOnPanic: true,
  privacyBlur: true,
  clipboardRetentionSeconds: 0,
});

const DEFAULT_SETTINGS = {
  homeUrl: 'https://web.whatsapp.com/',
  allowedDomains: [
    'web.whatsapp.com',
    'github.com',
    'mail.google.com',
    'accounts.google.com',
    'chatgpt.com',
    'openai.com',
    'accounts.youtube.com',
  ],
  migrations: {},
  autoLock: {
    enabled: false,
    timeoutMinutes: 5,
  },
  privacy: { ...DEFAULT_PRIVACY },
  activeSpaceId: 'whatsapp',
  spaces: null,
  recent: [],
  lastUnlockedAt: null,
};

let settingsPath = null;

function getSettingsPath() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }
  return settingsPath;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadSettings() {
  const filePath = getSettingsPath();
  try {
    if (!fs.existsSync(filePath)) {
      return {
        ...DEFAULT_SETTINGS,
        autoLock: { ...DEFAULT_SETTINGS.autoLock },
        recent: [],
      };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      autoLock: {
        ...DEFAULT_SETTINGS.autoLock,
        ...(parsed.autoLock || {}),
      },
      privacy: {
        ...DEFAULT_PRIVACY,
        ...(parsed.privacy && typeof parsed.privacy === 'object' ? parsed.privacy : {}),
      },
      allowedDomains: Array.isArray(parsed.allowedDomains)
        ? parsed.allowedDomains
        : [...DEFAULT_SETTINGS.allowedDomains],
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      spaces: Array.isArray(parsed.spaces) ? parsed.spaces : null,
      migrations:
        parsed.migrations && typeof parsed.migrations === 'object' && !Array.isArray(parsed.migrations)
          ? parsed.migrations
          : {},
      lastUnlockedAt:
        typeof parsed.lastUnlockedAt === 'string' ? parsed.lastUnlockedAt : null,
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      autoLock: { ...DEFAULT_SETTINGS.autoLock },
      privacy: { ...DEFAULT_PRIVACY },
      recent: [],
    };
  }
}

function saveSettings(settings) {
  const filePath = getSettingsPath();
  ensureDir(filePath);
  const payload = {
    ...DEFAULT_SETTINGS,
    ...settings,
    autoLock: {
      ...DEFAULT_SETTINGS.autoLock,
      ...(settings.autoLock || {}),
    },
    privacy: {
      ...DEFAULT_PRIVACY,
      ...(settings.privacy && typeof settings.privacy === 'object' ? settings.privacy : {}),
    },
    recent: Array.isArray(settings.recent) ? settings.recent : [],
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function getHomeUrl() {
  return loadSettings().homeUrl || DEFAULT_SETTINGS.homeUrl;
}

function setLastUnlockedAt(isoString) {
  const settings = loadSettings();
  return saveSettings({
    ...settings,
    lastUnlockedAt: isoString || new Date().toISOString(),
  });
}

function getLastUnlockedAt() {
  return loadSettings().lastUnlockedAt;
}

function getPrivacySettings() {
  return { ...DEFAULT_PRIVACY, ...(loadSettings().privacy || {}) };
}

function updatePrivacySettings(partial) {
  if (!partial || typeof partial !== 'object') {
    return { ok: false, error: 'Invalid privacy settings.' };
  }
  const current = loadSettings();
  const nextPrivacy = { ...DEFAULT_PRIVACY, ...(current.privacy || {}) };
  if (typeof partial.lockOnWindowsLock === 'boolean') {
    nextPrivacy.lockOnWindowsLock = partial.lockOnWindowsLock;
  }
  if (typeof partial.clearClipboardOnLock === 'boolean') {
    nextPrivacy.clearClipboardOnLock = partial.clearClipboardOnLock;
  }
  if (typeof partial.clearRecentFilesOnLock === 'boolean') {
    nextPrivacy.clearRecentFilesOnLock = partial.clearRecentFilesOnLock;
  }
  if (typeof partial.clearBrowsingDataOnLock === 'boolean') {
    nextPrivacy.clearBrowsingDataOnLock = partial.clearBrowsingDataOnLock;
  }
  if (typeof partial.clearBrowsingDataOnPanic === 'boolean') {
    nextPrivacy.clearBrowsingDataOnPanic = partial.clearBrowsingDataOnPanic;
  }
  if (typeof partial.privacyBlur === 'boolean') {
    nextPrivacy.privacyBlur = partial.privacyBlur;
  }
  if (typeof partial.clipboardRetentionSeconds === 'number') {
    nextPrivacy.clipboardRetentionSeconds = partial.clipboardRetentionSeconds;
  }
  saveSettings({ ...current, privacy: nextPrivacy });
  return { ok: true, privacy: nextPrivacy };
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_PRIVACY,
  loadSettings,
  saveSettings,
  getHomeUrl,
  getSettingsPath,
  setLastUnlockedAt,
  getLastUnlockedAt,
  getPrivacySettings,
  updatePrivacySettings,
};
