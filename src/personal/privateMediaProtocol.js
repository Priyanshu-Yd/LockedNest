'use strict';

const { pathToFileURL } = require('url');
const { protocol, net } = require('electron');
const {
  resolveSafePath,
  CATEGORIES,
  isValidPrivateSpaceId,
} = require('./privateSpacePaths');
const { assertSafePrivateTarget, pathIsInside } = require('./fsSecurity');
const privateFilesManager = require('./privateFilesManager');

const SCHEME = 'vaultprivate';

let accessChecker = null;

function installPrivilegedScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * @param {() => { authenticated: boolean, locked: boolean }} checker
 */
function setAccessChecker(checker) {
  accessChecker = typeof checker === 'function' ? checker : null;
}

function parseMediaUrl(requestUrl) {
  // vaultprivate://personal/photos/relative/path.jpg
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:`) {
    return null;
  }
  // Reject authority tricks / absolute escapes via URL features.
  if (url.username || url.password || url.port || url.search || url.hash) {
    return null;
  }
  if (url.href.includes('\\') || url.href.includes('\0')) {
    return null;
  }

  const spaceId = decodeURIComponent(url.hostname || '');
  if (!isValidPrivateSpaceId(spaceId)) {
    return null;
  }

  const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  let category;
  let relativeParts;
  try {
    category = decodeURIComponent(parts[0]);
    relativeParts = parts.slice(1).map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }

  if (!CATEGORIES[category]) {
    return null;
  }

  const relativePath = relativeParts.join('/');
  if (
    !relativePath ||
    relativePath.includes('..') ||
    relativePath.includes('\0') ||
    relativePath.includes('\\') ||
    pathLooksAbsolute(relativePath)
  ) {
    return null;
  }

  return { spaceId, category, relativePath };
}

function pathLooksAbsolute(value) {
  return (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-zA-Z]:/.test(value) ||
    /^(file|https?|data|javascript|blob):/i.test(value)
  );
}

function registerMediaProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const access = accessChecker ? accessChecker() : { authenticated: false, locked: true };
    if (!access.authenticated || access.locked) {
      return new Response('', { status: 403, statusText: 'Locked' });
    }

    const parsed = parseMediaUrl(request.url);
    if (!parsed) {
      return new Response('', { status: 400 });
    }

    const allowed =
      parsed.category === 'photos'
        ? new Set(['image'])
        : parsed.category === 'videos'
          ? new Set(['video'])
          : parsed.category === 'downloads' || parsed.category === 'files'
            ? new Set(['image', 'video'])
            : null;

    // resolveSafePath enforces vault root for parsed.spaceId only — no cross-vault.
    const media = privateFilesManager.resolveMediaFile(
      parsed.spaceId,
      parsed.category,
      parsed.relativePath,
      allowed
    );
    if (!media.ok) {
      return new Response('', { status: 404 });
    }

    const boundary = resolveSafePath(parsed.spaceId, parsed.category, parsed.relativePath, {
      requireExisting: true,
      expect: 'file',
    });
    if (!boundary.ok) {
      return new Response('', { status: 404 });
    }

    // Defense in depth: resolved absolute path must still belong to this space root.
    if (
      !pathIsInside(boundary.absolutePath, boundary.spaceRoot) ||
      media.absolutePath !== boundary.absolutePath
    ) {
      return new Response('', { status: 403 });
    }

    const safe = assertSafePrivateTarget(boundary.absolutePath, boundary.categoryDir, {
      mustExist: true,
      expect: 'file',
    });
    if (!safe.ok) {
      return new Response('', { status: 403 });
    }

    try {
      return await net.fetch(pathToFileURL(media.absolutePath).href);
    } catch {
      return new Response('', { status: 500 });
    }
  });
}

function buildMediaUrl(spaceId, category, relativePath) {
  if (!isValidPrivateSpaceId(spaceId) || !CATEGORIES[category]) {
    return '';
  }
  const parts = String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part));
  if (!parts.length) {
    return '';
  }
  return `${SCHEME}://${encodeURIComponent(spaceId)}/${encodeURIComponent(category)}/${parts.join('/')}`;
}

module.exports = {
  SCHEME,
  installPrivilegedScheme,
  setAccessChecker,
  registerMediaProtocol,
  buildMediaUrl,
  parseMediaUrl,
};
