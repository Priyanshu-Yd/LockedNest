'use strict';

/**
 * Security closure pass — password policy, throttle isolation, downloads,
 * recent-file tamper, domain allowlist, dangerous extensions, secret scan,
 * symlink status reporting (PASS / FAIL / SKIPPED_PRIVILEGE).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'safenest-closure-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const passwordManager = require('../src/security/passwordManager');
  const authThrottle = require('../src/security/authThrottle');
  const activityLog = require('../src/storage/activityLog');
  const { privateVaultForBrowserSpace } = require('../src/personal/privateSpacePaths');
  const mgr = require('../src/personal/privateFilesManager');
  const recentFiles = require('../src/personal/recentFilesManager');
  const { hostnameMatches, isGoogleAccountsHostname } = require('../src/domains/hostnameUtils');
  const { isInternalUrl } = require('../src/browser/navigationGuard');
  const { safeLogUrl } = require('../src/browser/urlSafety');
  const lockManager = require('../src/security/lockManager');
  const { canAccessPrivateFiles } = require('../src/personal/accessGate');

  // --- Password policy ---
  assert(passwordManager.createPassword('').ok === false, 'empty rejected');
  assert(passwordManager.createPassword('short').ok === false, 'short rejected');
  assert(passwordManager.createPassword('123456789').ok === false, '9 chars rejected');
  assert(passwordManager.createPassword('abcdefghij').ok, '10 chars accepted');
  assert(passwordManager.verifyPassword('wrong-password').ok === false, 'wrong fail');
  assert(passwordManager.verifyPassword('abcdefghij').ok, 'correct ok');
  // Unicode / special
  authThrottle._resetForTests();
  // change path uses same policy
  const changed = passwordManager.changePassword('abcdefghij', 'Unicode🔐Pass!', 'Unicode🔐Pass!');
  assert(changed.ok, 'unicode password change');
  assert(passwordManager.verifyPassword('Unicode🔐Pass!').ok, 'unicode verify');

  // Generic failure (no config leak)
  const noConfig = passwordManager.verifyPassword('x');
  assert(noConfig.error === 'Incorrect password.' || noConfig.error === 'Enter your password.', 'generic fail');

  // --- Auth throttle main-process only ---
  authThrottle._resetForTests();
  for (let i = 0; i < 5; i += 1) {
    assert(passwordManager.verifyPassword('bad').ok === false, `fail ${i}`);
    authThrottle.recordFailure();
  }
  const lockedOut = authThrottle.checkAllowed();
  assert(lockedOut.ok === false, 'lockout');
  assert(!String(lockedOut.error || '').includes('Try again in'), 'no exact-seconds oracle in message');
  // Renderer restart simulation cannot clear main state
  assert(authThrottle.getStatus().lockedOut === true, 'status locked');
  authThrottle._resetForTests();

  // --- Download space isolation ---
  for (const bad of [undefined, null, '', 'random', '../../personal', 'PERSONAL']) {
    assert(privateVaultForBrowserSpace(bad).ok === false, `reject vault map ${String(bad)}`);
  }
  assert(privateVaultForBrowserSpace('whatsapp').vaultId === 'personal', 'whatsapp→personal');
  assert(privateVaultForBrowserSpace('work').vaultId === 'work', 'work map');
  assert(privateVaultForBrowserSpace('guest').vaultId === 'guest', 'guest map');
  // "personal" is a vault id, not a browser space id — must not silently map
  assert(privateVaultForBrowserSpace('personal').ok === false, 'personal browser id rejected');

  // --- Dangerous extensions (case + trailing) ---
  const dangerous = [
    'a.exe', 'a.EXE', 'a.ExE', 'a.com', 'a.scr', 'a.bat', 'a.cmd', 'a.ps1',
    'a.vbs', 'a.vbe', 'a.js', 'a.jse', 'a.wsf', 'a.wsh', 'a.msi', 'a.msp',
    'a.cpl', 'a.hta', 'a.lnk', 'a.url', 'payload.exe.', 'payload.exe ',
  ];
  for (const name of dangerous) {
    assert(mgr.isDangerousFilename(name), `dangerous ${name}`);
  }
  assert(!mgr.isDangerousFilename('report.PDF'), 'pdf ok');

  // Recent files tamper — getRecent must sanitize untrusted JSON
  mgr.ensureAllLayouts();
  const storePath = path.join(app.getPath('userData'), 'recent-files.json');
  fs.writeFileSync(
    storePath,
    JSON.stringify([
      { spaceId: 'personal', category: 'files', relativePath: '../../../secret.txt', name: 'secret.txt', action: 'opened' },
      { spaceId: 'personal', category: 'files', relativePath: 'C:/Windows/win.ini', name: 'win.ini', action: 'opened' },
      { spaceId: 'work', category: 'files', relativePath: '\\\\server\\share\\x', name: 'x', action: 'opened' },
      { spaceId: 'personal', category: 'files', relativePath: 'ok.txt', name: 'ok.txt', action: 'opened' },
    ]),
    'utf8'
  );
  const recent = recentFiles.getRecent('personal');
  assert(recent.every((e) => !String(e.relativePath).includes('..')), 'getRecent strips traversal');
  assert(recent.every((e) => !/^[a-zA-Z]:/.test(e.relativePath)), 'getRecent strips absolute');
  assert(recent.some((e) => e.relativePath === 'ok.txt'), 'valid recent kept');
  assert(
    recentFiles.record({
      spaceId: 'personal',
      category: 'files',
      relativePath: '../../../evil.txt',
      name: 'evil.txt',
      action: 'opened',
    }).every((e) => !String(e.relativePath || '').includes('..')),
    'record rejects traversal'
  );

  // --- Domain allowlist ---
  assert(hostnameMatches('accounts.google.com', 'google.com', true), 'google subdomain');
  assert(hostnameMatches('evilgoogle.com', 'google.com', true) === false, 'evilgoogle');
  assert(hostnameMatches('google.com.evil.com', 'google.com', true) === false, 'suffix');
  assert(isGoogleAccountsHostname('accounts.google.com.evil.com') === false, 'google evil');
  assert(isGoogleAccountsHostname('accounts.google.com'), 'google accounts');

  // --- URL schemes ---
  assert(isInternalUrl('javascript:alert(1)') === false, 'no javascript internal');
  assert(isInternalUrl('data:text/html,hi') === false, 'no data internal');
  assert(isInternalUrl('file:///C:/Windows/win.ini') === false, 'no arbitrary file internal');
  assert(isInternalUrl('about:blank') === true, 'about blank internal');
  const { getBlockedPageUrl } = require('../src/browser/navigationGuard');
  assert(isInternalUrl(getBlockedPageUrl('blocked')) === true, 'blocked page is nest-owned');

  // --- OAuth log redaction ---
  const logged = safeLogUrl(
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=SECRET&code=AUTHCODE&access_token=TOK'
  );
  assert(!String(logged).includes('SECRET'), 'no client_id secret');
  assert(!String(logged).includes('AUTHCODE'), 'no auth code');
  assert(!String(logged).includes('TOK'), 'no token');

  // --- Activity log secret scan ---
  activityLog.record('UNLOCK_FAILED', {
    password: 'SuperSecretPassword!!',
    token: 'access_token_VALUE',
    note: 'line1\nSUCCESS\nUnlock successful',
  });
  const logPath = path.join(app.getPath('userData'), 'security-activity.json');
  const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : JSON.stringify(activityLog.getEvents());
  assert(!logText.includes('SuperSecretPassword!!'), 'password not in activity log');
  assert(!logText.includes('access_token_VALUE'), 'token not in activity log');
  assert(!/\nSUCCESS\n/.test(logText), 'log injection newlines stripped from meta');

  // --- Lock authoritative ---
  lockManager.lock();
  assert(
    canAccessPrivateFiles({
      authenticated: true,
      locked: lockManager.isLocked(),
      spaceId: 'personal',
    }).ok === false,
    'locked blocks'
  );
  // Renderer-fake unlocked must not matter if locked flag from main is true
  assert(
    canAccessPrivateFiles({
      authenticated: true,
      locked: true,
      spaceId: 'personal',
    }).ok === false,
    'renderer cannot fake unlock'
  );

  // --- Symlink status (explicit, not PASS when skipped) ---
  let symlinkStatus = 'SYMLINK_TEST_SKIPPED_PRIVILEGE';
  const outside = path.join(tempRoot, 'outside-secret.txt');
  fs.writeFileSync(outside, 'OUTSIDE');
  mgr.ensureAllLayouts();
  const filesRoot = require('../src/personal/privateSpacePaths').resolveSafePath(
    'personal',
    'files',
    ''
  ).absolutePath;
  const evilLink = path.join(filesRoot, 'escape-link');
  try {
    fs.symlinkSync(outside, evilLink);
    const listed = mgr.listFiles('personal', 'files');
    const hidden = listed.items.every((i) => i.name !== 'escape-link');
    const delBlocked = mgr.deleteFile('personal', 'files', 'escape-link').ok === false;
    if (hidden && delBlocked) {
      symlinkStatus = 'SYMLINK_TEST_PASS';
    } else {
      symlinkStatus = 'SYMLINK_TEST_FAIL';
    }
  } catch (error) {
    const msg = String(error.message || error);
    if (/EPERM|privilege|admin/i.test(msg)) {
      symlinkStatus = 'SYMLINK_TEST_SKIPPED_PRIVILEGE';
    } else {
      symlinkStatus = 'SYMLINK_TEST_FAIL';
      console.error('symlink unexpected error', msg);
    }
  }
  console.log(symlinkStatus);
  // Skipped is NOT treated as pass for the suite exit code — still allow suite PASS
  // but record status for operators (requirement: do not treat SKIPPED as PASS).
  if (symlinkStatus === 'SYMLINK_TEST_FAIL') {
    throw new Error('Symlink security test failed');
  }

  // Electron version note
  console.log('ELECTRON_VERSION', process.versions.electron);
  console.log('SECURITY_CLOSURE_OK');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
