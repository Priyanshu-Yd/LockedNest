'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultbrowse-features-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

app.whenReady().then(() => {
  const passwordManager = require('../src/security/passwordManager');
  const spaceManager = require('../src/spaces/spaceManager');
  const domainManager = require('../src/domains/domainManager');
  const recentManager = require('../src/storage/recentManager');
  const activityLog = require('../src/storage/activityLog');
  const { normalizeHostname, hostnameMatches, isGoogleAccountsHostname } = require('../src/domains/hostnameUtils');
  const { shouldAllowNavigation } = require('../src/browser/navigationGuard');
  const {
    isGoogleAuthUrl,
    isChatGptGoogleLoginUrl,
    isChatGptSignedInUrl,
    userAgentForUrl,
    requestHeadersForUrl,
    buildFirefoxUserAgent,
  } = require('../src/browser/browserIdentity');

  assert(passwordManager.createPassword('test-pass-123').ok, 'create password');

  const spaces = spaceManager.listSpaces();
  assert(spaces.spaces.length >= 1, 'default space exists');
  assert(spaces.spaces[0].partition === 'persist:vaultbrowse', 'whatsapp partition preserved');

  assert(normalizeHostname('https://GitHub.com/foo').ok, 'normalize url');
  assert(normalizeHostname('https://GitHub.com/foo').hostname === 'github.com', 'host extract');
  assert(normalizeHostname('example').ok === false, 'reject single label');

  assert(hostnameMatches('www.example.com', 'example.com', true), 'subdomain allow');
  assert(hostnameMatches('example.com.evil.com', 'example.com', true) === false, 'suffix attack blocked');
  assert(hostnameMatches('evil-example.com', 'example.com', true) === false, 'lookalike blocked');

  const add = spaceManager.addDomainToSpace(spaces.activeSpaceId, 'github.com', false);
  assert(add.ok, 'add domain');
  assert(domainManager.isHostnameAllowed('github.com'), 'github allowed');
  assert(domainManager.isHostnameAllowed('www.github.com') === false, 'subdomain denied by default');

  recentManager.recordVisit('github.com', spaces.activeSpaceId);
  assert(recentManager.getRecent()[0].domain === 'github.com', 'recent recorded');

  assert(shouldAllowNavigation('https://youtube.com/', 'whatsapp') === false, 'youtube blocked in whatsapp');
  assert(shouldAllowNavigation('https://web.whatsapp.com/', 'whatsapp') === true, 'whatsapp allowed');

  const web = spaces.spaces.find((space) => space.id === 'web');
  assert(web && web.openWeb, 'web open-browse space seeded');
  assert(
    spaceManager.getSpaceHomeUrl('web') === 'https://www.google.com/',
    'web space homes to Google'
  );
  assert(shouldAllowNavigation('https://www.google.com/', 'web') === true, 'google allowed in web');
  assert(shouldAllowNavigation('https://youtube.com/', 'web') === true, 'open web allows youtube');
  assert(shouldAllowNavigation('https://example.com/file.zip', 'web') === true, 'open web allows downloads hosts');
  assert(shouldAllowNavigation('https://youtube.com/', 'chatgpt') === false, 'chatgpt still allowlisted');

  const work = spaceManager.createSpace('Work', [{ domain: 'mail.google.com' }]);
  assert(work.ok, 'create work space');
  assert(work.space.partition.startsWith('persist:space_'), 'isolated partition');

  activityLog.record('PANIC_LOCK');
  activityLog.record('UNLOCK_SUCCESS');
  assert(activityLog.getEvents(10).length >= 2, 'activity logged');

  const chatgpt = spaces.spaces.find((space) => space.id === 'chatgpt');
  assert(chatgpt, 'chatgpt space seeded');
  assert(
    chatgpt.domains.some((entry) => entry.domain === 'accounts.google.com' && entry.allowSubdomains),
    'chatgpt allows Google accounts'
  );
  assert(
    chatgpt.domains.some((entry) => entry.domain === 'accounts.youtube.com'),
    'chatgpt allows Google sign-in host'
  );
  assert(isGoogleAuthUrl('https://accounts.google.com/o/oauth2/v2/auth'), 'google auth url');
  assert(
    isChatGptGoogleLoginUrl(
      'https://chatgpt.com/auth/login_with?callback_path=%2F&connection=google-oauth2'
    ),
    'chatgpt google login_with detected'
  );
  assert(isChatGptSignedInUrl('https://chatgpt.com/') === true, 'chatgpt home is signed-in url');
  assert(isChatGptSignedInUrl('https://chatgpt.com/auth/login_with') === false, 'auth path not signed-in');
  assert(userAgentForUrl('https://accounts.google.com/').includes('Chrome/'), 'google host alone keeps Chrome UA');
  assert(userAgentForUrl('https://chatgpt.com/').includes('Chrome/'), 'chatgpt keeps Chrome UA');
  assert(userAgentForUrl('https://web.whatsapp.com/').includes('Chrome/'), 'whatsapp keeps Chrome UA');
  const googleHeaders = requestHeadersForUrl('https://accounts.google.com/', {
    'User-Agent': 'Electron',
    'Sec-CH-UA': '"Chromium"',
  });
  assert(googleHeaders['User-Agent'].includes('Chrome/'), 'non-auth google request keeps Chrome UA');
  assert(googleHeaders['Sec-CH-UA'], 'non-auth requests keep Chrome client hints');
  const authWindowHeaders = requestHeadersForUrl(
    'https://auth.openai.com/api/accounts/authorize',
    { 'User-Agent': 'Chrome', 'Sec-CH-UA': '"Chromium"' },
    true
  );
  assert(
    authWindowHeaders['User-Agent'] === buildFirefoxUserAgent(),
    'auth window forceFirefox uses Firefox UA'
  );
  assert(
    !authWindowHeaders['Sec-CH-UA'] && !authWindowHeaders['sec-ch-ua'],
    'auth window strips Chrome client hints'
  );
  const normalPopupHeaders = requestHeadersForUrl(
    'https://chatgpt.com/',
    { 'User-Agent': 'Electron' },
    false
  );
  assert(normalPopupHeaders['User-Agent'].includes('Chrome/'), 'normal popup uses Chrome identity');
  const chatgptHeaders = requestHeadersForUrl('https://chatgpt.com/auth/login_with', {});
  assert(chatgptHeaders['Sec-CH-UA-Arch'], 'chatgpt requests include arch client hint');
  assert(chatgptHeaders['Sec-CH-UA-Full-Version-List'], 'chatgpt requests include full version list');

  // authResolver.js is unused by production runtime; these checks keep the
  // dead helper covered until a follow-up removes or rewires it.
  const { extractRedirectFromHtml, isUsefulAuthDestination } = require('../src/browser/authResolver');
  assert(
    isUsefulAuthDestination('https://auth.openai.com/api/accounts/authorize?x=1'),
    'openai auth host useful'
  );
  assert(
    isUsefulAuthDestination('https://auth.openai.com/') === false,
    'bare openai auth welcome page is not a useful destination'
  );
  const extracted = extractRedirectFromHtml(
    '<script>location.href="https://accounts.google.com/o/oauth2/v2/auth?client_id=x"</script>',
    'https://chatgpt.com/auth/login_with'
  );
  assert(
    extracted && extracted.startsWith('https://accounts.google.com/'),
    'extract google redirect from html'
  );

  const { safeLogUrl } = require('../src/browser/urlSafety');
  const oauthLogSample =
    'https://accounts.google.com/o/oauth2/auth?state=FAKE_STATE&nonce=FAKE_NONCE&code=FAKE_CODE&id_token=FAKE_ID&access_token=FAKE_AT';
  const redacted = safeLogUrl(oauthLogSample);
  assert(redacted === 'https://accounts.google.com/o/oauth2/auth', 'oauth log keeps origin+path');
  assert(!redacted.includes('state='), 'oauth log hides state');
  assert(!redacted.includes('nonce='), 'oauth log hides nonce');
  assert(!redacted.includes('code='), 'oauth log hides code');
  assert(!redacted.includes('token'), 'oauth log hides tokens');
  assert(safeLogUrl('not a url') === '[invalid-url]', 'invalid url sanitized');

  assert(isGoogleAccountsHostname('accounts.google.com'), 'google.com accounts host');
  assert(isGoogleAccountsHostname('accounts.google.co.in'), 'india google accounts host accepted');
  assert(isGoogleAccountsHostname('accounts.google.evil.com') === false, 'accounts.google.evil.com rejected');
  assert(
    isGoogleAccountsHostname('accounts.google.com.evil.com') === false,
    'accounts.google.com.evil.com rejected'
  );
  assert(isGoogleAccountsHostname('evilaccounts.google.com') === false, 'evilaccounts.google.com rejected');

  const browserManager = require('../src/browser/browserManager');
  assert(
    browserManager.classifyContentPopup(
      'chatgpt',
      'https://chatgpt.com/auth/login_with?callback_path=%2F&connection=google-oauth2'
    ) === 'auth',
    'chatgpt google login_with is auth popup'
  );
  assert(
    browserManager.classifyContentPopup('chatgpt', 'https://chatgpt.com/') === 'normal',
    'allowlisted chatgpt popup is normal'
  );
  assert(
    browserManager.classifyContentPopup('chatgpt', 'https://accounts.google.com/o/oauth2/auth') ===
      'normal',
    'google accounts alone is not auth popup without chatgpt login_with'
  );
  assert(
    browserManager.classifyContentPopup('whatsapp', 'https://accounts.google.com/') === 'deny',
    'whatsapp cannot open google as popup'
  );
  assert(
    browserManager.classifyContentPopup('chatgpt', 'https://accounts.google.evil.com/') === 'deny',
    'malicious google lookalike popup denied'
  );
  assert(
    browserManager.getChromeUserAgent().includes('Chrome/'),
    'normal browser chrome identity helper'
  );
  assert(
    browserManager.getFirefoxUserAgent().includes('Firefox/'),
    'auth firefox identity helper'
  );
  assert(browserManager.getGoogleAuthContextSnapshot() === null, 'no auth context initially');
  assert(browserManager.isAuthWebContentsId(999999) === false, 'unknown webContents not auth');
  browserManager.closeAuthWindows();
  assert(browserManager.getGoogleAuthContextSnapshot() === null, 'cleanup clears auth context');

  assert(
    shouldAllowNavigation('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', 'chatgpt'),
    'google oauth allowed in chatgpt'
  );
  assert(
    shouldAllowNavigation('https://accounts.google.co.in/o/oauth2/v2/auth', 'chatgpt'),
    'google india oauth allowed in chatgpt'
  );
  assert(
    shouldAllowNavigation('https://accounts.youtube.com/', 'chatgpt'),
    'youtube accounts host allowed in chatgpt'
  );
  assert(
    shouldAllowNavigation('https://accounts.google.com/', 'whatsapp') === false,
    'whatsapp blocks google login'
  );
  assert(shouldAllowNavigation('https://youtube.com/', 'chatgpt') === false, 'youtube still blocked in chatgpt');
  assert(
    shouldAllowNavigation('https://accounts.google.evil.com/', 'chatgpt') === false,
    'fake google host blocked in chatgpt'
  );

  const settingsManager = require('../src/storage/settingsManager');
  const saved = settingsManager.loadSettings();
  const stripped = saved.spaces.map((space) => {
    if (space.id !== 'chatgpt') {
      return space;
    }
    return {
      ...space,
      domains: space.domains.filter(
        (entry) => entry.domain !== 'accounts.google.com' && entry.domain !== 'accounts.youtube.com'
      ),
    };
  });
  settingsManager.saveSettings({ ...saved, spaces: stripped, migrations: {} });
  const migrated = spaceManager.listSpaces();
  const gpt = migrated.spaces.find((space) => space.id === 'chatgpt');
  assert(
    gpt.domains.some((entry) => entry.domain === 'accounts.google.com'),
    'existing chatgpt space gains Google login'
  );
  const removed = spaceManager.removeDomainFromSpace('chatgpt', 'accounts.google.com');
  assert(removed.ok, 'user can remove google domain');
  const afterRemove = spaceManager.listSpaces();
  assert(
    afterRemove.spaces
      .find((space) => space.id === 'chatgpt')
      .domains.every((entry) => entry.domain !== 'accounts.google.com'),
    'removed google domain stays removed'
  );

  console.log('FEATURES_SMOKE_OK');
  app.exit(0);
}).catch((error) => {
  console.error('FEATURES_SMOKE_FAIL');
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
