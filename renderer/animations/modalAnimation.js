'use strict';

window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.openModalMotion = function openModalMotion(card) {
  window.SafeNestMotion.skipOr(() => {
    gsap.fromTo(
      card || '.modal-card',
      { y: 14, opacity: 0, scale: 0.96 },
      { y: 0, opacity: 1, scale: 1, duration: 0.28, ease: 'power3.out' }
    );
  });
};

window.SafeNestMotion.closeModalMotion = function closeModalMotion(card, onDone) {
  window.SafeNestMotion.skipOr(
    () => {
      gsap.to(card || '.modal-card', {
        y: 8,
        opacity: 0,
        scale: 0.96,
        duration: 0.18,
        ease: 'power2.in',
        onComplete: () => onDone && onDone(),
      });
    },
    () => onDone && onDone()
  );
};
