'use strict';

window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.initSidebar = function initSidebar(nav) {
  if (!nav) return { setActive() {} };

  let indicator = nav.querySelector('.side-nav-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'side-nav-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    nav.insertBefore(indicator, nav.firstChild);
  }

  function moveTo(btn, instant) {
    if (!btn) {
      indicator.style.opacity = '0';
      return;
    }
    const navRect = nav.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const top = btnRect.top - navRect.top + nav.scrollTop;
    indicator.style.opacity = '1';
    if (window.SafeNestMotion.canAnimate() && !instant) {
      gsap.to(indicator, {
        y: top,
        height: btnRect.height,
        duration: 0.35,
        ease: 'power3.out',
        overwrite: true,
      });
    } else {
      indicator.style.transform = `translateY(${top}px)`;
      indicator.style.height = `${btnRect.height}px`;
    }
  }

  function setActive(mode) {
    let navMode = mode || 'dashboard';
    if (navMode === 'browser' || navMode === 'browserHub') navMode = 'browser';
    const btn = nav.querySelector(`.side-link[data-nav="${navMode}"]`);
    moveTo(btn);
  }

  nav.querySelectorAll('.side-link').forEach((btn) => {
    btn.addEventListener('pointerenter', () => {
      if (window.SafeNestMotion.reduced) return;
      const ico = btn.querySelector('.nav-ico');
      if (ico && typeof gsap !== 'undefined') {
        gsap.to(ico, { x: 2, duration: 0.2, ease: 'power2.out', overwrite: true });
      }
    });
    btn.addEventListener('pointerleave', () => {
      const ico = btn.querySelector('.nav-ico');
      if (ico && typeof gsap !== 'undefined') {
        gsap.to(ico, { x: 0, duration: 0.25, ease: 'power2.out', overwrite: true });
      }
    });
  });

  const active = nav.querySelector('.side-link.is-active');
  if (active) moveTo(active, true);

  window.addEventListener('resize', () => {
    const current = nav.querySelector('.side-link.is-active');
    if (current) moveTo(current, true);
  });

  return { setActive, moveTo };
};
