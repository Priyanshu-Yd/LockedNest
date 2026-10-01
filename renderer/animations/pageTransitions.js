'use strict';

window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.pageEnter = function pageEnter(panel) {
  if (!panel) return;
  window.SafeNestMotion.skipOr(
    () => {
      const cfg = window.SafeNestMotion.config;
      const reveals = panel.querySelectorAll('.reveal');
      const targets = reveals.length ? reveals : [panel];
      gsap.killTweensOf(targets);
      gsap.fromTo(
        targets,
        { y: 22, opacity: 0, filter: 'blur(6px)' },
        {
          y: 0,
          opacity: 1,
          filter: 'blur(0px)',
          duration: cfg.dur.slow,
          ease: cfg.ease.enter,
          stagger: cfg.stagger,
          overwrite: true,
        }
      );
    },
    () => {
      panel.style.opacity = '1';
    }
  );
};

window.SafeNestMotion.homeEntrance = function homeEntrance(root) {
  const scope = root || document;
  window.SafeNestMotion.skipOr(() => {
    const cfg = window.SafeNestMotion.config;
    const tl = gsap.timeline({ defaults: { ease: cfg.ease.enter } });
    const hero = scope.querySelectorAll('.hero.reveal, #greeting-title, .greeting-sub');
    const cards = scope.querySelectorAll(
      '.service-grid .service-card, .private-grid .private-card, .section-card.reveal, .stat-grid .stat-card'
    );
    gsap.set([hero, cards], { clearProps: 'filter' });
    tl.fromTo(
      hero,
      { y: 28, opacity: 0 },
      { y: 0, opacity: 1, duration: cfg.dur.slow, stagger: 0.05 },
      0
    );
    tl.fromTo(
      cards,
      { y: 24, opacity: 0, scale: 0.98 },
      { y: 0, opacity: 1, scale: 1, duration: 0.5, stagger: 0.04 },
      0.15
    );
  });
};

window.SafeNestMotion.navTransition = function navTransition(panel) {
  window.SafeNestMotion.pageEnter(panel);
};
