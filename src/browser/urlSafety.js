'use strict';

/**
 * Sanitize URLs for logs. Auth/OAuth query strings can contain temporary
 * secrets (state, nonce, code, tokens) and must never be written in full.
 */
function safeLogUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    return '[empty-url]';
  }
  if (
    rawUrl.startsWith('about:') ||
    rawUrl.startsWith('devtools:') ||
    rawUrl.startsWith('chrome-error:') ||
    rawUrl.startsWith('data:')
  ) {
    const cut = rawUrl.indexOf(',');
    return cut === -1 ? rawUrl.slice(0, 32) : rawUrl.slice(0, Math.min(cut, 32));
  }
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

module.exports = {
  safeLogUrl,
};
