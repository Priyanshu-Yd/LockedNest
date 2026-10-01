'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { isValidPrivateSpaceId, CATEGORIES } = require('./privateSpacePaths');

const MAX_RECENT = 40;
const ACTIONS = new Set(['imported', 'opened', 'played', 'downloaded', 'renamed']);

function getStorePath() {
  return path.join(app.getPath('userData'), 'recent-files.json');
}

function readAll() {
  try {
    const filePath = getStorePath();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries) {
  const filePath = getStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entries.slice(0, MAX_RECENT), null, 2), 'utf8');
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const spaceId = entry.spaceId;
  const category = entry.category;
  const relativePath = entry.relativePath;
  const action = entry.action;
  const name = entry.name;
  if (!isValidPrivateSpaceId(spaceId)) return null;
  if (typeof category !== 'string' || !CATEGORIES[category]) return null;
  if (typeof relativePath !== 'string' || !relativePath || relativePath.length > 4096) return null;
  if (
    relativePath.includes('..') ||
    relativePath.includes('\0') ||
    relativePath.includes('\\') ||
    /%(?:2e|2f|5c)/i.test(relativePath) ||
    relativePath.startsWith('/') ||
    /^[a-zA-Z]:/.test(relativePath) ||
    relativePath.startsWith('\\\\') ||
    /^(file|https?|data|javascript|blob):/i.test(relativePath)
  ) {
    return null;
  }
  if (!ACTIONS.has(action)) return null;
  if (typeof name !== 'string' || !name || name.length > 255) return null;
  return {
    spaceId,
    category,
    relativePath: relativePath.replace(/\\/g, '/'),
    name: name.slice(0, 255),
    action,
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
  };
}

function record(entry) {
  const clean = sanitizeEntry({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  if (!clean) return getRecent(entry?.spaceId);

  const all = readAll().filter(
    (item) =>
      !(
        item.spaceId === clean.spaceId &&
        item.category === clean.category &&
        item.relativePath === clean.relativePath
      )
  );
  all.unshift(clean);
  writeAll(all);
  return all.filter((item) => item.spaceId === clean.spaceId).slice(0, MAX_RECENT);
}

function getRecent(spaceId, limit = 20) {
  if (!isValidPrivateSpaceId(spaceId)) {
    return [];
  }
  const n = Math.min(Math.max(Number(limit) || 20, 1), MAX_RECENT);
  return readAll()
    .map((item) => sanitizeEntry(item))
    .filter((item) => item && item.spaceId === spaceId)
    .slice(0, n)
    .map((item) => ({
      spaceId: item.spaceId,
      category: item.category,
      relativePath: item.relativePath,
      name: item.name,
      action: item.action,
      timestamp: item.timestamp,
    }));
}

function removeMatching(spaceId, category, relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  const next = readAll().filter(
    (item) =>
      !(item.spaceId === spaceId && item.category === category && item.relativePath === rel)
  );
  writeAll(next);
}

function clearAll() {
  writeAll([]);
  return { ok: true };
}

module.exports = {
  MAX_RECENT,
  record,
  getRecent,
  removeMatching,
  clearAll,
};
