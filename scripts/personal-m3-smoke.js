'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultbrowse-m3-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const passwordManager = require('../src/security/passwordManager');
  const clipboard = require('../src/personal/privateClipboard');
  const recentFiles = require('../src/personal/recentFilesManager');
  const {
    getPrivacySettings,
    updatePrivacySettings,
  } = require('../src/storage/settingsManager');
  const { canAccessPrivateFiles } = require('../src/personal/accessGate');

  assert(passwordManager.createPassword('m3-test-pass-ok').ok, 'password');

  // Clipboard basics — never persists to disk
  assert(clipboard.getStatus().empty === true, 'clipboard starts empty');
  assert(clipboard.setText('secret-otp-1234').ok, 'set clipboard');
  assert(clipboard.getText().text === 'secret-otp-1234', 'get clipboard');
  assert(clipboard.setText('').ok === false, 'reject empty');
  assert(clipboard.setText(123).ok === false, 'reject non-string');
  assert(clipboard.setRetentionSeconds(30).ok, 'retention 30s');
  assert(clipboard.setRetentionSeconds(999).ok === false, 'bad retention');
  clipboard.clear();
  assert(clipboard.getText().empty === true, 'cleared');

  // Status must not echo contents
  clipboard.setText('do-not-leak');
  const status = clipboard.getStatus();
  assert(status.hasContent === true, 'has content flag');
  assert(!JSON.stringify(status).includes('do-not-leak'), 'status omits text');
  clipboard.clear();

  // Privacy settings
  const privacy = getPrivacySettings();
  assert(privacy.lockOnWindowsLock === true, 'default lock on OS lock');
  assert(privacy.clearClipboardOnLock === true, 'default clear clipboard');
  assert(privacy.clearBrowsingDataOnPanic === true, 'default clear browsing on panic');
  const updated = updatePrivacySettings({
    clearRecentFilesOnLock: true,
    clipboardRetentionSeconds: 60,
    clearBrowsingDataOnLock: true,
  });
  assert(updated.ok && updated.privacy.clearRecentFilesOnLock === true, 'privacy update');
  assert(getPrivacySettings().clipboardRetentionSeconds === 60, 'retention persisted');
  assert(getPrivacySettings().clearBrowsingDataOnLock === true, 'browsing wipe persisted');

  // Recent clear helper
  recentFiles.record({
    spaceId: 'personal',
    category: 'files',
    relativePath: 'a.txt',
    name: 'a.txt',
    action: 'imported',
  });
  assert(recentFiles.getRecent('personal').length >= 1, 'recent present');
  recentFiles.clearAll();
  assert(recentFiles.getRecent('personal').length === 0, 'recent cleared');

  // Lock gate still required for private access
  assert(
    canAccessPrivateFiles({ authenticated: true, locked: true, spaceId: 'personal' }).ok === false,
    'locked still denies files'
  );

  console.log('PERSONAL_M3_SMOKE_OK');
  app.exit(0);
}).catch((error) => {
  console.error('PERSONAL_M3_SMOKE_FAIL');
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
