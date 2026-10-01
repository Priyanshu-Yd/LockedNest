'use strict';

/**
 * Lightweight fog field — SafeNest atmosphere (dark / light aware).
 */
function createAtmosphere(canvas) {
  if (!canvas) return { destroy() {}, refresh() {} };

  const prefersReduced = (() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  })();

  const ctx = canvas.getContext('2d', { alpha: true });
  let raf = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  const orbs = [];

  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    orbs.length = 0;
    const count = prefersReduced ? 3 : 5;
    for (let i = 0; i < count; i += 1) {
      orbs.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 160 + Math.random() * 240,
        vx: prefersReduced ? 0 : (Math.random() - 0.5) * 0.18,
        vy: prefersReduced ? 0 : (Math.random() - 0.5) * 0.14,
        hue: i % 3 === 0 ? 168 : i % 3 === 1 ? 210 : 28,
        alpha: isLight() ? 0.05 + Math.random() * 0.04 : 0.06 + Math.random() * 0.05,
      });
    }
  }

  function frame(t) {
    const light = isLight();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = light ? '#eef1f5' : '#0a0c10';
    ctx.fillRect(0, 0, width, height);

    const radial = ctx.createRadialGradient(
      width * 0.5,
      height * 0.42,
      0,
      width * 0.5,
      height * 0.42,
      Math.max(width, height) * 0.55
    );
    if (light) {
      radial.addColorStop(0, 'rgba(255, 255, 255, 1)');
      radial.addColorStop(1, 'rgba(238, 241, 245, 1)');
    } else {
      radial.addColorStop(0, 'rgba(18, 21, 28, 1)');
      radial.addColorStop(1, 'rgba(10, 12, 16, 1)');
    }
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);

    for (const orb of orbs) {
      orb.x += orb.vx;
      orb.y += orb.vy;
      if (orb.x < -orb.r) orb.x = width + orb.r;
      if (orb.x > width + orb.r) orb.x = -orb.r;
      if (orb.y < -orb.r) orb.y = height + orb.r;
      if (orb.y > height + orb.r) orb.y = -orb.r;

      const pulse = prefersReduced ? 1 : 0.88 + Math.sin(t * 0.00035 + orb.r) * 0.12;
      const alpha = light ? orb.alpha * 0.7 : orb.alpha;
      const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r * pulse);
      g.addColorStop(0, `hsla(${orb.hue}, ${light ? 35 : 42}%, ${light ? 48 : 52}%, ${alpha})`);
      g.addColorStop(0.45, `hsla(${orb.hue}, ${light ? 28 : 35}%, ${light ? 55 : 38}%, ${alpha * 0.32})`);
      g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.r * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    raf = requestAnimationFrame(frame);
  }

  function onResize() {
    resize();
    seed();
  }

  resize();
  seed();
  raf = requestAnimationFrame(frame);
  window.addEventListener('resize', onResize);

  if (window.SafeNestTheme?.onChange) {
    window.SafeNestTheme.onChange(() => seed());
  }

  return {
    refresh() {
      seed();
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    },
  };
}

window.createAtmosphere = createAtmosphere;
