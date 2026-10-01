'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'safenest-lock-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const lockManager = require('../src/security/lockManager');
  const passwordManager = require('../src/security/passwordManager');
  const authThrottle = require('../src/security/authThrottle');
  const { canAccessPrivateFiles } = require('../src/personal/accessGate');
  const mgr = require('../src/personal/privateFilesManager');
  const { buildMediaUrl, setAccessChecker, parseMediaUrl } = require('../src/personal/privateMediaProtocol');

  authThrottle._resetForTests();
  assert(passwordManager.createPassword('LockTestPass9').ok, 'password');
  mgr.ensureAllLayouts();
  const src = path.join(tempRoot, 'a.txt');
  fs.writeFileSync(src, 'hello');
  assert(mgr.importFilesFromSources('personal', 'files', [src]).ok, 'import while conceptual unlock');

  // Simulate locked Nest
  lockManager.lock();
  assert(lockManager.isLocked(), 'locked');
  assert(
    canAccessPrivateFiles({
      authenticated: true,
      locked: lockManager.isLocked(),
      spaceId: 'personal',
    }).ok === false,
    'list gate fails when locked'
  );

  let accessState = { authenticated: true, locked: true };
  setAccessChecker(() => accessState);
  // Protocol handler registration needs app ready — parse still works offline
  assert(parseMediaUrl(buildMediaUrl('personal', 'files', 'a.txt')), 'media url builds');

  // Unlock path
  assert(passwordManager.verifyPassword('wrong').ok === false, 'bad password');
  assert(passwordManager.verifyPassword('LockTestPass9').ok, 'good password');
  lockManager.unlock();
  assert(!lockManager.isLocked(), 'unlocked');
  assert(
    canAccessPrivateFiles({
      authenticated: true,
      locked: lockManager.isLocked(),
      spaceId: 'personal',
    }).ok,
    'gate open when unlocked'
  );

  // Panic-equivalent: lock immediately
  lockManager.lock();
  assert(lockManager.isLocked(), 'panic-style lock');

  console.log('SECURITY_LOCK_OK');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
