'use strict';

/**
 * Service card flip transition (WhatsApp pilot).
 * Completes the flip WHILE still covering the UI, then caller opens the space
 * (Electron BrowserView sits above HTML — must not attach during the flip).
 */
window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.playServiceFlip = function playServiceFlip(cardEl, service) {
  const reduced = window.SafeNestMotion.reduced || typeof gsap === 'undefined';
  const accent = service?.accent || '#25d366';
  const name = service?.name || 'App';
  const mark = service?.mark || 'Wa';

  if (reduced || !cardEl) {
    return Promise.resolve({
      skipped: true,
      dismiss: async () => {},
    });
  }

  const rect = cardEl.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.className = 'service-flip-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="service-flip-veil"></div>
    <div class="service-flip-stage">
      <div class="service-flip-card">
        <div class="service-flip-face service-flip-front">
          <span class="service-mark">${mark}</span>
          <span class="service-name">${name}</span>
          <span class="service-desc">${service?.description || ''}</span>
        </div>
        <div class="service-flip-face service-flip-back">
          <span class="service-mark">${mark}</span>
          <strong>Opening ${name}</strong>
          <span>Entering your Nest…</span>
        </div>
      </div>
    </div>
  `;

  const stage = overlay.querySelector('.service-flip-stage');
  const flipCard = overlay.querySelector('.service-flip-card');
  const front = overlay.querySelector('.service-flip-front');
  const back = overlay.querySelector('.service-flip-back');

  overlay.style.setProperty('--flip-accent', accent);
  stage.style.left = `${rect.left}px`;
  stage.style.top = `${rect.top}px`;
  stage.style.width = `${rect.width}px`;
  stage.style.height = `${rect.height}px`;

  document.body.appendChild(overlay);

  const targetW = Math.min(window.innerWidth * 0.42, 420);
  const targetH = Math.min(window.innerHeight * 0.42, 280);
  const targetLeft = (window.innerWidth - targetW) / 2;
  const targetTop = (window.innerHeight - targetH) / 2;

  function dismiss() {
    return new Promise((resolve) => {
      if (!overlay.isConnected) {
        resolve();
        return;
      }
      if (typeof gsap === 'undefined') {
        overlay.remove();
        resolve();
        return;
      }
      gsap.to(overlay, {
        opacity: 0,
        duration: 0.2,
        ease: 'power2.in',
        onComplete: () => {
          overlay.remove();
          resolve();
        },
      });
    });
  }

  return new Promise((resolve) => {
    const tl = gsap.timeline({
      defaults: { ease: 'power3.inOut' },
      onComplete: () => {
        // Keep overlay up — open BrowserView only after this resolves
        resolve({ skipped: false, dismiss });
      },
    });

    gsap.set(flipCard, { transformStyle: 'preserve-3d' });
    gsap.set([front, back], { backfaceVisibility: 'hidden' });
    gsap.set(back, { rotateY: 180 });

    tl.to(overlay, { opacity: 1, duration: 0.1, ease: 'power1.out' }, 0);

    tl.to(
      stage,
      {
        left: targetLeft,
        top: targetTop,
        width: targetW,
        height: targetH,
        duration: 0.55,
      },
      0
    );

    tl.to(
      flipCard,
      {
        rotateY: 180,
        scale: 1.04,
        duration: 0.65,
      },
      0.05
    );
  });
};
