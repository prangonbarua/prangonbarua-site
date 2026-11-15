/* Koi pond: a small fish simulation drawn as a monospace glyph grid.
 *
 * Three parts:
 *   Pond      the world, in CSS pixels (koi, pellets, ripples, bites)
 *   GlyphGrid rasterises the world into character cells and paints them
 *   PondView  wires both to the page (sizing, pointer, clicks, theme, stats)
 *
 * No dependencies. Loaded with `defer` on the home page.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  var TAU = 2 * Math.PI;
  var STEP = 1 / 60;

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  function rand(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // shortest signed turn from angle a to angle b, in (-pi, pi]
  function turnBetween(a, b) {
    var d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  // integer hash of three ints into [0, 1)
  function hash3(a, b, c) {
    var h =
      Math.imul(a | 0, 0x165667b1) ^
      Math.imul(b | 0, 0x27d4eb2f) ^
      Math.imul(c | 0, 0x55fdc781);
    h = Math.imul(h ^ (h >>> 13), 0x4bf19f61);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // smooth value noise on an integer lattice
  function valueNoise(x, y, seed) {
    var x0 = Math.floor(x);
    var y0 = Math.floor(y);
    var sx = smoothstep(0, 1, x - x0);
    var sy = smoothstep(0, 1, y - y0);
    var c00 = hash3(x0, y0, seed);
    var c10 = hash3(x0 + 1, y0, seed);
    var c01 = hash3(x0, y0 + 1, seed);
    return (
      c00 +
      (c10 - c00) * sx +
      (c01 - c00) * sy +
      (c00 - c10 - c01 + hash3(x0 + 1, y0 + 1, seed)) * sx * sy
    );
  }

  // a line glyph that follows the direction (x, y), screen space (y down)
  function lineGlyph(x, y) {
    var len = Math.hypot(x, y) || 1;
    if (Math.abs(y) < 0.38 * len) return '-';
    if (Math.abs(x) < 0.38 * len) return '|';
    return x * y > 0 ? '\\' : '/';
  }

  function mixRgb(a, b, t) {
    return [
      (a[0] + (b[0] - a[0]) * t) | 0,
      (a[1] + (b[1] - a[1]) * t) | 0,
      (a[2] + (b[2] - a[2]) * t) | 0,
    ];
  }

  function scaleRgb(c, k) {
    return [
      Math.min(255, c[0] * k) | 0,
      Math.min(255, c[1] * k) | 0,
      Math.min(255, c[2] * k) | 0,
    ];
  }

  function packRgb(c) {
    return (c[0] << 16) | (c[1] << 8) | c[2];
  }

  function rampColor(stops, t) {
    var x = clamp(t, 0, 1) * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(x));
    return mixRgb(stops[i], stops[i + 1], x - i);
  }

  /* ------------------------------------------------------------------ */
  /* the world                                                           */
  /* ------------------------------------------------------------------ */

  var VARIETIES = [
    ['kohaku', 3],
    ['sanke', 2],
    ['tancho', 1],
  ];
  var VARIETY_TOTAL = 6;

  function pickVariety() {
    var r = Math.random() * VARIETY_TOTAL;
    for (var i = 0; i < VARIETIES.length; i++) {
      r -= VARIETIES[i][1];
      if (r <= 0) return VARIETIES[i][0];
    }
    return 'kohaku';
  }

  function rippleLife(r) {
    return 2.2 + 1.6 * r.strength;
  }

  var SPINE_NODES = 20;
  var PELLET_LIFE = 14;
  var PELLET_CAP = 24;
  var BITE_LIFE = 0.45;

  function Pond() {
    this.width = 0;
    this.height = 0;
    this.time = 0;
    this.koi = [];
    this.pellets = [];
    this.bites = [];
    this.ripples = [];
    this.lastFeed = -Infinity;
    this.pointer = { x: 0, y: 0, speed: 0, active: false };
    this.avoid = [];
    this._push = { x: 0, y: 0 };
  }

  Pond.prototype.resize = function (w, h) {
    var first = this.width === 0;
    this.width = w;
    this.height = h;
    if (first) this.seed();
  };

  Pond.prototype.seed = function () {
    var W = this.width;
    var H = this.height;
    var base = clamp(0.5 * Math.min(W, H), 170, 420);
    var adults = clamp(Math.round((W * H) / 240000), 3, 6);
    var young = W >= 1024 ? 2 : 0;
    this.koi = [];
    for (var i = 0; i < adults + young; i++) {
      var juvenile = i >= adults;
      var length = base * (juvenile ? rand(0.32, 0.45) : rand(0.6, 1));
      var depthMax = juvenile ? 0.72 : 1;
      var heading = rand(0, TAU);
      var hx = rand(0.1 * W, 0.9 * W);
      var hy = rand(0.1 * H, 0.9 * H);
      var nodes = new Float32Array(SPINE_NODES * 2);
      var gap = length / 19;
      for (var k = 0; k < SPINE_NODES; k++) {
        nodes[2 * k] = hx - Math.cos(heading) * gap * k;
        nodes[2 * k + 1] = hy - Math.sin(heading) * gap * k;
      }
      var variety = pickVariety();
      var phase = rand(0, TAU);
      var curiosity = rand(0.35, 1);
      var depth = rand(0.5, depthMax);
      var depthTarget = rand(0.5, depthMax);
      var nextDive = rand(6, 18);
      var nextSurface = rand(3, 14);
      var nextWake = rand(0, 2);
      var nextBurst = rand(0, 3);
      var finPhase = rand(0, TAU);
      this.koi.push({
        id: i + 1,
        variety: variety,
        length: length,
        nodes: nodes,
        heading: heading,
        speed: 20,
        phase: phase,
        turn: 0,
        wander: 0,
        curiosity: curiosity,
        depth: depth,
        depthTarget: depthTarget,
        depthMax: depthMax,
        nextDive: nextDive,
        nextSurface: nextSurface,
        nextWake: nextWake,
        beat: 0,
        rush: 0,
        food: null,
        burstUntil: 0,
        nextBurst: nextBurst,
        finPhase: finPhase,
        startle: 0,
        fleeX: 0,
        fleeY: 0,
        gulp: 0,
      });
    }
  };

  Pond.prototype.feed = function (x, y) {
    this.lastFeed = this.time;
    this.ripples.push({ x: x, y: y, born: this.time, strength: 0.35 });
    var count = Math.min(5 + Math.floor(3 * Math.random()), PELLET_CAP - this.pellets.length);
    for (var i = 0; i < count; i++) {
      var theta = rand(0, TAU);
      var r = 34 * Math.sqrt(Math.random());
      var v = rand(2, 6);
      var landAt = rand(0.15, 0.45);
      this.pellets.push({
        x: x + Math.cos(theta) * r * 1.3,
        y: y + Math.sin(theta) * r,
        born: this.time,
        landAt: landAt,
        landed: false,
        vx: Math.cos(theta) * v,
        vy: Math.sin(theta) * v,
      });
    }
  };

  Pond.prototype.step = function (dt) {
    this.time += dt;
    this.pointer.speed *= Math.exp(-(8 * dt));
    for (var i = 0; i < this.koi.length; i++) this.swim(this.koi[i], dt);

    var now = this.time;
    this.pellets = this.pellets.filter(function (p) {
      return now - p.born < PELLET_LIFE;
    });
    for (var j = 0; j < this.pellets.length; j++) {
      var p = this.pellets[j];
      if (!p.landed) {
        if (now - p.born < p.landAt) continue;
        p.landed = true;
        this.ripples.push({ x: p.x, y: p.y, born: now, strength: 0.1 });
        for (var k = 0; k < this.koi.length; k++) {
          var f = this.koi[k];
          if (Math.hypot(f.nodes[0] - p.x, f.nodes[1] - p.y) < 650) f.rush = 1;
        }
        continue;
      }
      var drag = Math.exp(-(0.2 * dt));
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.ripples = this.ripples.filter(function (r) {
      return now - r.born < rippleLife(r);
    });
    this.bites = this.bites.filter(function (b) {
      return now - b.born < BITE_LIFE;
    });
  };

  // steering push away from text boxes, written into out
  function avoidPush(boxes, x, y, reach, out) {
    out.x = 0;
    out.y = 0;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var ax = x - clamp(x, b.left, b.right);
      var ay = y - clamp(y, b.top, b.bottom);
      var n = Math.hypot(ax, ay);
      if (n > reach) continue;
      if (n < 0.001) {
        // inside: leave through the nearest edge
        var edges = [b.left - x, x - b.right, b.top - y, y - b.bottom];
        var e = edges.indexOf(Math.max.apply(null, edges));
        ax = e === 0 ? -1 : e === 1 ? 1 : 0;
        ay = e === 2 ? -1 : e === 3 ? 1 : 0;
        n = 0;
      }
      var len = Math.hypot(ax, ay) || 1;
      out.x += (ax / len) * (1 - n / reach);
      out.y += (ay / len) * (1 - n / reach);
    }
  }

  Pond.prototype.swim = function (f, dt) {
    var W = this.width;
    var H = this.height;
    var ptr = this.pointer;
    var now = this.time;
    var L = f.length;
    var n = f.nodes;
    var hx = n[0];
    var hy = n[1];
    var dx = Math.cos(f.heading);
    var dy = Math.sin(f.heading);

    // 1. idle wander
    f.wander = clamp(f.wander + (Math.random() - 0.5) * dt * 2.4, -0.9, 0.9);
    dx += 0.6 * Math.cos(f.heading + f.wander);
    dy += 0.6 * Math.sin(f.heading + f.wander);

    // 2. food
    var food = this.chooseFood(f, hx, hy, Math.max(1.6 * L + 220, f.rush > 0 ? 650 : 0));

    // 3. startle from a fast pointer
    var pd = Math.hypot(ptr.x - hx, ptr.y - hy);
    var justFed = now - this.lastFeed < 2;
    if (!food && !justFed && ptr.active && ptr.speed > 1100 && pd < 0.9 * L) {
      f.startle = 1;
      f.fleeX = ptr.x;
      f.fleeY = ptr.y;
    }
    f.startle = Math.max(0, f.startle - 0.6 * dt);

    // 4. one drive: flee, chase or investigate the pointer
    var fleeing = f.startle > 0.3 && !food;
    var chasing = false;
    var curious = false;
    var close = 0;
    var ax, ay, d;
    if (fleeing) {
      ax = hx - f.fleeX;
      ay = hy - f.fleeY;
      d = Math.hypot(ax, ay) || 1;
      dx += (ax / d) * 4 * f.startle;
      dy += (ay / d) * 4 * f.startle;
    } else if (food) {
      ax = food.x - hx;
      ay = food.y - hy;
      d = Math.hypot(ax, ay) || 1;
      dx += (ax / d) * 3;
      dy += (ay / d) * 3;
      chasing = true;
      close = clamp(1 - d / (1.2 * L), 0, 1);
    } else if (ptr.active) {
      ax = ptr.x - hx;
      ay = ptr.y - hy;
      d = Math.hypot(ax, ay) || 1;
      if (d < 300) {
        var pull = f.curiosity * (1 - d / 300) * 2.2;
        var s = clamp(d / (0.6 * L), 0, 1);
        dx += ((ax / d) * s - (ay / d) * (1 - s)) * pull;
        dy += ((ay / d) * s + (ax / d) * (1 - s)) * pull;
        curious = true;
      }
    }

    // 5. other koi: keep apart, loosely school
    for (var i = 0; i < this.koi.length; i++) {
      var o = this.koi[i];
      if (o === f) continue;
      var ox = o.nodes[0];
      var oy = o.nodes[1];
      if (Math.abs(ox - hx) > 2 * L || Math.abs(oy - hy) > 2 * L) continue;
      for (var k = 0; k < SPINE_NODES; k += 3) {
        var sx = hx - o.nodes[2 * k];
        var sy = hy - o.nodes[2 * k + 1];
        var r = Math.hypot(sx, sy);
        var sep = (L + o.length) * (food ? 0.12 : 0.28);
        if (r < sep && r > 0.001) {
          var shove = (1 - r / sep) * 2.4;
          dx += (sx / r) * shove;
          dy += (sy / r) * shove;
        }
      }
      if (!chasing && Math.hypot(ox - hx, oy - hy) < 1.6 * L) {
        dx += 0.18 * Math.cos(o.heading);
        dy += 0.18 * Math.sin(o.heading);
      }
    }

    // 6. stay out from under the text
    avoidPush(this.avoid, hx, hy, 0.4 * L, this._push);
    var avoidGain = chasing || curious ? 0.5 : 1.8;
    dx += this._push.x * avoidGain;
    dy += this._push.y * avoidGain;

    // 7. walls
    var out = Math.max(-hx, hx - W, -hy, hy - H);
    if (out > -(0.25 * L)) {
      var wall = 3.5 * clamp((out + 0.25 * L) / (0.5 * L), 0, 1);
      var cx = W / 2 - hx;
      var cy = H / 2 - hy;
      var cd = Math.hypot(cx, cy) || 1;
      dx += (cx / cd) * wall;
      dy += (cy / cd) * wall;
    }

    // 8. turn toward the desired direction
    var want = Math.atan2(dy, dx);
    var maxTurn =
      (1 + 0.6 * f.rush) *
      Math.min(fleeing ? 3 : chasing ? 1.9 + close : curious ? 1.2 : 0.7, (f.speed / L) * 4) *
      dt;
    var delta = clamp(turnBetween(f.heading, want), -maxTurn, maxTurn);
    f.heading += delta;
    f.turn += (delta / dt - f.turn) * Math.min(1, 3 * dt);

    // 9. bursts of tail beats
    if (now > f.nextBurst && now > f.burstUntil) {
      f.burstUntil = now + rand(0.7, 1.6);
      f.nextBurst = f.burstUntil + rand(1.2, 4);
    }
    var active = fleeing || chasing || now < f.burstUntil;
    f.beat += ((active ? 1 : 0) - f.beat) * Math.min(1, 3 * dt);

    // 11. wake ring off the tail
    if (f.beat > 0.6 && f.depth > 0.65 && now > f.nextWake) {
      this.ripples.push({ x: n[34], y: n[35], born: now, strength: 0.25 + 0.2 * f.depth });
      f.nextWake = now + rand(0.8, 1.6) / f.beat;
    }
    f.rush = Math.max(0, f.rush - 0.7 * dt);

    // 13. speed
    var cruise = 12 + 0.05 * L;
    var target =
      (1 + 0.8 * f.rush) *
      (fleeing
        ? 3.2 * cruise
        : chasing
          ? cruise * (1.9 + close)
          : active
            ? cruise * (curious ? 1.6 : 1.35)
            : 0.45 * cruise);
    f.speed += (target - f.speed) * Math.min(1, dt * (active ? 1.6 + 3 * f.rush : 0.35));
    f.phase += dt * (0.6 + f.beat * (2.2 + f.speed / 11));
    f.finPhase += 2.4 * dt;
    f.gulp += ((chasing && close > 0.55 ? 1 : 0) - f.gulp) * Math.min(1, 6 * dt);

    // 16. depth: dive now and then, rise to feed
    if (now > f.nextDive) {
      f.depthTarget = rand(0.5, f.depthMax);
      f.nextDive = now + rand(8, 20);
    }
    f.depth += ((chasing ? 1 : f.depthTarget) - f.depth) * Math.min(1, dt * (chasing ? 0.8 : 0.15));

    // 17. move the head, 18. drag the body behind it
    n[0] += Math.cos(f.heading) * f.speed * dt;
    n[1] += Math.sin(f.heading) * f.speed * dt;
    var seg = L / 19;
    var prev = f.heading + Math.PI;
    for (var t = 1; t < SPINE_NODES; t++) {
      var px = n[(t - 1) * 2];
      var py = n[(t - 1) * 2 + 1];
      var ang = Math.atan2(n[2 * t + 1] - py, n[2 * t] - px);
      ang = prev + clamp(turnBetween(prev, ang), -0.16, 0.16);
      n[2 * t] = px + Math.cos(ang) * seg;
      n[2 * t + 1] = py + Math.sin(ang) * seg;
      prev = ang;
    }

    // 19. eat what is under the mouth
    var mouth = 0.08 * L + 6;
    var before = this.pellets.length;
    this.pellets = this.pellets.filter(function (p) {
      return !p.landed || (p.x - n[0]) ** 2 + (p.y - n[1]) ** 2 > mouth * mouth;
    });
    if (this.pellets.length < before) {
      this.ripples.push({ x: n[0], y: n[1], born: now, strength: 0.6 });
      this.bites.push({ x: n[0], y: n[1], born: now });
      f.nextSurface = now + rand(6, 16);
    } else if (now > f.nextSurface) {
      this.ripples.push({ x: n[0], y: n[1], born: now, strength: 0.3 });
      f.nextSurface = now + rand(8, 20);
    }
  };

  Pond.prototype.chooseFood = function (f, x, y, reach) {
    if (f.food && this.pellets.indexOf(f.food) === -1) f.food = null;
    var nearest = this.nearestPellet(x, y, reach);
    if (!f.food) {
      f.food = nearest;
      return f.food;
    }
    var cur = Math.hypot(f.food.x - x, f.food.y - y);
    if (cur > 1.3 * reach) f.food = nearest;
    else if (nearest && Math.hypot(nearest.x - x, nearest.y - y) < 0.5 * cur) f.food = nearest;
    return f.food;
  };

  Pond.prototype.nearestPellet = function (x, y, reach) {
    var best = null;
    var bestD = reach * reach;
    for (var i = 0; i < this.pellets.length; i++) {
      var p = this.pellets[i];
      if (!p.landed) continue;
      var d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  /* ------------------------------------------------------------------ */
  /* koi shape                                                           */
  /* ------------------------------------------------------------------ */

  // body half width (fraction of length) at arc position s, snout 0 to tail 1
  function halfWidth(s) {
    if (s < 0.12) return 0.11 * Math.pow(Math.sin(((s / 0.12) * Math.PI) / 2), 0.55);
    if (s < 0.3) return 0.11 + 0.025 * smoothstep(0.12, 0.3, s);
    return 0.033 + 0.102 * (1 - smoothstep(0.3, 0.74, s));
  }

  // elliptical fin test (pectoral and pelvic), mirrored because d is unsigned
  function inFin(s, d, s0, angle, rs, rv, hit) {
    var dv0 = 0.85 * halfWidth(s0);
    var c = Math.cos(angle);
    var sn = Math.sin(angle);
    var du = s - s0;
    var dv = d - dv0;
    if (((du * c + dv * sn - rs) / rs) ** 2 + ((-du * sn + dv * c) / rv) ** 2 > 1) return false;
    hit.part = PART_FIN;
    return true;
  }

  var PART_BODY = 1;
  var PART_FIN = 2;
  var PART_EYE = 3;
  var PART_DORSAL = 4;
  var PART_BARBEL = 5;

  // classify a point (all distances in body lengths)
  function classify(s, d, beyond, flare, hit, front, perp) {
    hit.part = 0;
    hit.across = 1;
    if (front > 0) {
      if (front < 0.05 && Math.abs(perp - (0.045 + 0.7 * front)) < 0.016) {
        hit.part = PART_BARBEL;
        return true;
      }
      return false;
    }
    var w = halfWidth(s);
    if (s <= 0.74 && d <= w) {
      var a = d / w;
      hit.across = a;
      if (s > 0.055 && s < 0.1 && a > 0.5 && a < 0.85) hit.part = PART_EYE;
      else if (s > 0.28 && s < 0.6 && a < 0.14) hit.part = PART_DORSAL;
      else hit.part = PART_BODY;
      return true;
    }
    if (s > 0.68 && beyond <= 0) {
      var tw = (0.03 + 0.15 * Math.pow(smoothstep(0.7, 1, s), 0.8)) * flare;
      if (d <= tw && s <= 0.86 + (d / tw) * 0.14) {
        hit.part = PART_FIN;
        return true;
      }
    }
    return (
      inFin(s, d, 0.19, 0.85 + 0.5 * (flare - 1), 0.066 * flare, 0.04, hit) ||
      inFin(s, d, 0.47, 0.75, 0.036, 0.018, hit)
    );
  }

  function inPatch(p, s, v, wobble) {
    return ((s - p.s) / p.rs) ** 2 + ((v - p.v) / p.rv) ** 2 < 1 + wobble;
  }

  // red patches and black spots, fixed per koi id
  function patternFor(f) {
    var t = function (k) {
      return hash3(f.id, k, 41);
    };
    if (f.variety === 'tancho') {
      return { red: [{ s: 0.11, v: 0, rs: 0.05, rv: 0.055 }], black: [] };
    }
    var red = [];
    if (t(0) < 0.75) {
      red.push({ s: 0.1, v: (t(1) - 0.5) * 0.03, rs: 0.055 + 0.03 * t(2), rv: 0.11 });
    }
    var count = 2 + Math.floor(2 * t(3));
    for (var k = 0; k < count; k++) {
      var slot = 0.42 / count;
      red.push({
        s: 0.25 + slot * (k + 0.5) + (t(10 + k) - 0.5) * slot * 0.3,
        v: (t(20 + k) - 0.5) * 0.05,
        rs: slot * (0.32 + 0.12 * t(30 + k)),
        rv: 0.09 + 0.05 * t(40 + k),
      });
    }
    var black = [];
    if (f.variety === 'sanke') {
      var spots = 4 + Math.floor(3 * t(50));
      for (var j = 0; j < spots; j++) {
        black.push({
          s: 0.24 + 0.44 * t(60 + j),
          v: (t(70 + j) - 0.5) * 0.16,
          rs: 0.022,
          rv: 0.026,
        });
      }
    }
    return { red: red, black: black };
  }

  /* ------------------------------------------------------------------ */
  /* palettes                                                            */
  /* ------------------------------------------------------------------ */

  var DARK = {
    bg: [26, 25, 33],
    white: [236, 228, 218],
    red: [232, 96, 56],
    black: [92, 90, 108],
    fin: [214, 206, 198],
    eye: [20, 20, 26],
    water: [255, 247, 240],
    shadow: [0, 0, 0],
    shadowAlpha: 0.55,
    pellet: [236, 170, 92],
    alpha: 0.8,
    depthFloor: 0.4,
    tile: [0.68, 0.98],
    hi: [
      [112, 22, 24],
      [168, 34, 28],
      [214, 58, 30],
      [240, 96, 34],
      [250, 138, 52],
      [255, 178, 96],
    ],
    ink: 0.42,
  };

  var LIGHT = {
    bg: [245, 244, 241],
    white: [112, 108, 104],
    red: [204, 62, 28],
    black: [36, 33, 40],
    fin: [138, 132, 126],
    eye: [24, 22, 26],
    water: [38, 37, 35],
    shadow: [60, 58, 56],
    shadowAlpha: 0.2,
    pellet: [176, 108, 40],
    alpha: 0.9,
    depthFloor: 0.55,
    tile: [0.78, 0.55],
    hi: [
      [138, 24, 22],
      [184, 38, 24],
      [222, 62, 28],
      [238, 100, 38],
      [244, 140, 66],
      [248, 176, 116],
    ],
    ink: 0.45,
  };

  var SKIN_RAMP = 't%SX8@#';
  // sub-sample points inside a cell, as (x, y) fractions
  var SUBS = [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75];
  var FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, monospace';

  /* ------------------------------------------------------------------ */
  /* glyph grid renderer                                                 */
  /* ------------------------------------------------------------------ */

  function GlyphGrid(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.dpr = 1;
    this.cw = 8;
    this.ch = 12;
    this.cols = 0;
    this.rows = 0;
    this.palette = DARK;
    this.colorCache = new Map();
    this.patterns = new Map();
    this.energy = new Float32Array(0);
    this.energyNext = new Float32Array(0);
    this.glyph = new Uint16Array(0);
    this.glyphColor = new Uint32Array(0);
    this.glyphAlpha = new Float32Array(0);
    this.tile = new Uint32Array(0);
    this.tileAlpha = new Float32Array(0);
    this.dim = new Float32Array(0);
    this.shadow = new Uint8Array(0);
    // per-koi scratch: the swimming spine and its arc lengths
    this.spine = new Float32Array(SPINE_NODES * 2);
    this.arc = new Float32Array(SPINE_NODES);
    this.arcTotal = 1;
    this.flareL = 1;
    this.flareR = 1;
    // last sample result
    this.hit = { part: 0, across: 1 };
    this.hS = 0;
    this.hV = 0;
    this.hDist = 0;
    this.hTx = 1;
    this.hTy = 0;
    this.hSeg = 0;
  }

  GlyphGrid.prototype.setTheme = function (light) {
    this.palette = light ? LIGHT : DARK;
  };

  GlyphGrid.prototype.resize = function (w, h, dpr) {
    this.dpr = dpr;
    this.cw = clamp(Math.round(w / 125), 8, 12);
    this.ch = this.cw + 2;
    this.cols = Math.ceil(w / this.cw);
    this.rows = Math.ceil(h / this.ch);
    this.ctx.canvas.width = Math.round(w * dpr);
    this.ctx.canvas.height = Math.round(h * dpr);
    var cells = this.cols * this.rows;
    this.energy = new Float32Array(cells);
    this.energyNext = new Float32Array(cells);
    this.glyph = new Uint16Array(cells);
    this.glyphColor = new Uint32Array(cells);
    this.glyphAlpha = new Float32Array(cells);
    this.tile = new Uint32Array(cells);
    this.tileAlpha = new Float32Array(cells);
    this.dim = new Float32Array(cells).fill(1);
    this.shadow = new Uint8Array(cells);
  };

  // koi under text fade to 15% and recover over four cells
  GlyphGrid.prototype.setDimBoxes = function (boxes) {
    var cols = this.cols;
    var rows = this.rows;
    var cw = this.cw;
    var ch = this.ch;
    var dim = this.dim;
    dim.fill(1);
    var margin = 4 * cw;
    for (var b = 0; b < boxes.length; b++) {
      var box = boxes[b];
      var c0 = Math.max(0, Math.floor((box.left - margin) / cw));
      var c1 = Math.min(cols - 1, Math.floor((box.right + margin) / cw));
      var r0 = Math.max(0, Math.floor((box.top - margin) / ch));
      var r1 = Math.min(rows - 1, Math.floor((box.bottom + margin) / ch));
      for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) {
          var x = c * cw + cw / 2;
          var y = r * ch + ch / 2;
          var d = Math.hypot(
            Math.max(box.left - x, 0, x - box.right),
            Math.max(box.top - y, 0, y - box.bottom)
          );
          var i = r * cols + c;
          dim[i] = Math.min(dim[i], 0.15 + 0.85 * smoothstep(0, margin, d));
        }
      }
    }
  };

  GlyphGrid.prototype.render = function (pond, dt) {
    var ctx = this.ctx;
    if (this.cols === 0) return;
    this.glyph.fill(0);
    this.tileAlpha.fill(0);
    this.shadow.fill(0);
    var order = pond.koi.slice().sort(function (a, b) {
      return a.depth - b.depth;
    });
    for (var i = 0; i < order.length; i++) this.rasterize(order[i], pond.time);
    this.depositWake(pond);
    this.spreadWake(dt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '600 ' + Math.round(0.72 * this.ch) + 'px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.paintShadows();
    this.paintWake();
    this.paintRipples(pond);
    this.paintPellets(pond);
    this.paintKoi();
    this.paintBites(pond);
    ctx.globalAlpha = 1;
  };

  GlyphGrid.prototype.css = function (packed) {
    var s = this.colorCache.get(packed);
    if (!s) {
      s = 'rgb(' + (packed >>> 16) + ',' + ((packed >>> 8) & 255) + ',' + (packed & 255) + ')';
      this.colorCache.set(packed, s);
    }
    return s;
  };

  // a loose glyph centred in cell i
  GlyphGrid.prototype.put = function (i, ch, rgb, alpha) {
    var ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.css(packRgb(rgb));
    ctx.fillText(ch, (i % this.cols) * this.cw + this.cw / 2, ((i / this.cols) | 0) * this.ch + this.ch / 2);
  };

  GlyphGrid.prototype.cellAt = function (x, y) {
    var c = Math.floor(x / this.cw);
    var r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  };

  // nearest point on the swimming spine (segments from..to), then classify
  GlyphGrid.prototype.sample = function (px, py, L, from, to) {
    if (from === undefined) from = 0;
    if (to === undefined) to = 18;
    var sp = this.spine;
    var arc = this.arc;
    var best = Infinity;
    var s = 0;
    var side = 1;
    var beyond = 0;
    var front = 0;
    var perp = 0;
    for (var i = from; i <= to; i++) {
      var ax = sp[2 * i];
      var ay = sp[2 * i + 1];
      var vx = sp[(i + 1) * 2] - ax;
      var vy = sp[(i + 1) * 2 + 1] - ay;
      var vv = vx * vx + vy * vy || 1;
      var g = ((px - ax) * vx + (py - ay) * vy) / vv;
      var gc = clamp(g, 0, 1);
      var d2 = (px - ax - vx * gc) ** 2 + (py - ay - vy * gc) ** 2;
      if (d2 < best) {
        var len = Math.sqrt(vv);
        best = d2;
        s = (arc[i] + gc * len) / this.arcTotal;
        side = vx * (py - ay) - vy * (px - ax) >= 0 ? 1 : -1;
        beyond = i === 18 ? Math.max(0, g - 1) * len : 0;
        front = i === 0 ? Math.max(0, -g) * len : 0;
        perp = Math.abs(vx * (py - ay) - vy * (px - ax)) / len;
        this.hTx = vx / len;
        this.hTy = vy / len;
        this.hSeg = i;
      }
    }
    var dist = Math.sqrt(best);
    this.hDist = dist;
    this.hS = s;
    this.hV = dist * side;
    return classify(s, dist / L, beyond / L, side > 0 ? this.flareL : this.flareR, this.hit, front / L, perp / L);
  };

  GlyphGrid.prototype.pattern = function (f) {
    var p = this.patterns.get(f.id);
    if (!p) {
      p = patternFor(f);
      this.patterns.set(f.id, p);
    }
    return p;
  };

  // which skin color sits at (s, v); returns the palette entry itself
  GlyphGrid.prototype.skinAt = function (f, s, v, across) {
    var pal = this.palette;
    var vn = v / f.length;
    if (across > 0.9 || s > 0.74) return pal.white;
    var wobble = (valueNoise(14 * s + f.id, 30 * vn, f.id + 3) - 0.5) * 0.6;
    var pat = this.pattern(f);
    for (var i = 0; i < pat.black.length; i++) if (inPatch(pat.black[i], s, vn, wobble)) return pal.black;
    for (var j = 0; j < pat.red.length; j++) if (inPatch(pat.red[j], s, vn, wobble)) return pal.red;
    return pal.white;
  };

  GlyphGrid.prototype.rasterize = function (f, time) {
    var sp = this.spine;
    var arc = this.arc;
    var cw = this.cw;
    var ch = this.ch;
    var cols = this.cols;
    var rows = this.rows;
    var pal = this.palette;
    var L = f.length;
    var n = f.nodes;
    var amp = 0.2 + 1.1 * f.beat;

    // swimming spine: a travelling sideways wave, bigger toward the tail
    for (var t = 0; t < SPINE_NODES; t++) {
      var u = t / 19;
      var a = Math.max(0, t - 1);
      var b = Math.min(19, t + 1);
      var nx = n[2 * a] - n[2 * b];
      var ny = n[2 * a + 1] - n[2 * b + 1];
      var nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      var off = 0.04 * L * (0.05 + 0.95 * Math.pow(u, 2.2)) * amp * Math.sin(f.phase - 4.6 * u);
      sp[2 * t] = n[2 * t] - ny * off;
      sp[2 * t + 1] = n[2 * t + 1] + nx * off;
    }
    arc[0] = 0;
    for (var e = 1; e < SPINE_NODES; e++) {
      arc[e] = arc[e - 1] + Math.hypot(sp[2 * e] - sp[(e - 1) * 2], sp[2 * e + 1] - sp[(e - 1) * 2 + 1]);
    }
    this.arcTotal = arc[19] || 1;

    var flareBase = 1 - 0.25 * f.beat;
    var flareOsc = 0.18 * (1 - f.beat) * Math.sin(f.finPhase);
    var bend = clamp(0.6 * f.turn, -0.35, 0.35);
    this.flareL = flareBase + flareOsc - bend;
    this.flareR = flareBase - flareOsc + bend;

    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var q = 0; q < SPINE_NODES; q++) {
      minX = Math.min(minX, sp[2 * q]);
      maxX = Math.max(maxX, sp[2 * q]);
      minY = Math.min(minY, sp[2 * q + 1]);
      maxY = Math.max(maxY, sp[2 * q + 1]);
    }
    var pad = 0.26 * L;
    var c0 = Math.max(0, Math.floor((minX - pad) / cw));
    var c1 = Math.min(cols - 1, Math.floor((maxX + pad) / cw));
    var r0 = Math.max(0, Math.floor((minY - pad) / ch));
    var r1 = Math.min(rows - 1, Math.floor((maxY + pad) / ch));
    if (c0 > c1 || r0 > r1) return;

    var diag = Math.hypot(cw, ch);
    var shadowDx = Math.round((0.07 * L * f.depth) / cw) + 1;
    var shadowDy = Math.round((0.05 * L * f.depth) / ch) + 1;
    var A = pal.alpha * (pal.depthFloor + (1 - pal.depthFloor) * f.depth);
    var tileLo = pal.tile[0];
    var tileHi = pal.tile[1];
    var hit = this.hit;

    for (var row = r0; row <= r1; row++) {
      for (var col = c0; col <= c1; col++) {
        var x0 = col * cw;
        var y0 = row * ch;
        var centre = this.sample(x0 + cw / 2, y0 + ch / 2, L);
        if (!centre && this.hDist > L * (this.hS > 0.4 && this.hS < 0.62 ? 0.15 : 0.25) + diag) {
          // far from the body: skip ahead along the row
          col += Math.max(0, Math.floor((this.hDist - 0.25 * L - diag) / cw));
          continue;
        }
        var lo = Math.max(0, this.hSeg - 2);
        var hiSeg = Math.min(18, this.hSeg + 2);
        var part = hit.part;
        var across = hit.across;
        var s = this.hS;
        var v = this.hV;
        var tx = this.hTx;
        var ty = this.hTy;
        var count = centre ? 1 : 0;
        var offX = 0;
        var offY = 0;
        var solid =
          centre &&
          part !== PART_FIN &&
          part !== PART_BARBEL &&
          s > 0.04 &&
          s < 0.72 &&
          halfWidth(s) * L - this.hDist > 0.35 * diag;
        if (solid) count = 5;
        for (var k = 0; !solid && k < SUBS.length; k += 2) {
          if (this.sample(x0 + SUBS[k] * cw, y0 + SUBS[k + 1] * ch, L, lo, hiSeg)) {
            offX += (SUBS[k] - 0.5) * cw;
            offY += (SUBS[k + 1] - 0.5) * ch;
            if (count === 0) {
              part = hit.part;
              across = hit.across;
              s = this.hS;
              v = this.hV;
              tx = this.hTx;
              ty = this.hTy;
            }
            count++;
          }
        }
        if (count === 0) continue;

        var cover = count / 5;
        var sideSign = v >= 0 ? 1 : -1;
        var idx = row * cols + col;
        var J = (0xffffffff * hash3(Math.round(90 * s), Math.round(v / (0.8 * cw)), f.id)) >>> 0;
        var solidEye = centre && cover >= 0.6;
        var glyph = ' ';
        var gColor = pal.fin;
        var gAlpha = A;
        var tile = null;
        var tAlpha = 0;

        if (part === PART_BARBEL) {
          glyph = lineGlyph(-tx - sideSign * ty * 0.7, -ty + sideSign * tx * 0.7);
          gColor = scaleRgb(mixRgb(pal.bg, pal.fin, 0.9), pal.ink + 0.3);
        } else if (part === PART_EYE && solidEye) {
          tile = mixRgb(pal.bg, pal.eye, 0.85);
          tAlpha = A;
          glyph = 'o';
          gColor = mixRgb(pal.bg, pal.white, 0.9);
        } else if (part === PART_FIN) {
          tile = mixRgb(pal.bg, pal.fin, 0.55);
          tAlpha = 0.45 * A * cover;
          if (J % 2 === 0) {
            glyph = '.';
            gAlpha *= 0.6 * cover;
          }
        } else {
          var skin = this.skinAt(f, s, v, across);
          var lean = sideSign * (0.6 * ty - 0.8 * tx) * across;
          var shade = clamp(0.22 + 0.5 * Math.sqrt(1 - across * across) + 0.18 * lean, 0, 1);
          if (skin === pal.red) {
            var shift = (hash3(f.id, 5, 17) - 0.5) * 0.3;
            var grain = (valueNoise(9 * s + f.id, (v / L) * 18, f.id + 21) - 0.5) * 0.25;
            var shimmer = Math.max(0, Math.sin(11 * s - 1.8 * time + f.id) - 0.7) / 0.3;
            tile = rampColor(pal.hi, 0.15 + 0.8 * shade + shift + grain + 0.35 * shimmer);
          } else {
            tile = mixRgb(pal.bg, skin, tileLo + (tileHi - tileLo) * shade);
          }
          if (count === 5) {
            var sc = col + shadowDx;
            var sr = row + shadowDy;
            if (sc < cols && sr < rows) this.shadow[sr * cols + sc] = 1;
            tAlpha = A;
            if (s < 0.035 && across < 0.6 && f.gulp > 0.5) {
              glyph = 'o';
              gColor = pal.eye;
            } else {
              glyph = SKIN_RAMP[clamp(Math.round((1 - shade) * 4) + ((J >>> 4) % 3), 0, SKIN_RAMP.length - 1)];
              gColor = scaleRgb(tile, pal.ink);
              if (skin === pal.white) gAlpha *= 0.6;
              var epoch = Math.floor(1.4 * time + (J % 997) / 97);
              if (hash3(J, epoch, 7) < 0.03) tile = mixRgb(tile, pal.bg, 0.45);
            }
          } else {
            tAlpha = A * cover * 0.55;
            if (Math.hypot(offX, offY) > 0.2 * cw && J % 3 === 0) {
              glyph = '.';
              gColor = scaleRgb(tile, pal.ink);
            }
          }
        }

        if (glyph !== ' ' || tAlpha !== 0) {
          this.tile[idx] = tile ? packRgb(tile) : 0;
          this.tileAlpha[idx] = tAlpha;
          this.glyph[idx] = glyph.charCodeAt(0);
          this.glyphColor[idx] = packRgb(gColor);
          this.glyphAlpha[idx] = gAlpha;
        }
      }
    }
  };

  GlyphGrid.prototype.paintKoi = function () {
    var ctx = this.ctx;
    var cw = this.cw;
    var ch = this.ch;
    var cols = this.cols;
    var glyph = this.glyph;
    var dim = this.dim;
    for (var i = 0; i < glyph.length; i++) {
      var code = glyph[i];
      if (!code) continue;
      var x = (i % cols) * cw;
      var y = ((i / cols) | 0) * ch;
      if (this.tileAlpha[i] > 0) {
        ctx.globalAlpha = this.tileAlpha[i] * dim[i];
        ctx.fillStyle = this.css(this.tile[i]);
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
      }
      if (code !== 32) {
        ctx.globalAlpha = this.glyphAlpha[i] * dim[i];
        ctx.fillStyle = this.css(this.glyphColor[i]);
        ctx.fillText(String.fromCharCode(code), x + cw / 2, y + ch / 2 + 1);
      }
    }
  };

  GlyphGrid.prototype.depositWake = function (pond) {
    var energy = this.energy;
    for (var k = 0; k < pond.koi.length; k++) {
      var f = pond.koi[k];
      for (var t = 16; t < SPINE_NODES; t++) {
        var i = this.cellAt(f.nodes[2 * t], f.nodes[2 * t + 1]);
        if (i >= 0) energy[i] = Math.min(1.5, energy[i] + 0.035 + 0.0012 * f.speed);
      }
    }
    if (pond.pointer.active) {
      var p = this.cellAt(pond.pointer.x, pond.pointer.y);
      if (p >= 0) energy[p] = Math.min(1.5, energy[p] + 0.12);
    }
  };

  GlyphGrid.prototype.spreadWake = function (dt) {
    var cols = this.cols;
    var rows = this.rows;
    var cur = this.energy;
    var next = this.energyNext;
    var decay = Math.exp(-(1.1 * dt));
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c;
        var left = c > 0 ? cur[i - 1] : cur[i];
        var right = c < cols - 1 ? cur[i + 1] : cur[i];
        var up = r > 0 ? cur[i - cols] : cur[i];
        var down = r < rows - 1 ? cur[i + cols] : cur[i];
        next[i] = (4 * cur[i] + left + right + up + down) * 0.125 * decay;
      }
    }
    this.energy = next;
    this.energyNext = cur;
  };

  GlyphGrid.prototype.paintShadows = function () {
    var pal = this.palette;
    for (var i = 0; i < this.shadow.length; i++) {
      if (this.shadow[i] && !this.glyph[i]) this.put(i, ':', pal.shadow, pal.shadowAlpha * this.dim[i]);
    }
  };

  GlyphGrid.prototype.paintWake = function () {
    var pal = this.palette;
    var energy = this.energy;
    for (var i = 0; i < energy.length; i++) {
      var en = energy[i];
      if (en < 0.22 || this.glyph[i] || this.shadow[i]) continue;
      this.put(i, en > 0.5 ? '-' : '.', pal.water, 0.35 * Math.min(1, (en - 0.22) * 1.4));
    }
  };

  GlyphGrid.prototype.paintRipples = function (pond) {
    var cw = this.cw;
    var ch = this.ch;
    var cols = this.cols;
    var rows = this.rows;
    var pal = this.palette;
    for (var k = 0; k < pond.ripples.length; k++) {
      var rp = pond.ripples[k];
      var age = pond.time - rp.born;
      var fade = Math.pow(1 - age / rippleLife(rp), 1.5) * rp.strength;
      for (var ring = 0; ring < 2; ring++) {
        var radius = 52 * Math.max(0, age - 0.45 * ring) * (0.7 + 0.5 * rp.strength);
        if (radius < 2) continue;
        var band = 0.6 * cw;
        var c0 = Math.max(0, Math.floor((rp.x - radius - cw) / cw));
        var c1 = Math.min(cols - 1, Math.floor((rp.x + radius + cw) / cw));
        var r0 = Math.max(0, Math.floor((rp.y - radius - ch) / ch));
        var r1 = Math.min(rows - 1, Math.floor((rp.y + radius + ch) / ch));
        var alpha = fade * (ring === 0 ? 0.55 : 0.3);
        for (var r = r0; r <= r1; r++) {
          for (var c = c0; c <= c1; c++) {
            var i = r * cols + c;
            if (this.glyph[i]) continue;
            var dx = c * cw + cw / 2 - rp.x;
            var dy = r * ch + ch / 2 - rp.y;
            if (Math.abs(Math.hypot(dx, dy) - radius) > band) continue;
            this.put(i, ring === 1 ? '.' : lineGlyph(-dy, dx), pal.water, alpha);
          }
        }
      }
    }
  };

  GlyphGrid.prototype.paintBites = function (pond) {
    var pal = this.palette;
    for (var k = 0; k < pond.bites.length; k++) {
      var b = pond.bites[k];
      var i = this.cellAt(b.x, b.y);
      if (i < 0) continue;
      var q = (pond.time - b.born) / BITE_LIFE;
      this.put(i, q < 0.35 ? '*' : q < 0.7 ? '+' : '.', pal.pellet, Math.min(1, 1.6 * pal.alpha) * (1 - q * q));
    }
  };

  GlyphGrid.prototype.paintPellets = function (pond) {
    var pal = this.palette;
    var ch = this.ch;
    for (var k = 0; k < pond.pellets.length; k++) {
      var p = pond.pellets[k];
      var age = pond.time - p.born;
      var i;
      if (!p.landed) {
        // still falling: drop into place from a cell and a half above
        var fall = age / p.landAt;
        i = this.cellAt(p.x, p.y - (1 - fall) * ch * 1.5);
        if (i < 0 || this.glyph[i]) continue;
        this.put(i, fall < 0.5 ? "'" : '.', pal.pellet, pal.alpha * (0.5 + 0.4 * fall));
        continue;
      }
      i = this.cellAt(p.x, p.y);
      if (i < 0 || this.glyph[i]) continue;
      var fade = smoothstep(9, 14, age);
      var bob = 0.8 + 0.2 * Math.sin(3 * age + p.x);
      this.put(i, fade > 0.55 ? '.' : 'o', pal.pellet, pal.alpha * bob * (1 - 0.85 * fade));
    }
  };

  /* ------------------------------------------------------------------ */
  /* page controller                                                     */
  /* ------------------------------------------------------------------ */

  // merge nearby text rects into a few boxes (never grows a box upward)
  function mergeBoxes(rects) {
    var boxes = [];
    rects.sort(function (a, b) {
      return a.top - b.top;
    });
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var into = null;
      for (var j = 0; j < boxes.length; j++) {
        var b = boxes[j];
        if (r.top - b.bottom < 160 && r.left - b.right < 160 && b.left - r.right < 160) {
          into = b;
          break;
        }
      }
      if (!into) {
        boxes.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
        continue;
      }
      into.left = Math.min(into.left, r.left);
      into.right = Math.max(into.right, r.right);
      into.bottom = Math.max(into.bottom, r.bottom);
    }
    return boxes;
  }

  var NO_FEED = "a, button, input, textarea, select, label, [role='button'], [data-koi-ignore]";

  function PondView(canvas, onStats) {
    var self = this;
    this.canvas = canvas;
    this.onStats = onStats;
    this.pond = new Pond();
    this.grid = new GlyphGrid(canvas);
    this.raf = 0;
    this.last = 0;
    this.acc = 0;
    this.frames = 0;
    this.lastMove = 0;
    this.reported = { koi: -1, pellets: -1 };
    this.visible = true;
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.schedule = function () {
      cancelAnimationFrame(self.raf);
      if (!self.visible) return;
      if (self.still.matches) {
        self.drawStill();
        return;
      }
      self.last = performance.now();
      self.raf = requestAnimationFrame(self.frame);
    };

    this.frame = function (now) {
      var dt = Math.min(0.1, (now - self.last) / 1000);
      self.last = now;
      self.acc += dt;
      var steps = 0;
      while (self.acc >= STEP && steps < 4) {
        self.pond.step(STEP);
        self.acc -= STEP;
        steps++;
      }
      if (steps === 4) self.acc = 0;
      if (++self.frames % 30 === 0) self.measure();
      self.grid.render(self.pond, dt);
      self.report();
      self.raf = requestAnimationFrame(self.frame);
    };

    this.onMove = function (e) {
      var at = self.local(e);
      var p = self.pond.pointer;
      var secs = Math.max(1, e.timeStamp - self.lastMove) / 1000;
      var instant = Math.hypot(at.x - p.x, at.y - p.y) / secs;
      p.speed += (Math.min(instant, 5000) - p.speed) * 0.5;
      self.lastMove = e.timeStamp;
      p.x = at.x;
      p.y = at.y;
      p.active = at.inside && e.pointerType !== 'touch';
    };

    this.onClick = function (e) {
      if (self.still.matches) return;
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var el = path[i];
        if (el instanceof Element && el.matches(NO_FEED)) return;
      }
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.toString()) return;
      var at = self.local(e);
      if (!at.inside) return;
      self.pond.feed(at.x, at.y);
      self.report();
    };

    this.onLeave = function () {
      self.pond.pointer.active = false;
      self.pond.pointer.speed = 0;
    };

    // palette only: a still frame now would warm up an empty, unsized pond
    this.grid.setTheme(document.documentElement.classList.contains('light'));
    new MutationObserver(function () {
      self.setTheme(document.documentElement.classList.contains('light'));
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () {
        self.resize();
      }).observe(canvas);
    } else {
      window.addEventListener('resize', function () {
        self.resize();
      });
    }
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(function (entries) {
        self.visible = entries[0].isIntersecting;
        self.schedule();
      }).observe(canvas);
    }
    if (this.still.addEventListener) this.still.addEventListener('change', this.schedule);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('click', this.onClick);
    document.documentElement.addEventListener('pointerleave', this.onLeave);
    window.addEventListener('blur', this.onLeave);
    this.resize();
    this.schedule();
  }

  PondView.prototype.setTheme = function (light) {
    this.grid.setTheme(light);
    if (this.still.matches) this.drawStill();
  };

  PondView.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    this.grid.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2));
    this.pond.resize(r.width, r.height);
    this.measure();
    this.report();
    if (this.still.matches) this.drawStill();
  };

  PondView.prototype.report = function () {
    var koi = this.pond.koi.length;
    var pellets = this.pond.pellets.length;
    if (koi !== this.reported.koi || pellets !== this.reported.pellets) {
      this.reported = { koi: koi, pellets: pellets };
      this.onStats(this.reported);
    }
  };

  PondView.prototype.measure = function () {
    var c = this.canvas.getBoundingClientRect();
    var els = document.querySelectorAll('[data-koi-avoid]');
    var rects = [];
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({ left: r.left - c.left, top: r.top - c.top, right: r.right - c.left, bottom: r.bottom - c.top });
      }
    }
    var boxes = mergeBoxes(rects);
    this.grid.setDimBoxes(boxes);
    this.pond.avoid = boxes;
  };

  // reduced motion: one settled frame, redrawn on theme and size changes
  PondView.prototype.drawStill = function () {
    if (this.pond.time < 4) for (var i = 0; i < 240; i++) this.pond.step(STEP);
    this.measure();
    this.grid.render(this.pond, STEP);
    this.report();
  };

  PondView.prototype.local = function (e) {
    var r = this.canvas.getBoundingClientRect();
    var x = e.clientX - r.left;
    var y = e.clientY - r.top;
    return { x: x, y: y, inside: x >= 0 && y >= 0 && x <= r.width && y <= r.height };
  };

  /* ------------------------------------------------------------------ */
  /* koi and pellet counter                                              */
  /* ------------------------------------------------------------------ */

  function counter(root) {
    if (!root) return function () {};
    var koiEl = root.querySelector('[data-koi-n]');
    var pelletEl = root.querySelector('[data-pellet-n]');
    var shownPellets = null;
    return function (stats) {
      if (stats.koi <= 0) return;
      root.hidden = false;
      koiEl.textContent = String(stats.koi);
      if (stats.pellets !== shownPellets) {
        shownPellets = stats.pellets;
        // a fresh node per count, bright then fading back; a script animation
        // also finishes while the desktop header is hidden
        var next = pelletEl.cloneNode(false);
        next.textContent = String(stats.pellets);
        pelletEl.replaceWith(next);
        pelletEl = next;
        if (next.animate) {
          next.animate([{ opacity: 1 }, { opacity: 0.32 }], {
            duration: 600,
            easing: 'cubic-bezier(0, 0, 0.58, 1)',
          });
        }
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      Pond: Pond,
      GlyphGrid: GlyphGrid,
      PondView: PondView,
      mergeBoxes: mergeBoxes,
      counter: counter,
      STEP: STEP,
      DARK: DARK,
      LIGHT: LIGHT,
    };
    return;
  }

  function boot() {
    var canvas = document.querySelector('canvas[data-pond]');
    if (!canvas) return;
    try {
      new PondView(canvas, counter(document.querySelector('[data-koi-stats]')));
    } catch (err) {
      // no 2D canvas: the page still reads fine without the pond
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
