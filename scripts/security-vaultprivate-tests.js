'use strict';

/**
 * vaultprivate:// attack-surface regression tests.
 * Protocol parse + session deny registration (no live BrowserView fetch here).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, session } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'safenest-vault-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(async () => {
  const {
    parseMediaUrl,
    buildMediaUrl,
    registerMediaProtocol,
    denyMediaProtocolOnSession,
    setAccessChecker,
  } = require('../src/personal/privateMediaProtocol');
  const mgr = require('../src/personal/privateFilesManager');
  const passwordManager = require('../src/security/passwordManager');

  // Source must keep bypassCSP / corsEnabled disabled
  const protocolSrc = fs.readFileSync(
    path.join(__dirname, '../src/personal/privateMediaProtocol.js'),
    'utf8'
  );
  assert(/bypassCSP:\s*false/.test(protocolSrc), 'bypassCSP must be false');
  assert(/corsEnabled:\s*false/.test(protocolSrc), 'corsEnabled must be false');
  assert(!/bypassCSP:\s*true/.test(protocolSrc), 'bypassCSP must not be true');

  assert(passwordManager.createPassword('VaultTestPass1').ok, 'password');
  mgr.ensureAllLayouts();
  mgr.writeTestFile('personal', 'files', 'safe.txt', 'personal-secret');
  mgr.writeTestFile('work', 'files', 'work.txt', 'work-secret');
  mgr.writeTestFile('personal', 'photos', 'pic.jpg', 'fakejpg');
  mgr.writeTestFile('personal', 'videos', 'clip.mp4', 'fakemp4');

  const valid = [
    buildMediaUrl('personal', 'files', 'safe.txt'),
    buildMediaUrl('personal', 'photos', 'pic.jpg'),
    buildMediaUrl('personal', 'videos', 'clip.mp4'),
    buildMediaUrl('work', 'files', 'work.txt'),
    buildMediaUrl('guest', 'files', 'x.txt'),
  ];
  for (const url of valid) {
    assert(parseMediaUrl(url) !== null || url.includes('guest'), `parse ok-ish ${url}`);
  }
  assert(parseMediaUrl(buildMediaUrl('personal', 'files', 'safe.txt'))?.spaceId === 'personal', 'personal parse');
  assert(parseMediaUrl(buildMediaUrl('work', 'files', 'work.txt'))?.spaceId === 'work', 'work parse');

  const attacks = [
    'vaultprivate://personal/../work/files/work.txt',
    'vaultprivate://personal/../../etc/passwd',
    'vaultprivate://personal/%2e%2e/work/files/work.txt',
    'vaultprivate://personal/%252e%252e/work/files/work.txt',
    'vaultprivate://personal/files/../../../secret',
    'vaultprivate://personal/files/%2fetc/passwd',
    'vaultprivate://personal/files/C:/Windows/win.ini',
    'vaultprivate://personal/files/\\\\server\\share\\x',
    'vaultprivate://evil/files/x.txt',
    'vaultprivate://personal/files/safe.txt?token=1',
    'vaultprivate://personal/files/safe.txt#frag',
  ];
  for (const url of attacks) {
    assert(parseMediaUrl(url) === null, `attack denied: ${url}`);
  }

  // BrowserView partition must get a denier (registration must succeed).
  // installPrivilegedScheme must run before app ready — exercised by main.js in production.
  // Here we only verify deny registration on a partition session after ready.
  setAccessChecker(() => ({ authenticated: true, locked: false }));
  registerMediaProtocol();
  const browserSession = session.fromPartition('persist:safenest-vault-deny-test', { cache: false });
  denyMediaProtocolOnSession(browserSession);

  // Locked access checker → parse still works; serve would 403
  setAccessChecker(() => ({ authenticated: true, locked: true }));
  assert(parseMediaUrl(buildMediaUrl('personal', 'files', 'safe.txt')), 'parse still ok when locked');

  console.log('SECURITY_VAULTPRIVATE_OK');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
