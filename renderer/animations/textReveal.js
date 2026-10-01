'use strict';

/**
 * Lightweight text reveal helper for SafeNest headings.
 */
window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.revealText = function revealText(selector, opts = {}) {
  const nodes = typeof selector === 'string' ? document.querySelectorAll(selector) : [selector];
  window.SafeNestMotion.skipOr(() => {
    gsap.fromTo(
      nodes,
      { y: opts.y || 16, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: opts.duration || 0.5,
        stagger: opts.stagger || 0.05,
        ease: 'power3.out',
      }
    );
  });
};
