'use strict';

const { BrowserWindow } = require('electron');
const {
  buildChromeUserAgent,
  isGoogleAuthUrl,
  chromeIdentityHeaders,
} = require('./browserIdentity');
const { isGoogleAccountsHostname } = require('../domains/hostnameUtils');
const { safeLogUrl } = require('./urlSafety');

function hostnameOf(urlString) {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * A destination is useful only if Google/OpenAI auth can actually continue.
 * Bare https://auth.openai.com/ is NOT enough — its Google button is a no-op
 * without ChatGPT's authorize/session query parameters.
 */
function isUsefulAuthDestination(urlString) {
  if (isGoogleAuthUrl(urlString)) {
    return true;
  }
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    const path = url.pathname || '/';

    if (host === 'auth.openai.com' || host.endsWith('.auth.openai.com')) {
      if (path === '/' || path === '') {
        return false;
      }
      return (
        path.includes('authorize') ||
        path.includes('/u/') ||
        path.includes('login') ||
        path.includes('connect') ||
        path.includes('continue') ||
        path.includes('identifier') ||
        url.searchParams.has('connection') ||
        url.searchParams.has('client_id') ||
        url.searchParams.has('clientId')
      );
    }

    if (host === 'auth0.com' || host.endsWith('.auth0.com')) {
      return path !== '/' && path !== '';
    }

    if (host === 'gsi.google.com' || host.endsWith('.gsi.google.com')) {
      return true;
    }

    // Exact Google account hosts (incl. country TLDs) — never host.includes('google.')
    if (isGoogleAccountsHostname(host)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isChatGptHost(urlString) {
  const host = hostnameOf(urlString);
  return host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
}

function extractRedirectFromHtml(html, baseUrl) {
  if (typeof html !== 'string' || !html) {
    return null;
  }

  const patterns = [
    /http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>\s]+)/i,
    /content=["'][^"']*url=([^"'>\s]+)["'][^>]*http-equiv=["']refresh["']/i,
    /(?:window\.)?location(?:\.href|\.replace)\s*=\s*["']([^"']+)["']/i,
    /(?:window\.)?location\.replace\(\s*["']([^"']+)["']\s*\)/i,
    /<a[^>]+href=["'](https:\/\/accounts\.google\.[^"']+)["']/i,
    /<a[^>]+href=["'](https:\/\/auth\.openai\.com[^"']+)["']/i,
    /(https:\/\/auth\.openai\.com\/api\/accounts\/authorize[^"'<\s]+)/i,
    /(https:\/\/accounts\.google\.[^"'<\s]+\/o\/oauth2[^"'<\s]*)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match || !match[1]) {
      continue;
    }
    try {
      const absolute = new URL(match[1].replace(/&amp;/g, '&'), baseUrl).href;
      if (isUsefulAuthDestination(absolute)) {
        return absolute;
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

async function resolveAuthDestinationFetch(session, startUrl, maxHops = 10) {
  let current = startUrl;
  let lastHtmlUrl = null;

  for (let hop = 0; hop < maxHops; hop += 1) {
    if (isUsefulAuthDestination(current)) {
      return { ok: true, url: current, hops: hop, via: 'fetch' };
    }

    let response;
    try {
      response = await session.fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: chromeIdentityHeaders({
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Upgrade-Insecure-Requests': '1',
        }),
      });
    } catch (error) {
      return {
        ok: false,
        error: error && error.message ? error.message : 'Could not reach sign-in server.',
        url: current,
        via: 'fetch',
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        break;
      }
      current = new URL(location, current).href;
      continue;
    }

    const contentType = String(response.headers.get('content-type') || '');
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      const html = await response.text();
      lastHtmlUrl = current;
      const extracted = extractRedirectFromHtml(html, current);
      if (extracted && extracted !== current) {
        current = extracted;
        continue;
      }
    }

    if (isUsefulAuthDestination(current)) {
      return { ok: true, url: current, hops: hop, via: 'fetch' };
    }
    break;
  }

  return {
    ok: false,
    error: 'Could not reach Google sign-in from ChatGPT.',
    url: lastHtmlUrl || current,
    via: 'fetch',
  };
}

/**
 * Load login_with in a real Chromium window (with JS + cookies) and capture the
 * first Google / OpenAI authorize URL. session.fetch alone dies on Cloudflare.
 */
function resolveAuthDestinationInWindow(session, startUrl, timeoutMs = 18000) {
  return new Promise((resolve) => {
    let settled = false;
    const ua = buildChromeUserAgent();

    const win = new BrowserWindow({
      show: false,
      width: 520,
      height: 740,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        if (!win.isDestroyed()) {
          win.close();
        }
      } catch {
        // ignore
      }
      resolve(result);
    };

    const consider = (url) => {
      if (!url || isInternalish(url)) {
        return;
      }
      console.log(`[SafeNest] auth resolve hop: ${safeLogUrl(url)}`);
      if (isUsefulAuthDestination(url)) {
        finish({ ok: true, url, via: 'window' });
      }
    };

    const timer = setTimeout(() => {
      const current = !win.isDestroyed() ? win.webContents.getURL() : '';
      if (current && isUsefulAuthDestination(current)) {
        finish({ ok: true, url: current, via: 'window-timeout' });
        return;
      }
      finish({
        ok: false,
        error: 'Timed out waiting for Google / OpenAI authorize URL.',
        url: current || startUrl,
        via: 'window-timeout',
      });
    }, timeoutMs);

    const wc = win.webContents;
    wc.setUserAgent(ua);
    wc.on('will-redirect', (_event, url) => consider(url));
    wc.on('will-navigate', (_event, url) => consider(url));
    wc.on('did-navigate', (_event, url) => consider(url));
    wc.on('did-navigate-in-page', (_event, url) => consider(url));
    wc.on('did-fail-load', (_event, code, desc, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3 || settled) {
        return;
      }
      console.warn(
        `[SafeNest] auth resolve fail (${code}): ${desc} @ ${safeLogUrl(validatedURL)}`
      );
    });

    wc.loadURL(startUrl, { userAgent: ua }).catch((error) => {
      finish({
        ok: false,
        error: error && error.message ? error.message : 'Failed to load sign-in URL.',
        url: startUrl,
        via: 'window',
      });
    });
  });
}

function isInternalish(urlString) {
  return (
    !urlString ||
    urlString.startsWith('data:') ||
    urlString.startsWith('about:') ||
    urlString.startsWith('devtools:') ||
    urlString.startsWith('chrome-error:')
  );
}

async function resolveAuthDestination(session, startUrl) {
  const fetched = await resolveAuthDestinationFetch(session, startUrl);
  if (fetched.ok) {
    return fetched;
  }
  console.warn('[VaultBrowse] fetch resolve missed, trying window:', fetched.error);
  return resolveAuthDestinationInWindow(session, startUrl);
}

function loadingPageUrl(message) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Sign in</title>
<style>
  html,body{margin:0;height:100%;font-family:DM Sans,Segoe UI,sans-serif;background:#f7f7f8;color:#0d0d0d}
  main{min-height:100%;display:grid;place-items:center;padding:24px;text-align:center}
  p{max-width:28rem;line-height:1.45}
  .spin{width:28px;height:28px;border:3px solid #ddd;border-top-color:#10a37f;border-radius:50%;margin:0 auto 16px;animation:r .8s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}
</style></head>
<body><main><div><div class="spin"></div><p>${String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')}</p></div></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

module.exports = {
  resolveAuthDestination,
  resolveAuthDestinationFetch,
  resolveAuthDestinationInWindow,
  isUsefulAuthDestination,
  loadingPageUrl,
  extractRedirectFromHtml,
};
