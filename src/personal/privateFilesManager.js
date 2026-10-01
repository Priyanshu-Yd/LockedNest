'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  CATEGORIES,
  PRIVATE_SPACE_IDS,
  getSpaceRoot,
  getCategoryDir,
  isValidPrivateSpaceId,
  resolveSafePath,
} = require('./privateSpacePaths');
const {
  SAFE_REJECT,
  isReparseOrSymlink,
  assertSafeImportSource,
  assertSafePrivateTarget,
  sanitizeDownloadBasename,
} = require('./fsSecurity');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv']);
const PLAYABLE_VIDEO_EXT = new Set(['.mp4', '.webm']);
const DOC_EXT = new Set([
  '.pdf',
  '.txt',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
]);
const DANGEROUS_EXT = new Set(['.exe', '.bat', '.cmd', '.ps1', '.msi', '.scr']);

/** @type {Map<string, { at: number, stats: object }>} */
const statsCache = new Map();
const STATS_TTL_MS = 15_000;

function classifyExtension(ext) {
  const e = String(ext || '').toLowerCase();
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  if (DOC_EXT.has(e)) return 'document';
  if (DANGEROUS_EXT.has(e)) return 'executable';
  return 'other';
}

function ensureSpaceLayout(spaceId) {
  if (!isValidPrivateSpaceId(spaceId)) {
    return { ok: false, error: 'Invalid Nest.' };
  }
  const root = getSpaceRoot(spaceId);
  if (!root) {
    return { ok: false, error: 'Invalid Nest.' };
  }
  fs.mkdirSync(root, { recursive: true });
  for (const category of Object.keys(CATEGORIES)) {
    const dir = getCategoryDir(spaceId, category);
    fs.mkdirSync(dir, { recursive: true });
  }
  return { ok: true, root };
}

function ensureAllLayouts() {
  for (const id of PRIVATE_SPACE_IDS) {
    ensureSpaceLayout(id);
  }
  return { ok: true };
}

function invalidateStats(spaceId) {
  if (spaceId) {
    statsCache.delete(spaceId);
  } else {
    statsCache.clear();
  }
}

function uniqueFilename(directory, originalName) {
  const base = path.basename(originalName);
  const ext = path.extname(base);
  const stem = path.basename(base, ext) || 'file';
  let candidate = base.slice(0, 255);
  let i = 1;
  while (fs.existsSync(path.join(directory, candidate))) {
    const suffix = ` (${i})`;
    const maxStem = Math.max(1, 255 - ext.length - suffix.length);
    candidate = `${stem.slice(0, maxStem)}${suffix}${ext}`;
    i += 1;
    if (i > 10_000) {
      candidate = `${stem.slice(0, 40)}-${Date.now()}${ext}`;
      break;
    }
  }
  return candidate;
}

function toEntry(spaceId, category, absolutePath, relativePath, dirent) {
  let isDirectory = false;
  try {
    if (isReparseOrSymlink(absolutePath)) {
      return null;
    }
    const st = fs.lstatSync(absolutePath);
    isDirectory = dirent ? dirent.isDirectory() && !dirent.isSymbolicLink() : st.isDirectory();
  } catch {
    return null;
  }

  const name = path.basename(absolutePath);
  let size = 0;
  let createdAt = null;
  let modifiedAt = null;
  try {
    const st = fs.lstatSync(absolutePath);
    size = st.size;
    createdAt = st.birthtime?.toISOString?.() || st.ctime.toISOString();
    modifiedAt = st.mtime.toISOString();
  } catch {
    // ignore
  }
  const ext = isDirectory ? '' : path.extname(name).toLowerCase();
  return {
    id: crypto
      .createHash('sha1')
      .update(`${spaceId}:${category}:${relativePath}`)
      .digest('hex')
      .slice(0, 16),
    spaceId,
    category,
    relativePath: relativePath.replace(/\\/g, '/'),
    name,
    isDirectory,
    extension: ext,
    type: isDirectory ? 'folder' : classifyExtension(ext),
    size,
    createdAt,
    modifiedAt,
    playable: !isDirectory && PLAYABLE_VIDEO_EXT.has(ext),
    viewable: !isDirectory && IMAGE_EXT.has(ext),
  };
}

function listFiles(spaceId, category, relativePath = '') {
  ensureSpaceLayout(spaceId);
  const resolved = resolveSafePath(spaceId, category, relativePath, {
    requireExisting: relativePath ? true : false,
    expect: relativePath ? 'directory' : 'any',
  });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error || 'This item cannot be accessed.' };
  }

  const targetCheck = assertSafePrivateTarget(resolved.absolutePath, resolved.categoryDir, {
    mustExist: true,
    expect: 'directory',
  });
  if (!targetCheck.ok) {
    return targetCheck;
  }

  let entries;
  try {
    entries = fs.readdirSync(resolved.absolutePath, { withFileTypes: true });
  } catch {
    return { ok: false, error: 'This item cannot be accessed.' };
  }

  const items = entries
    .filter((entry) => !entry.name.startsWith('.') && !entry.isSymbolicLink())
    .map((entry) => {
      const childRel = relativePath
        ? `${String(relativePath).replace(/\\/g, '/').replace(/\/$/, '')}/${entry.name}`
        : entry.name;
      const full = path.join(resolved.absolutePath, entry.name);
      return toEntry(spaceId, category, full, childRel, entry);
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  return {
    ok: true,
    spaceId,
    category,
    path: resolved.relativePath,
    items,
  };
}

function countTree(dir) {
  let files = 0;
  let folders = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (isReparseOrSymlink(current)) {
      continue;
    }
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (isReparseOrSymlink(full)) continue;
      if (entry.isDirectory()) {
        folders += 1;
        stack.push(full);
      } else if (entry.isFile()) {
        files += 1;
      }
    }
  }
  return { files, folders, total: files + folders };
}

