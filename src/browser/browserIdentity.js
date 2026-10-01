'use strict';

const os = require('os');
const { app } = require('electron');
const { isGoogleAccountsHostname } = require('../domains/hostnameUtils');

/**
 * Google blocks Chromium-based embedded clients when they claim to be Chrome.
 * Presenting Google auth as Firefox skips that check. WhatsApp and other sites
 * still get a Chrome UA (they reject Electron's default string).
 *
 * ChatGPT/Cloudflare also send Critical-CH for a full Sec-CH-UA* set — sending
 * only a partial Chrome hint list can yield a blank challenge page on
 * /auth/login_with.
 */

function platformToken() {
  if (process.platform === 'darwin') {
    // Chrome still uses the Intel token on Apple Silicon for compatibility.
    return 'Macintosh; Intel Mac OS X 10_15_7';
  }
  if (process.platform === 'linux') {
    return 'X11; Linux x86_64';
  }
  return 'Windows NT 10.0; Win64; x64';
}

function firefoxPlatformToken() {
  if (process.platform === 'darwin') {
    return 'Macintosh; Intel Mac OS X 10.15';
  }
  if (process.platform === 'linux') {
    return 'X11; Linux x86_64';
  }
  return 'Windows NT 10.0; Win64; x64';
}

function platformClientHint() {
  if (process.platform === 'darwin') {
    return '"macOS"';
  }
  if (process.platform === 'linux') {
    return '"Linux"';
  }
  return '"Windows"';
}

function platformVersionHint() {
  if (process.platform === 'darwin') {
    const [darwinMajor, darwinMinor = '0'] = String(os.release()).split('.');
    const macMajor = Math.max(Number(darwinMajor) - 9, 13);
    return `"${macMajor}.${Number(darwinMinor) || 0}.0"`;
  }
  if (process.platform === 'win32') {
    return '"15.0.0"';
  }
  return '"6.5.0"';
}

function archClientHint() {
  if (process.arch === 'arm64' || process.arch === 'arm') {
    return '"arm"';
  }
  return '"x86"';
}

function chromeVersion() {
  return process.versions.chrome || '138.0.7204.251';
}

function chromeMajor() {
  return String(chromeVersion()).split('.')[0];
}

function buildChromeUserAgent() {
  return `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion()} Safari/537.36`;
}

function buildFirefoxUserAgent() {
  return `Mozilla/5.0 (${firefoxPlatformToken()}; rv:133.0) Gecko/20100101 Firefox/133.0`;
}

function isGoogleAuthHostname(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!host) {
    return false;
  }
  if (isGoogleAccountsHostname(host)) {
    return true;
  }
  return host === 'accounts.youtube.com' || host.endsWith('.accounts.youtube.com');
}

function isGoogleAuthUrl(urlString) {
  try {
    return isGoogleAuthHostname(new URL(urlString).hostname);
  } catch {
    return false;
  }
}

function isChatGptGoogleLoginUrl(urlString) {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    if (host !== 'chatgpt.com' && !host.endsWith('.chatgpt.com')) {
      return false;
    }
    if (!url.pathname.includes('/auth/login_with')) {
      return false;
    }
    return url.searchParams.get('connection') === 'google-oauth2';
  } catch {
    return false;
  }
}

function isChatGptSignedInUrl(urlString) {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    if (host !== 'chatgpt.com' && !host.endsWith('.chatgpt.com')) {
      return false;
    }
    const path = url.pathname || '/';
    if (path.includes('/auth/') || path.includes('/login') || path.includes('/api/auth')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Default browsing identity is Chrome-like.
 * Firefox UA is applied only to dedicated auth windows (markAuthWebContents),
 * not inferred from Google hostnames alone.
 */
function userAgentForUrl(_urlString) {
  return buildChromeUserAgent();
}

function stripClientHintHeaders(existing) {
  const next = {};
  for (const [key, value] of Object.entries(existing || {})) {
    const lower = key.toLowerCase();
    if (lower === 'user-agent' || lower.startsWith('sec-ch-ua') || lower.startsWith('ua-')) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function chromeIdentityHeaders(existing) {
  const next = stripClientHintHeaders(existing);
  const major = chromeMajor();
  const full = chromeVersion();
  const brands = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not.A/Brand";v="24"`;
  const fullList = `"Google Chrome";v="${full}", "Chromium";v="${full}", "Not.A/Brand";v="10.0.2.3"`;

  next['User-Agent'] = buildChromeUserAgent();
  next['Sec-CH-UA'] = brands;
  next['Sec-CH-UA-Mobile'] = '?0';
  next['Sec-CH-UA-Platform'] = platformClientHint();
  next['Sec-CH-UA-Platform-Version'] = platformVersionHint();
  next['Sec-CH-UA-Arch'] = archClientHint();
  next['Sec-CH-UA-Bitness'] = '"64"';
  next['Sec-CH-UA-Model'] = '""';
  next['Sec-CH-UA-Full-Version'] = `"${full}"`;
  next['Sec-CH-UA-Full-Version-List'] = fullList;
  return next;
}

function firefoxIdentityHeaders(existing) {
  const next = stripClientHintHeaders(existing);
  next['User-Agent'] = buildFirefoxUserAgent();
  return next;
}

/**
 * @param {string} _urlString reserved for callers / future per-URL policy
 * @param {Record<string, string>} existing
 * @param {boolean} forceFirefox true only for ChatGPT Google OAuth auth windows
 */
function requestHeadersForUrl(_urlString, existing, forceFirefox = false) {
  return forceFirefox ? firefoxIdentityHeaders(existing) : chromeIdentityHeaders(existing);
}

function applyUserAgentForUrl(webContents, urlString) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }
  webContents.setUserAgent(userAgentForUrl(urlString));
}

function stealthScript() {
  // Only hide the automation flag. Overriding userAgentData has been observed
  // to blank Cloudflare / ChatGPT challenge pages in Electron.
  return `(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    } catch {}
    try {
      if (!window.chrome) {
        window.chrome = { runtime: {} };
      } else if (!window.chrome.runtime) {
        window.chrome.runtime = {};
      }
    } catch {}
  })();`;
}

function injectStealth(webContents) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }
  webContents.executeJavaScript(stealthScript(), true).catch(() => {});
}

function installEarlyIdentity() {
  if (app.isReady()) {
    return;
  }
  app.userAgentFallback = buildChromeUserAgent();
  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
}

module.exports = {
  buildChromeUserAgent,
  buildFirefoxUserAgent,
  isGoogleAuthHostname,
  isGoogleAuthUrl,
  isChatGptGoogleLoginUrl,
  isChatGptSignedInUrl,
  userAgentForUrl,
  chromeIdentityHeaders,
  requestHeadersForUrl,
  applyUserAgentForUrl,
  injectStealth,
  installEarlyIdentity,
};
