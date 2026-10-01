'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const spaceManager = require('../spaces/spaceManager');

function getBlockedPageUrl(reason = 'blocked') {
  const filePath = path.join(__dirname, '..', '..', 'renderer', 'blocked', 'blocked.html');
  const url = new URL(pathToFileURL(filePath).href);
  url.searchParams.set('reason', reason);
  return url.href;
}

function isInternalUrl(urlString) {
  if (typeof urlString !== 'string') {
    return false;
  }
  return (
    urlString.startsWith('file:') ||
    urlString.startsWith('about:') ||
    urlString.startsWith('devtools:') ||
    urlString.startsWith('chrome-error:') ||
    urlString.startsWith('data:')
  );
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
