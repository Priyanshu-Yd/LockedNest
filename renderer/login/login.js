'use strict';

const subtitle = document.getElementById('subtitle');
const lede = document.getElementById('lede');
const form = document.getElementById('auth-form');
const createFields = document.getElementById('create-fields');
const unlockFields = document.getElementById('unlock-fields');
const passwordInput = document.getElementById('password');
const confirmInput = document.getElementById('confirm');
const unlockInput = document.getElementById('unlock-password');
const submitBtn = document.getElementById('submit-btn');
const errorEl = document.getElementById('error');

let mode = 'loading';

if (typeof window.createAtmosphere === 'function') {
  window.createAtmosphere(document.getElementById('atmosphere'));
}

if (typeof gsap !== 'undefined') {
  gsap.from('.auth-card', {
    y: 24,
    opacity: 0,
    duration: 0.7,
    ease: 'power3.out',
  });
}

function showError(message) {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function setMode(nextMode) {
  mode = nextMode;
  createFields.classList.toggle('hidden', mode !== 'create');
  unlockFields.classList.toggle('hidden', mode !== 'unlock');
  submitBtn.disabled = false;

  if (mode === 'create') {
    subtitle.textContent = 'Create your Nest';
    if (lede) {
      lede.textContent = 'Set a password to protect your private workspace.';
    }
    submitBtn.textContent = 'Create Nest';
    passwordInput.required = true;
    confirmInput.required = true;
    unlockInput.required = false;
    passwordInput.focus();
  } else if (mode === 'unlock') {
    subtitle.textContent = 'Unlock Nest';
    if (lede) {
      lede.textContent = 'Enter your Nest password to continue.';
    }
    submitBtn.textContent = 'Unlock Nest';
    passwordInput.required = false;
    confirmInput.required = false;
    unlockInput.required = true;
    unlockInput.focus();
  }
}

async function init() {
  try {
    const status = await window.vaultbrowse.getAuthStatus();
    setMode(status.configured ? 'unlock' : 'create');
  } catch {
    subtitle.textContent = 'Could not start';
    showError('Failed to read authentication status.');
    submitBtn.disabled = true;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  submitBtn.disabled = true;

  try {
    let result;
    if (mode === 'create') {
      result = await window.vaultbrowse.createPassword(
        passwordInput.value,
        confirmInput.value
      );
    } else {
      result = await window.vaultbrowse.verifyPassword(unlockInput.value);
    }

    if (!result || !result.ok) {
      showError((result && result.error) || 'Authentication failed.');
      submitBtn.disabled = false;
      if (mode === 'unlock') {
        unlockInput.value = '';
        unlockInput.focus();
      }
    }
  } catch {
    showError('Unexpected authentication error.');
    submitBtn.disabled = false;
  }
});

init();
