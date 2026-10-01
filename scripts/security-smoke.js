'use strict';

/**
 * Security smoke — auth throttle, download vault mapping, dangerous imports,
 * locked dashboard redaction helpers, path rejection.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'safenest-sec-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const authThrottle = require('../src/security/authThrottle');
  const passwordManager = require('../src/security/passwordManager');
  const { privateVaultForBrowserSpace, resolveSafePath } = require('../src/personal/privateSpacePaths');
  const mgr = require('../src/personal/privateFilesManager');
  const { canAccessPrivateFiles } = require('../src/personal/accessGate');
  const { parseMediaUrl } = require('../src/personal/privateMediaProtocol');

  authThrottle._resetForTests();
  assert(passwordManager.createPassword('SecurityPass1').ok, 'create password');

  // Brute-force throttle
  for (let i = 0; i < 5; i += 1) {
    assert(passwordManager.verifyPassword('wrong').ok === false, `fail ${i}`);
    authThrottle.recordFailure();
  }
  const limited = authThrottle.checkAllowed();
  assert(limited.ok === false, 'lockout after failures');
  authThrottle._resetForTests();
  assert(authThrottle.checkAllowed().ok, 'reset clears lockout');
  assert(authThrottle.validatePasswordInput('x'.repeat(600)).ok === false, 'long password rejected');

  // Access gate
  assert(
    canAccessPrivateFiles({ authenticated: true, locked: true, spaceId: 'personal' }).ok === false,
    'locked blocks private'
  );
  assert(
    canAccessPrivateFiles({ authenticated: false, locked: false, spaceId: 'personal' }).ok === false,
    'unauth blocks private'
  );
  assert(
    canAccessPrivateFiles({ authenticated: true, locked: false, spaceId: 'personal' }).ok,
    'unlocked allows private'
  );

  // Unmapped browser space must not map to personal
  assert(privateVaultForBrowserSpace('custom-future').ok === false, 'unknown space rejected');
  assert(privateVaultForBrowserSpace('whatsapp').vaultId === 'personal', 'whatsapp→personal');
  assert(privateVaultForBrowserSpace('work').vaultId === 'work', 'work→work');
  assert(privateVaultForBrowserSpace('guest').vaultId === 'guest', 'guest→guest');

  // Dangerous import blocked
  mgr.ensureAllLayouts();
  const srcDir = path.join(tempRoot, 'src');
  fs.mkdirSync(srcDir);
  const exe = path.join(srcDir, 'payload.exe');
  fs.writeFileSync(exe, 'MZ');
  const blocked = mgr.importFilesFromSources('personal', 'files', [exe]);
  assert(blocked.ok === false, 'exe import blocked');
  assert(mgr.isDangerousFilename('note.bat'), 'bat dangerous');
  assert(!mgr.isDangerousFilename('resume.pdf'), 'pdf ok');

  const dl = mgr.prepareDownloadDestination('personal', '../../evil.exe');
  assert(dl.ok === false || !String(dl.filename || '').includes('..'), 'download basename sanitized/blocked');
  const dlExe = mgr.prepareDownloadDestination('personal', 'setup.exe');
  assert(dlExe.ok === false, 'exe download blocked');

  // Encoded / absolute media escapes
  assert(parseMediaUrl('vaultprivate://personal/files/..%2f..%2fsecret') === null, 'encoded traversal');
  assert(resolveSafePath('personal', 'files', '%2e%2e%2fsecret').ok === false, 'percent dots in resolve');
  assert(resolveSafePath('personal', 'files', '%2e%2e/secret').ok === false, 'percent dots variant');

  console.log('SECURITY_SMOKE_OK');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
