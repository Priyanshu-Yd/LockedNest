'use strict';

window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.toast = function toast(message, opts = {}) {
  if (!message) return;
  let host = document.getElementById('sn-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'sn-toast-host';
    host.className = 'sn-toast-host';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }

  const el = document.createElement('div');
  el.className = `sn-toast${opts.error ? ' is-error' : ''}`;
  el.innerHTML = `<span class="sn-toast-mark" aria-hidden="true">${opts.error ? '!' : '✓'}</span><span>${message}</span>`;
  host.appendChild(el);

  window.SafeNestMotion.skipOr(
    () => {
      gsap.fromTo(
        el,
        { y: 16, opacity: 0, scale: 0.96 },
        { y: 0, opacity: 1, scale: 1, duration: 0.28, ease: 'power3.out' }
      );
      gsap.to(el, {
        y: -8,
        opacity: 0,
        delay: opts.duration || 2.4,
        duration: 0.28,
        ease: 'power2.in',
        onComplete: () => el.remove(),
      });
    },
    () => {
      setTimeout(() => el.remove(), opts.duration ? opts.duration * 1000 : 2400);
    }
  );
};
