'use strict';

const crypto = require('crypto');
const { loadSettings, saveSettings } = require('../storage/settingsManager');
const {
  normalizeHostname,
  displayNameForDomain,
  hostnameMatches,
  isGoogleAccountsHostname,
  toHttpsUrl,
} = require('../domains/hostnameUtils');

const SPACE_COLORS = ['green', 'blue', 'purple', 'teal', 'amber', 'rose'];

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function domainEntry(domain, allowSubdomains = false) {
  return {
    domain: String(domain).toLowerCase(),
    allowSubdomains: Boolean(allowSubdomains),
    displayName: displayNameForDomain(domain),
  };
}

function defaultWhatsAppSpace() {
  return {
    id: 'whatsapp',
    name: 'WhatsApp',
    color: 'green',
    // Preserve existing Chromium profile used by Phase 1.
    partition: 'persist:vaultbrowse',
    domains: [domainEntry('web.whatsapp.com', false)],
  };
}

function defaultWorkSpace() {
  return {
    id: 'work',
    name: 'Work',
    color: 'blue',
    partition: 'persist:space_work',
    domains: [
      domainEntry('github.com', true),
      domainEntry('mail.google.com', false),
      // Needed for Gmail sign-in redirects.
      domainEntry('accounts.google.com', true),
    ],
  };
}

function defaultChatGptSpace() {
  return {
    id: 'chatgpt',
    name: 'ChatGPT',
    color: 'purple',
    partition: 'persist:space_chatgpt',
    domains: [
      domainEntry('chatgpt.com', true),
      // Auth / account flows often move through OpenAI hosts.
      domainEntry('openai.com', true),
      // "Continue with Google" redirects through Google account hosts.
      domainEntry('accounts.google.com', true),
      domainEntry('accounts.youtube.com', true),
      domainEntry('challenges.cloudflare.com', true),
      domainEntry('auth0.com', true),
      domainEntry('gsi.google.com', true),
    ],
  };
}

/**
 * Open web browsing space — starts at Google, allows general http(s) navigation.
 * WhatsApp / Work / ChatGPT stay on their allowlists.
 */
function defaultWebSpace() {
  return {
    id: 'web',
    name: 'Internet',
    color: 'teal',
    partition: 'persist:space_web',
    openWeb: true,
    homeUrl: 'https://www.google.com/',
    domains: [domainEntry('www.google.com', true)],
  };
}

function defaultSpaces() {
  return [
    defaultWhatsAppSpace(),
    defaultWebSpace(),
    defaultWorkSpace(),
    defaultChatGptSpace(),
  ];
}

function seedMissingDefaultSpaces(spaces) {
  const next = [...spaces];
  const hasId = (id) => next.some((space) => space.id === id);
  const hasDomain = (domain) =>
    next.some((space) => space.domains.some((entry) => entry.domain === domain));

  if (!hasId('whatsapp')) {
    next.unshift(defaultWhatsAppSpace());
  }
  if (!hasId('web')) {
    // Prefer Internet near the top, after WhatsApp when present.
    const whatsappIndex = next.findIndex((space) => space.id === 'whatsapp');
    if (whatsappIndex >= 0) {
      next.splice(whatsappIndex + 1, 0, defaultWebSpace());
    } else {
      next.unshift(defaultWebSpace());
    }
  }
  if (!hasId('work') && !hasDomain('github.com') && !hasDomain('mail.google.com')) {
    next.push(defaultWorkSpace());
  }
  if (!hasId('chatgpt') && !hasDomain('chatgpt.com')) {
    next.push(defaultChatGptSpace());
  }
  return next;
}

