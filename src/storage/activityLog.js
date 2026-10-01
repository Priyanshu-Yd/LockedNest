'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_EVENTS = 300;

const EVENT_TYPES = new Set([
  'UNLOCK_SUCCESS',
  'UNLOCK_FAILED',
  'UNLOCK_RATE_LIMITED',
  'MANUAL_LOCK',
  'PANIC_LOCK',
  'AUTO_LOCK',
  'PASSWORD_CHANGED',
  'DOMAIN_ADDED',
  'DOMAIN_REMOVED',
  'SPACE_CREATED',
  'SPACE_SWITCHED',
  'OPENED_DOMAIN',
  'FILE_ADDED',
  'FILE_DELETED',
  'FILE_RENAMED',
  'FOLDER_CREATED',
  'NOTE_CREATED',
  'NOTE_UPDATED',
  'NOTE_DELETED',
  'BACKUP_EXPORTED',
  'BACKUP_RESTORED',
]);

function getLogPath() {
  return path.join(app.getPath('userData'), 'security-activity.json');
}

function readAll() {
  try {
    const filePath = getLogPath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(events) {
  const filePath = getLogPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(events.slice(0, MAX_EVENTS), null, 2), 'utf8');
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }
  const out = {};
  if (typeof meta.domain === 'string') {
    out.domain = meta.domain.toLowerCase().replace(/[\r\n\u0000-\u001f]/g, '').slice(0, 253);
  }
  if (typeof meta.spaceName === 'string') {
    out.spaceName = meta.spaceName.replace(/[\r\n\u0000-\u001f]/g, '').slice(0, 40);
  }
  if (typeof meta.spaceId === 'string') {
    out.spaceId = meta.spaceId.slice(0, 64);
  }
  // File events: category/type only — never filenames, contents, or clipboard.
  if (typeof meta.category === 'string') {
    out.category = meta.category.slice(0, 32);
  }
  if (typeof meta.type === 'string') {
    out.type = meta.type.slice(0, 32);
  }
  if (typeof meta.files === 'number' && Number.isFinite(meta.files)) {
    out.files = Math.max(0, Math.floor(meta.files));
  }
  return Object.keys(out).length ? out : undefined;
}

function record(type, meta) {
  if (!EVENT_TYPES.has(type)) {
    return getEvents();
  }

  const events = readAll();
  events.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    at: new Date().toISOString(),
    meta: sanitizeMeta(meta),
  });
  writeAll(events);
  return events.slice(0, MAX_EVENTS);
}

function getEvents(limit = 100) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), MAX_EVENTS);
  return readAll().slice(0, n);
}

function clear() {
  writeAll([]);
  return [];
}

function labelFor(type) {
  switch (type) {
    case 'UNLOCK_SUCCESS':
      return 'Browser unlocked';
    case 'UNLOCK_FAILED':
      return 'Incorrect password';
    case 'UNLOCK_RATE_LIMITED':
      return 'Unlock temporarily locked out';
    case 'MANUAL_LOCK':
      return 'Browser locked';
    case 'PANIC_LOCK':
      return 'Panic lock';
    case 'AUTO_LOCK':
      return 'Auto-lock';
    case 'PASSWORD_CHANGED':
      return 'Password changed';
    case 'DOMAIN_ADDED':
      return 'Website added';
    case 'DOMAIN_REMOVED':
      return 'Website removed';
    case 'SPACE_CREATED':
      return 'Protected space created';
    case 'SPACE_SWITCHED':
      return 'Protected space switched';
    case 'OPENED_DOMAIN':
      return 'Opened website';
    case 'FILE_ADDED':
      return 'Private file added';
    case 'FILE_DELETED':
      return 'Private file deleted';
    case 'FILE_RENAMED':
      return 'Private file renamed';
    case 'FOLDER_CREATED':
      return 'Private folder created';
    case 'NOTE_CREATED':
      return 'Secure note created';
    case 'NOTE_UPDATED':
      return 'Secure note updated';
    case 'NOTE_DELETED':
      return 'Secure note deleted';
    case 'BACKUP_EXPORTED':
      return 'Encrypted backup exported';
    case 'BACKUP_RESTORED':
      return 'Encrypted backup restored';
    default:
      return type;
  }
}

module.exports = {
  MAX_EVENTS,
  EVENT_TYPES,
  record,
  getEvents,
  clear,
  labelFor,
};
