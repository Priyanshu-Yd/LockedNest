'use strict';

const address = document.getElementById('address');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const btnLock = document.getElementById('btn-lock');
const autoLockSelect = document.getElementById('auto-lock');
const lockScreen = document.getElementById('lock-screen');
const lockBlur = document.getElementById('lock-blur');
const unlockForm = document.getElementById('unlock-form');
const unlockPassword = document.getElementById('unlock-password');
const unlockError = document.getElementById('unlock-error');
const unlockBtn = document.getElementById('unlock-btn');

let isLocked = false;

function showUnlockError(message) {
  if (!message) {
    unlockError.hidden = true;
    unlockError.textContent = '';
    return;
  }
  unlockError.hidden = false;
  unlockError.textContent = message;
}

function setBlurBackground(dataUrl) {
  if (dataUrl && typeof dataUrl === 'string') {
    lockBlur.style.backgroundImage = `url("${dataUrl}")`;
    lockBlur.classList.add('has-image');
  } else {
    lockBlur.style.backgroundImage = '';
    lockBlur.classList.remove('has-image');
  }
}

function applyLockState(state) {
  isLocked = Boolean(state && state.locked);
  document.body.classList.toggle('is-locked', isLocked);
  lockScreen.classList.toggle('hidden', !isLocked);

  if (state && state.autoLock) {
    const minutes = state.autoLock.enabled ? state.autoLock.timeoutMinutes : 0;
    autoLockSelect.value = String(minutes);
  }

  if (isLocked) {
    if (Object.prototype.hasOwnProperty.call(state || {}, 'blurBackground')) {
      setBlurBackground(state.blurBackground);
    }
    unlockPassword.value = '';
    showUnlockError('');
    unlockBtn.disabled = false;
    setTimeout(() => unlockPassword.focus(), 30);
  } else {
    setBlurBackground(null);
  }
}

async function refreshAddress() {
  try {
    const url = await window.vaultbrowse.getUrl();
    if (url) {
      address.value = url;
    }
  } catch {
    // ignore
  }
}

btnBack.addEventListener('click', async () => {
  if (isLocked) return;
  await window.vaultbrowse.navigate('back');
  refreshAddress();
});

btnForward.addEventListener('click', async () => {
  if (isLocked) return;
  await window.vaultbrowse.navigate('forward');
  refreshAddress();
});

btnReload.addEventListener('click', async () => {
  if (isLocked) return;
  await window.vaultbrowse.navigate('reload');
  refreshAddress();
});

btnLock.addEventListener('click', async () => {
  await window.vaultbrowse.lock();
});

autoLockSelect.addEventListener('change', async () => {
  const minutes = Number(autoLockSelect.value);
  const result = await window.vaultbrowse.setAutoLockMinutes(minutes);
  if (result && result.ok) {
    applyLockState(result);
  }
});

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showUnlockError('');
  unlockBtn.disabled = true;

  try {
    const result = await window.vaultbrowse.unlock(unlockPassword.value);
    if (!result || !result.ok) {
      showUnlockError((result && result.error) || 'Incorrect password.');
      unlockPassword.value = '';
      unlockPassword.focus();
      unlockBtn.disabled = false;
      return;
    }
    applyLockState({ locked: false, autoLock: (await window.vaultbrowse.getLockState()).autoLock });
    refreshAddress();
  } catch {
    showUnlockError('Could not unlock your Nest.');
    unlockBtn.disabled = false;
  }
});

window.vaultbrowse.onUrlChange((url) => {
  if (typeof url === 'string') {
    address.value = url;
  }
});

window.vaultbrowse.onLockChange((state) => {
  applyLockState(state);
});

// Activity for auto-lock (shell UI interactions).
let lastActivityPing = 0;
function pingActivity() {
  if (isLocked) return;
  const now = Date.now();
  if (now - lastActivityPing < 2000) return;
  lastActivityPing = now;
  window.vaultbrowse.noteActivity();
}

['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach((eventName) => {
  window.addEventListener(eventName, pingActivity, { passive: true });
});

window.vaultbrowse.getHomeUrl().then((url) => {
  if (url) {
    address.value = url;
  }
});

window.vaultbrowse.getLockState().then((state) => {
  applyLockState(state);
});

refreshAddress();
