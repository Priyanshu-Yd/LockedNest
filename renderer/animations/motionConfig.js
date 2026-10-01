'use strict';

/**
 * SafeNest motion configuration — single motion language.
 * OPEN → ENTER → EXPLORE → PROTECT → LOCK
 */
window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.config = {
  ease: {
    out: 'power3.out',
    soft: 'power2.inOut',
    enter: 'power4.out',
  },
  dur: {
    fast: 0.18,
    med: 0.32,
    slow: 0.55,
    unlock: 0.85,
    lock: 0.45,
    panic: 0.18,
  },
  stagger: 0.06,
};
