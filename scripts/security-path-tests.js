'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'safenest-path-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const { resolveSafePath } = require('../src/personal/privateSpacePaths');
  const {
    validateRelativePath,
    validateFilename,
    validateSpaceId,
    rejectSchemeLike,
  } = require('../src/personal/ipcValidation');
  const { assertSafeImportSource, sanitizeDownloadBasename } = require('../src/personal/fsSecurity');

  const attacks = [
    '../',
    '../../',
    '../../../',
    '..\\..\\',
    '..%2f',
    '%2e%2e%2f',
    '%252e%252e%252f',
    'C:\\',
    'C:/',
    '\\\\server\\share',
    '//server/share',
    'file:///',
    'notes/../../x',
    'a/../../b',
    '\0file',
  ];

  for (const p of attacks) {
    const resolved = resolveSafePath('personal', 'files', p);
    assert(resolved.ok === false, `resolve reject: ${p}`);
  }

  assert(validateRelativePath('../x').ok === false, 'relative validator rejects ..');
  assert(resolveSafePath('personal', 'files', '../x').ok === false, 'resolve still rejects ../x');

  assert(validateFilename('../x').ok === false, 'filename with slash');
  assert(validateFilename('..').ok === false, 'filename ..');
  assert(validateSpaceId('work').ok, 'work space');
  assert(validateSpaceId('personal ').ok === false, 'space trailing space');
  assert(rejectSchemeLike('javascript:alert(1)'), 'scheme rejected');
  assert(sanitizeDownloadBasename('../../evil.txt') === 'evil.txt', 'basename strip');
  assert(sanitizeDownloadBasename('..') === 'download', 'basename dots');

  const ghost = path.join(tempRoot, 'ghost.txt');
  fs.writeFileSync(ghost, 'x');
  assert(assertSafeImportSource(ghost).ok, 'normal file import source');

  console.log('SECURITY_PATH_OK');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
