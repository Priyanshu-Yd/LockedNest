'use strict';

const path = require('path');
const { app } = require('electron');
const {
  assertNoSymlinkComponents,
  pathIsInside,
} = require('./fsSecurity');

/** Allowed private vault ids (filesystem isolation roots). */
const PRIVATE_SPACE_IDS = Object.freeze(['personal', 'work', 'guest']);

const CATEGORIES = Object.freeze({
  files: 'Files',
  photos: 'Photos',
  videos: 'Videos',
  downloads: 'Downloads',
});

function getPrivateSpaceRoot() {
  return path.join(app.getPath('userData'), 'PrivateSpace');
}

function isValidPrivateSpaceId(spaceId) {
  return typeof spaceId === 'string' && PRIVATE_SPACE_IDS.includes(spaceId);
}

function getSpaceRoot(spaceId) {
  if (!isValidPrivateSpaceId(spaceId)) {
    return null;
  }
  return path.join(getPrivateSpaceRoot(), spaceId);
}

function getCategoryDir(spaceId, category) {
  const root = getSpaceRoot(spaceId);
  const folder = CATEGORIES[category];
  if (!root || !folder) {
    return null;
  }
  return path.join(root, folder);
}

/**
 * Resolve a relative path inside a private space category and ensure it cannot
 * escape that category directory. Rejects symlinks/reparse points on existing components.
 *
 * @returns {{ ok: true, absolutePath: string, relativePath: string, spaceRoot: string, categoryDir: string } | { ok: false, error: string }}
 */
function resolveSafePath(spaceId, category, relativePath = '', options = {}) {
  const requireExisting = Boolean(options.requireExisting);
  const expect = options.expect || 'any';

  if (!isValidPrivateSpaceId(spaceId)) {
    return { ok: false, error: 'Invalid Nest.' };
  }
  if (typeof category !== 'string' || !CATEGORIES[category]) {
    return { ok: false, error: 'Invalid category.' };
  }

  const categoryDir = getCategoryDir(spaceId, category);
  const spaceRoot = getSpaceRoot(spaceId);
  if (!categoryDir || !spaceRoot) {
    return { ok: false, error: 'Invalid Nest path.' };
  }

  if (relativePath !== undefined && relativePath !== null && typeof relativePath !== 'string') {
    return { ok: false, error: 'Path not allowed.' };
  }

  const raw = relativePath || '';
  if (
    raw.includes('\0') ||
    path.isAbsolute(raw) ||
    /^[a-zA-Z]:[\\/]/.test(raw) ||
    raw.startsWith('/') ||
    raw.startsWith('\\') ||
    raw.includes('..') ||
    /^(file|https?|data|javascript|vbscript|blob):/i.test(raw.trim())
  ) {
    return { ok: false, error: 'Path not allowed.' };
  }

  const rel = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel && raw) {
    return { ok: false, error: 'Path not allowed.' };
  }
  if (rel.includes('..') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) {
    return { ok: false, error: 'Path not allowed.' };
  }
  if (rel.length > 4096) {
    return { ok: false, error: 'Path not allowed.' };
  }

  const joined = rel ? path.join(categoryDir, ...rel.split('/').filter(Boolean)) : categoryDir;
  const resolved = path.resolve(joined);
  const allowedCategory = path.resolve(categoryDir);
  const allowedSpace = path.resolve(spaceRoot);

  if (!pathIsInside(resolved, allowedCategory) || !pathIsInside(resolved, allowedSpace)) {
    return { ok: false, error: 'Path not allowed.' };
  }

  const linkCheck = assertNoSymlinkComponents(resolved, allowedCategory);
  if (!linkCheck.ok) {
    return linkCheck;
  }

  if (requireExisting) {
    const fs = require('fs');
    const { isReparseOrSymlink } = require('./fsSecurity');
    if (!fs.existsSync(resolved) || isReparseOrSymlink(resolved)) {
      return { ok: false, error: 'This file is no longer available.' };
    }
    const st = fs.lstatSync(resolved);
    if (expect === 'file' && !st.isFile()) {
      return { ok: false, error: 'This item cannot be accessed.' };
    }
    if (expect === 'directory' && !st.isDirectory()) {
      return { ok: false, error: 'This item cannot be accessed.' };
    }
  }

  return {
    ok: true,
    absolutePath: resolved,
    relativePath: rel,
    spaceRoot: allowedSpace,
    categoryDir: allowedCategory,
  };
}

/**
 * Explicit browser Protected Space → PrivateSpace vault mapping.
 * Unknown / future spaces do NOT silently fall back to personal.
 */
const BROWSER_SPACE_VAULT_MAP = Object.freeze({
  whatsapp: 'personal',
  chatgpt: 'personal',
  web: 'personal',
  work: 'work',
  guest: 'guest',
});

/**
 * @returns {{ ok: true, vaultId: string } | { ok: false, error: string }}
 */
function privateVaultForBrowserSpace(browserSpaceId) {
  if (typeof browserSpaceId !== 'string' || !browserSpaceId) {
    return { ok: false, error: 'Unknown browser space.' };
  }
  const vaultId = BROWSER_SPACE_VAULT_MAP[browserSpaceId];
  if (!vaultId || !isValidPrivateSpaceId(vaultId)) {
    return { ok: false, error: 'No private vault mapping for this space.' };
  }
  return { ok: true, vaultId };
}

module.exports = {
  PRIVATE_SPACE_IDS,
  CATEGORIES,
  BROWSER_SPACE_VAULT_MAP,
  getPrivateSpaceRoot,
  getSpaceRoot,
  getCategoryDir,
  isValidPrivateSpaceId,
  resolveSafePath,
  privateVaultForBrowserSpace,
};