function ensureSpacesShape(settings) {
  let spaces = Array.isArray(settings.spaces) ? settings.spaces : null;
  if (!spaces || spaces.length === 0) {
    spaces = defaultSpaces();
  } else {
    spaces = seedMissingDefaultSpaces(spaces);
  }

  spaces = spaces.map((space, index) => {
    const id = typeof space.id === 'string' && space.id ? space.id : createId('space');
    const domains = Array.isArray(space.domains)
      ? space.domains
          .map((entry) => {
            if (typeof entry === 'string') {
              return {
                domain: entry.toLowerCase(),
                allowSubdomains: false,
                displayName: displayNameForDomain(entry),
              };
            }
            if (!entry || typeof entry.domain !== 'string') {
              return null;
            }
            return {
              domain: entry.domain.toLowerCase(),
              allowSubdomains: Boolean(entry.allowSubdomains),
              displayName:
                typeof entry.displayName === 'string' && entry.displayName
                  ? entry.displayName
                  : displayNameForDomain(entry.domain),
            };
          })
          .filter(Boolean)
      : [];

    return {
      id,
      name: typeof space.name === 'string' && space.name.trim() ? space.name.trim() : `Space ${index + 1}`,
      color: SPACE_COLORS.includes(space.color) ? space.color : SPACE_COLORS[index % SPACE_COLORS.length],
      partition:
        typeof space.partition === 'string' && space.partition.startsWith('persist:')
          ? space.partition
          : id === 'whatsapp'
            ? 'persist:vaultbrowse'
            : `persist:space_${id}`,
      openWeb: Boolean(space.openWeb) || id === 'web',
      homeUrl:
        typeof space.homeUrl === 'string' && /^https?:\/\//i.test(space.homeUrl)
          ? space.homeUrl
          : id === 'web'
            ? 'https://www.google.com/'
            : undefined,
      domains,
    };
  });

  let activeSpaceId = settings.activeSpaceId;
  if (!spaces.some((space) => space.id === activeSpaceId)) {
    activeSpaceId = spaces[0].id;
  }

  return { spaces, activeSpaceId };
}

function grantChatGptGoogleLogin(spaces) {
  const required = [
    domainEntry('accounts.google.com', true),
    domainEntry('accounts.youtube.com', true),
    // Cloudflare challenge frames used on ChatGPT auth hops.
    domainEntry('challenges.cloudflare.com', true),
    // OpenAI Auth0-style hosts sometimes appear beside openai.com.
    domainEntry('auth0.com', true),
    domainEntry('gsi.google.com', true),
  ];
  let changed = false;
  const next = spaces.map((space) => {
    if (space.id !== 'chatgpt') {
      return space;
    }
    const domains = [...space.domains];
    let added = false;
    for (const entry of required) {
      if (!domains.some((existing) => existing.domain === entry.domain)) {
        domains.push(entry);
        added = true;
      }
    }
    if (!added) {
      return space;
    }
    changed = true;
    return { ...space, domains };
  });
  return { spaces: next, changed };
}

function persistSpaces(spaces, activeSpaceId, migrationPatch) {
  const settings = loadSettings();
  const allowedDomains = [];
  for (const space of spaces) {
    for (const entry of space.domains) {
      if (!allowedDomains.includes(entry.domain)) {
        allowedDomains.push(entry.domain);
      }
    }
  }

  const migrations = {
    ...(settings.migrations && typeof settings.migrations === 'object' ? settings.migrations : {}),
    ...(migrationPatch || {}),
  };

  return saveSettings({
    ...settings,
    spaces,
    activeSpaceId,
    allowedDomains,
    migrations,
    homeUrl:
      spaces.find((s) => s.id === activeSpaceId)?.domains[0]
        ? toHttpsUrl(spaces.find((s) => s.id === activeSpaceId).domains[0].domain)
        : settings.homeUrl,
  });
}

