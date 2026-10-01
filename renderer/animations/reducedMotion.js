'use strict';

window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.reduced = (() => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
})();

window.SafeNestMotion.canAnimate = function canAnimate() {
  return typeof gsap !== 'undefined' && !window.SafeNestMotion.reduced;
};

window.SafeNestMotion.skipOr = function skipOr(fn, instantFn) {
  if (window.SafeNestMotion.canAnimate()) return fn();
  if (typeof instantFn === 'function') instantFn();
};
