'use strict';

/**
 * Secure Notes — stored under PrivateSpace/{spaceId}/Notes as JSON files.
 * Access must be gated by auth + unlock in the main process.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getSpaceRoot, isValidPrivateSpaceId } = require('./privateSpacePaths');

const MAX_TITLE = 120;
const MAX_BODY = 200_000;
const MAX_NOTES = 500;

function notesDir(spaceId) {
  if (!isValidPrivateSpaceId(spaceId)) {
    return null;
  }
  return path.join(getSpaceRoot(spaceId), 'Notes');
}

function ensureNotesDir(spaceId) {
  const dir = notesDir(spaceId);
  if (!dir) {
    return { ok: false, error: 'Invalid Nest.' };
  }
  fs.mkdirSync(dir, { recursive: true });
  return { ok: true, dir };
}

function notePath(spaceId, id) {
  const dir = notesDir(spaceId);
  if (!dir || typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id)) {
    return null;
  }
  return path.join(dir, `${id}.json`);
}

function sanitizeTitle(title) {
  if (typeof title !== 'string') {
    return '';
  }
  return title.trim().slice(0, MAX_TITLE);
}

function readNoteFile(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') {
      return null;
    }
    return {
      id: raw.id,
      title: typeof raw.title === 'string' ? raw.title : 'Untitled',
      body: typeof raw.body === 'string' ? raw.body : '',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    };
  } catch {
    return null;
  }
}

function listNotes(spaceId) {
  const ensured = ensureNotesDir(spaceId);
  if (!ensured.ok) {
    return ensured;
  }
  let files;
  try {
    files = fs.readdirSync(ensured.dir);
  } catch {
    return { ok: false, error: 'Could not read notes.' };
  }
  const notes = files
    .filter((name) => /^[a-f0-9]{16}\.json$/.test(name))
    .map((name) => readNoteFile(path.join(ensured.dir, name)))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return {
    ok: true,
    notes: notes.map(({ id, title, updatedAt, createdAt, body }) => ({
      id,
      title: title || 'Untitled',
      updatedAt,
      createdAt,
      preview: String(body || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120),
    })),
  };
}

function getNote(spaceId, id) {
  const filePath = notePath(spaceId, id);
  if (!filePath) {
    return { ok: false, error: 'Invalid note.' };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'Note not found.' };
  }
  const note = readNoteFile(filePath);
  if (!note) {
    return { ok: false, error: 'Note is unreadable.' };
  }
  return { ok: true, note };
}

function createNote(spaceId, title, body) {
  const ensured = ensureNotesDir(spaceId);
  if (!ensured.ok) {
    return ensured;
  }
  const listed = listNotes(spaceId);
  if (listed.ok && listed.notes.length >= MAX_NOTES) {
    return { ok: false, error: 'Note limit reached.' };
  }
  const now = new Date().toISOString();
  const id = crypto.randomBytes(8).toString('hex');
  const note = {
    id,
    title: sanitizeTitle(title) || 'Untitled',
    body: typeof body === 'string' ? body.slice(0, MAX_BODY) : '',
    createdAt: now,
    updatedAt: now,
  };
  try {
    fs.writeFileSync(path.join(ensured.dir, `${id}.json`), JSON.stringify(note, null, 2), 'utf8');
  } catch {
    return { ok: false, error: 'Could not save note.' };
  }
  return { ok: true, note };
}

function updateNote(spaceId, id, title, body) {
  const existing = getNote(spaceId, id);
  if (!existing.ok) {
    return existing;
  }
  const filePath = notePath(spaceId, id);
  const note = {
    ...existing.note,
    title: sanitizeTitle(title) || 'Untitled',
    body: typeof body === 'string' ? body.slice(0, MAX_BODY) : '',
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(filePath, JSON.stringify(note, null, 2), 'utf8');
  } catch {
    return { ok: false, error: 'Could not update note.' };
  }
  return { ok: true, note };
}

function deleteNote(spaceId, id) {
  const filePath = notePath(spaceId, id);
  if (!filePath) {
    return { ok: false, error: 'Invalid note.' };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'Note not found.' };
  }
  try {
    fs.unlinkSync(filePath);
  } catch {
    return { ok: false, error: 'Could not delete note.' };
  }
  return { ok: true };
}

module.exports = {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  notesDir,
  ensureNotesDir,
};
