'use strict';

window.SafeNestMotion = window.SafeNestMotion || {};

/**
 * Lock visuals — security state must already be applied before calling.
 * Never apply full-screen CSS blur; keep the unlock card sharp.
 * @param {{ panic?: boolean, nest?: object }} opts
 */
window.SafeNestMotion.playLock = function playLock(opts = {}) {
  const lockScreen = document.getElementById('lock-screen');
  const lockCard = document.querySelector('.lock-card');
  const nestHost = document.getElementById('lock-nest');
  const panic = Boolean(opts.panic);
  const cfg = window.SafeNestMotion.config;

  if (lockScreen) {
    lockScreen.style.filter = '';
    lockScreen.style.opacity = '';
  }
  if (lockCard) {
    lockCard.style.filter = '';
    lockCard.style.opacity = '1';
  }

  if (opts.nest) opts.nest.setState(panic ? 'locked' : 'close');
  if (nestHost && window.SafeNestMotion._lockNest) {
    window.SafeNestMotion._lockNest.setState('locked');
  }

  window.SafeNestMotion.skipOr(
    () => {
      if (!lockCard) return;
      const dur = panic ? cfg.dur.panic : cfg.dur.lock;
      gsap.fromTo(
        lockCard,
        { y: panic ? 8 : 20, opacity: 0, scale: panic ? 0.99 : 0.96, filter: 'none' },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          filter: 'none',
          duration: dur,
          ease: cfg.ease.out,
          clearProps: 'filter',
        }
      );
      const modules = lockCard.querySelectorAll('.lock-modules span');
      if (modules.length) {
        gsap.fromTo(
          modules,
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.28, stagger: 0.04, delay: panic ? 0 : 0.12 }
        );
      }
    },
    () => {
      if (lockCard) {
        lockCard.style.opacity = '1';
        lockCard.style.filter = '';
      }
    }
  );
};

/**
 * Unlock visuals after successful auth (security already unlocked).
 */
window.SafeNestMotion.playUnlock = function playUnlock(opts = {}) {
  const lockScreen = document.getElementById('lock-screen');
  const lockCard = document.querySelector('.lock-card');
  const cfg = window.SafeNestMotion.config;

  if (opts.nest) opts.nest.setState('open');

  return new Promise((resolve) => {
    window.SafeNestMotion.skipOr(
      () => {
        const tl = gsap.timeline({
          onComplete: () => {
            if (lockCard) {
              lockCard.style.filter = '';
              lockCard.style.opacity = '';
              lockCard.style.transform = '';
            }
            if (lockScreen) {
              lockScreen.style.opacity = '';
              lockScreen.style.filter = '';
            }
            resolve();
          },
        });
        if (lockCard) {
          tl.to(lockCard, {
            scale: 1.03,
            opacity: 0,
            duration: cfg.dur.unlock * 0.55,
            ease: cfg.ease.soft,
          });
        }
        if (lockScreen) {
          tl.to(
            lockScreen,
            {
              opacity: 0,
              duration: cfg.dur.unlock * 0.35,
              ease: cfg.ease.out,
            },
            '-=0.2'
          );
        }
        if (!lockCard && !lockScreen) resolve();
      },
      () => resolve()
    );
  });
};

window.SafeNestMotion.wrongPassword = function wrongPassword(nestApi, errorEl, message) {
  if (nestApi) nestApi.shake();
  const card = document.querySelector('.lock-card, .auth-stage, .auth-card');
  if (window.SafeNestMotion.canAnimate() && card) {
    gsap.fromTo(card, { x: -6 }, { x: 0, duration: 0.42, ease: 'power2.out' });
  }
  if (errorEl && message) {
    errorEl.hidden = false;
    errorEl.classList?.remove('hidden');
    errorEl.textContent = message;
  }
};
