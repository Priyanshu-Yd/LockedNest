'use strict';

const { isValidPrivateSpaceId } = require('./privateSpacePaths');

/**
 * Main-process gate for private file IPC. Renderer hiding is not enough.
 */
function canAccessPrivateFiles({ authenticated, locked, spaceId }) {
  if (!authenticated) {
    return { ok: false, error: 'Not authenticated.' };
  }
  if (locked) {
    return { ok: false, error: 'Your Nest is locked.' };
  }
  if (!isValidPrivateSpaceId(spaceId)) {
    return { ok: false, error: 'Invalid Nest.' };
  }
  return { ok: true };
}

module.exports = {
  canAccessPrivateFiles,
};
