'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'safenest-ipc-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const {
    validateSpaceId,
    validateCategory,
    validateImportCategory,
    validateRelativePath,
    validateFilename,
    validateSourcePathList,
  } = require('../src/personal/ipcValidation');

  assert(validateSpaceId(null).ok === false, 'null space');
  assert(validateSpaceId(undefined).ok === false, 'undef space');
  assert(validateSpaceId({}).ok === false, 'object space');
  assert(validateSpaceId(['personal']).ok === false, 'array space');
  assert(validateSpaceId('a'.repeat(100)).ok === false, 'long space');

  assert(validateCategory(123).ok === false, 'num category');
  assert(validateCategory('notes').ok === false, 'notes not a file category');
  assert(validateImportCategory('downloads').ok === false, 'no import downloads');

  assert(validateRelativePath(null).ok, 'null relative → empty');
  assert(validateRelativePath({ path: 'x' }).ok === false, 'object relative');
  assert(validateFilename('').ok === false, 'empty name');
  assert(validateFilename('file\0name').ok === false, 'null byte name');

  assert(validateSourcePathList('x').ok === false, 'paths not array');
  assert(validateSourcePathList([]).ok === false, 'empty paths');
  assert(validateSourcePathList(new Array(51).fill('a')).ok === false, 'too many paths');
  assert(validateSourcePathList([123]).ok === false, 'non-string path');
  assert(validateSourcePathList(['ok.txt']).ok, 'one path');

  console.log('SECURITY_IPC_OK');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
