'use strict';

/**
 * Password security model (Phase 1)
 *
 * 1) Password KDF (PBKDF2-SHA512)
 *    - User password is never stored.
 *    - A random salt + high-iteration PBKDF2 produces a verifier.
 *    - Verification recomputes the KDF and compares with timingSafeEqual.
 *
 * 2) Electron safeStorage (Windows DPAPI when available)
 *    - The verifier record (salt, params, verifier) is encrypted at rest
 *      with Electron safeStorage before writing to disk.
 *    - On Windows this typically uses DPAPI bound to the current OS user.
 *
 * 3) Windows user account security
 *    - safeStorage protection is only as strong as the signed-in Windows account.
 *    - An attacker with the same user session (or admin rights) can often decrypt
 *      DPAPI data. VaultBrowse is an application-level lock, not OS hard security.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const ALGORITHM = 'pbkdf2-sha512';
const ITERATIONS = 600000;
const KEYLEN = 64;
const DIGEST = 'sha512';
const SALT_BYTES = 32;
/** Length-based policy for local Nest privacy (no complexity theatre). */
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 512;

function validatePasswordPolicy(password, { forChange = false } = {}) {
  if (typeof password !== 'string') {
    return { ok: false, error: 'Invalid password.' };
  }
  if (password.length === 0) {
    return { ok: false, error: forChange ? 'Enter a new password.' : 'Enter a password.' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: 'Invalid password.' };
  }
  return { ok: true };
}

function getVerifierPath() {
  return path.join(app.getPath('userData'), 'password-verifier.bin');
}

function ensureUserDataDir() {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function deriveVerifier(password, salt, iterations, keylen, digest) {
  return crypto.pbkdf2Sync(password, salt, iterations, keylen, digest);
}

function encodeRecord(record) {
  const json = JSON.stringify(record);
  if (safeStorage.isEncryptionAvailable()) {
    return Buffer.concat([
      Buffer.from([1]), // version marker: safeStorage encrypted
      safeStorage.encryptString(json),
    ]);
  }
  // Fallback if OS encryption unavailable (should be rare on Windows).
  // Still never stores plaintext password — only salt + verifier.
  return Buffer.concat([Buffer.from([0]), Buffer.from(json, 'utf8')]);
}

function decodeRecord(buffer) {
  if (!buffer || buffer.length < 2) {
    throw new Error('Password verifier file is invalid.');
  }
  const marker = buffer[0];
  const payload = buffer.subarray(1);
  if (marker === 1) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('secure storage is not available to decrypt the password verifier.');
    }
    const json = safeStorage.decryptString(payload);
    return JSON.parse(json);
  }
  if (marker === 0) {
    return JSON.parse(payload.toString('utf8'));
  }
  throw new Error('Unsupported password verifier format.');
}

function hasPassword() {
  return fs.existsSync(getVerifierPath());
}

function loadRecord() {
  const filePath = getVerifierPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  return decodeRecord(buffer);
}

function createPassword(password) {
  const policy = validatePasswordPolicy(password);
  if (!policy.ok) {
    return policy;
  }
  if (hasPassword()) {
    return { ok: false, error: 'A password already exists. Unlock instead.' };
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const verifier = deriveVerifier(password, salt, ITERATIONS, KEYLEN, DIGEST);

  const record = {
    algorithm: ALGORITHM,
    iterations: ITERATIONS,
    keylen: KEYLEN,
    digest: DIGEST,
    salt: salt.toString('base64'),
    verifier: verifier.toString('base64'),
    createdAt: new Date().toISOString(),
    encryption: safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'none',
  };

  ensureUserDataDir();
  fs.writeFileSync(getVerifierPath(), encodeRecord(record));
  return { ok: true };
}

function verifyPassword(password) {
  // Generic failures — do not reveal configuration / algorithm / proximity.
  const AUTH_FAIL = { ok: false, error: 'Incorrect password.' };

  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'Enter your password.' };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return AUTH_FAIL;
  }

  let record;
  try {
    record = loadRecord();
  } catch {
    return AUTH_FAIL;
  }

  if (!record) {
    return AUTH_FAIL;
  }

  if (record.algorithm !== ALGORITHM) {
    return AUTH_FAIL;
  }

  let salt;
  let expected;
  try {
    salt = Buffer.from(record.salt, 'base64');
    expected = Buffer.from(record.verifier, 'base64');
  } catch {
    return AUTH_FAIL;
  }

  const actual = deriveVerifier(
    password,
    salt,
    record.iterations,
    record.keylen,
    record.digest
  );

  if (expected.length !== actual.length) {
    return AUTH_FAIL;
  }

  const match = crypto.timingSafeEqual(expected, actual);
  if (!match) {
    return AUTH_FAIL;
  }

  return { ok: true };
}

function getPasswordStatus() {
  return {
    configured: hasPassword(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function changePassword(currentPassword, newPassword, confirmPassword) {
  const verified = verifyPassword(currentPassword);
  if (!verified.ok) {
    return { ok: false, error: 'Current password is incorrect.' };
  }
  const policy = validatePasswordPolicy(newPassword, { forChange: true });
  if (!policy.ok) {
    return policy;
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: 'New passwords do not match.' };
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const verifier = deriveVerifier(newPassword, salt, ITERATIONS, KEYLEN, DIGEST);
  const record = {
    algorithm: ALGORITHM,
    iterations: ITERATIONS,
    keylen: KEYLEN,
    digest: DIGEST,
    salt: salt.toString('base64'),
    verifier: verifier.toString('base64'),
    createdAt: new Date().toISOString(),
    encryption: safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'none',
  };

  ensureUserDataDir();
  fs.writeFileSync(getVerifierPath(), encodeRecord(record));
  return { ok: true };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  hasPassword,
  createPassword,
  verifyPassword,
  changePassword,
  getPasswordStatus,
  getVerifierPath,
  validatePasswordPolicy,
};