function getStats(spaceId, { force = false } = {}) {
  if (!isValidPrivateSpaceId(spaceId)) {
    return { ok: false, error: 'Invalid Nest.' };
  }
  const cached = statsCache.get(spaceId);
  if (!force && cached && Date.now() - cached.at < STATS_TTL_MS) {
    return { ok: true, stats: cached.stats, cached: true };
  }

  ensureSpaceLayout(spaceId);
  const stats = { files: 0, photos: 0, videos: 0, downloads: 0 };
  for (const category of Object.keys(CATEGORIES)) {
    const dir = getCategoryDir(spaceId, category);
    stats[category] = countTree(dir).files;
  }
  statsCache.set(spaceId, { at: Date.now(), stats });
  return { ok: true, stats, cached: false };
}

function createFolder(spaceId, category, relativeParent, folderName) {
  const name = typeof folderName === 'string' ? folderName.trim() : '';
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name) || name.includes('\0') || name.length > 255) {
    return { ok: false, error: 'Invalid folder name.' };
  }
  const parentRel =
    relativeParent && typeof relativeParent === 'string'
      ? `${relativeParent.replace(/\\/g, '/').replace(/\/$/, '')}/${name}`
      : name;
  const resolved = resolveSafePath(spaceId, category, parentRel);
  if (!resolved.ok) {
    return resolved;
  }
  ensureSpaceLayout(spaceId);
  if (fs.existsSync(resolved.absolutePath)) {
    return { ok: false, error: 'A file or folder with that name already exists.' };
  }
  try {
    fs.mkdirSync(resolved.absolutePath, { recursive: false });
  } catch {
    return { ok: false, error: 'Could not create folder.' };
  }
  invalidateStats(spaceId);
  const item = toEntry(spaceId, category, resolved.absolutePath, resolved.relativePath);
  return { ok: true, item };
}

function renameFile(spaceId, category, relativePath, newName) {
  const name = typeof newName === 'string' ? newName.trim() : '';
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name) || name.includes('\0') || name.length > 255) {
    return { ok: false, error: 'Invalid name.' };
  }
  const source = resolveSafePath(spaceId, category, relativePath, {
    requireExisting: true,
  });
  if (!source.ok) {
    return { ok: false, error: source.error || 'This file is no longer available.' };
  }
  const safe = assertSafePrivateTarget(source.absolutePath, source.categoryDir, {
    mustExist: true,
  });
  if (!safe.ok) return safe;

  const parentRel = path.posix.dirname(source.relativePath.replace(/\\/g, '/'));
  const destRel = parentRel === '.' ? name : `${parentRel}/${name}`;
  const dest = resolveSafePath(spaceId, category, destRel);
  if (!dest.ok) {
    return dest;
  }
  if (fs.existsSync(dest.absolutePath)) {
    return { ok: false, error: 'A file or folder with that name already exists.' };
  }
  try {
    fs.renameSync(source.absolutePath, dest.absolutePath);
  } catch {
    return { ok: false, error: 'Could not rename file.' };
  }
  invalidateStats(spaceId);
  return {
    ok: true,
    item: toEntry(spaceId, category, dest.absolutePath, dest.relativePath),
  };
}

function deleteFile(spaceId, category, relativePath) {
  const resolved = resolveSafePath(spaceId, category, relativePath, { requireExisting: true });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error || 'This file is no longer available.' };
  }
  if (!resolved.relativePath) {
    return { ok: false, error: 'Cannot delete category root.' };
  }
  if (isReparseOrSymlink(resolved.absolutePath)) {
    return { ok: false, error: SAFE_REJECT };
  }

  let st;
  try {
    st = fs.lstatSync(resolved.absolutePath);
  } catch {
    return { ok: false, error: 'This file is no longer available.' };
  }

  try {
    if (st.isDirectory()) {
      // Manual walk that skips symlink children instead of blind recursive rm.
      const stack = [resolved.absolutePath];
      const dirs = [];
      while (stack.length) {
        const current = stack.pop();
        if (isReparseOrSymlink(current)) {
          return { ok: false, error: SAFE_REJECT };
        }
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isSymbolicLink() || isReparseOrSymlink(full)) {
            return { ok: false, error: SAFE_REJECT };
          }
          if (entry.isDirectory()) {
            stack.push(full);
          } else {
            fs.unlinkSync(full);
          }
        }
        dirs.push(current);
      }
      for (const dir of dirs.reverse()) {
        fs.rmdirSync(dir);
      }
    } else {
      fs.unlinkSync(resolved.absolutePath);
    }
  } catch {
    return { ok: false, error: 'Could not delete file.' };
  }

  invalidateStats(spaceId);
  return {
    ok: true,
    type: st.isDirectory() ? 'folder' : classifyExtension(path.extname(resolved.absolutePath)),
  };
}

