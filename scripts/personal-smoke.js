'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultbrowse-personal-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const {
    resolveSafePath,
    getSpaceRoot,
    getPrivateSpaceRoot,
    CATEGORIES,
  } = require('../src/personal/privateSpacePaths');
  const privateFiles = require('../src/personal/privateFilesManager');
  const { getAvailableServices, SERVICE_REGISTRY } = require('../src/personal/serviceRegistry');
  const spaceManager = require('../src/spaces/spaceManager');
  const passwordManager = require('../src/security/passwordManager');

  assert(passwordManager.createPassword('personal-test-pass').ok, 'create password');

  privateFiles.ensureAllLayouts();
  const root = getPrivateSpaceRoot();
  assert(root.startsWith(tempRoot), 'private root under userData');
  assert(fs.existsSync(path.join(root, 'personal', 'Files')), 'personal Files dir');
  assert(fs.existsSync(path.join(root, 'work', 'Photos')), 'work Photos dir');
  assert(fs.existsSync(path.join(root, 'guest', 'Downloads')), 'guest Downloads dir');

  // Path traversal protection
  assert(resolveSafePath('personal', 'files', '../../secret.txt').ok === false, 'block ../');
  assert(resolveSafePath('personal', 'files', '..\\..\\secret.txt').ok === false, 'block ..\\');
  assert(resolveSafePath('personal', 'files', 'C:\\Windows\\system32').ok === false, 'block absolute win');
  assert(resolveSafePath('personal', 'files', '/etc/passwd').ok === false, 'block absolute unix');
  assert(resolveSafePath('personal', 'files', 'notes/../../secret').ok === false, 'block nested traversal');
  const okPath = resolveSafePath('personal', 'files', 'docs/readme.txt');
  assert(okPath.ok, 'allow nested relative');
  assert(okPath.absolutePath.startsWith(getSpaceRoot('personal')), 'resolved under personal root');

  // Space isolation
  const personalWrite = privateFiles.writeTestFile('personal', 'files', 'only-personal.txt', 'secret');
  assert(personalWrite.ok, 'write personal file');
  const personalList = privateFiles.listFiles('personal', 'files');
  assert(personalList.ok && personalList.items.some((i) => i.name === 'only-personal.txt'), 'list personal');
  const workList = privateFiles.listFiles('work', 'files');
  assert(workList.ok && workList.items.every((i) => i.name !== 'only-personal.txt'), 'work cannot see personal file');

  // Folder / rename / delete
  const folder = privateFiles.createFolder('personal', 'files', '', 'Projects');
  assert(folder.ok, 'create folder');
  const renamed = privateFiles.renameFile('personal', 'files', 'only-personal.txt', 'renamed.txt');
  assert(renamed.ok && renamed.item.name === 'renamed.txt', 'rename file');
  const deleted = privateFiles.deleteFile('personal', 'files', 'renamed.txt');
  assert(deleted.ok, 'delete file');
  const afterDelete = privateFiles.listFiles('personal', 'files');
  assert(afterDelete.items.every((i) => i.name !== 'renamed.txt'), 'deleted gone');

  // Unsupported / dangerous classification
  assert(privateFiles.classifyExtension('.pdf') === 'document', 'pdf document');
  assert(privateFiles.classifyExtension('.png') === 'image', 'png image');
  assert(privateFiles.classifyExtension('.mp4') === 'video', 'mp4 video');
  assert(privateFiles.classifyExtension('.exe') === 'executable', 'exe flagged');
  assert(privateFiles.classifyExtension('.xyz') === 'other', 'unknown type allowed as other');
  assert(Object.keys(CATEGORIES).length === 4, 'four categories');

  // Stats cache
  privateFiles.writeTestFile('personal', 'photos', 'a.jpg', 'x');
  const stats = privateFiles.getStats('personal', { force: true });
  assert(stats.ok && stats.stats.photos >= 1, 'photo stats');

  // Service registry does not override allowlist
  const { spaces } = spaceManager.listSpaces();
  const services = getAvailableServices(spaces);
  assert(services.some((s) => s.id === 'whatsapp'), 'whatsapp available from spaces');
  assert(services.some((s) => s.id === 'chatgpt'), 'chatgpt available from spaces');
  assert(services.some((s) => s.id === 'gmail'), 'gmail available from work space');
  assert(
    services.every((s) => spaces.some((sp) => sp.id === s.spaceId)),
    'every service maps to a real space'
  );
  // YouTube/Drive not in default spaces → should not appear
  assert(services.every((s) => s.id !== 'youtube'), 'youtube hidden until allowed');
  assert(SERVICE_REGISTRY.whatsapp.domain === 'web.whatsapp.com', 'registry metadata present');

  // Invalid space id
  assert(privateFiles.listFiles('not-a-space', 'files').ok === false, 'invalid space denied');
  assert(resolveSafePath('personal', 'not-a-category', 'x').ok === false, 'invalid category denied');

  const { canAccessPrivateFiles } = require('../src/personal/accessGate');
  assert(
    canAccessPrivateFiles({ authenticated: false, locked: false, spaceId: 'personal' }).ok === false,
    'unauthenticated file access denied'
  );
  assert(
    canAccessPrivateFiles({ authenticated: true, locked: true, spaceId: 'personal' }).ok === false,
    'locked file access denied'
  );
  assert(
    canAccessPrivateFiles({ authenticated: true, locked: false, spaceId: 'work' }).ok === true,
    'unlocked work private root allowed for its own id'
  );
  assert(
    canAccessPrivateFiles({ authenticated: true, locked: false, spaceId: 'personal' }).ok === true,
    'unlocked personal access allowed'
  );

  console.log('PERSONAL_SMOKE_OK');
  app.exit(0);
}).catch((error) => {
  console.error('PERSONAL_SMOKE_FAIL');
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
