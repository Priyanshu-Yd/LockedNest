'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const spaceManager = require('../spaces/spaceManager');

const RENDERER_ROOT = path.resolve(__dirname, '..', '..', 'renderer');

function getBlockedPageUrl(reason = 'blocked') {
  const filePath = path.join(RENDERER_ROOT, 'blocked', 'blocked.html');
  const url = new URL(pathToFileURL(filePath).href);
  url.searchParams.set('reason', reason);
  return url.href;
}

function isNestOwnedFileUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'file:') {
      return false;
    }
    let filePath = decodeURIComponent(url.pathname);
    // Windows file URLs: /C:/...
    if (/^\/[a-zA-Z]:\//.test(filePath)) {
      filePath = filePath.slice(1);
    }
    const resolved = path.resolve(filePath);
    const root = RENDERER_ROOT.endsWith(path.sep) ? RENDERER_ROOT : RENDERER_ROOT + path.sep;
    const target = resolved.toLowerCase();
    const nestRoot = root.toLowerCase();
    return target === nestRoot.slice(0, -1) || target.startsWith(nestRoot);
  } catch {
    return false;
  }
}

function isInternalUrl(urlString) {
  if (typeof urlString !== 'string') {
    return false;
  }
  // data: / blob: / arbitrary file: are NOT internal Nest pages.
  if (
    urlString.startsWith('about:') ||
    urlString.startsWith('devtools:') ||
    urlString.startsWith('chrome-error:')
  ) {
    return true;
  }
  if (urlString.startsWith('file:')) {
    return isNestOwnedFileUrl(urlString);
  }
  return false;
}

function shouldAllowNavigation(urlString, spaceId) {
  if (isInternalUrl(urlString)) {
    return true;
  }
  return spaceManager.isUrlAllowedInSpace(
    urlString,
    spaceId || spaceManager.getActiveSpace()?.id
  );
}

function attachNavigationGuards(webContents, getSpaceId, onBlocked, options = {}) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }

  const evaluate = (url) => {
    const spaceId = typeof getSpaceId === 'function' ? getSpaceId() : getSpaceId;
    return shouldAllowNavigation(url, spaceId);
  };

  const allowPopupTarget = (url) => {
    if (!url || url === 'about:blank' || isInternalUrl(url)) {
      return true;
    }
    return evaluate(url);
  };

  const showBlocked = (url, reason) => {
    if (typeof onBlocked === 'function') {
      onBlocked(url, reason);
    }
    // Loading during an in-flight redirect can leave a white screen — defer.
    setTimeout(() => {
      if (!webContents.isDestroyed()) {
        webContents.loadURL(getBlockedPageUrl('blocked'));
      }
    }, 0);
  };

  webContents.on('will-navigate', (event, url) => {
    if (!evaluate(url)) {
      event.preventDefault();
      showBlocked(url, 'navigate');
    }
  });

  webContents.on('will-redirect', (event, url) => {
    if (!evaluate(url)) {
      event.preventDefault();
      showBlocked(url, 'redirect');
    }
  });

  webContents.setWindowOpenHandler((details) => {
    const url = typeof details.url === 'string' ? details.url : '';
    if (!allowPopupTarget(url)) {
      if (typeof onBlocked === 'function') {
        onBlocked(url, 'popup');
      }
      return { action: 'deny' };
    }
    // Popup permission (allowlisted) is separate from authentication treatment.
    // Callers decide whether this is a normal popup or a ChatGPT Google OAuth
    // auth window; this guard only enforces allowlist + delegates.
    if (typeof options.onPopup === 'function') {
      const decision = options.onPopup(details);
      if (decision && decision.action) {
        return decision;
      }
    }
    return { action: 'deny' };
  });
}

module.exports = {
  shouldAllowNavigation,
  getBlockedPageUrl,
  isInternalUrl,
  attachNavigationGuards,
};
