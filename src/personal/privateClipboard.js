'use strict';

/**
 * In-memory Private Clipboard. Never persisted. Never logged.
 * Cleared on lock and optional retention timeout.
 */

const RETENTION_OPTIONS = Object.freeze([
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 0, label: 'Until lock' },
]);

/** @type {{ text: string, at: number } | null} */
let entry = null;
let clearTimer = null;
/** @type {number} seconds; 0 = until lock */
let retentionSeconds = 0;

function getRetentionSeconds() {
  return retentionSeconds;
}

function setRetentionSeconds(seconds) {
  const value = Number(seconds);
  const allowed = RETENTION_OPTIONS.some((opt) => opt.value === value);
  if (!allowed) {
    return { ok: false, error: 'Unsupported clipboard retention.' };
  }
  retentionSeconds = value;
  if (entry) {
    scheduleExpiry();
  }
  return { ok: true, retentionSeconds };
}

function clearTimerOnly() {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

function scheduleExpiry() {
  clearTimerOnly();
  if (!entry || !retentionSeconds) {
    return;
  }
  clearTimer = setTimeout(() => {
    entry = null;
    clearTimer = null;
  }, retentionSeconds * 1000);
  if (typeof clearTimer.unref === 'function') {
    clearTimer.unref();
  }
}

function clear() {
  clearTimerOnly();
  entry = null;
  return { ok: true, cleared: true };
}

/**
 * @param {string} text
 * @returns {{ ok: boolean, error?: string, bytes?: number }}
 */
function setText(text) {
  if (typeof text !== 'string') {
    return { ok: false, error: 'Invalid clipboard text.' };
  }
  if (text.length === 0) {
    return { ok: false, error: 'Clipboard text is empty.' };
  }
  if (text.length > 100_000) {
    return { ok: false, error: 'Clipboard text is too large.' };
  }
  entry = { text, at: Date.now() };
  scheduleExpiry();
  return { ok: true, bytes: Buffer.byteLength(text, 'utf8') };
}

function getText() {
  if (!entry) {
    return { ok: true, text: '', empty: true };
  }
  return { ok: true, text: entry.text, empty: false, at: entry.at };
}

function getStatus() {
  return {
    ok: true,
    empty: !entry,
    retentionSeconds,
    options: RETENTION_OPTIONS,
    // Never include text contents in status payloads used by settings UI.
    hasContent: Boolean(entry),
  };
}

module.exports = {
  RETENTION_OPTIONS,
  setText,
  getText,
  clear,
  getStatus,
  getRetentionSeconds,
  setRetentionSeconds,
};
