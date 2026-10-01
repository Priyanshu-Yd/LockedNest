'use strict';

/**
 * Lightweight Vanta-inspired fog field (no Three.js).
 * Soft drifting orbs + grain — atmosphere, not decoration overload.
 */
function createAtmosphere(canvas) {
  if (!canvas) return { destroy() {} };

  const ctx = canvas.getContext('2d', { alpha: true });
  let raf = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  const orbs = [];

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
    const count = 5;
    for (let i = 0; i < count; i += 1) {
      orbs.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 140 + Math.random() * 220,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.2,
        hue: i % 2 === 0 ? 168 : 28,
        alpha: 0.08 + Math.random() * 0.07,
      });
    }
  }

  function frame(t) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#07090d';
    ctx.fillRect(0, 0, width, height);

    for (const orb of orbs) {
      orb.x += orb.vx;
      orb.y += orb.vy;
      if (orb.x < -orb.r) orb.x = width + orb.r;
      if (orb.x > width + orb.r) orb.x = -orb.r;
      if (orb.y < -orb.r) orb.y = height + orb.r;
      if (orb.y > height + orb.r) orb.y = -orb.r;

      const pulse = 0.85 + Math.sin(t * 0.0004 + orb.r) * 0.15;
      const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r * pulse);
      g.addColorStop(0, `hsla(${orb.hue}, 70%, 55%, ${orb.alpha})`);
      g.addColorStop(0.45, `hsla(${orb.hue}, 60%, 40%, ${orb.alpha * 0.35})`);
      g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.r * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fine grain
    const grain = ctx.createImageData(Math.min(width, 320), 2);
    for (let i = 0; i < grain.data.length; i += 4) {
      const v = 20 + Math.random() * 30;
      grain.data[i] = v;
      grain.data[i + 1] = v;
      grain.data[i + 2] = v;
      grain.data[i + 3] = 18;
    }
    ctx.globalCompositeOperation = 'soft-light';
    for (let y = 0; y < height; y += 48) {
      ctx.putImageData(grain, Math.floor(Math.random() * Math.max(width - 320, 1)), y);
    }
    ctx.globalCompositeOperation = 'source-over';

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

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    },
  };
}

window.createAtmosphere = createAtmosphere;