function listSpaces() {
  const settings = loadSettings();
  const before = Array.isArray(settings.spaces) ? settings.spaces : [];
  let { spaces, activeSpaceId } = ensureSpacesShape(settings);
  const googleAuthReady = Boolean(settings.migrations && settings.migrations.chatgptGoogleAuth);
  const googleAuthHostsReady = Boolean(
    settings.migrations && settings.migrations.chatgptGoogleAuthHostsV3
  );
  let addedGoogleAuth = false;
  if (!googleAuthReady || !googleAuthHostsReady) {
    const granted = grantChatGptGoogleLogin(spaces);
    spaces = granted.spaces;
    addedGoogleAuth = granted.changed || !googleAuthHostsReady;
  }
  const needsPersist =
    !googleAuthReady ||
    !googleAuthHostsReady ||
    addedGoogleAuth ||
    !Array.isArray(settings.spaces) ||
    settings.spaces.length === 0 ||
    spaces.length !== before.length ||
    !before.some((space) => space.id === 'work') ||
    !before.some((space) => space.id === 'chatgpt') ||
    !before.some((space) => space.id === 'web');

  if (needsPersist) {
    persistSpaces(spaces, activeSpaceId, {
      chatgptGoogleAuth: true,
      chatgptGoogleAuthHostsV3: true,
    });
  }
  return { spaces, activeSpaceId };
}

function getActiveSpace() {
  const { spaces, activeSpaceId } = listSpaces();
  return spaces.find((space) => space.id === activeSpaceId) || spaces[0];
}

function getSpaceById(spaceId) {
  const { spaces } = listSpaces();
  return spaces.find((space) => space.id === spaceId) || null;
}

/** Ensure the open-Internet space exists (seed + persist if missing). */
function ensureWebSpace() {
  const listed = listSpaces();
  let space = listed.spaces.find((entry) => entry.id === 'web');
  if (space && space.openWeb) {
    return space;
  }
  const next = seedMissingDefaultSpaces(listed.spaces).map((entry) => {
    if (entry.id !== 'web') {
      return entry;
    }
    return {
      ...entry,
      openWeb: true,
      homeUrl:
        typeof entry.homeUrl === 'string' && /^https?:\/\//i.test(entry.homeUrl)
          ? entry.homeUrl
          : 'https://www.google.com/',
    };
  });
  if (!next.some((entry) => entry.id === 'web')) {
    next.splice(1, 0, defaultWebSpace());
  }
  persistSpaces(next, listed.activeSpaceId, { openWebSpaceV1: true });
  return getSpaceById('web');
}

function setActiveSpace(spaceId) {
  const { spaces } = listSpaces();
  if (!spaces.some((space) => space.id === spaceId)) {
    return { ok: false, error: 'Space not found.' };
  }
  persistSpaces(spaces, spaceId);
  return { ok: true, ...listSpaces() };
}

function createSpace(name, initialDomains = []) {
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: 'Enter a space name.' };
  }

  const { spaces, activeSpaceId } = listSpaces();
  const id = createId('space');
  const domains = [];

  for (const item of initialDomains) {
    const raw = typeof item === 'string' ? item : item?.domain;
    const parsed = normalizeHostname(raw);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    if (domains.some((d) => d.domain === parsed.hostname)) {
      continue;
    }
    domains.push({
      domain: parsed.hostname,
      allowSubdomains: Boolean(item?.allowSubdomains),
      displayName: displayNameForDomain(parsed.hostname),
    });
  }

  const space = {
    id,
    name: name.trim().slice(0, 40),
    color: SPACE_COLORS[spaces.length % SPACE_COLORS.length],
    partition: `persist:space_${id}`,
    domains,
  };

  const next = [...spaces, space];
  persistSpaces(next, activeSpaceId);
  return { ok: true, space, ...listSpaces() };
}

function getDomainsForSpace(spaceId) {
  const space = getSpaceById(spaceId) || getActiveSpace();
  return space ? space.domains : [];
}

function getAllDomainsFlat() {
  const { spaces } = listSpaces();
  const out = [];
  for (const space of spaces) {
    for (const entry of space.domains) {
      out.push({ ...entry, spaceId: space.id, spaceName: space.name, color: space.color });
    }
  }
  return out;
}

