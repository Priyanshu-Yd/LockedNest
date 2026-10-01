'use strict';

/**
 * Phase 1 smoke test (runs inside Electron).
 * Verifies password create/verify and persistent session partition wiring.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, session } = require('electron');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultbrowse-phase1-'));
app.setPath('userData', tempRoot);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

app
  .whenReady()
  .then(() => {
    const passwordManager = require('../src/security/passwordManager');
    const browserManager = require('../src/browser/browserManager');
    const { getHomeUrl } = require('../src/storage/settingsManager');

    assert(passwordManager.hasPassword() === false, 'Expected no password initially');

    const badCreate = passwordManager.createPassword('123');
    assert(badCreate.ok === false, 'Short password should fail');

    const created = passwordManager.createPassword('correct-horse-battery');
    assert(created.ok === true, 'Password creation should succeed');
    assert(passwordManager.hasPassword() === true, 'Password should exist after create');

    const wrong = passwordManager.verifyPassword('wrong-password');
    assert(wrong.ok === false, 'Wrong password should fail');

    const right = passwordManager.verifyPassword('correct-horse-battery');
    assert(right.ok === true, 'Correct password should pass');

    const verifierPath = passwordManager.getVerifierPath();
    assert(fs.existsSync(verifierPath), 'Verifier file should exist');
    const raw = fs.readFileSync(verifierPath);
    const asText = raw.toString('utf8');
    assert(!asText.includes('correct-horse-battery'), 'Password must not appear in verifier file');

    assert(
      getHomeUrl() === 'https://web.whatsapp.com/',
      'Home URL should be WhatsApp Web'
    );

    const spaceManager = require('../src/spaces/spaceManager');
    const vaultSession = browserManager.getVaultSession();
    assert(typeof vaultSession.getUserAgent === 'function', 'Session should be available');
    assert(
      spaceManager.getActiveSpace().partition === 'persist:vaultbrowse',
      'WhatsApp partition must remain persistent'
    );
    assert(session.fromPartition('persist:vaultbrowse'), 'persist partition resolvable');

    console.log('PHASE1_SMOKE_OK');
    console.log(`tempUserData=${tempRoot}`);
    app.exit(0);
  })
  .catch((error) => {
    console.error('PHASE1_SMOKE_FAIL');
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  });
