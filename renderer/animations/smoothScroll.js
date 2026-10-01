'use strict';

window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.initSmoothScroll = function initSmoothScroll(wrapper, content) {
  if (typeof Lenis !== 'function' || window.SafeNestMotion.reduced) return null;
  const lenis = new Lenis({
    wrapper,
    content,
    duration: 1.05,
    smoothWheel: true,
    touchMultiplier: 1.35,
  });
  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
  return lenis;
};