/**
 * Copy local source files into a private category. Sources are absolute OS paths
 * already chosen by the native dialog or validated drop list — never destinations.
 */
function importFilesFromSources(spaceId, category, sourcePaths) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    return { ok: false, error: 'No files selected.' };
  }
  ensureSpaceLayout(spaceId);
  const destRoot = resolveSafePath(spaceId, category, '');
  if (!destRoot.ok) {
    return destRoot;
  }

  const imported = [];
  const errors = [];

  for (const source of sourcePaths) {
    const sourceCheck = assertSafeImportSource(source);
    if (!sourceCheck.ok) {
      errors.push(sourceCheck.error);
      continue;
    }

    const baseName = sanitizeDownloadBasename(path.basename(source));
    const unique = uniqueFilename(destRoot.absolutePath, baseName);
    const dest = resolveSafePath(spaceId, category, unique);
    if (!dest.ok) {
      errors.push('File could not be imported.');
      continue;
    }
    if (fs.existsSync(dest.absolutePath)) {
      // uniqueFilename should prevent this; skip rather than overwrite.
      errors.push('File could not be imported.');
      continue;
    }

    try {
      fs.copyFileSync(source, dest.absolutePath);
    } catch {
      errors.push('File could not be imported.');
      continue;
    }

    if (isReparseOrSymlink(dest.absolutePath)) {
      try {
        fs.unlinkSync(dest.absolutePath);
      } catch {
        // ignore
      }
      errors.push(SAFE_REJECT);
      continue;
    }

    const item = toEntry(spaceId, category, dest.absolutePath, dest.relativePath);
    if (item) {
      imported.push(item);
    }
  }

  invalidateStats(spaceId);

  if (imported.length === 0) {
    return {
      ok: false,
      error: errors[0] || 'File could not be imported.',
      imported: [],
    };
  }

  return {
    ok: true,
    imported,
    failed: errors.length,
  };
}

function resolveMediaFile(spaceId, category, relativePath, allowedTypes) {
  const resolved = resolveSafePath(spaceId, category, relativePath, {
    requireExisting: true,
    expect: 'file',
  });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error || 'This file is no longer available.' };
  }
  const safe = assertSafePrivateTarget(resolved.absolutePath, resolved.categoryDir, {
    mustExist: true,
    expect: 'file',
  });
  if (!safe.ok) return safe;

  const ext = path.extname(resolved.absolutePath).toLowerCase();
  const type = classifyExtension(ext);
  if (allowedTypes && !allowedTypes.has(type) && !allowedTypes.has(ext)) {
    return { ok: false, error: 'This item cannot be accessed.' };
  }

  const item = toEntry(spaceId, category, resolved.absolutePath, resolved.relativePath);
  return {
    ok: true,
    item,
    absolutePath: resolved.absolutePath,
  };
}

function prepareDownloadDestination(spaceId, suggestedName) {
  ensureSpaceLayout(spaceId);
  const root = resolveSafePath(spaceId, 'downloads', '');
  if (!root.ok) {
    return root;
  }
  const base = sanitizeDownloadBasename(suggestedName);
  const unique = uniqueFilename(root.absolutePath, base);
  const dest = resolveSafePath(spaceId, 'downloads', unique);
  if (!dest.ok) {
    return { ok: false, error: 'Download destination not allowed.' };
  }
  return {
    ok: true,
    absolutePath: dest.absolutePath,
    relativePath: dest.relativePath,
    filename: unique,
  };
}

function writeTestFile(spaceId, category, relativePath, contents = '') {
  const resolved = resolveSafePath(spaceId, category, relativePath);
  if (!resolved.ok) {
    return resolved;
  }
  ensureSpaceLayout(spaceId);
  fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
  fs.writeFileSync(resolved.absolutePath, contents, 'utf8');
  invalidateStats(spaceId);
  return { ok: true, absolutePath: resolved.absolutePath, relativePath: resolved.relativePath };
}

module.exports = {
  IMAGE_EXT,
  VIDEO_EXT,
  PLAYABLE_VIDEO_EXT,
  DOC_EXT,
  DANGEROUS_EXT,
  classifyExtension,
  ensureSpaceLayout,
  ensureAllLayouts,
  listFiles,
  getStats,
  createFolder,
  renameFile,
  deleteFile,
  importFilesFromSources,
  resolveMediaFile,
  prepareDownloadDestination,
  uniqueFilename,
  writeTestFile,
  invalidateStats,
  resolveSafePath,
};
