'use strict';

const fs = require('fs');
const path = require('path');

const SAFE_REJECT = 'This item cannot be used inside your Nest.';

/**
 * True when the path exists and is a symlink / junction / reparse point.
 * Uses lstat so the link itself is inspected, not the target.
 */
function isReparseOrSymlink(absolutePath) {
  try {
    const st = fs.lstatSync(absolutePath);
    if (st.isSymbolicLink()) {
      return true;
    }
    // Windows: junctions/reparse points usually appear as symlinks to Node.
    // Also treat a successful readlink as a link even if lstat is ambiguous.
    try {
      fs.readlinkSync(absolutePath);
      return true;
    } catch {
      // not a link
    }
    return false;
  } catch {
    return false;
  }
}

function pathIsInside(child, parent) {
  let resolvedChild = path.resolve(child);
  let resolvedParent = path.resolve(parent);
  if (process.platform === 'win32') {
    resolvedChild = resolvedChild.toLowerCase();
    resolvedParent = resolvedParent.toLowerCase();
  }
  return (
    resolvedChild === resolvedParent ||
    resolvedChild.startsWith(resolvedParent + path.sep)
  );
}

/**
 * When a path exists and is not a symlink leaf, ensure its realpath still
 * stays inside the allowed root (catches odd mounts / late replacement).
 */
function assertRealPathInside(absolutePath, root) {
  try {
    if (!fs.existsSync(absolutePath) || !fs.existsSync(root)) {
      return { ok: true };
    }
    if (isReparseOrSymlink(absolutePath) || isReparseOrSymlink(root)) {
      return { ok: false, error: SAFE_REJECT };
    }
    const real = fs.realpathSync(absolutePath);
    const realRoot = fs.realpathSync(root);
    if (!pathIsInside(real, realRoot)) {
      return { ok: false, error: SAFE_REJECT };
    }
    return { ok: true, realPath: real };
  } catch {
    return { ok: false, error: SAFE_REJECT };
  }
}

/**
 * Walk every existing prefix of absolutePath and reject symlinks/reparse points.
 * For paths that do not exist yet, only existing ancestors are checked.
 */
function assertNoSymlinkComponents(absolutePath, stopAtRoot) {
  const resolved = path.resolve(absolutePath);
  const root = path.resolve(stopAtRoot);
  if (!pathIsInside(resolved, root) && resolved !== root) {
    return { ok: false, error: SAFE_REJECT };
  }

  const parts = [];
  let current = resolved;
  while (true) {
    parts.push(current);
    if (current === root || current === path.parse(current).root) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    if (!pathIsInside(current, root) && current !== root) {
      break;
    }
  }

  for (const segment of parts) {
    if (!fs.existsSync(segment)) {
      continue;
    }
    if (isReparseOrSymlink(segment)) {
      return { ok: false, error: SAFE_REJECT };
    }
  }

  // Existing leaf/ancestors must realpath inside the private root.
  const existing = parts.find((segment) => fs.existsSync(segment));
  if (existing) {
    const realCheck = assertRealPathInside(existing, root);
    if (!realCheck.ok) {
      return realCheck;
    }
  }

  return { ok: true };
}

/**
 * Validate an existing source file for import: must be a regular file, not a link.
 */
function assertSafeImportSource(absolutePath) {
  if (typeof absolutePath !== 'string' || !absolutePath || absolutePath.includes('\0')) {
    return { ok: false, error: 'File could not be imported.' };
  }
  if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
    // Allow UNC file paths only if they resolve to a normal file later; still no links.
  }
  if (/^[a-zA-Z]:$/.test(absolutePath)) {
    return { ok: false, error: 'File could not be imported.' };
  }

  let st;
  try {
    st = fs.lstatSync(absolutePath);
  } catch {
    return { ok: false, error: 'File could not be imported.' };
  }
  if (st.isSymbolicLink() || isReparseOrSymlink(absolutePath)) {
    return { ok: false, error: SAFE_REJECT };
  }
  if (!st.isFile()) {
    return { ok: false, error: 'File could not be imported.' };
  }

  // Re-check immediately before the caller copies (narrow TOCTOU window).
  try {
    const again = fs.lstatSync(absolutePath);
    if (again.isSymbolicLink() || !again.isFile()) {
      return { ok: false, error: SAFE_REJECT };
    }
  } catch {
    return { ok: false, error: 'File could not be imported.' };
  }

  return { ok: true, size: st.size };
}

/**
 * After string-boundary resolve, ensure private path (and ancestors) are not links.
 * Optionally require the leaf to exist as a regular file or directory.
 */
function assertSafePrivateTarget(absolutePath, categoryDir, { mustExist = false, expect = 'any' } = {}) {
  const boundary = assertNoSymlinkComponents(absolutePath, categoryDir);
  if (!boundary.ok) {
    return boundary;
  }
  if (!mustExist) {
    // For new destinations, validate the parent directory thoroughly.
    const parent = path.dirname(path.resolve(absolutePath));
    const parentCheck = assertNoSymlinkComponents(parent, categoryDir);
    if (!parentCheck.ok) {
      return parentCheck;
    }
    return assertRealPathInside(parent, categoryDir);
  }
  if (!fs.existsSync(absolutePath)) {
    return { ok: false, error: 'This file is no longer available.' };
  }
  if (isReparseOrSymlink(absolutePath)) {
    return { ok: false, error: SAFE_REJECT };
  }
  let st;
  try {
    st = fs.lstatSync(absolutePath);
  } catch {
    return { ok: false, error: 'This item cannot be accessed.' };
  }
  if (expect === 'file' && !st.isFile()) {
    return { ok: false, error: 'This item cannot be accessed.' };
  }
  if (expect === 'directory' && !st.isDirectory()) {
    return { ok: false, error: 'This item cannot be accessed.' };
  }
  const realCheck = assertRealPathInside(absolutePath, categoryDir);
  if (!realCheck.ok) {
    return realCheck;
  }
  return { ok: true, stats: st };
}

function sanitizeDownloadBasename(name) {
  const base = path.basename(String(name || 'download'));
  const cleaned = base.replace(/[<>:"|?*\0]/g, '_').replace(/^\.+/, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return 'download';
  }
  return cleaned.slice(0, 255);
}

module.exports = {
  SAFE_REJECT,
  isReparseOrSymlink,
  pathIsInside,
  assertNoSymlinkComponents,
  assertSafeImportSource,
  assertSafePrivateTarget,
  assertRealPathInside,
  sanitizeDownloadBasename,
};
