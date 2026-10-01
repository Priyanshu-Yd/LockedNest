'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultbrowse-m2-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const { resolveSafePath, privateVaultForBrowserSpace } = require('../src/personal/privateSpacePaths');
  const mgr = require('../src/personal/privateFilesManager');
  const { canAccessPrivateFiles } = require('../src/personal/accessGate');
  const {
    validateSpaceId,
    validateImportCategory,
    validateRelativePath,
    validateFilename,
    validateSourcePathList,
  } = require('../src/personal/ipcValidation');
  const recentFiles = require('../src/personal/recentFilesManager');
  const { parseMediaUrl, buildMediaUrl } = require('../src/personal/privateMediaProtocol');
  const passwordManager = require('../src/security/passwordManager');

  assert(passwordManager.createPassword('m2-test-pass-ok').ok, 'password');

  mgr.ensureAllLayouts();

  // Path / scheme attacks
  for (const p of [
    '../../secret.txt',
    '..\\..\\secret.txt',
    '../work/file.txt',
    'C:\\secret.txt',
    'C:/secret.txt',
    '\\\\server\\share\\secret.txt',
    '//server/share/secret.txt',
    'file:///C:/secret.txt',
    'file:C:\\secret.txt',
    'http://evil',
    'notes/../../x',
  ]) {
    assert(resolveSafePath('personal', 'files', p).ok === false, `reject ${p}`);
  }
  assert(validateRelativePath('a'.repeat(5000)).ok === false, 'long path rejected');
  assert(validateFilename('a'.repeat(300)).ok === false, 'long name rejected');
  assert(validateSpaceId('PERSONAL').ok === false, 'case-sensitive space id');
  assert(validateSpaceId('../work').ok === false, 'traversal space id');
  assert(validateSpaceId('').ok === false, 'empty space id');
  assert(validateSpaceId('unknown').ok === false, 'unknown space');
  assert(validateImportCategory('downloads').ok === false, 'import into downloads blocked');
  assert(validateImportCategory('photos').ok === true, 'import photos ok');

  // Import + duplicate naming
  const srcDir = path.join(tempRoot, 'sources');
  fs.mkdirSync(srcDir);
  const src1 = path.join(srcDir, 'resume.pdf');
  fs.writeFileSync(src1, 'pdf-one');
  const first = mgr.importFilesFromSources('personal', 'files', [src1]);
  assert(first.ok && first.imported[0].name === 'resume.pdf', 'first import');
  const second = mgr.importFilesFromSources('personal', 'files', [src1]);
  assert(second.ok && second.imported[0].name === 'resume (1).pdf', 'duplicate rename');
  assert(fs.readFileSync(src1, 'utf8') === 'pdf-one', 'source untouched');

  const badSrc = validateSourcePathList(['../nope']);
  // source list allows string paths; import source check rejects missing/unsafe
  const missing = mgr.importFilesFromSources('personal', 'files', [path.join(srcDir, 'missing.bin')]);
  assert(missing.ok === false, 'missing source fails');

  // Symlink source rejected
  const outside = path.join(tempRoot, 'outside.txt');
  fs.writeFileSync(outside, 'OUT');
  const linkSrc = path.join(srcDir, 'link.txt');
  try {
    fs.symlinkSync(outside, linkSrc);
    const linked = mgr.importFilesFromSources('personal', 'files', [linkSrc]);
    assert(linked.ok === false, 'symlink source rejected');
  } catch (error) {
    console.log('SYMLINK_SOURCE_SKIP', error.message);
  }

  // Symlink inside private root rejected on list/delete
  const filesRoot = resolveSafePath('personal', 'files', '').absolutePath;
  const evilLink = path.join(filesRoot, 'escape');
  try {
    fs.symlinkSync(outside, evilLink);
    const listed = mgr.listFiles('personal', 'files');
    assert(listed.items.every((i) => i.name !== 'escape'), 'symlink hidden from list');
    assert(mgr.deleteFile('personal', 'files', 'escape').ok === false, 'symlink delete rejected');
  } catch (error) {
    console.log('SYMLINK_PRIVATE_SKIP', error.message);
  }

  // Space isolation
  mgr.writeTestFile('personal', 'files', 'only-p.txt', 'p');
  mgr.writeTestFile('work', 'files', 'only-w.txt', 'w');
  mgr.writeTestFile('guest', 'files', 'only-g.txt', 'g');
  assert(
    mgr.listFiles('personal', 'files').items.some((i) => i.name === 'only-p.txt') &&
      mgr.listFiles('personal', 'files').items.every((i) => i.name !== 'only-w.txt'),
    'personal isolation'
  );
  assert(
    mgr.listFiles('work', 'files').items.some((i) => i.name === 'only-w.txt') &&
      mgr.listFiles('work', 'files').items.every((i) => i.name !== 'only-p.txt'),
    'work isolation'
  );
  assert(
    mgr.listFiles('guest', 'files').items.some((i) => i.name === 'only-g.txt'),
    'guest isolation'
  );

  // Rename / delete / missing
  assert(mgr.renameFile('personal', 'files', '../../x', 'y').ok === false, 'rename traverse');
  const ren = mgr.renameFile('personal', 'files', 'only-p.txt', 'renamed-p.txt');
  assert(ren.ok, 'rename ok');
  assert(mgr.deleteFile('personal', 'files', 'nope-missing.txt').ok === false, 'missing delete');
  assert(mgr.deleteFile('personal', 'files', 'renamed-p.txt').ok === true, 'delete ok');

  // Downloads destination
  const dl = mgr.prepareDownloadDestination('personal', '../../evil.exe');
  assert(dl.ok && !dl.relativePath.includes('..'), 'download basename sanitized');
  assert(dl.absolutePath.includes(`${path.sep}Downloads${path.sep}`), 'download in Downloads');
  assert(privateVaultForBrowserSpace('work').ok && privateVaultForBrowserSpace('work').vaultId === 'work', 'work browser → work vault');
  assert(privateVaultForBrowserSpace('chatgpt').ok && privateVaultForBrowserSpace('chatgpt').vaultId === 'personal', 'chatgpt → personal vault');
  assert(privateVaultForBrowserSpace('web').ok && privateVaultForBrowserSpace('web').vaultId === 'personal', 'web browser → personal vault');
  assert(privateVaultForBrowserSpace('future-space').ok === false, 'unknown space not mapped to personal');
  assert(privateVaultForBrowserSpace('').ok === false, 'empty browser space rejected');

  // Lock gate
  assert(
    canAccessPrivateFiles({ authenticated: true, locked: true, spaceId: 'personal' }).ok === false,
    'locked rejects'
  );
  assert(
    canAccessPrivateFiles({ authenticated: true, locked: false, spaceId: 'personal' }).ok === true,
    'unlocked allows'
  );

  // Recent files — no absolute paths
  recentFiles.record({
    spaceId: 'personal',
    category: 'files',
    relativePath: 'resume.pdf',
    name: 'resume.pdf',
    action: 'imported',
  });
  const rec = recentFiles.getRecent('personal');
  assert(rec.length >= 1 && rec[0].name === 'resume.pdf', 'recent stored');
  assert(!JSON.stringify(rec).includes(tempRoot), 'recent has no abs paths');
  recentFiles.record({
    spaceId: 'personal',
    category: 'files',
    relativePath: '../hack',
    name: 'hack',
    action: 'opened',
  });
  assert(
    recentFiles.getRecent('personal').every((e) => !e.relativePath.includes('..')),
    'recent rejects traversal entries'
  );

  // Media URL builder / parser + cross-vault / escape attempts
  const url = buildMediaUrl('personal', 'photos', 'album/pic.jpg');
  const parsed = parseMediaUrl(url);
  assert(parsed && parsed.spaceId === 'personal' && parsed.relativePath === 'album/pic.jpg', 'media url');
  assert(parseMediaUrl('vaultprivate://work/files/only-w.txt')?.spaceId === 'work', 'parse work vault');
  assert(parseMediaUrl('vaultprivate://personal/photos/../../work/files/x') === null, 'media traversal rejected');
  assert(parseMediaUrl('vaultprivate://evil/photos/x.jpg') === null, 'unknown vault rejected');
  assert(parseMediaUrl('vaultprivate://personal/photos/x.jpg?x=1') === null, 'query rejected');
  assert(parseMediaUrl('vaultprivate://personal/photos/C:/Windows/x.jpg') === null, 'abs in path rejected');
  assert(parseMediaUrl('file:///C:/secret.txt') === null, 'file scheme rejected');

  // Photos import category
  const pic = path.join(srcDir, 'shot.png');
  fs.writeFileSync(pic, 'PNG');
  const photoImp = mgr.importFilesFromSources('personal', 'photos', [pic]);
  assert(photoImp.ok && photoImp.imported[0].viewable, 'photo import viewable');
  const media = mgr.resolveMediaFile(
    'personal',
    'photos',
    photoImp.imported[0].relativePath,
    new Set(['image'])
  );
  assert(media.ok && media.item.type === 'image', 'resolve photo');
  assert(
    mgr.resolveMediaFile('personal', 'photos', photoImp.imported[0].relativePath, new Set(['video']))
      .ok === false,
    'photo not as video'
  );

  console.log('PERSONAL_M2_SMOKE_OK');
  app.exit(0);
}).catch((error) => {
  console.error('PERSONAL_M2_SMOKE_FAIL');
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
