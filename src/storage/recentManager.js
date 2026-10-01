'use strict';

const { loadSettings, saveSettings } = require('./settingsManager');
const { displayNameForDomain } = require('../domains/hostnameUtils');
const spaceManager = require('../spaces/spaceManager');

const MAX_RECENT = 10;

function getRecent() {
  const settings = loadSettings();
  const recent = Array.isArray(settings.recent) ? settings.recent : [];
  return recent
    .filter((item) => item && typeof item.domain === 'string')
    .map((item) => ({
      domain: item.domain.toLowerCase(),
      displayName:
        typeof item.displayName === 'string' && item.displayName
          ? item.displayName
          : displayNameForDomain(item.domain),
      lastAccessedAt: item.lastAccessedAt || null,
      spaceId: typeof item.spaceId === 'string' ? item.spaceId : null,
    }))
    .sort((a, b) => String(b.lastAccessedAt || '').localeCompare(String(a.lastAccessedAt || '')))
    .slice(0, MAX_RECENT);
}

function recordVisit(domain, spaceId) {
  if (typeof domain !== 'string' || !domain) {
    return getRecent();
  }

  const host = domain.toLowerCase();
  const settings = loadSettings();
  const recent = getRecent().filter((item) => item.domain !== host);
  recent.unshift({
    domain: host,
    displayName: displayNameForDomain(host),
    lastAccessedAt: new Date().toISOString(),
    spaceId: typeof spaceId === 'string' ? spaceId : spaceManager.getActiveSpace()?.id || null,
  });

  saveSettings({
    ...settings,
    recent: recent.slice(0, MAX_RECENT),
  });

  return getRecent();
}

function getRecentAllowed() {
  return getRecent().map((item) => {
    const stillAllowed = spaceManager
      .getAllDomainsFlat()
      .some((entry) => entry.domain === item.domain);
    return { ...item, allowed: stillAllowed };
  });
}

module.exports = {
  MAX_RECENT,
  getRecent,
  getRecentAllowed,
  recordVisit,
};
