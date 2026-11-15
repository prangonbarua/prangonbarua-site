// Koi pond: spine-chain koi, food pellets, ripples, lily pads.
(() => {
  const canvas = document.getElementById('pond');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const pond = canvas.parentElement;
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const TAU = Math.PI * 2;
  const N = 16; // spine nodes
  // half-width of the body at each node, as a fraction of the widest point
  const WIDTH = [0.6, 0.85, 0.97, 1, 0.99, 0.95, 0.88, 0.79, 0.68, 0.58, 0.48, 0.39, 0.31, 0.24, 0.18, 0.14];
  const GIRTH = 0.105; // widest half-width / body length
  const MAX_BEND = 0.13; // radians per spine joint

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };

  const RED = '#d9452b', WHITE = '#f5efe6', SUMI = '#24211f', GOLD = '#e7b04a';
  const VARIETIES = [
    { name: 'kohaku', weight: 4, base: WHITE, fin: 'rgba(250, 246, 240, 0.55)' },
    { name: 'sanke', weight: 2, base: WHITE, fin: 'rgba(250, 246, 240, 0.55)' },
    { name: 'tancho', weight: 1, base: WHITE, fin: 'rgba(250, 246, 240, 0.55)' },
    { name: 'showa', weight: 1, base: SUMI, fin: 'rgba(60, 54, 50, 0.55)' },
    { name: 'ogon', weight: 1, base: GOLD, fin: 'rgba(240, 196, 110, 0.55)' },
  ];
  const TOTAL_WEIGHT = VARIETIES.reduce((s, v) => s + v.weight, 0);
  function pickVariety() {
    let r = Math.random() * TOTAL_WEIGHT;
    for (const v of VARIETIES) if ((r -= v.weight) <= 0) return v;
    return VARIETIES[0];
  }

  // patches: { u: 0..1 along body, off: -1..1 across, r: radius in girth units, color }
  function patchesFor(name) {
    const p = [];
    const blob = (u, off, r, color) => {
      p.push({ u, off, r, color });
      p.push({ u: u + rand(-0.05, 0.05), off: off + rand(-0.4, 0.4), r: r * rand(0.6, 0.85), color });
    };
    if (name === 'kohaku' || name === 'sanke') {
      const n = Math.random() < 0.5 ? 2 : 3;
      for (let i = 0; i < n; i++) blob(0.1 + i * (0.6 / n) + rand(0, 0.1), rand(-0.4, 0.4), rand(0.75, 1.15), RED);
    }
    if (name === 'sanke') {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) p.push({ u: rand(0.2, 0.8), off: rand(-0.8, 0.8), r: rand(0.22, 0.38), color: SUMI });
    }
    if (name === 'tancho') p.push({ u: 0.075, off: 0, r: 0.52, color: RED });
    if (name === 'showa') {
      for (let i = 0; i < 2; i++) blob(rand(0.08, 0.6), rand(-0.5, 0.5), rand(0.7, 1), RED);
      for (let i = 0; i < 2; i++) blob(rand(0.15, 0.75), rand(-0.6, 0.6), rand(0.45, 0.7), WHITE);
    }
    if (name === 'ogon') p.push({ u: 0.4, off: 0, r: 0.5, color: 'rgba(255, 236, 180, 0.45)', stripe: true });
    return p;
  }

  let W = 0, H = 0, dpr = 1;
  let koi = [], pellets = [], ripples = [], pads = [], avoid = [];
  let time = 0, nextAmbient = 2;
  const pointer = { x: -1e4, y: -1e4, speed: 0, t: 0, lastWake: 0 };
  let colors = {};

  function readColors() {
    const cs = getComputedStyle(root);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = { ripple: v('--ripple'), shadow: v('--shadow'), pad: v('--pad'), vein: v('--pad-vein') };
  }

  function readAvoid() {
    const pr = pond.getBoundingClientRect();
    avoid = [...pond.querySelectorAll('[data-avoid]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - pr.left, t: r.top - pr.top, r: r.right - pr.left, b: r.bottom - pr.top };
    });
  }

  function insideAvoid(x, y, pad) {
    return avoid.some((a) => x > a.l - pad && x < a.r + pad && y > a.t - pad && y < a.b + pad);
  }

  function makeKoi(len) {
    let x, y, tries = 0;
    do {
      x = rand(0.12, 0.88) * W;
      y = rand(0.15, 0.85) * H;
    } while (insideAvoid(x, y, len) && ++tries < 30);
    const heading = rand(0, TAU);
    const seg = len / (N - 1);
    const nodes = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      nodes[i * 2] = x - Math.cos(heading) * seg * i;
      nodes[i * 2 + 1] = y - Math.sin(heading) * seg * i;
    }
    const variety = pickVariety();
    return {
      nodes, seg, len, heading, variety,
      patches: patchesFor(variety.name),
      cruise: len * rand(0.26, 0.4),
      speed: len * 0.3,
      phase: rand(0, TAU),
      wander: 0,
      rush: 0,
      hunger: rand(0.5, 1),
      depth: Math.random(),
    };
  }

  function seed() {
    const base = clamp(Math.min(W, H) * 0.16, 64, 150);
    const count = clamp(Math.round((W * H) / 110000), 5, 10);
    koi = [];
    for (let i = 0; i < count; i++) koi.push(makeKoi(base * rand(0.72, 1.15)));
    koi.sort((a, b) => b.depth - a.depth);
  }

  function placePads() {
    const s = clamp(Math.min(W, H) / 900, 0.55, 1.2);
    const spots = W < 720
      ? [[0.14, 0.2, 30], [0.8, 0.5, 38], [0.62, 0.62, 22]]
      : [[0.1, 0.22, 34], [0.17, 0.3, 22], [0.58, 0.16, 28], [0.86, 0.72, 46], [0.78, 0.8, 26]];
    pads = spots.map(([fx, fy, r], i) => ({
      x: fx * W, y: fy * H, r: r * s,
      rot: (i * 2.39) % TAU,
      bob: rand(0, TAU),
    }));
  }

  function resize() {
    const first = W === 0;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    readAvoid();
    placePads();
    if (first) seed();
    else {
      for (const k of koi) {
        const dx = clamp(k.nodes[0], 20, W - 20) - k.nodes[0];
        const dy = clamp(k.nodes[1], 20, H - 20) - k.nodes[1];
        for (let i = 0; i < N; i++) { k.nodes[i * 2] += dx; k.nodes[i * 2 + 1] += dy; }
      }
    }
  }

  // ---- simulation ----

  function stepKoi(k, dt) {
    const n = k.nodes;
    const hx = n[0], hy = n[1];
    const ch = Math.cos(k.heading), sh = Math.sin(k.heading);
    let vx = ch, vy = sh;

    // wander
    k.wander = clamp(k.wander + (Math.random() - 0.5) * dt * 3, -1, 1);
    vx += -sh * k.wander * 0.55;
    vy += ch * k.wander * 0.55;

    // stay in the pond
    const m = Math.min(W, H) * 0.1 + k.len * 0.9;
    if (hx < m) vx += ((m - hx) / m) * 2.5;
    if (hx > W - m) vx -= ((hx - (W - m)) / m) * 2.5;
    if (hy < m) vy += ((m - hy) / m) * 2.5;
    if (hy > H - m) vy -= ((hy - (H - m)) / m) * 2.5;

    // swim around the text
    const pad = k.len * 0.35;
    for (const a of avoid) {
      if (hx > a.l - pad && hx < a.r + pad && hy > a.t - pad && hy < a.b + pad) {
        const cx = (a.l + a.r) / 2, cy = (a.t + a.b) / 2;
        const ax = (hx - cx) / ((a.r - a.l) / 2 + pad);
        const ay = (hy - cy) / ((a.b - a.t) / 2 + pad);
        const d = Math.hypot(ax, ay) || 1;
        vx += (ax / d) * 1.4;
        vy += (ay / d) * 1.4;
      }
    }

    // keep a little space between koi
    for (const o of koi) {
      if (o === k) continue;
      const dx = hx - o.nodes[0], dy = hy - o.nodes[1];
      const d = Math.hypot(dx, dy);
      const r = (k.len + o.len) * 0.3;
      if (d > 0 && d < r) { vx += (dx / d) * 0.8 * (1 - d / r); vy += (dy / d) * 0.8 * (1 - d / r); }
    }

    // startle at a fast pointer
    const pdx = hx - pointer.x, pdy = hy - pointer.y;
    const pd = Math.hypot(pdx, pdy);
    if (pointer.speed > 500 && pd < 150 && pd > 0) {
      vx += (pdx / pd) * 4 * (1 - pd / 150);
      vy += (pdy / pd) * 4 * (1 - pd / 150);
      k.rush = 1;
    }

    // food
    if (k.hunger > 0.15) {
      let best = null, bestD = 340;
      for (const p of pellets) {
        if (!p.landed || p.eaten) continue;
        const d = Math.hypot(p.x - hx, p.y - hy);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) {
        const mx = hx + ch * k.len * 0.04, my = hy + sh * k.len * 0.04;
        if (Math.hypot(best.x - mx, best.y - my) < Math.max(8, k.len * 0.11)) {
          best.eaten = true;
          k.hunger = Math.max(0, k.hunger - 0.22);
          ripples.push({ x: best.x, y: best.y, born: time, max: k.len * 0.35, life: 1.1 });
        } else {
          vx += ((best.x - hx) / bestD) * 2.4;
          vy += ((best.y - hy) / bestD) * 2.4;
          k.rush = Math.max(k.rush, 0.55);
        }
      }
    }
    k.hunger = Math.min(1, k.hunger + dt * 0.02);

    const want = Math.atan2(vy, vx);
    // turn radius stays near a body length when cruising, tighter when rushing
    const maxTurn = (0.15 + (1.1 * k.speed) / k.len + k.rush * 1.6) * dt;
    k.heading += clamp(angDiff(k.heading, want), -maxTurn, maxTurn);

    const target = k.cruise * (1 + k.rush * 1.7);
    k.speed += (target - k.speed) * (1 - Math.exp(-dt * 2.2));
    k.rush *= Math.exp(-dt * 0.9);
    k.phase += dt * TAU * (0.7 + (1.5 * k.speed) / k.len);

    n[0] += Math.cos(k.heading) * k.speed * dt;
    n[1] += Math.sin(k.heading) * k.speed * dt;
    // follow the head, but never let one joint bend past MAX_BEND
    let prev = k.heading + Math.PI;
    for (let i = 1; i < N; i++) {
      const dx = n[i * 2] - n[i * 2 - 2], dy = n[i * 2 + 1] - n[i * 2 - 1];
      const a = prev + clamp(angDiff(prev, Math.atan2(dy, dx)), -MAX_BEND, MAX_BEND);
      n[i * 2] = n[i * 2 - 2] + Math.cos(a) * k.seg;
      n[i * 2 + 1] = n[i * 2 - 1] + Math.sin(a) * k.seg;
      prev = a;
    }
  }

  function step(dt) {
    time += dt;
    pointer.speed *= Math.exp(-dt * 6);
    for (const k of koi) stepKoi(k, dt);

    for (const p of pellets) {
      if (!p.landed && time - p.born >= p.delay) {
        p.landed = true;
        ripples.push({ x: p.x, y: p.y, born: time, max: 26, life: 1.4 });
      }
      const f = Math.exp(-dt * 0.6);
      p.vx *= f; p.vy *= f;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    pellets = pellets.filter((p) => !p.eaten && time - p.born < 30);
    ripples = ripples.filter((r) => time - r.born < r.life);

    if (time > nextAmbient) {
      nextAmbient = time + rand(2.5, 6);
      ripples.push({ x: rand(0.05, 0.95) * W, y: rand(0.05, 0.95) * H, born: time, max: rand(18, 40), life: 2.2 });
    }
  }

  function feed(x, y) {
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), s = rand(4, 22);
      pellets.push({
        x: x + Math.cos(a) * s * 0.6, y: y + Math.sin(a) * s * 0.6,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        born: time, delay: i * 0.07, landed: false, eaten: false,
      });
    }
    ripples.push({ x, y, born: time, max: 46, life: 1.8 });
  }

  // ---- drawing ----

  const px = new Float32Array(N), py = new Float32Array(N);
  const nx = new Float32Array(N), ny = new Float32Array(N), hw = new Float32Array(N);

  function frame(k) {
    const n = k.nodes;
    const amp = k.len * 0.045 * (0.6 + 0.5 * Math.min(1.4, k.speed / k.cruise));
    for (let i = 0; i < N; i++) {
      const a = i === 0 ? 0 : i - 1, b = i === 0 ? 1 : i;
      let tx = n[a * 2] - n[b * 2], ty = n[a * 2 + 1] - n[b * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      nx[i] = -ty; ny[i] = tx;
      const u = i / (N - 1);
      const sway = amp * Math.pow(u, 1.6) * Math.sin(k.phase - i * 0.55);
      px[i] = n[i * 2] + nx[i] * sway;
      py[i] = n[i * 2 + 1] + ny[i] * sway;
      hw[i] = WIDTH[i] * k.len * GIRTH;
    }
  }

  function bodyPath(k) {
    const pts = [];
    const tx = px[0] - px[1], ty = py[0] - py[1];
    const tl = Math.hypot(tx, ty) || 1;
    pts.push([px[0] + (tx / tl) * k.len * 0.07, py[0] + (ty / tl) * k.len * 0.07]);
    for (let i = 0; i < N; i++) pts.push([px[i] + nx[i] * hw[i], py[i] + ny[i] * hw[i]]);
    const e = N - 1;
    const bx = px[e] - px[e - 1], by = py[e] - py[e - 1];
    const bl = Math.hypot(bx, by) || 1;
    pts.push([px[e] + (bx / bl) * hw[e] * 0.6, py[e] + (by / bl) * hw[e] * 0.6]);
    for (let i = N - 1; i >= 0; i--) pts.push([px[i] - nx[i] * hw[i], py[i] - ny[i] * hw[i]]);

    const path = new Path2D();
    const L = pts.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = mid(pts[L - 1], pts[0]);
    path.moveTo(s[0], s[1]);
    for (let i = 0; i < L; i++) {
      const c = pts[i], m = mid(c, pts[(i + 1) % L]);
      path.quadraticCurveTo(c[0], c[1], m[0], m[1]);
    }
    path.closePath();
    return path;
  }

  function finPath(k) {
    const path = new Path2D();
    const flap = Math.sin(k.phase * 0.5);
    // pectoral fins at node 3, pelvic at node 7
    for (const [i, size, spread] of [[3, 0.17, 0.95], [7, 0.09, 0.8]]) {
      const tx = ny[i], ty = -nx[i]; // tangent (toward head); normal is this rotated +90deg
      for (const side of [1, -1]) {
        // point backward, swung out toward the side the fin is attached on
        const ang = Math.atan2(-ty, -tx) - side * (spread + 0.18 * flap);
        const L = k.len * size;
        const ax = px[i] + nx[i] * hw[i] * 0.75 * side, ay = py[i] + ny[i] * hw[i] * 0.75 * side;
        path.ellipse(ax + Math.cos(ang) * L * 0.5, ay + Math.sin(ang) * L * 0.5, L * 0.5, L * 0.24, ang, 0, TAU);
      }
    }
    // tail
    const e = N - 1;
    let bx = px[e] - px[e - 1], by = py[e] - py[e - 1];
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    const base = Math.atan2(by, bx) + Math.sin(k.phase - e * 0.55 - 0.6) * 0.32;
    const T = k.len * 0.22;
    const tip = (a, r) => [px[e] + Math.cos(base + a) * r, py[e] + Math.sin(base + a) * r];
    const t1 = tip(0.5, T), t2 = tip(-0.5, T), notch = tip(0, T * 0.55);
    const r1 = [px[e - 2] + nx[e - 2] * hw[e - 2], py[e - 2] + ny[e - 2] * hw[e - 2]];
    const r2 = [px[e - 2] - nx[e - 2] * hw[e - 2], py[e - 2] - ny[e - 2] * hw[e - 2]];
    const c1 = tip(0.28, T * 0.62), c2 = tip(-0.28, T * 0.62);
    path.moveTo(r1[0], r1[1]);
    path.quadraticCurveTo(c1[0], c1[1], t1[0], t1[1]);
    path.quadraticCurveTo(notch[0] + (c1[0] - notch[0]) * 0.3, notch[1] + (c1[1] - notch[1]) * 0.3, notch[0], notch[1]);
    path.quadraticCurveTo(notch[0] + (c2[0] - notch[0]) * 0.3, notch[1] + (c2[1] - notch[1]) * 0.3, t2[0], t2[1]);
    path.quadraticCurveTo(c2[0], c2[1], r2[0], r2[1]);
    path.closePath();
    return path;
  }

  function drawKoi(k) {
    frame(k);
    const body = bodyPath(k);
    const fins = finPath(k);
    const off = 5 + (1 - k.depth) * 9;

    ctx.globalAlpha = 1 - k.depth * 0.42;

    ctx.save();
    ctx.translate(off * 0.7, off);
    ctx.fillStyle = colors.shadow;
    ctx.fill(body);
    ctx.fill(fins);
    ctx.restore();

    ctx.fillStyle = k.variety.fin;
    ctx.fill(fins);

    ctx.fillStyle = k.variety.base;
    ctx.fill(body);

    ctx.save();
    ctx.clip(body);
    for (const p of k.patches) {
      const f = clamp(p.u, 0, 1) * (N - 1);
      const i = Math.min(N - 2, Math.floor(f)), t = f - i;
      const cx = px[i] + (px[i + 1] - px[i]) * t, cy = py[i] + (py[i + 1] - py[i]) * t;
      const w = hw[i] + (hw[i + 1] - hw[i]) * t;
      const ang = Math.atan2(ny[i], nx[i]) - Math.PI / 2;
      const r = p.r * k.len * GIRTH;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      if (p.stripe) ctx.ellipse(cx, cy, k.len * 0.32, r * 0.5, ang, 0, TAU);
      else ctx.ellipse(cx + nx[i] * w * p.off, cy + ny[i] * w * p.off, r * 1.45, r, ang, 0, TAU);
      ctx.fill();
    }
    // soft highlight down the back
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = k.len * 0.035;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px[1], py[1]);
    for (let i = 2; i < 11; i++) ctx.lineTo(px[i], py[i]);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke(body);

    // eyes
    ctx.fillStyle = 'rgba(20, 18, 16, 0.75)';
    const er = Math.max(1, k.len * 0.011);
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.arc(px[0] + nx[0] * hw[0] * 0.62 * side + (px[0] - px[1]) * 0.25,
              py[0] + ny[0] * hw[0] * 0.62 * side + (py[0] - py[1]) * 0.25, er, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function padPath(p, dx, dy) {
    const path = new Path2D();
    const x = p.x + dx + Math.sin(time * 0.3 + p.bob) * 1.5;
    const y = p.y + dy + Math.cos(time * 0.25 + p.bob) * 1.5;
    const rot = p.rot + Math.sin(time * 0.1 + p.bob) * 0.05;
    path.moveTo(x, y);
    path.arc(x, y, p.r, rot + 0.22, rot + TAU - 0.22);
    path.closePath();
    return { path, x, y, rot };
  }

  function drawPads() {
    for (const p of pads) {
      ctx.fillStyle = colors.shadow;
      ctx.fill(padPath(p, 4, 6).path);
      const { path, x, y, rot } = padPath(p, 0, 0);
      ctx.fillStyle = colors.pad;
      ctx.fill(path);
      ctx.strokeStyle = colors.vein;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 8; i++) {
        const a = rot + 0.22 + (i * (TAU - 0.44)) / 8;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * p.r * 0.85, y + Math.sin(a) * p.r * 0.85);
      }
      ctx.stroke();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (const p of pellets) {
      if (!p.landed) continue;
      const age = time - p.born;
      ctx.globalAlpha = age > 26 ? Math.max(0, (30 - age) / 4) : 1;
      ctx.fillStyle = colors.shadow;
      ctx.beginPath(); ctx.arc(p.x + 2, p.y + 3, 2.8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9c6a3a';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const k of koi) drawKoi(k);
    drawPads();

    ctx.strokeStyle = colors.ripple;
    ctx.lineWidth = 1.1;
    for (const r of ripples) {
      const t = (time - r.born) / r.life;
      const e = 1 - Math.pow(1 - t, 2.2);
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.max * e, 0, TAU); ctx.stroke();
      if (t > 0.12) {
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.max * e * 0.62, 0, TAU); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- loop + input ----

  let last = 0, running = false;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    step(dt);
    draw();
    if (running) requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }
  function stop() { running = false; }

  function settle() {
    // reduced motion: show a calm, already-swimming pond as one still frame
    for (let i = 0; i < 180; i++) step(1 / 60);
    ripples = [];
    draw();
  }

  pond.addEventListener('pointermove', (e) => {
    const r = pond.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const now = performance.now() / 1000;
    const dt = Math.max(0.008, now - pointer.t);
    if (pointer.t) pointer.speed = Math.max(pointer.speed, Math.hypot(x - pointer.x, y - pointer.y) / dt);
    pointer.x = x; pointer.y = y; pointer.t = now;
    if (running && e.pointerType === 'mouse' && pointer.speed > 260 && time - pointer.lastWake > 0.12) {
      pointer.lastWake = time;
      ripples.push({ x, y, born: time, max: 14, life: 0.9 });
    }
  });
  pond.addEventListener('pointerleave', () => { pointer.x = pointer.y = -1e4; pointer.speed = 0; });
  pond.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button')) return;
    const r = pond.getBoundingClientRect();
    feed(e.clientX - r.left, e.clientY - r.top);
    if (!running) { step(0.3); draw(); }
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); if (!running) draw(); }, 120);
  });
  new MutationObserver(() => { readColors(); if (!running) draw(); })
    .observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); if (!running) draw(); });

  function applyMotion() {
    if (reduced.matches) { stop(); settle(); } else start();
  }
  reduced.addEventListener('change', applyMotion);

  readColors();
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => readAvoid());
  applyMotion();
})();
