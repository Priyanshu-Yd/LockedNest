'use strict';

const KNOWN_DISPLAY_NAMES = {
  'web.whatsapp.com': 'WhatsApp Web',
  'whatsapp.com': 'WhatsApp',
  'github.com': 'GitHub',
  'mail.google.com': 'Gmail',
  'accounts.google.com': 'Google Accounts',
  'accounts.youtube.com': 'Google sign-in',
  'gsi.google.com': 'Google Identity',
  'drive.google.com': 'Google Drive',
  'docs.google.com': 'Google Docs',
  'google.com': 'Google',
  'chatgpt.com': 'ChatGPT',
  'openai.com': 'OpenAI',
  'auth.openai.com': 'OpenAI Auth',
};

/**
 * Normalize user input into a hostname.
 * Accepts "example.com" or "https://example.com/path".
 */
function normalizeHostname(input) {
  if (typeof input !== 'string') {
    return { ok: false, error: 'Enter a website domain.' };
  }

  let raw = input.trim().toLowerCase();
  if (!raw) {
    return { ok: false, error: 'Enter a website domain.' };
  }

  // Strip credentials / whitespace artifacts.
  raw = raw.replace(/\s+/g, '');

  let hostname;
  try {
    if (raw.includes('://')) {
      hostname = new URL(raw).hostname;
    } else if (raw.includes('/') || raw.includes('?') || raw.includes('#')) {
      hostname = new URL(`https://${raw}`).hostname;
    } else {
      // Hostname-only path — still parse via URL for punycode/normalization.
      hostname = new URL(`https://${raw}`).hostname;
    }
  } catch {
    return { ok: false, error: 'Invalid website domain.' };
  }

  hostname = String(hostname || '')
    .replace(/\.$/, '')
    .toLowerCase();

  if (!hostname) {
    return { ok: false, error: 'Invalid website domain.' };
  }

  if (hostname === 'localhost') {
    return { ok: true, hostname };
  }

  // Reject IPs for this product surface (keep allowlist domain-oriented).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { ok: false, error: 'IP addresses are not supported. Use a domain name.' };
  }

  // Require a real domain with at least one dot (rejects "example").
  if (!hostname.includes('.')) {
    return { ok: false, error: 'Enter a valid domain like example.com' };
  }

  // Labels: alnum, internal hyphens; TLD letters (incl. punycode xn--).
  const label = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
  const parts = hostname.split('.');
  if (parts.length < 2 || parts.some((part) => !label.test(part))) {
    return { ok: false, error: 'Invalid website domain.' };
  }

  return { ok: true, hostname };
}

function displayNameForDomain(domain) {
  const host = String(domain || '').toLowerCase();
  if (KNOWN_DISPLAY_NAMES[host]) {
    return KNOWN_DISPLAY_NAMES[host];
  }
  const base = host.split('.').slice(-2).join('.');
  if (KNOWN_DISPLAY_NAMES[base]) {
    return KNOWN_DISPLAY_NAMES[base];
  }
  const label = host.split('.')[0] || host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Google sign-in often leaves accounts.google.com for a country host such as
 * accounts.google.co.in. Those are not subdomains of accounts.google.com.
 * Only treat real Google account hosts as a match — not lookalikes.
 */
function isGoogleAccountsHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return /^(?:[a-z0-9-]+\.)*accounts\.google\.(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/.test(host);
}

/**
 * Exact host match, or subdomain match when allowSubdomains is true.
 * Never treats evil.com.example.com style hosts as matching example.com
 * unless they are true DNS subdomains (host === domain || host.endsWith('.'+domain)).
 */
function hostnameMatches(hostname, domain, allowSubdomains) {
  if (typeof hostname !== 'string' || typeof domain !== 'string') {
    return false;
  }
  const host = hostname.toLowerCase();
  const allowed = domain.toLowerCase();
  if (host === allowed) {
    return true;
  }
  if (allowSubdomains && host.endsWith(`.${allowed}`)) {
    return true;
  }
  return false;
}

function toHttpsUrl(domain) {
  return `https://${domain}/`;
}

module.exports = {
  KNOWN_DISPLAY_NAMES,
  normalizeHostname,
  displayNameForDomain,
  isGoogleAccountsHostname,
  hostnameMatches,
  toHttpsUrl,
};
