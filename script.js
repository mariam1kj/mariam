/* =========================================================================
   MIDNIGHT GIFT — interactive experience
   - one requestAnimationFrame loop drives every canvas effect
   - a starfield / dust layer (#sky) and a pooled fireworks engine (#fireworks)
   - a small state machine: intro -> revealing -> celebration
   ========================================================================= */
(() => {
  'use strict';

  const root = document.documentElement;
  const $ = (selector) => document.querySelector(selector);

  /* ---------------------------------------------------------------------
     Environment
     --------------------------------------------------------------------- */
  const media = (query) => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null);
  const reducedMotionQuery = media('(prefers-reduced-motion: reduce)');
  const finePointerQuery = media('(hover: hover) and (pointer: fine)');

  const env = {
    reduced: !!(reducedMotionQuery && reducedMotionQuery.matches),
    finePointer: !!(finePointerQuery && finePointerQuery.matches),
    get compact() {
      return Math.min(window.innerWidth, window.innerHeight) < 640;
    },
  };

  const watchQuery = (query, onChange) => {
    if (!query) return;
    if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
    else if (typeof query.addListener === 'function') query.addListener(onChange);
  };
  watchQuery(reducedMotionQuery, (event) => { env.reduced = event.matches; });
  watchQuery(finePointerQuery, (event) => { env.finePointer = event.matches; });

  const warn = (...args) => {
    if (window.console && typeof console.warn === 'function') console.warn('[Midnight Gift]', ...args);
  };

  const safely = (fn) => {
    try { return fn(); } catch (error) { warn(error); return undefined; }
  };

  /* ---------------------------------------------------------------------
     Small math helpers
     --------------------------------------------------------------------- */
  const TAU = Math.PI * 2;
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
  const pick = (list) => list[(Math.random() * list.length) | 0];
  const ease = (dt, rate) => 1 - Math.exp(-dt * rate);

  /* ---------------------------------------------------------------------
     The single animation loop
     --------------------------------------------------------------------- */
  const Loop = (() => {
    const tasks = [];
    let frameId = 0;
    let last = 0;
    let running = false;

    const frame = (now) => {
      frameId = requestAnimationFrame(frame);
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.05) dt = 0.05; // never jump after a stall

      for (let i = 0; i < tasks.length; i++) {
        try {
          tasks[i](dt, now);
        } catch (error) {
          // A broken effect must never take the experience down with it.
          warn('effect disabled:', error);
          tasks.splice(i, 1);
          i--;
        }
      }
    };

    const start = () => {
      if (running || document.hidden || typeof requestAnimationFrame !== 'function') return;
      running = true;
      last = performance.now();
      frameId = requestAnimationFrame(frame);
    };

    const stop = () => {
      running = false;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else start();
    });

    return {
      add(task) { if (tasks.indexOf(task) === -1) tasks.push(task); },
      remove(task) {
        const index = tasks.indexOf(task);
        if (index !== -1) tasks.splice(index, 1);
      },
      start,
    };
  })();

  /* ---------------------------------------------------------------------
     Shared pointer (for parallax and the gift's gentle tilt)
     --------------------------------------------------------------------- */
  const pointer = { x: 0.5, y: 0.5 };

  /* ---------------------------------------------------------------------
     Canvas helpers
     --------------------------------------------------------------------- */
  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /** Pre-rendered glow sprite with a white-hot core (used for sparks and stars). */
  const makeGlowSprite = (hex, size) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    if (!g) return canvas;
    const [r, gr, b] = hexToRgb(hex);
    const mr = Math.round((r + 255 * 1.4) / 2.4);
    const mg = Math.round((gr + 255 * 1.4) / 2.4);
    const mb = Math.round((b + 255 * 1.4) / 2.4);
    const half = size / 2;
    const gradient = g.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.1, `rgba(${mr},${mg},${mb},1)`);
    gradient.addColorStop(0.26, `rgba(${r},${gr},${b},.72)`);
    gradient.addColorStop(0.55, `rgba(${r},${gr},${b},.16)`);
    gradient.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    return canvas;
  };

  /** Soft sprite without a core (used for large, out-of-focus particles). */
  const makeSoftSprite = (hex, size) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    if (!g) return canvas;
    const [r, gr, b] = hexToRgb(hex);
    const half = size / 2;
    const gradient = g.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, `rgba(${r},${gr},${b},.9)`);
    gradient.addColorStop(0.45, `rgba(${r},${gr},${b},.32)`);
    gradient.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    return canvas;
  };

  /** Size a canvas to its CSS box, honouring device pixel ratio within a pixel budget. */
  const fitCanvas = (canvas, ctx, maxDpr, maxPixels) => {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (w * h * dpr * dpr > maxPixels) dpr = Math.max(0.75, Math.sqrt(maxPixels / (w * h)));
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  };

  const get2d = (canvas) => {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try { return canvas.getContext('2d'); } catch (error) { return null; }
  };

  /* =======================================================================
     Ambient sky: drifting stars, shimmering dust, soft bokeh
     ======================================================================= */
  const createSky = (canvas) => {
    const ctx = get2d(canvas);
    if (!ctx) return { update() {}, resize() {}, setIntensity() {} };

    const starSprites = ['#F8F7FF', '#DCD3FF', '#F4D06F', '#F9C5E2'].map((c) => makeGlowSprite(c, 32));
    const dustSprites = ['#A855F7', '#F4D06F', '#C4B5FD'].map((c) => makeGlowSprite(c, 32));
    const bokehSprites = ['#8B5CF6', '#F472B6', '#F4D06F', '#A855F7'].map((c) => makeSoftSprite(c, 128));

    let W = 0;
    let H = 0;
    let stars = [];
    let dust = [];
    let bokeh = [];
    let intensity = 1;
    let target = 1;
    let px = 0;
    let py = 0;
    let dirty = true;

    const build = () => {
      const area = W * H;
      const starCount = clamp(Math.round(area / 5200), 90, 300);
      stars = [];
      for (let i = 0; i < starCount; i++) {
        const roll = Math.random();
        stars.push({
          x: Math.random(),
          y: Math.random(),
          r: 0.35 + Math.pow(Math.random(), 3) * 1.25,
          a: rand(0.25, 0.95),
          tw: rand(0.4, 1.9),
          ph: Math.random() * TAU,
          depth: rand(0.2, 1),
          c: roll < 0.8 ? 0 : roll < 0.92 ? 1 : roll < 0.97 ? 2 : 3,
        });
      }

      const dustCount = env.compact ? 22 : 40;
      dust = [];
      for (let i = 0; i < dustCount; i++) {
        dust.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: rand(-4, 4),
          vy: rand(-12, -3),
          size: rand(4, 10),
          a: rand(0.18, 0.5),
          ph: Math.random() * TAU,
          depth: rand(0.4, 1),
          c: (Math.random() * dustSprites.length) | 0,
        });
      }

      bokeh = [];
      const bokehCount = env.compact ? 5 : 8;
      for (let i = 0; i < bokehCount; i++) {
        bokeh.push({
          x: Math.random(),
          y: Math.random(),
          r: rand(40, 120),
          a: rand(0.04, 0.09),
          ph: Math.random() * TAU,
          sp: rand(0.03, 0.08),
          depth: rand(0.1, 0.35),
          c: (Math.random() * bokehSprites.length) | 0,
        });
      }
    };

    const resize = () => {
      const size = fitCanvas(canvas, ctx, 2, 3.2e6);
      const firstBuild = W === 0;
      // keep dust inside the new bounds
      if (!firstBuild && (size.w !== W || size.h !== H)) {
        for (const d of dust) { d.x = (d.x / W) * size.w; d.y = (d.y / H) * size.h; }
      }
      W = size.w;
      H = size.h;
      if (firstBuild) build();
      dirty = true;
    };

    const draw = (now, dt, animate) => {
      ctx.clearRect(0, 0, W, H);
      const t = now / 1000;
      const ox = px * 22;
      const oy = py * 14;

      // soft bokeh, furthest back
      for (const b of bokeh) {
        if (animate) b.ph += dt * b.sp;
        const x = b.x * W + Math.sin(b.ph) * 40 - ox * b.depth;
        const y = b.y * H + Math.cos(b.ph * 0.8) * 30 - oy * b.depth;
        ctx.globalAlpha = b.a * (0.75 + 0.25 * intensity);
        ctx.drawImage(bokehSprites[b.c], x - b.r, y - b.r, b.r * 2, b.r * 2);
      }

      // stars
      const boost = Math.min(intensity, 2);
      for (const s of stars) {
        if (animate) {
          s.x -= s.depth * 0.0022 * dt;
          if (s.x < -0.02) s.x += 1.04;
        }
        const twinkle = animate ? 0.62 + 0.38 * Math.sin(t * s.tw + s.ph) : 0.85;
        let alpha = s.a * twinkle * boost;
        if (alpha > 1) alpha = 1;
        const size = s.r * 5.2 * (0.85 + 0.15 * boost);
        let x = s.x * W - ox * s.depth;
        let y = s.y * H - oy * s.depth;
        if (x < -10) x += W + 20;
        ctx.globalAlpha = alpha;
        ctx.drawImage(starSprites[s.c], x - size / 2, y - size / 2, size, size);
      }

      // floating violet & gold dust
      for (const d of dust) {
        if (animate) {
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          d.ph += dt * 0.8;
          if (d.y < -20) { d.y = H + 20; d.x = Math.random() * W; }
          if (d.x < -20) d.x = W + 20;
          else if (d.x > W + 20) d.x = -20;
        }
        const alpha = d.a * (0.55 + 0.45 * Math.sin(d.ph)) * Math.min(1.4, intensity);
        if (alpha <= 0.01) continue;
        ctx.globalAlpha = alpha > 1 ? 1 : alpha;
        const x = d.x - ox * d.depth * 1.6;
        const y = d.y - oy * d.depth * 1.6;
        ctx.drawImage(dustSprites[d.c], x - d.size / 2, y - d.size / 2, d.size, d.size);
      }
      ctx.globalAlpha = 1;
    };

    const update = (dt, now) => {
      const prevIntensity = intensity;
      intensity += (target - intensity) * ease(dt, 1.4);

      const tx = env.finePointer && !env.reduced ? pointer.x - 0.5 : 0;
      const ty = env.finePointer && !env.reduced ? pointer.y - 0.5 : 0;
      px += (tx - px) * ease(dt, 2.5);
      py += (ty - py) * ease(dt, 2.5);

      if (env.reduced) {
        // static sky: redraw only when something actually changed
        if (!dirty && Math.abs(prevIntensity - intensity) < 0.002) return;
        dirty = false;
        draw(now, dt, false);
        return;
      }
      dirty = false;
      draw(now, dt, true);
    };

    return {
      update,
      resize,
      setIntensity(value) { target = value; },
    };
  };

  /* =======================================================================
     Fireworks engine
     ======================================================================= */
  const createFireworks = (canvas) => {
    const ctx = get2d(canvas);
    const noop = () => {};
    if (!ctx) {
      return { update: noop, resize: noop, gather: noop, fountain: noop, startShow: noop, launchTo: noop };
    }

    // palette indices
    const VIOLET = 0, PURPLE = 1, LAVENDER = 2, PINK = 3, BLUSH = 4, GOLD = 5, CHAMPAGNE = 6, WHITE = 7;
    const COLORS = ['#A855F7', '#8B5CF6', '#C4B5FD', '#F472B6', '#F9A8D4', '#F4D06F', '#FFE7A3', '#F8F7FF'];
    const sprites = COLORS.map((c) => makeGlowSprite(c, 48));

    // drag modes, as a per-frame (60 fps) velocity multiplier
    const DRAG = [0.955, 0.975, 1];
    const dragNow = [1, 1, 1];

    const MAX_PARTICLES = env.compact ? 1100 : 2600;
    const MAX_ROCKETS = env.compact ? 7 : 12;
    const TRAIL_FADE = 0.24;

    // ---- particle pool: preallocated, recycled, no per-frame allocation ----
    const pool = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      pool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, c: 0, drag: 0, grav: 0, flicker: false, swell: false, alpha: 1 });
    }
    const free = pool.slice();
    const live = [];

    const rocketPool = [];
    for (let i = 0; i < MAX_ROCKETS; i++) {
      rocketPool.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, kind: '', pal: null, scale: 1, acc: 0 });
    }
    const rocketsFree = rocketPool.slice();
    const rockets = [];

    const emitters = [];
    const queue = [];

    let W = 0;
    let H = 0;
    let showing = false;
    let showTime = 0;
    let nextLaunch = 0;
    let cleared = true;

    const spawn = (x, y, vx, vy, life, size, c, drag, grav, flicker, swell, alpha) => {
      const p = free.pop();
      if (!p) return null;
      p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.life = life; p.max = life; p.size = size; p.c = c;
      p.drag = drag; p.grav = grav;
      p.flicker = !!flicker; p.swell = !!swell;
      p.alpha = alpha === undefined ? 1 : alpha;
      live.push(p);
      return p;
    };

    const kill = (index) => {
      const p = live[index];
      const lastIndex = live.length - 1;
      live[index] = live[lastIndex];
      live.pop();
      free.push(p);
    };

    const quality = () => (env.compact ? 0.62 : 1);
    const baseRadius = () => Math.max(70, Math.min(W, H) * rand(0.15, 0.23));

    /* ---- burst shapes ---- */
    const burst = (x, y, kind, pal, scale) => {
      const q = quality() * (env.reduced ? 0.5 : 1);
      const radius = baseRadius() * scale * (env.reduced ? 0.7 : 1);
      // distance travelled with drag d per frame at 60fps ≈ v0 / (60 * (1 - d))
      const v0 = radius * 60 * (1 - DRAG[0]);
      const primary = pal[0];
      const secondary = pal[1];
      const lifeScale = env.reduced ? 1.5 : 1;

      // soft bloom at the centre (gentle, never a full-screen flash; bigger shells glow less)
      const bloomAlpha = (env.reduced ? 0.22 : 0.42) / Math.max(1, scale);
      spawn(x, y, 0, 0, 0.32, Math.min(radius * 0.9, 240), secondary, 2, 0, false, false, bloomAlpha);

      if (kind === 'ring' || kind === 'double') {
        const n = Math.round((kind === 'ring' ? 70 : 54) * q * scale);
        const tilt = rand(0.45, 1);
        const rot = Math.random() * TAU;
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        const speed = kind === 'ring' ? v0 : v0 * 0.55;
        const color = kind === 'ring' ? primary : secondary;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + rand(-0.03, 0.03);
          const ex = Math.cos(a) * speed * rand(0.97, 1.03);
          const ey = Math.sin(a) * speed * tilt * rand(0.97, 1.03);
          spawn(x, y, ex * cr - ey * sr, ex * sr + ey * cr, rand(1.1, 1.5) * lifeScale, rand(7, 10), color, 0, 90, false);
        }
      }

      if (kind === 'rings') {
        // two concentric, equally tilted rings: a double-ring shell
        const tilt = rand(0.5, 0.95);
        const rot = Math.random() * TAU;
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        const layers = [[v0, primary, 68], [v0 * 0.58, secondary, 46]];
        for (const [speed, color, count] of layers) {
          const n = Math.round(count * q * scale);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU;
            const ex = Math.cos(a) * speed * rand(0.98, 1.02);
            const ey = Math.sin(a) * speed * tilt * rand(0.98, 1.02);
            spawn(x, y, ex * cr - ey * sr, ex * sr + ey * cr, rand(1.3, 1.7) * lifeScale, rand(7, 10), color, 0, 80, false);
          }
        }
      }

      if (kind === 'heart') {
        // parametric heart: x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t
        const n = Math.round(84 * q * scale);
        const rot = rand(-0.22, 0.22);
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        const shells = [[1, primary, n], [0.55, secondary, Math.round(n * 0.45)]];
        for (const [k, color, count] of shells) {
          for (let i = 0; i < count; i++) {
            const t = (i / count) * TAU;
            const hx = (16 * Math.pow(Math.sin(t), 3)) / 17;
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
            const sp = v0 * 0.95 * k * rand(0.97, 1.03);
            const vx = (hx * cr - hy * sr) * sp;
            const vy = (hx * sr + hy * cr) * sp;
            spawn(x, y, vx, vy, rand(1.5, 1.9) * lifeScale, rand(7, 10), color, 0, 34, false);
          }
        }
      }

      if (kind === 'starburst') {
        // straight rays of light that streak outward
        const rays = env.compact ? 12 : 16;
        const steps = 7;
        const offset = Math.random() * TAU;
        for (let r = 0; r < rays; r++) {
          const a = offset + (r / rays) * TAU + rand(-0.04, 0.04);
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          for (let j = 0; j < steps; j++) {
            const sp = v0 * (0.28 + (0.72 * j) / (steps - 1)) * rand(0.96, 1.04);
            const color = j >= steps - 2 ? WHITE : (j % 3 === 0 ? secondary : primary);
            spawn(x, y, ca * sp, sa * sp, rand(1, 1.35) * lifeScale, rand(6, 9), color, 0, 70, false);
          }
        }
      }

      if (kind === 'peony' || kind === 'double' || kind === 'grand' || kind === 'crackle') {
        const n = Math.round((kind === 'grand' ? 150 : kind === 'double' ? 80 : 96) * q * scale);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          // projected sphere: denser at the rim, like a real shell
          const u = rand(-1, 1);
          const sf = Math.sqrt(1 - u * u) * rand(0.9, 1.04);
          const sp = v0 * sf;
          const c = Math.random() < 0.78 ? primary : secondary;
          spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(1.1, 1.7) * lifeScale, rand(7, 11), c, 0, 95, Math.random() < 0.12);
        }
      }

      if (kind === 'willow') {
        // long, slowly cascading golden sparks
        const n = Math.round(90 * q * scale);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const sp = v0 * 0.62 * rand(0.55, 1);
          const c = Math.random() < 0.7 ? GOLD : CHAMPAGNE;
          spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp - v0 * 0.08, rand(2.4, 3.3) * lifeScale, rand(6, 9), c, 1, 42, Math.random() < 0.45);
        }
      }

      if (kind === 'grand') {
        // a halo of glittering gold
        const n = Math.round(70 * q);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const sp = v0 * rand(0.25, 0.7);
          spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(1.6, 2.6) * lifeScale, rand(5, 8), Math.random() < 0.6 ? GOLD : WHITE, 1, 55, true);
        }
      }

      if ((kind === 'crackle' || kind === 'grand') && !env.reduced) {
        queue.push({ at: 0.42, kind: 'glitter', x, y, pal, scale });
      }
    };

    const glitter = (x, y, scale) => {
      const n = Math.round(46 * quality() * scale);
      const spread = baseRadius() * 0.9 * scale;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const d = Math.sqrt(Math.random()) * spread;
        spawn(x + Math.cos(a) * d, y + Math.sin(a) * d, rand(-12, 12), rand(-6, 18), rand(0.35, 0.8), rand(5, 8), Math.random() < 0.7 ? CHAMPAGNE : WHITE, 0, 40, true);
      }
    };

    /* ---- rockets ---- */
    const launch = (tx, ty, kind, pal, scale) => {
      const r = rocketsFree.pop();
      if (!r) return false;
      const x0 = clamp(tx + rand(-0.05, 0.05) * W, 16, W - 16);
      const y0 = H + 8;
      const g = 380;
      const dy = Math.max(80, y0 - ty);
      const vy = -Math.sqrt(2 * g * dy);
      const t = -vy / g;
      r.x = x0; r.y = y0;
      r.vx = (tx - x0) / t;
      r.vy = vy;
      r.g = g;
      r.kind = kind;
      r.pal = pal;
      r.scale = scale;
      r.acc = 0;
      rockets.push(r);
      return true;
    };

    const fire = (tx, ty, kind, pal, scale) => {
      if (env.reduced) burst(tx, ty, kind === 'willow' || kind === 'starburst' ? 'peony' : kind, pal, scale);
      else launch(tx, ty, kind, pal, scale);
    };

    /* ---- fountains ---- */
    const GIFT_COLORS = [GOLD, GOLD, CHAMPAGNE, VIOLET, PINK, WHITE, LAVENDER];
    const ROSE_COLORS = [PINK, PINK, BLUSH, VIOLET, PURPLE, LAVENDER, WHITE];

    const addFountain = (x, y, opts) => {
      emitters.push({
        kind: 'fountain', x, y, t: 0, acc: 0,
        dur: opts.dur, rate: opts.rate, radius: opts.jitter || 0,
        angle: opts.angle, spread: opts.spread, sMin: opts.sMin, sMax: opts.sMax,
        colors: opts.colors, grav: opts.grav, drag: opts.drag || 0,
      });
    };

    // a pair of pink and purple fountains rising from the bottom corners
    const groundFountains = () => {
      if (env.reduced) return;
      const rate = env.compact ? 60 : 105;
      const base = { dur: 2.4, rate, spread: 0.13, sMin: H * 0.5, sMax: H * 0.78, colors: ROSE_COLORS, grav: 230, drag: 1, jitter: 6 };
      addFountain(W * 0.04, H + 2, { ...base, angle: -Math.PI / 2 + 0.2 });
      addFountain(W * 0.96, H + 2, { ...base, angle: -Math.PI / 2 - 0.2 });
    };

    /* ---- the show: a director that keeps the centre clear ---- */
    const P = {
      gold: [GOLD, CHAMPAGNE], rose: [PINK, BLUSH], royal: [PURPLE, VIOLET], lavender: [LAVENDER, WHITE],
      violetGold: [VIOLET, GOLD], roseGold: [PINK, CHAMPAGNE], heart: [PINK, BLUSH], heartViolet: [VIOLET, PINK],
    };
    const SMALL = [P.rose, P.royal, P.lavender, P.gold, P.violetGold];

    // normalised positions; the middle column is reserved for the name and the letter
    const zone = (name) => {
      const c = env.compact;
      const cornerX = c ? rand(0.14, 0.26) : rand(0.07, 0.2);
      const sideX = c ? rand(0.08, 0.18) : rand(0.04, 0.15);
      switch (name) {
        case 'cornerL': return [cornerX, rand(0.08, 0.22)];
        case 'cornerR': return [1 - cornerX, rand(0.08, 0.22)];
        case 'sideL': return [sideX, rand(0.3, 0.68)];
        case 'sideR': return [1 - sideX, rand(0.3, 0.68)];
        default: return [rand(0.42, 0.58), rand(0.04, 0.1)]; // high above everything
      }
    };
    const either = (a, b) => (Math.random() < 0.5 ? a : b);
    const plan = (at, pos, kind, pal, scale) => {
      queue.push({ at, kind: 'launch', x: W * pos[0], y: H * pos[1], burst: kind, pal, scale: scale * (env.compact ? 0.82 : 1) });
    };

    const MOMENTS = {
      corners() {
        const big = [['peony', P.gold], ['rings', P.rose], ['peony', P.royal], ['double', P.violetGold], ['crackle', P.gold]];
        const a = pick(big);
        const b = pick(big);
        plan(0, zone('cornerL'), a[0], a[1], rand(1.2, 1.45));
        plan(rand(0.25, 0.5), zone('cornerR'), b[0], b[1], rand(1.2, 1.45));
        return rand(1.9, 2.5);
      },
      sides() {
        const s = either('sideL', 'sideR');
        for (let i = 0; i < 3; i++) {
          plan(i * rand(0.22, 0.34), zone(s), pick(['peony', 'ring', 'starburst', 'double']), pick(SMALL), rand(0.48, 0.66));
        }
        return rand(1.3, 1.8);
      },
      heart() {
        plan(0, zone(either('cornerL', 'cornerR')), 'heart', either(P.heart, P.heartViolet), rand(1.05, 1.25));
        plan(0.7, zone(either('sideL', 'sideR')), 'peony', P.rose, 0.55);
        return rand(2.2, 2.7);
      },
      fountains() {
        groundFountains();
        plan(0.5, zone('sideL'), 'starburst', P.lavender, 0.6);
        plan(0.8, zone('sideR'), 'starburst', P.lavender, 0.6);
        return rand(2.6, 3.1);
      },
      cascade() {
        plan(0, zone(either('cornerL', 'cornerR')), 'willow', P.gold, rand(1.15, 1.35));
        plan(0.45, zone(either('sideL', 'sideR')), 'ring', P.royal, 0.6);
        return rand(2.1, 2.6);
      },
      starburst() {
        const first = either('cornerL', 'cornerR');
        plan(0, zone(first), 'starburst', P.lavender, rand(1.1, 1.3));
        plan(0.4, zone(first === 'cornerL' ? 'sideR' : 'sideL'), 'starburst', P.lavender, 0.6);
        return rand(1.7, 2.2);
      },
      glitter() {
        plan(0, zone(either('cornerL', 'cornerR')), 'crackle', P.gold, rand(1, 1.2));
        plan(0.35, zone(either('sideL', 'sideR')), 'double', P.roseGold, 0.6);
        return rand(1.8, 2.2);
      },
      grand() {
        // the occasional spectacular moment, high behind the composition
        plan(0, zone('top'), 'grand', P.gold, 1.3);
        plan(0.35, zone('cornerL'), 'rings', P.rose, 1.15);
        plan(0.55, zone('cornerR'), 'peony', P.royal, 1.15);
        plan(0.95, zone('sideL'), 'heart', P.heart, 0.62);
        plan(1.1, zone('sideR'), 'starburst', P.lavender, 0.62);
        return 3.4;
      },
    };
    const MOMENT_WEIGHTS = [['corners', 4], ['sides', 3], ['heart', 2], ['glitter', 2], ['starburst', 2], ['cascade', 2], ['fountains', 1]];
    let lastMoment = '';
    let moments = 0;

    const chooseMoment = () => {
      let total = 0;
      for (const [name, w] of MOMENT_WEIGHTS) if (name !== lastMoment) total += w;
      let roll = Math.random() * total;
      for (const [name, w] of MOMENT_WEIGHTS) {
        if (name === lastMoment) continue;
        roll -= w;
        if (roll <= 0) return name;
      }
      return 'corners';
    };

    const directShow = () => {
      moments++;
      if (env.reduced) {
        // calm mode: one gentle burst at a time, no rockets or fountains
        const pos = zone(pick(['cornerL', 'cornerR', 'sideL', 'sideR']));
        burst(W * pos[0], H * pos[1], pick(['peony', 'rings', 'heart']), pick([P.gold, P.rose, P.royal, P.lavender]), 0.85);
        return rand(2.6, 3.4);
      }
      const name = moments % 7 === 0 ? 'grand' : chooseMoment();
      lastMoment = name;
      const duration = MOMENTS[name]();
      // dense and overlapping at first, then settling into a steady, unhurried rhythm
      const pace = showTime < 14 ? 0.62 : showTime < 40 ? 0.85 : 1.1;
      return duration * pace * (env.compact ? 1.15 : 1);
    };

    /* ---- emitters (reveal effects and fountains) ---- */
    const emitterTick = (e, dt) => {
      e.t += dt;
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (e.kind === 'gather') {
          const a = Math.random() * TAU;
          const d = e.radius * rand(0.75, 1.25);
          const sx = e.x + Math.cos(a) * d;
          const sy = e.y + Math.sin(a) * d * 0.8;
          const life = rand(0.7, 1.1);
          spawn(sx, sy, ((e.x - sx) / life) * 0.9, ((e.y - sy) / life) * 0.9, life, rand(4, 8), pick([GOLD, LAVENDER, CHAMPAGNE, WHITE, VIOLET]), 2, 0, false, true);
        } else {
          const a = e.angle + rand(-e.spread, e.spread);
          const sp = rand(e.sMin, e.sMax);
          spawn(e.x + rand(-e.radius, e.radius), e.y, Math.cos(a) * sp, Math.sin(a) * sp, rand(1.2, 2), rand(5, 10), pick(e.colors), e.drag, e.grav, Math.random() < 0.3);
        }
      }
      return e.t < e.dur;
    };

    /* ---- simulation + rendering ---- */
    const update = (dt) => {
      const busy = showing || live.length || rockets.length || emitters.length || queue.length;
      if (!busy) {
        if (!cleared) { ctx.clearRect(0, 0, W, H); cleared = true; }
        return;
      }
      cleared = false;

      const frames = dt * 60;
      for (let i = 0; i < DRAG.length; i++) dragNow[i] = Math.pow(DRAG[i], frames);

      // scheduled events
      for (let i = queue.length - 1; i >= 0; i--) {
        const item = queue[i];
        item.at -= dt;
        if (item.at > 0) continue;
        queue.splice(i, 1);
        if (item.kind === 'glitter') glitter(item.x, item.y, item.scale);
        else if (item.kind === 'launch') fire(item.x, item.y, item.burst || 'peony', item.pal, item.scale);
      }

      // the show
      if (showing) {
        showTime += dt;
        nextLaunch -= dt;
        if (nextLaunch <= 0) nextLaunch = directShow();
      }

      for (let i = emitters.length - 1; i >= 0; i--) {
        if (!emitterTick(emitters[i], dt)) emitters.splice(i, 1);
      }

      // rockets climb, leave a trail, then burst near their apex
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.vy += r.g * dt;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.acc += dt;
        while (r.acc > 1 / 75) {
          r.acc -= 1 / 75;
          spawn(r.x + rand(-1.5, 1.5), r.y + rand(0, 4), rand(-14, 14) - r.vx * 0.05, rand(12, 46), rand(0.3, 0.6), rand(4, 6.5), Math.random() < 0.6 ? CHAMPAGNE : WHITE, 0, 30, false, false, 0.75);
        }
        if (r.vy >= -36) {
          burst(r.x, r.y, r.kind, r.pal, r.scale);
          rockets[i] = rockets[rockets.length - 1];
          rockets.pop();
          rocketsFree.push(r);
        }
      }

      // particles
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.life -= dt;
        if (p.life <= 0) { kill(i); continue; }
        const d = dragNow[p.drag];
        p.vx *= d;
        p.vy = p.vy * d + p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      // fade previous frame for soft trails, keeping the canvas transparent
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1 - Math.pow(1 - TRAIL_FADE, frames);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < live.length; i++) {
        const p = live[i];
        const k = p.life / p.max;
        let alpha = p.swell ? Math.sin(k * Math.PI) : k * k * (3 - 2 * k);
        alpha *= p.alpha;
        if (p.flicker && Math.random() < 0.32) alpha *= 0.25;
        if (alpha < 0.02) continue;
        const s = p.size * (0.45 + 0.55 * k);
        ctx.globalAlpha = alpha > 1 ? 1 : alpha;
        ctx.drawImage(sprites[p.c], p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < rockets.length; i++) {
        const r = rockets[i];
        ctx.drawImage(sprites[CHAMPAGNE], r.x - 5, r.y - 5, 10, 10);
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    const resize = () => {
      const size = fitCanvas(canvas, ctx, env.compact ? 1.5 : 1.75, 2.4e6);
      W = size.w;
      H = size.h;
      cleared = false;
    };

    return {
      update,
      resize,
      gather(x, y, radius, duration) {
        if (env.reduced) return;
        emitters.push({ kind: 'gather', x, y, radius, t: 0, dur: duration, rate: env.compact ? 70 : 120, acc: 0 });
      },
      fountain(x, y, width, duration) {
        if (env.reduced) return;
        const reach = clamp(H, 400, 1000);
        addFountain(x, y, {
          dur: duration, rate: env.compact ? 120 : 210, jitter: width,
          angle: -Math.PI / 2, spread: 0.55, sMin: reach * 0.3, sMax: reach * 0.78,
          colors: GIFT_COLORS, grav: 260, drag: 0,
        });
      },
      startShow() {
        if (showing) return;
        showing = true;
        showTime = 0;
        moments = 0;
        if (env.reduced) { nextLaunch = 0.4; return; }
        // opening salvo: both upper corners, then the sides
        plan(0.05, zone('cornerL'), 'peony', P.gold, 1.35);
        plan(0.35, zone('cornerR'), 'rings', P.rose, 1.3);
        plan(0.85, zone('sideL'), 'starburst', P.lavender, 0.62);
        plan(1.05, zone('sideR'), 'heart', P.heart, 0.7);
        nextLaunch = 2.4;
      },
      launchTo(x, y) {
        if (!showing) return;
        fire(x, Math.min(y, H * 0.72), pick(['peony', 'rings', 'heart', 'starburst', 'double']), pick([P.gold, P.rose, P.royal, P.lavender, P.violetGold]), rand(0.7, 0.95));
      },
    };
  };

  /* =======================================================================
     Confetti shower and floating hearts (one canvas, driven by the shared loop)
     ======================================================================= */
  const makeHeartSprite = (hex, size) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    if (!g) return canvas;
    const [r, gr, b] = hexToRgb(hex);
    const s = size / 64;
    g.translate(size / 2, size / 2 + 2 * s);
    g.scale(s, s);
    g.beginPath();
    g.moveTo(0, 13);
    g.bezierCurveTo(-3, 10, -17, 1, -17, -8);
    g.bezierCurveTo(-17, -16, -8, -19, 0, -11);
    g.bezierCurveTo(8, -19, 17, -16, 17, -8);
    g.bezierCurveTo(17, 1, 3, 10, 0, 13);
    g.closePath();
    const fill = g.createRadialGradient(-6, -8, 1, 0, 0, 20);
    fill.addColorStop(0, 'rgba(255,255,255,.95)');
    fill.addColorStop(0.35, `rgba(${r},${gr},${b},1)`);
    fill.addColorStop(1, `rgba(${Math.round(r * 0.6)},${Math.round(gr * 0.6)},${Math.round(b * 0.6)},1)`);
    g.shadowColor = `rgba(${r},${gr},${b},.9)`;
    g.shadowBlur = 14 * s;
    g.fillStyle = fill;
    g.fill();
    return canvas;
  };

  const createConfetti = (canvas) => {
    const ctx = get2d(canvas);
    if (!ctx) return { update() {}, resize() {}, start() {} };

    const PAPER = ['#F4D06F', '#E6B44A', '#F472B6', '#F9A8D4', '#A855F7', '#8B5CF6', '#C4B5FD', '#FFF1C4'];
    // five shading steps per colour, from turned away to catching the light
    const SHADE = [0.42, 0.6, 0.78, 0.92, 1.1];
    const shades = PAPER.map((hex) => {
      const [r, g, b] = hexToRgb(hex);
      return SHADE.map((f) => `rgb(${clamp(Math.round(r * f), 0, 255)},${clamp(Math.round(g * f), 0, 255)},${clamp(Math.round(b * f), 0, 255)})`);
    });
    const sparkSprites = ['#FFF1C4', '#F8F7FF', '#F9A8D4'].map((c) => makeGlowSprite(c, 32));
    const heartSprites = ['#F472B6', '#A855F7', '#F9A8D4'].map((c) => makeHeartSprite(c, 64));

    const PAPER_KIND = 0, RIBBON = 1, METAL = 2, SPARK = 3;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let active = false;
    let cleared = true;
    const pieces = [];
    const hearts = [];
    let heartTimer = 1.2;

    const resetPiece = (p, initial) => {
      const roll = Math.random();
      p.kind = roll < 0.6 ? PAPER_KIND : roll < 0.76 ? RIBBON : roll < 0.92 ? METAL : SPARK;
      p.x = Math.random() * W;
      p.y = initial ? -rand(10, H * 1.2) : -rand(10, 80);
      p.vy = p.kind === RIBBON ? rand(30, 55) : p.kind === METAL ? rand(55, 95) : rand(40, 80);
      p.sway = rand(10, 34);
      p.swayF = rand(0.5, 1.4);
      p.ph = Math.random() * TAU;
      p.rot = Math.random() * TAU;
      p.vr = rand(-3, 3);
      p.flip = Math.random() * TAU;
      p.vf = rand(3, 8);
      if (p.kind === PAPER_KIND) { p.w = rand(6, 11); p.h = rand(3.5, 6); p.c = (Math.random() * PAPER.length) | 0; }
      else if (p.kind === RIBBON) { p.w = rand(11, 17); p.h = rand(1.6, 2.4); p.c = pick([2, 4, 5, 6]); }
      else if (p.kind === METAL) { p.w = p.h = rand(2, 3.4); p.c = pick([0, 0, 1, 7]); }
      else { p.w = rand(5, 9); p.c = (Math.random() * sparkSprites.length) | 0; }
      return p;
    };

    const spawnHeart = () => {
      const edge = Math.random() < 0.7;
      const left = Math.random() < 0.5;
      const x = edge ? (left ? rand(0.03, 0.26) : rand(0.74, 0.97)) * W : rand(0.05, 0.95) * W;
      hearts.push({
        x0: x, x, y: H + 30,
        vy: -rand(18, 36),
        size: env.compact ? rand(12, 22) : rand(14, 28),
        amp: rand(10, 24),
        freq: rand(0.3, 0.6),
        ph: Math.random() * TAU,
        age: 0,
        peak: rand(0.45, 0.8),
        c: (Math.random() * heartSprites.length) | 0,
      });
    };

    const update = (dt, now) => {
      if (!active) {
        if (!cleared) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); cleared = true; }
        return;
      }
      cleared = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const wind = Math.sin(now / 1000 * 0.23) * 14;

      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        p.ph += dt * p.swayF;
        p.y += p.vy * dt;
        p.x += (Math.sin(p.ph * TAU) * p.sway + wind) * dt;
        p.rot += p.vr * dt;
        p.flip += p.vf * dt;
        if (p.y > H + 20) resetPiece(p, false);
        if (p.x < -20) p.x += W + 40;
        else if (p.x > W + 20) p.x -= W + 40;
        if (p.y < -20) continue;

        if (p.kind === SPARK) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(p.ph * 3));
          ctx.drawImage(sparkSprites[p.c], p.x - p.w / 2, p.y - p.w / 2, p.w, p.w);
          continue;
        }

        const cr = Math.cos(p.rot);
        const sr = Math.sin(p.rot);
        const sy = Math.cos(p.flip); // tumbling: the piece turns edge-on and back
        const light = Math.abs(sy);
        ctx.globalAlpha = 0.92;
        ctx.setTransform(dpr * cr, dpr * sr, -dpr * sr * sy, dpr * cr * sy, dpr * p.x, dpr * p.y);

        if (p.kind === RIBBON) {
          ctx.strokeStyle = shades[p.c][Math.min(4, (light * 5) | 0)];
          ctx.lineWidth = p.h;
          ctx.beginPath();
          ctx.moveTo(-p.w / 2, 0);
          ctx.quadraticCurveTo(0, Math.sin(p.ph * 9) * 5, p.w / 2, 0);
          ctx.stroke();
        } else {
          // metallic pieces flash brighter as they catch the light
          const level = p.kind === METAL && light > 0.9 ? 4 : Math.min(4, (light * 4.6) | 0);
          ctx.fillStyle = shades[p.c][level];
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
      }

      // hearts: occasional, slow, glowing
      heartTimer -= dt;
      const maxHearts = env.compact ? 5 : 9;
      if (heartTimer <= 0) {
        if (hearts.length < maxHearts) spawnHeart();
        heartTimer = rand(1.3, 2.8);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = hearts.length - 1; i >= 0; i--) {
        const h = hearts[i];
        h.age += dt;
        h.ph += dt * h.freq * TAU;
        h.y += h.vy * dt;
        h.x = h.x0 + Math.sin(h.ph) * h.amp;
        if (h.y < -40) { hearts.splice(i, 1); continue; }
        // fade in, then fade away as it nears the top of the screen
        const alpha = Math.min(1, h.age / 1.6) * clamp(h.y / (H * 0.4), 0, 1) * h.peak;
        if (alpha < 0.01) continue;
        const s = h.size * (1 + 0.06 * Math.sin(h.age * 3));
        ctx.globalAlpha = alpha;
        ctx.drawImage(heartSprites[h.c], h.x - s, h.y - s, s * 2, s * 2);
      }

      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const resize = () => {
      const prevW = W;
      const prevH = H;
      const size = fitCanvas(canvas, ctx, 1.5, 2.2e6);
      W = size.w;
      H = size.h;
      dpr = canvas.width / W;
      if (prevW && (prevW !== W || prevH !== H)) {
        for (const p of pieces) p.x = (p.x / prevW) * W;
      }
      cleared = false;
    };

    return {
      update,
      resize,
      start() {
        if (active || env.reduced) return;
        active = true;
        const count = env.compact ? 60 : 120;
        for (let i = 0; i < count; i++) pieces.push(resetPiece({}, true));
      },
    };
  };

  /* =======================================================================
     Balloons — DOM + SVG, animated by the compositor along the screen edges
     ======================================================================= */
  const createBalloons = (layer) => {
    if (!layer) return { start() {} };
    const COLORS = ['gold', 'pink', 'lavender', 'purple', 'pearl'];

    const markup = (color) => (
      '<svg viewBox="0 0 100 172" focusable="false">'
      + `<path d="M50 4C24 4 7 26 7 52c0 28 23 52 40 58h6c17-6 40-30 40-58C93 26 76 4 50 4Z" fill="url(#g-bal-${color})"/>`
      + `<path d="M45 117l5-7 5 7q-5 3-10 0Z" fill="url(#g-bal-${color})"/>`
      + '<path d="M50 118c-7 13 7 25-1 37s3 11 1 17" fill="none" stroke="rgba(248,247,255,.38)" stroke-width=".8"/>'
      + '<ellipse cx="33" cy="31" rx="10" ry="18" transform="rotate(-28 33 31)" fill="url(#g-bal-shine)" opacity=".8"/>'
      + '<ellipse cx="41" cy="16" rx="3.2" ry="2.2" transform="rotate(-20 41 16)" fill="#fff" opacity=".6"/>'
      + '<path d="M80 36c7 12 7 30-2 44" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2.4" stroke-linecap="round"/>'
      + '</svg>'
    );

    let started = false;
    return {
      start() {
        if (started) return;
        started = true;
        const compact = env.compact;
        const count = env.reduced ? 4 : compact ? 6 : 11;
        const minW = compact ? 34 : 52;
        const rangeW = compact ? 20 : 44;
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
          const left = i % 2 === 0;
          const edge = compact ? rand(3, 12) : rand(3, 17);
          const w = minW + Math.random() * rangeW;
          const near = (w - minW) / rangeW; // bigger balloons feel closer: faster and brighter
          const balloon = document.createElement('div');
          balloon.className = 'balloon';
          balloon.style.cssText = [
            `--x:${(left ? edge : 100 - edge).toFixed(1)}%`,
            `--w:${Math.round(w)}px`,
            `--dur:${((compact ? 20 : 27) - near * 8 + rand(-2, 2)).toFixed(1)}s`,
            `--delay:${(i * rand(1.3, 2.1) + rand(0, 0.6)).toFixed(2)}s`,
            `--sway:${rand(4.5, 7.5).toFixed(2)}s`,
            `--amp:${Math.round(rand(8, 20))}px`,
            `--tilt:${rand(3, 7).toFixed(1)}deg`,
            `--o:${(0.72 + near * 0.28).toFixed(2)}`,
            `--rest:${Math.round(rand(-6, 26))}%`,
          ].join(';');
          balloon.innerHTML = `<div class="balloon-sway">${markup(COLORS[i % COLORS.length])}</div>`;
          fragment.appendChild(balloon);
        }
        layer.appendChild(fragment);
        requestAnimationFrame(() => layer.classList.add('is-active'));
      },
    };
  };

  /* =======================================================================
     Gift tilt — follows the mouse gently on desktop
     ======================================================================= */
  const createTilt = (element, isActive) => {
    if (!element) return { update() {}, dispose() {} };
    let rx = 0;
    let ry = 0;
    let lastRx = NaN;
    let lastRy = NaN;

    const update = (dt) => {
      const on = env.finePointer && !env.reduced && isActive();
      const targetX = on ? (0.5 - pointer.y) * 9 : 0;
      const targetY = on ? (pointer.x - 0.5) * 14 : 0;
      const k = ease(dt, 3.2);
      rx += (targetX - rx) * k;
      ry += (targetY - ry) * k;
      if (Math.abs(rx - lastRx) < 0.01 && Math.abs(ry - lastRy) < 0.01) return;
      lastRx = rx;
      lastRy = ry;
      element.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    };

    return {
      update,
      dispose() {
        Loop.remove(update);
        element.style.transform = '';
      },
    };
  };

  /* =======================================================================
     Music
     ======================================================================= */
  const createMusic = (audio, button, label) => {
    const stub = { autoStart() {} };
    if (!audio || !button || typeof audio.play !== 'function') return stub;

    const TARGET_VOLUME = 0.85;
    let unavailable = false;
    let blocked = false;
    let userPaused = false;
    let fadeTask = null;

    const setVolume = (value) => { try { audio.volume = value; } catch (error) { /* read-only on some devices */ } };

    const render = () => {
      const playing = !unavailable && !audio.paused;
      button.classList.toggle('is-playing', playing);
      button.classList.toggle('is-blocked', blocked && !playing && !unavailable);
      button.classList.toggle('is-unavailable', unavailable);
      button.setAttribute('aria-pressed', playing ? 'true' : 'false');
      button.setAttribute('aria-disabled', unavailable ? 'true' : 'false');

      let text = 'Music off';
      let description = 'Play music';
      if (unavailable) { text = 'Music unavailable'; description = 'Music unavailable — the audio file could not be loaded'; }
      else if (playing) { text = 'Music on'; description = 'Pause music'; }
      else if (blocked) { text = 'Tap to play music'; description = 'Play music'; }
      if (label) label.textContent = text;
      button.setAttribute('aria-label', description);
      button.title = description;
    };

    const FADE_MS = 2200;

    const stopFade = () => {
      if (fadeTask) { window.clearInterval(fadeTask); fadeTask = null; }
    };

    // Time-based (not frame-based) so the fade still completes in a background tab.
    const fadeIn = () => {
      stopFade();
      const start = performance.now();
      fadeTask = window.setInterval(() => {
        const progress = Math.min(1, (performance.now() - start) / FADE_MS);
        if (audio.paused || progress >= 1) {
          setVolume(TARGET_VOLUME);
          stopFade();
          return;
        }
        setVolume(TARGET_VOLUME * progress * progress);
      }, 50);
    };

    const onFailure = (error) => {
      stopFade();
      setVolume(TARGET_VOLUME);
      const name = error && error.name;
      if (name === 'NotSupportedError' || audio.error) unavailable = true;
      else if (name !== 'AbortError') blocked = true; // usually NotAllowedError: needs a direct tap
      render();
    };

    const play = () => {
      if (unavailable) return;
      setVolume(0);
      let result;
      try {
        result = audio.play();
      } catch (error) {
        onFailure(error);
        return;
      }
      if (result && typeof result.then === 'function') {
        result.then(() => { blocked = false; fadeIn(); render(); }, onFailure);
      } else {
        fadeIn();
      }
    };

    button.addEventListener('click', () => {
      if (unavailable) return;
      if (audio.paused) {
        userPaused = false;
        blocked = false;
        play();
      } else {
        userPaused = true;
        stopFade();
        audio.pause();
      }
      render();
    });

    ['play', 'playing', 'pause', 'ended'].forEach((type) => audio.addEventListener(type, render));
    audio.addEventListener('error', () => {
      unavailable = true;
      warn('the music file could not be loaded — see README.md for where to place it.');
      render();
    });

    // the source may already have failed before this script ran
    if (audio.error) unavailable = true;

    button.hidden = false;
    render();

    return {
      /** Called from the "Open your gift" tap, so the browser sees a user gesture. */
      autoStart() {
        if (userPaused || unavailable || !audio.paused) return;
        play();
      },
    };
  };

  /* =======================================================================
     The experience: intro -> revealing -> celebration
     ======================================================================= */
  const init = () => {
    const intro = $('#intro');
    const celebration = $('#celebration');
    const openButton = $('#open-btn');
    const scene = $('.gift-scene');
    const title = $('#celebration-title');
    if (!intro || !celebration || !openButton || !scene) throw new Error('missing markup');

    const STATE = { INTRO: 'intro', REVEALING: 'revealing', CELEBRATION: 'celebration' };
    let state = STATE.INTRO;
    const setState = (next) => {
      state = next;
      root.setAttribute('data-state', next);
    };

    const sky = createSky($('#sky'));
    const fx = createFireworks($('#fireworks'));
    const confetti = createConfetti($('#confetti'));
    const balloons = createBalloons($('#balloons'));
    const letterCard = $('#letter-card');
    const tilt = createTilt($('#gift-tilt'), () => state === STATE.INTRO);
    const music = createMusic($('#bgm'), $('#music-toggle'), $('#music-label'));

    // ---- one resize path for every canvas ----
    let resizeQueued = false;
    const resize = () => {
      resizeQueued = false;
      safely(sky.resize);
      safely(fx.resize);
      safely(confetti.resize);
    };
    const queueResize = () => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(resize);
    };
    window.addEventListener('resize', queueResize, { passive: true });
    window.addEventListener('orientationchange', queueResize, { passive: true });
    resize();

    window.addEventListener('pointermove', (event) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      pointer.x = event.clientX / Math.max(1, window.innerWidth);
      pointer.y = event.clientY / Math.max(1, window.innerHeight);
    }, { passive: true });

    Loop.add(sky.update);
    Loop.add(fx.update);
    Loop.add(confetti.update);
    Loop.add(tilt.update);
    Loop.start();

    // ---- timeline helpers: every step is isolated so nothing can stall the reveal ----
    const later = (ms, fn) => window.setTimeout(() => safely(fn), ms);

    /** Screen position of the gift (centre and mouth), computed from the scene box. */
    const giftPoint = (lifted) => {
      const rect = scene.getBoundingClientRect();
      const s = rect.width / 1.8;
      const lift = lifted && !env.reduced ? s * 0.16 : 0;
      const cy = rect.top + rect.height * 0.63 - lift;
      return { x: rect.left + rect.width / 2, cy, mouth: cy - s * 0.37, s };
    };

    // ---- progressive reveal: one element at a time, never ahead of the reader ----
    const revealInSequence = (elements, gap, done) => {
      let index = 0;
      let waiting = false;
      let finished = false;
      const reachable = (element) => element.getBoundingClientRect().top < window.innerHeight - 24;

      const pump = () => {
        if (waiting || finished) return;
        const element = elements[index];
        if (!element) {
          finished = true;
          window.removeEventListener('scroll', onScroll);
          if (done) safely(done);
          return;
        }
        if (!reachable(element)) return; // continues as soon as the reader scrolls down
        element.classList.add('is-in');
        index++;
        waiting = true;
        later(gap, () => { waiting = false; pump(); });
      };
      const onScroll = () => { if (!waiting) pump(); };

      window.addEventListener('scroll', onScroll, { passive: true });
      pump();
    };

    // ---- "read your letter" cue, shown only when the letter starts below the fold ----
    const createScrollCue = (button, target) => {
      if (!button || !target) return { maybeShow() {} };
      let shown = false;
      let dismissed = false;
      const onScroll = () => { if (window.scrollY > 60) hide(); };
      const hide = () => {
        if (dismissed) return;
        dismissed = true;
        button.classList.remove('is-visible');
        window.removeEventListener('scroll', onScroll);
        later(900, () => { button.hidden = true; });
      };
      button.addEventListener('click', () => {
        target.scrollIntoView({ behavior: env.reduced ? 'auto' : 'smooth', block: 'start' });
        hide();
      });
      return {
        maybeShow() {
          if (shown || dismissed) return;
          if (target.getBoundingClientRect().bottom <= window.innerHeight + 4 || window.scrollY > 60) return;
          shown = true;
          button.hidden = false;
          void button.offsetWidth; // commit the hidden state so the fade-in transitions
          button.classList.add('is-visible');
          window.addEventListener('scroll', onScroll, { passive: true });
        },
      };
    };
    const scrollCue = createScrollCue($('#scroll-cue'), letterCard);

    const revealCelebration = () => {
      const calm = env.reduced;
      const show = (selector, ms) => {
        const element = celebration.querySelector(selector);
        if (element) later(ms, () => element.classList.add('is-in'));
      };
      // title first, then the letter frame, then the letter itself line by line
      show('.cel-kicker', calm ? 100 : 200);
      show('.cel-happy', calm ? 300 : 550);
      show('.cel-name', calm ? 550 : 1000);
      show('.ornament', calm ? 900 : 2300);
      show('.letter-card', calm ? 1100 : 2700);
      later(calm ? 1500 : 3300, () => {
        const lines = letterCard ? Array.from(letterCard.querySelectorAll('.rv')) : [];
        revealInSequence(lines, calm ? 350 : 750, () => show('.sky-hint', 300));
      });
      later(calm ? 1700 : 3700, () => scrollCue.maybeShow());
    };

    // ---- the three phases ----
    const phaseOpen = () => {
      root.classList.add('phase-open');
      sky.setIntensity(1.8);
      later(280, () => {
        const p = giftPoint(true);
        fx.fountain(p.x, p.mouth, p.s * 0.22, 1.5);
      });
      // the first fireworks light the sky while the gift is still glowing
      later(env.reduced ? 200 : 650, () => fx.startShow());
    };

    const phaseCelebrate = () => {
      root.classList.add('phase-celebrate');
      sky.setIntensity(1.3);
      safely(revealCelebration);
      safely(() => fx.startShow());
      safely(() => confetti.start());
      safely(() => balloons.start());
      if (title) safely(() => title.focus({ preventScroll: true }));
    };

    const phaseSettle = () => {
      root.classList.add('phase-settled');
      intro.setAttribute('aria-hidden', 'true');
      setState(STATE.CELEBRATION);
      tilt.dispose();
    };

    const open = () => {
      if (state !== STATE.INTRO) return; // guards against double taps and repeat clicks
      setState(STATE.REVEALING);
      openButton.disabled = true;
      openButton.setAttribute('aria-disabled', 'true');

      // must run inside the click so the browser treats it as user-initiated playback
      safely(() => music.autoStart());

      root.classList.add('phase-anticipate');
      sky.setIntensity(1.25);

      const calm = env.reduced;
      const timing = calm
        ? { open: 300, celebrate: 1300, settle: 2600 }
        : { open: 1100, celebrate: 2800, settle: 4400 };

      later(120, () => {
        const p = giftPoint(true);
        fx.gather(p.x, p.cy, p.s * 1.25, 0.95);
      });
      later(timing.open, phaseOpen);
      later(timing.celebrate, phaseCelebrate);
      later(timing.settle, phaseSettle);
    };

    openButton.addEventListener('click', open);

    // ---- celebration: tap the sky for more fireworks ----
    let lastTap = 0;
    document.addEventListener('click', (event) => {
      if (!root.classList.contains('phase-celebrate')) return;
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('button, a, input, textarea, select, .letter-card')) return;
      const now = performance.now();
      if (now - lastTap < 280) return;
      lastTap = now;
      fx.launchTo(event.clientX, event.clientY);
    });
  };

  try {
    init();
  } catch (error) {
    // Fall back to the static letter instead of a blank or stuck page.
    warn(error);
    root.classList.remove('js');
    root.classList.add('no-js');
  }
})();
