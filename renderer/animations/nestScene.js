'use strict';

/**
 * Nest Boundary scene — concentric protective rings (canvas).
 * States: idle | focus | open | protect | close | locked
 */
window.SafeNestMotion = window.SafeNestMotion || {};

window.SafeNestMotion.createNestScene = function createNestScene(host, options = {}) {
  if (!host) return { setState() {}, destroy() {}, focus() {}, blur() {}, shake() {} };

  const canvas = document.createElement('canvas');
  canvas.className = 'nest-boundary__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const core = document.createElement('div');
  core.className = 'nest-boundary__core';
  core.setAttribute('aria-hidden', 'true');
  host.appendChild(core);

  const ctx = canvas.getContext('2d');
  let raf = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let state = options.state || 'idle';
  let openAmount = state === 'open' ? 1 : state === 'locked' ? 0 : 0.35;
  let targetOpen = openAmount;
  let glow = 0.35;
  let targetGlow = glow;
  let t0 = performance.now();
  const reduced = window.SafeNestMotion.reduced;

  function resize() {
    const rect = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(rect.width, 1);
    h = Math.max(rect.height, 1);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function setState(next) {
    state = next || 'idle';
    if (state === 'open' || state === 'explore') {
      targetOpen = 1;
      targetGlow = 0.55;
    } else if (state === 'focus') {
      targetOpen = Math.max(openAmount, 0.45);
      targetGlow = 0.9;
    } else if (state === 'protect' || state === 'close') {
      targetOpen = 0.15;
      targetGlow = 0.25;
    } else if (state === 'locked') {
      targetOpen = 0;
      targetGlow = 0.2;
    } else {
      targetOpen = 0.35;
      targetGlow = 0.4;
    }
    host.dataset.nestState = state;
  }

  function draw(now) {
    const t = (now - t0) * 0.001;
    openAmount += (targetOpen - openAmount) * (reduced ? 1 : 0.08);
    glow += (targetGlow - glow) * (reduced ? 1 : 0.1);
    host.style.setProperty('--nest-open', String(openAmount));
    host.style.setProperty('--nest-glow', String(glow));

    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) * 0.42;

    for (let i = 0; i < 4; i += 1) {
      const spread = 0.55 + i * 0.14 + openAmount * 0.22;
      const r = base * spread;
      const pulse = reduced ? 0 : Math.sin(t * (0.7 + i * 0.15) + i) * 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + pulse * 0.2, r, r * (0.92 + openAmount * 0.06), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(94, 184, 168, ${0.08 + glow * 0.12 - i * 0.015})`;
      ctx.lineWidth = 1 + (3 - i) * 0.35;
      ctx.stroke();

      // soft arc highlights
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.94, t * 0.15 + i, 0.2, 1.4);
      ctx.strokeStyle = `rgba(235, 230, 220, ${0.04 + glow * 0.08})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // inner protective veil
    const veil = ctx.createRadialGradient(cx, cy, base * 0.1, cx, cy, base * (0.7 + openAmount * 0.25));
    veil.addColorStop(0, `rgba(94, 184, 168, ${0.12 + glow * 0.1})`);
    veil.addColorStop(0.55, `rgba(107, 140, 174, ${0.04 + (1 - openAmount) * 0.04})`);
    veil.addColorStop(1, 'rgba(10, 12, 16, 0)');
    ctx.fillStyle = veil;
    ctx.beginPath();
    ctx.arc(cx, cy, base * (0.75 + openAmount * 0.2), 0, Math.PI * 2);
    ctx.fill();

    raf = requestAnimationFrame(draw);
  }

  function onResize() {
    resize();
  }

  resize();
  setState(state);
  if (!reduced) {
    raf = requestAnimationFrame(draw);
  } else {
    draw(performance.now());
  }
  window.addEventListener('resize', onResize);

  return {
    setState,
    focus() {
      host.classList.add('is-focus');
      setState('focus');
    },
    blur() {
      host.classList.remove('is-focus');
      setState(host.dataset.nestPersist || 'idle');
    },
    shake() {
      host.classList.remove('is-shake');
      void host.offsetWidth;
      host.classList.add('is-shake');
      setTimeout(() => host.classList.remove('is-shake'), 450);
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.remove();
      core.remove();
    },
  };
};