function isHostnameAllowedInSpace(hostname, spaceId) {
  const space = getSpaceById(spaceId) || getActiveSpace();
  if (!space) {
    return false;
  }
  // Open Internet space: any host is allowed (URL layer still requires http/https).
  if (space.openWeb) {
    return typeof hostname === 'string' && hostname.length > 0;
  }
  if (
    space.domains.some((entry) =>
      hostnameMatches(hostname, entry.domain, entry.allowSubdomains)
    )
  ) {
    return true;
  }
  // Country Google hosts (accounts.google.co.in and similar) are part of the
  // same sign-in flow as accounts.google.com.
  const allowsGoogleAccounts = space.domains.some((entry) => entry.domain === 'accounts.google.com');
  return allowsGoogleAccounts && isGoogleAccountsHostname(hostname);
}

function isUrlAllowedInSpace(urlString, spaceId) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return false;
    }
    // Allow VaultBrowse internal pages.
    if (url.protocol === 'file:') {
      return true;
    }
    return isHostnameAllowedInSpace(url.hostname, spaceId);
  } catch {
    return false;
  }
}

function addDomainToSpace(spaceId, domainInput, allowSubdomains = false) {
  const parsed = normalizeHostname(domainInput);
  if (!parsed.ok) {
    return parsed;
  }

  const { spaces, activeSpaceId } = listSpaces();
  const index = spaces.findIndex((space) => space.id === spaceId);
  if (index < 0) {
    return { ok: false, error: 'Space not found.' };
  }

  if (spaces[index].domains.some((entry) => entry.domain === parsed.hostname)) {
    return { ok: false, error: 'This website is already allowed in this space.' };
  }

  spaces[index] = {
    ...spaces[index],
    domains: [
      ...spaces[index].domains,
      {
        domain: parsed.hostname,
        allowSubdomains: Boolean(allowSubdomains),
        displayName: displayNameForDomain(parsed.hostname),
      },
    ],
  };

  persistSpaces(spaces, activeSpaceId);
  return {
    ok: true,
    domain: parsed.hostname,
    ...listSpaces(),
  };
}

function removeDomainFromSpace(spaceId, domain) {
  const host = String(domain || '').toLowerCase();
  const { spaces, activeSpaceId } = listSpaces();
  const index = spaces.findIndex((space) => space.id === spaceId);
  if (index < 0) {
    return { ok: false, error: 'Space not found.' };
  }

  const before = spaces[index].domains.length;
  spaces[index] = {
    ...spaces[index],
    domains: spaces[index].domains.filter((entry) => entry.domain !== host),
  };
  if (spaces[index].domains.length === before) {
    return { ok: false, error: 'Website not found in this space.' };
  }

  persistSpaces(spaces, activeSpaceId);
  return { ok: true, domain: host, ...listSpaces() };
}

function getSpaceHomeUrl(spaceId) {
  const space = getSpaceById(spaceId) || getActiveSpace();
  if (!space) {
    return null;
  }
  if (typeof space.homeUrl === 'string' && /^https?:\/\//i.test(space.homeUrl)) {
    return space.homeUrl;
  }
  if (space.openWeb) {
    return 'https://www.google.com/';
  }
  if (space.domains.length === 0) {
    return null;
  }
  return toHttpsUrl(space.domains[0].domain);
}

function countAllowedWebsites() {
  return getAllDomainsFlat().length;
}

module.exports = {
  SPACE_COLORS,
  listSpaces,
  getActiveSpace,
  getSpaceById,
  ensureWebSpace,
  setActiveSpace,
  createSpace,
  getDomainsForSpace,
  getAllDomainsFlat,
  isHostnameAllowedInSpace,
  isUrlAllowedInSpace,
  addDomainToSpace,
  removeDomainFromSpace,
  getSpaceHomeUrl,
  countAllowedWebsites,
  ensureSpacesShape,
};
