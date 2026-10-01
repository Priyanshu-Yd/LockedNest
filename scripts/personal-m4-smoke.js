'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultbrowse-m4-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const passwordManager = require('../src/security/passwordManager');
  const secureNotes = require('../src/personal/secureNotes');
  const vaultBackup = require('../src/personal/vaultBackup');
  const privateFilesManager = require('../src/personal/privateFilesManager');
  const {
    getPrivacySettings,
    updatePrivacySettings,
  } = require('../src/storage/settingsManager');

  assert(passwordManager.createPassword('m4-backup-pass').ok, 'password');
  privateFilesManager.ensureAllLayouts();
  secureNotes.ensureNotesDir('personal');

  // Notes CRUD
  const created = secureNotes.createNote('personal', 'Secret PIN', 'pin-9988');
  assert(created.ok && created.note.id, 'create note');
  const listed = secureNotes.listNotes('personal');
  assert(listed.ok && listed.notes.some((n) => n.id === created.note.id), 'list notes');
  assert(
    listed.notes.every((n) => typeof n.body === 'undefined'),
    'list omits body field'
  );
  const got = secureNotes.getNote('personal', created.note.id);
  assert(got.ok && got.note.body === 'pin-9988', 'get note body');
  const updated = secureNotes.updateNote('personal', created.note.id, 'Secret PIN', 'pin-updated');
  assert(updated.ok && updated.note.body === 'pin-updated', 'update note');
  assert(secureNotes.deleteNote('personal', created.note.id).ok, 'delete note');
  assert(secureNotes.getNote('personal', created.note.id).ok === false, 'deleted gone');

  // Privacy defaults for browsing wipe
  const privacy = getPrivacySettings();
  assert(privacy.clearBrowsingDataOnLock === false, 'default no wipe on normal lock');
  assert(privacy.clearBrowsingDataOnPanic === true, 'default wipe on panic');
  const updatedPrivacy = updatePrivacySettings({ clearBrowsingDataOnLock: true });
  assert(updatedPrivacy.ok && updatedPrivacy.privacy.clearBrowsingDataOnLock === true, 'privacy update wipe');

  // Encrypted backup round-trip
  privateFilesManager.writeTestFile('personal', 'files', 'hello.txt', 'vault-hello');
  const note = secureNotes.createNote('personal', 'Backup me', 'note-body-42');
  assert(note.ok, 'note for backup');

  const exported = vaultBackup.createEncryptedBackup('m4-backup-pass');
  assert(exported.ok && exported.buffer?.length > 20, 'export backup');
  assert(vaultBackup.decryptBackup('wrong-pass', exported.buffer).ok === false, 'bad password rejected');

  // Wipe private space and restore
  const root = path.join(tempRoot, 'PrivateSpace');
  fs.rmSync(root, { recursive: true, force: true });
  const restored = vaultBackup.restoreEncryptedBackup('m4-backup-pass', exported.buffer);
  assert(restored.ok && restored.restored >= 1, 'restore backup');
  const hello = path.join(root, 'personal', 'Files', 'hello.txt');
  assert(fs.existsSync(hello) && fs.readFileSync(hello, 'utf8') === 'vault-hello', 'file restored');
  const noteAgain = secureNotes.getNote('personal', note.note.id);
  assert(noteAgain.ok && noteAgain.note.body === 'note-body-42', 'note restored');

  console.log('PERSONAL_M4_SMOKE_OK');
  app.exit(0);
}).catch((error) => {
  console.error('PERSONAL_M4_SMOKE_FAIL');
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
