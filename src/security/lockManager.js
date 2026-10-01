'use strict';

/**
 * Lock manager
 *
 * Application-level lock + inactivity detection.
 * Uses Electron powerMonitor.getSystemIdleTime() when available (Windows/macOS/Linux)
 * so idle time can reflect OS-level input inactivity, not only DOM events.
 *
 * This is NOT Windows account security.
 */

const { loadSettings, saveSettings } = require('../storage/settingsManager');

const AUTO_LOCK_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
];

let locked = false;
let lastActivityAt = Date.now();
let watchTimer = null;
let onAutoLock = null;
let powerMonitorRef = null;

function getPowerMonitor() {
  if (powerMonitorRef) {
    return powerMonitorRef;
  }
  try {
    ({ powerMonitor: powerMonitorRef } = require('electron'));
  } catch {
    powerMonitorRef = null;
  }
  return powerMonitorRef;
}

function isLocked() {
  return locked;
}

function noteActivity() {
  if (locked) {
    return;
  }
  lastActivityAt = Date.now();
}

function getAutoLockSettings() {
  const settings = loadSettings();
  const timeoutMinutes = Number(settings.autoLock?.timeoutMinutes);
  const enabled = Boolean(settings.autoLock?.enabled) && timeoutMinutes > 0;
  return {
    enabled,
    timeoutMinutes: Number.isFinite(timeoutMinutes) ? timeoutMinutes : 5,
  };
}

function setAutoLockSettings({ enabled, timeoutMinutes }) {
  const settings = loadSettings();
  const minutes = Number(timeoutMinutes);
  const allowed = AUTO_LOCK_OPTIONS.some((opt) => opt.value === minutes);

  const next = {
    enabled: Boolean(enabled) && minutes > 0,
    timeoutMinutes: allowed && minutes > 0 ? minutes : settings.autoLock?.timeoutMinutes || 5,
  };

  if (minutes === 0) {
    next.enabled = false;
  }

  saveSettings({
    ...settings,
    autoLock: next,
  });
  noteActivity();
  return getAutoLockSettings();
}

function setAutoLockTimeoutMinutes(timeoutMinutes) {
  const minutes = Number(timeoutMinutes);
  if (minutes === 0) {
    return setAutoLockSettings({ enabled: false, timeoutMinutes: 0 });
  }
  return setAutoLockSettings({ enabled: true, timeoutMinutes: minutes });
}

function getState() {
  const autoLock = getAutoLockSettings();
  return {
    locked,
    autoLock,
    options: AUTO_LOCK_OPTIONS,
    idleSource: 'powerMonitor+appActivity',
  };
}

function lock() {
  if (locked) {
    return { ok: true, locked: true };
  }
  locked = true;
  return { ok: true, locked: true };
}

function unlock() {
  locked = false;
  noteActivity();
  return { ok: true, locked: false };
}

function setOnAutoLock(callback) {
  onAutoLock = typeof callback === 'function' ? callback : null;
}

function getIdleMs() {
  const pm = getPowerMonitor();
  let systemIdleMs = 0;
  if (pm && typeof pm.getSystemIdleTime === 'function') {
    try {
      systemIdleMs = Number(pm.getSystemIdleTime()) * 1000;
    } catch {
      systemIdleMs = 0;
    }
  }
  const appIdleMs = Date.now() - lastActivityAt;
  // Use the greater idle signal so background OS idle still locks even if
  // the app process missed a few DOM activity pings — and vice versa.
  return Math.max(systemIdleMs, appIdleMs);
}

function checkAutoLock() {
  if (locked) {
    return;
  }
  const { enabled, timeoutMinutes } = getAutoLockSettings();
  if (!enabled || timeoutMinutes <= 0) {
    return;
  }
  const limitMs = timeoutMinutes * 60 * 1000;
  if (getIdleMs() >= limitMs && typeof onAutoLock === 'function') {
    onAutoLock();
  }
}

function startWatching() {
  if (watchTimer) {
    return;
  }
  watchTimer = setInterval(checkAutoLock, 3000);
  if (typeof watchTimer.unref === 'function') {
    watchTimer.unref();
  }
}

function stopWatching() {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

function reset() {
  locked = false;
  lastActivityAt = Date.now();
  stopWatching();
}

module.exports = {
  AUTO_LOCK_OPTIONS,
  isLocked,
  noteActivity,
  getAutoLockSettings,
  setAutoLockSettings,
  setAutoLockTimeoutMinutes,
  getState,
  lock,
  unlock,
  setOnAutoLock,
  startWatching,
  stopWatching,
  reset,
  getIdleMs,
};
