'use strict';

/**
 * Main-process unlock / password-attempt throttle.
 * Renderer counters are NOT security controls — this is.
 */

const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 60 * 1000;
const MAX_PASSWORD_CHARS = 512;

/** @type {{ failures: number[], lockUntil: number }} */
let state = {
  failures: [],
  lockUntil: 0,
};

function prune(now = Date.now()) {
  state.failures = state.failures.filter((t) => now - t < WINDOW_MS);
}

function checkAllowed() {
  const now = Date.now();
  if (state.lockUntil && now < state.lockUntil) {
    // Generic message — avoid exact remaining-seconds oracle over IPC spam.
    return {
      ok: false,
      error: 'Too many failed attempts. Try again later.',
      retryAfterMs: state.lockUntil - now,
    };
  }
  if (state.lockUntil && now >= state.lockUntil) {
    state.lockUntil = 0;
  }
  prune(now);
  return { ok: true };
}

function recordFailure() {
  const now = Date.now();
  prune(now);
  state.failures.push(now);
  if (state.failures.length >= LOCKOUT_AFTER) {
    state.lockUntil = now + LOCKOUT_MS;
    state.failures = [];
  }
  return checkAllowed();
}

function recordSuccess() {
  state.failures = [];
  state.lockUntil = 0;
}

function validatePasswordInput(password) {
  if (typeof password !== 'string') {
    return { ok: false, error: 'Invalid password input.' };
  }
  if (password.length > MAX_PASSWORD_CHARS) {
    return { ok: false, error: 'Invalid password input.' };
  }
  return { ok: true };
}

function getStatus() {
  prune();
  return {
    failuresInWindow: state.failures.length,
    lockedOut: Boolean(state.lockUntil && Date.now() < state.lockUntil),
    lockUntil: state.lockUntil || 0,
  };
}

/** Test helper only */
function _resetForTests() {
  state = { failures: [], lockUntil: 0 };
}

module.exports = {
  WINDOW_MS,
  LOCKOUT_AFTER,
  LOCKOUT_MS,
  MAX_PASSWORD_CHARS,
  checkAllowed,
  recordFailure,
  recordSuccess,
  validatePasswordInput,
  getStatus,
  _resetForTests,
};
