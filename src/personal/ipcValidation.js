'use strict';

const { CATEGORIES, isValidPrivateSpaceId } = require('./privateSpacePaths');

const LIMITS = Object.freeze({
  SPACE_ID: 32,
  CATEGORY: 32,
  FILENAME: 255,
  RELATIVE_PATH: 4096,
  SOURCE_PATH: 4096,
  MAX_IMPORT_BATCH: 50,
});

const SCHEME_RE = /^(file|https?|data|javascript|vbscript|blob):/i;
const IMPORT_CATEGORIES = Object.freeze(['files', 'photos', 'videos']);

function isNonEmptyString(value, maxLen) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLen;
}

function isOptionalString(value, maxLen) {
  return value === undefined || value === null || value === '' || isNonEmptyString(value, maxLen);
}

function rejectSchemeLike(value) {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (SCHEME_RE.test(trimmed)) return true;
  if (trimmed.includes('\0')) return true;
  return false;
}

function validateSpaceId(spaceId) {
  if (typeof spaceId !== 'string' || spaceId.length === 0 || spaceId.length > LIMITS.SPACE_ID) {
    return { ok: false, error: 'Invalid Nest.' };
  }
  if (!isValidPrivateSpaceId(spaceId)) {
    return { ok: false, error: 'Invalid Nest.' };
  }
  return { ok: true, value: spaceId };
}

function validateCategory(category, { allowDownloads = true } = {}) {
  if (typeof category !== 'string' || category.length === 0 || category.length > LIMITS.CATEGORY) {
    return { ok: false, error: 'Invalid category.' };
  }
  if (!CATEGORIES[category]) {
    return { ok: false, error: 'Invalid category.' };
  }
  if (!allowDownloads && category === 'downloads') {
    return { ok: false, error: 'Invalid category.' };
  }
  return { ok: true, value: category };
}

function validateImportCategory(category) {
  const base = validateCategory(category, { allowDownloads: false });
  if (!base.ok) return base;
  if (!IMPORT_CATEGORIES.includes(category)) {
    return { ok: false, error: 'Invalid category.' };
  }
  return base;
}

function validateRelativePath(relativePath, { allowEmpty = true } = {}) {
  if (relativePath === undefined || relativePath === null || relativePath === '') {
    if (allowEmpty) return { ok: true, value: '' };
    return { ok: false, error: 'Path not allowed.' };
  }
  if (typeof relativePath !== 'string') {
    return { ok: false, error: 'Path not allowed.' };
  }
  if (relativePath.length > LIMITS.RELATIVE_PATH) {
    return { ok: false, error: 'Path not allowed.' };
  }
  if (rejectSchemeLike(relativePath)) {
    return { ok: false, error: 'Path not allowed.' };
  }
  return { ok: true, value: relativePath };
}

function validateFilename(name) {
  if (typeof name !== 'string') {
    return { ok: false, error: 'Invalid name.' };
  }
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed.length > LIMITS.FILENAME ||
    trimmed === '.' ||
    trimmed === '..' ||
    /[\\/]/.test(trimmed) ||
    trimmed.includes('\0') ||
    rejectSchemeLike(trimmed)
  ) {
    return { ok: false, error: 'Invalid name.' };
  }
  return { ok: true, value: trimmed };
}

function validateSourcePathList(paths) {
  if (!Array.isArray(paths)) {
    return { ok: false, error: 'Invalid import request.' };
  }
  if (paths.length === 0) {
    return { ok: false, error: 'No files selected.' };
  }
  if (paths.length > LIMITS.MAX_IMPORT_BATCH) {
    return { ok: false, error: 'Too many files selected.' };
  }
  const cleaned = [];
  for (const p of paths) {
    if (typeof p !== 'string' || !p || p.length > LIMITS.SOURCE_PATH || p.includes('\0')) {
      return { ok: false, error: 'Invalid source path.' };
    }
    cleaned.push(p);
  }
  return { ok: true, value: cleaned };
}

module.exports = {
  LIMITS,
  IMPORT_CATEGORIES,
  validateSpaceId,
  validateCategory,
  validateImportCategory,
  validateRelativePath,
  validateFilename,
  validateSourcePathList,
  rejectSchemeLike,
};
