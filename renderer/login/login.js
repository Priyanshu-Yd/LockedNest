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
const startup = document.getElementById('startup');
const authStage = document.getElementById('auth-stage');

let mode = 'loading';
let authNest = null;
let startupNest = null;

if (typeof window.createAtmosphere === 'function') {
  window.createAtmosphere(document.getElementById('atmosphere'));
}

if (window.SafeNestMotion?.createNestScene) {
  startupNest = window.SafeNestMotion.createNestScene(document.getElementById('startup-nest'), {
    state: 'idle',
  });
  authNest = window.SafeNestMotion.createNestScene(document.getElementById('auth-nest'), {
    state: 'locked',
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

function bindFocusGlow(input) {
  if (!input) return;
  input.addEventListener('focus', () => authNest?.focus());
  input.addEventListener('blur', () => authNest?.blur());
}

bindFocusGlow(passwordInput);
bindFocusGlow(confirmInput);
bindFocusGlow(unlockInput);

function playStartupThen(next) {
  const reduced = window.SafeNestMotion?.reduced;
  if (!startup || reduced || typeof gsap === 'undefined') {
    if (startup) startup.remove();
    authStage.style.opacity = '1';
    next();
    return;
  }

  const tl = gsap.timeline({
    onComplete: () => {
      startup.classList.add('is-done');
      startup.remove();
      next();
    },
  });

  tl.fromTo(
    '.startup-brand',
    { y: 12, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.45, ease: 'power3.out' },
    0.05
  );
  tl.fromTo(
    '.startup-tag',
    { y: 10, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.4, ease: 'power3.out' },
    0.18
  );
  tl.to(startup, {
    opacity: 0,
    duration: 0.35,
    ease: 'power2.inOut',
    delay: 0.15,
  });
  tl.fromTo(
    authStage,
    { y: 20, opacity: 0, filter: 'blur(8px)' },
    { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.55, ease: 'power3.out' },
    '-=0.15'
  );
}

function revealAuthFields() {
  if (!window.SafeNestMotion?.canAnimate()) return;
  const fields = form.querySelectorAll('label, input, .primary-btn, .hint');
  gsap.fromTo(
    fields,
    { y: 14, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.45, stagger: 0.04, ease: 'power3.out' }
  );
}

function setMode(nextMode) {
  mode = nextMode;
  createFields.classList.toggle('hidden', mode !== 'create');
  unlockFields.classList.toggle('hidden', mode !== 'unlock');
  submitBtn.disabled = false;

  if (mode === 'create') {
    subtitle.textContent = 'Create your Nest';
    if (lede) {
      lede.textContent = 'Set a password to protect your private workspace on this PC.';
    }
    submitBtn.textContent = 'Create Nest';
    passwordInput.required = true;
    confirmInput.required = true;
    unlockInput.required = false;
    authNest?.setState('idle');
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
    authNest?.setState('locked');
    unlockInput.focus();
  }
  revealAuthFields();
}

async function init() {
  try {
    const status = await window.vaultbrowse.getAuthStatus();
    playStartupThen(() => {
      setMode(status.configured ? 'unlock' : 'create');
      authNest?.setState(status.configured ? 'locked' : 'idle');
    });
  } catch {
    if (startup) startup.remove();
    authStage.style.opacity = '1';
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
      const message = (result && result.error) || 'Incorrect password. Try again.';
      if (window.SafeNestMotion?.wrongPassword) {
        window.SafeNestMotion.wrongPassword(authNest, errorEl, message);
      } else {
        showError(message);
        authNest?.shake();
      }
      submitBtn.disabled = false;
      if (mode === 'unlock') {
        unlockInput.value = '';
        unlockInput.focus();
      }
      return;
    }

    // Success — open boundary briefly; main process navigates shell.
    authNest?.setState('open');
    if (window.SafeNestMotion?.canAnimate()) {
      gsap.to(authStage, {
        scale: 1.03,
        opacity: 0,
        filter: 'blur(10px)',
        duration: 0.45,
        ease: 'power2.inOut',
      });
    }
  } catch {
    showError('Unexpected authentication error.');
    submitBtn.disabled = false;
  }
});

init();
