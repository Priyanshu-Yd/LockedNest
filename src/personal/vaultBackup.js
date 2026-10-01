'use strict';

/**
 * Encrypted vault backup (AES-256-GCM + PBKDF2).
 * Bundles PrivateSpace files + selected settings. Password never stored in backup.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getPrivateSpaceRoot } = require('./privateSpacePaths');
const { loadSettings, saveSettings } = require('../storage/settingsManager');

const MAGIC = Buffer.from('VBK1');
const ITERATIONS = 210_000;
const KEYLEN = 32;
const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40MB per file
const MAX_TOTAL_BYTES = 180 * 1024 * 1024; // 180MB payload

function walkFiles(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) {
    return out;
  }
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(rootDir, rel) : rootDir;
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(rootDir, childRel);
      if (entry.isDirectory()) {
        stack.push(childRel.replace(/\\/g, '/'));
      } else if (entry.isFile()) {
        out.push({ relativePath: childRel.replace(/\\/g, '/'), absolutePath: childAbs });
      }
    }
  }
  return out;
}

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, 'sha512');
}

function buildPayload() {
  const root = getPrivateSpaceRoot();
  const files = [];
  let total = 0;
  for (const entry of walkFiles(root)) {
    let st;
    try {
      st = fs.statSync(entry.absolutePath);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) {
      continue;
    }
    if (total + st.size > MAX_TOTAL_BYTES) {
      return { ok: false, error: 'Your Nest is too large to back up in one file. Remove large videos first.' };
    }
    const data = fs.readFileSync(entry.absolutePath);
    total += data.length;
    files.push({
      path: entry.relativePath,
      data: data.toString('base64'),
    });
  }

  const settings = loadSettings();
  return {
    ok: true,
    payload: {
      version: 1,
      createdAt: new Date().toISOString(),
      settings: {
        spaces: settings.spaces,
        activeSpaceId: settings.activeSpaceId,
        privacy: settings.privacy,
        autoLock: settings.autoLock,
        allowedDomains: settings.allowedDomains,
      },
      privateSpace: files,
    },
    fileCount: files.length,
    bytes: total,
  };
}

function encryptBackup(password, payloadObject) {
  if (typeof password !== 'string' || password.length < 10) {
    return { ok: false, error: 'Enter your Nest password to encrypt the backup.' };
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const plaintext = Buffer.from(JSON.stringify(payloadObject), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([MAGIC, salt, iv, tag, encrypted]);
  return { ok: true, buffer: blob };
}

function decryptBackup(password, buffer) {
  if (typeof password !== 'string' || password.length < 10) {
    return { ok: false, error: 'Enter the password used for this backup.' };
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < MAGIC.length + 16 + 12 + 16 + 1) {
    return { ok: false, error: 'Backup file is invalid.' };
  }
  if (!buffer.subarray(0, 4).equals(MAGIC)) {
    return { ok: false, error: 'Not a SafeNest backup file.' };
  }
  const salt = buffer.subarray(4, 20);
  const iv = buffer.subarray(20, 32);
  const tag = buffer.subarray(32, 48);
  const encrypted = buffer.subarray(48);
  const key = deriveKey(password, salt);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const payload = JSON.parse(plaintext.toString('utf8'));
    if (!payload || payload.version !== 1 || !Array.isArray(payload.privateSpace)) {
      return { ok: false, error: 'Backup contents are not supported.' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, error: 'Wrong password or corrupted backup.' };
  }
}

function createEncryptedBackup(password) {
  const built = buildPayload();
  if (!built.ok) {
    return built;
  }
  const enc = encryptBackup(password, built.payload);
  if (!enc.ok) {
    return enc;
  }
  return {
    ok: true,
    buffer: enc.buffer,
    fileCount: built.fileCount,
    bytes: built.bytes,
  };
}

function restoreEncryptedBackup(password, buffer, { mergeSettings = true } = {}) {
  const dec = decryptBackup(password, buffer);
  if (!dec.ok) {
    return dec;
  }
  const root = getPrivateSpaceRoot();
  fs.mkdirSync(root, { recursive: true });

  let restored = 0;
  for (const entry of dec.payload.privateSpace) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.data !== 'string') {
      continue;
    }
    const rel = entry.path.replace(/\\/g, '/');
    if (!rel || rel.includes('..') || path.isAbsolute(rel) || rel.startsWith('/')) {
      continue;
    }
    const abs = path.join(root, rel);
    if (!abs.startsWith(root)) {
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(entry.data, 'base64'));
    restored += 1;
  }

  if (mergeSettings && dec.payload.settings && typeof dec.payload.settings === 'object') {
    const current = loadSettings();
    const incoming = dec.payload.settings;
    saveSettings({
      ...current,
      spaces: Array.isArray(incoming.spaces) ? incoming.spaces : current.spaces,
      activeSpaceId:
        typeof incoming.activeSpaceId === 'string' ? incoming.activeSpaceId : current.activeSpaceId,
      privacy:
        incoming.privacy && typeof incoming.privacy === 'object'
          ? { ...current.privacy, ...incoming.privacy }
          : current.privacy,
      autoLock:
        incoming.autoLock && typeof incoming.autoLock === 'object'
          ? { ...current.autoLock, ...incoming.autoLock }
          : current.autoLock,
      allowedDomains: Array.isArray(incoming.allowedDomains)
        ? incoming.allowedDomains
        : current.allowedDomains,
    });
  }

  return { ok: true, restored, createdAt: dec.payload.createdAt || null };
}

module.exports = {
  createEncryptedBackup,
  restoreEncryptedBackup,
  encryptBackup,
  decryptBackup,
  buildPayload,
};
