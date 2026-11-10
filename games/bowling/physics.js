/*
 * Emberlane — a small rigid-body simulation for one lane: a ball, ten pins, an oiled lane,
 * gutters, kickback walls and a pit. Pure maths, no browser needed
 * (node games/bowling/test/physics.test.js).
 *
 * Units: metres, kilograms, seconds. Axes as in three.js: x right, y up, the lane runs toward
 * -z from the foul line (z = 0) to the head pin (z = -18.288).
 *
 * Bodies are rigid: position of the centre of mass x, orientation quaternion q, velocity v,
 * angular velocity w (world). Collision shapes are spheres in body space: the ball is one,
 * a pin is a stack of nine following the real pin profile, plus a ring of points on the base so
 * a standing pin sits flat. Contacts are solved with sequential impulses (accumulated, clamped
 * normal impulses, Coulomb friction, restitution) at a fixed 480 Hz step.
 */
(function (root) {
  'use strict';
  const G = 9.81;

  // ------------------------------------------------------------------ lane geometry (USBC sizes)
  const LANE = {
    HALF: 0.527,          // lane half width (41.5 in)
    GUTTER_X: 0.765,      // outer edge of the gutter = kickback wall
    GUTTER_Y: -0.075,     // gutter floor
    HEAD_Z: -18.288,      // head pin spot, 60 ft from the foul line
    ROW: 0.2639,          // distance between pin rows
    SPACING: 0.3048,      // pin centres 12 in apart
    PIT_Z: -19.16,        // end of the pin deck
    PIT_Y: -0.6,
    BACK_Z: -20.25,       // pit cushion
    OIL_END: -12.2,       // oil pattern 40 ft (a typical house shot)
    DRY_Z: -14.2,         // fully dry from here (the oil tapers off over ~2 m)
    MU_OIL: 0.02, MU_DRY: 0.2, MU_DECK: 0.22, MU_APPROACH: 0.22,
    APPROACH_END: 4.6,    // the approach runs from the foul line back to here (+z)
  };
  /**
   * Gutter bumpers (an option): a rail over each gutter, its inner face on the lane edge, from
   * just past the foul line to the end of the pin deck. Top 0.17 m (over the ball's equator at
   * 0.1085, so a rolling ball meets the face square on; a lofted ball can land on the top).
   * Moulded plastic rails on a spring frame: the ball comes back off at ~0.45 of its sideways
   * speed (a soft thud, not a ricochet), pins at 0.5; little friction along the face.
   */
  const BUMPER = { X: LANE.HALF, W: 0.07, TOP: 0.17, Z0: -0.1, Z1: LANE.PIT_Z, E_BALL: 0.45, E_PIN: 0.5, MU: 0.12 };
  /** Friction between ball/pins and the floor at (x, z). */
  function mu(x, z) {
    if (z > 0) return LANE.MU_APPROACH;
    if (z < LANE.HEAD_Z + 0.6) return LANE.MU_DECK;
    if (z > LANE.OIL_END) return LANE.MU_OIL;
    if (z < LANE.DRY_Z) return LANE.MU_DRY;
    const k = (LANE.OIL_END - z) / (LANE.OIL_END - LANE.DRY_Z);
    return LANE.MU_OIL + (LANE.MU_DRY - LANE.MU_OIL) * k * k * (3 - 2 * k);
  }
  function floorY(x, z) {
    if (z > 0) return 0;                 // the approach: one flat floor, no gutters
    if (z < LANE.PIT_Z) return LANE.PIT_Y;
    if (Math.abs(x) > LANE.HALF) return LANE.GUTTER_Y;
    return 0;
  }

  /** Pin spot n (1..10) -> {x, z}. Standard triangle, head pin toward the bowler. */
  const SPOT_ROW = [0, 1, 1, 2, 2, 2, 3, 3, 3, 3];
  const SPOT_COL = [0, -1, 1, -2, 0, 2, -3, -1, 1, 3];
  function pinSpot(n) {
    return { x: SPOT_COL[n - 1] * LANE.SPACING / 2, z: LANE.HEAD_Z - SPOT_ROW[n - 1] * LANE.ROW };
  }

  // ------------------------------------------------------------------ pin and ball
  // Pin outline (height above base, radius), from the regulation profile (inches -> metres)
  const PIN_PROFILE = [
    [0, 0.0258], [0.019, 0.0359], [0.057, 0.0496], [0.0857, 0.0573], [0.1143, 0.0605], [0.149, 0.0580],
    [0.184, 0.0475], [0.219, 0.0311], [0.238, 0.0250], [0.254, 0.0228], [0.276, 0.0239], [0.305, 0.0295],
    [0.343, 0.0323], [0.368, 0.0250], [0.381, 0.0],
  ];
  const PIN_SPHERES = [ // [height above base, radius]
    [0.045, 0.042], [0.088, 0.056], [0.122, 0.060], [0.162, 0.054], [0.203, 0.038],
    [0.249, 0.024], [0.29, 0.027], [0.335, 0.032], [0.358, 0.024],
  ];
  const PIN = { MASS: 1.53, HEIGHT: 0.381 };
  // centre of mass and inertia of the outline as a solid of revolution, scaled to the real mass
  (function pinMassProps() {
    let vol = 0, my = 0;
    const slices = [];
    for (let i = 0; i < PIN_PROFILE.length - 1; i++) {
      const [y0, r0] = PIN_PROFILE[i], [y1, r1] = PIN_PROFILE[i + 1];
      for (let k = 0; k < 10; k++) {
        const ya = y0 + (y1 - y0) * k / 10, yb = y0 + (y1 - y0) * (k + 1) / 10;
        const r = r0 + (r1 - r0) * (k + 0.5) / 10, h = yb - ya, dv = Math.PI * r * r * h, yc = (ya + yb) / 2;
        slices.push({ r, h, dv, yc }); vol += dv; my += dv * yc;
      }
    }
    const com = my / vol, rho = PIN.MASS / vol;
    let Iy = 0, Ix = 0;
    for (const s of slices) {
      const dm = s.dv * rho;
      Iy += 0.5 * dm * s.r * s.r;
      Ix += dm * (s.r * s.r / 4 + s.h * s.h / 12) + dm * (s.yc - com) * (s.yc - com);
    }
    PIN.COM = com; PIN.IX = Ix; PIN.IY = Iy;
  })();
  // 15 lb (6.8 kg) house ball by default; 16 lb = 7.26 kg. I = 0.38 m R^2: a little under a
  // uniform sphere (dense core), as real balls (RG ~2.5 in).
  const BALL = { R: 0.1085, MASS: 6.8, MASS_16LB: 7.257, K_I: 0.38 };
  BALL.I = BALL.K_I * BALL.MASS * BALL.R * BALL.R;
  // Restitution (normal rebound speed / impact speed).
  //  - ball-pin 0.65, pin-pin 0.55: hard maple under a plastic (surlyn/nylon) coat;
  //  - ball on the lane / approach: a urethane or reactive shell on a lacquered synthetic or
  //    maple surface rebounds at roughly 0.2-0.4 from a vertical drop: 0.36 at 1 m/s easing to
  //    ~0.28 at 4 m/s (harder hits lose more in the shell and the lane);
  //  - pin on the deck: ~0.45 (hollow-cored maple, hard coat: pins hop and clatter), its base 0.35;
  //  - the pit: rubber mat floor (ball 0.3, pins 0.35), padded cushion / curtain 0.2;
  //  - kickbacks (laminate panels): ball 0.25, pins 0.45.
  // Below BOUNCE_MIN of impact speed nothing rebounds (a ball set down just lands).
  const E = { BALL_PIN: 0.65, PIN_PIN: 0.55, BALL_FLOOR: 0.36, BALL_FLOOR_K: 0.09, PIN_FLOOR: 0.45, PIN_BASE: 0.35,
    PIT_BALL: 0.3, PIT_PIN: 0.35, CUSHION: 0.2, WALL_BALL: 0.25, WALL_PIN: 0.45, BOUNCE_MIN: 0.3 };

  // ------------------------------------------------------------------ small vector helpers
  function qrot(q, x, y, z, out) {
    // v' = v + 2w(u x v) + 2 u x (u x v), u = q.xyz
    const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    out[0] = x + qw * tx + (qy * tz - qz * ty);
    out[1] = y + qw * ty + (qz * tx - qx * tz);
    out[2] = z + qw * tz + (qx * ty - qy * tx);
    return out;
  }
  function qrotInv(q, x, y, z, out) { return qrot([-q[0], -q[1], -q[2], q[3]], x, y, z, out); }
  const T1 = [0, 0, 0], T2 = [0, 0, 0];
  /** out = I_world^-1 * (x, y, z) for body b. */
  function invI(b, x, y, z, out) {
    if (b.isSphere) { out[0] = x * b.iI[0]; out[1] = y * b.iI[0]; out[2] = z * b.iI[0]; return out; }
    qrotInv(b.q, x, y, z, T1);
    T1[0] *= b.iI[0]; T1[1] *= b.iI[1]; T1[2] *= b.iI[2];
    return qrot(b.q, T1[0], T1[1], T1[2], out);
  }

  // ------------------------------------------------------------------ bodies
  let nextId = 1;
  function makePin(n, x, z) {
    const spheres = PIN_SPHERES.map(([h, r]) => [0, h - PIN.COM, 0, r]);
    const base = [];
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; base.push([Math.cos(a) * 0.024, -PIN.COM, Math.sin(a) * 0.024]); }
    return {
      id: nextId++, kind: 'pin', n, m: PIN.MASS, im: 1 / PIN.MASS, iI: [1 / PIN.IX, 1 / PIN.IY, 1 / PIN.IX],
      x: [x, PIN.COM, z], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0],
      spheres, base, bound: 0.24, asleep: true, still: 0, gone: false, touched: false, isSphere: false,
      home: { x, z },
    };
  }
  function makeBall(x, y, z, mass) {
    const m = mass || BALL.MASS, I = BALL.K_I * m * BALL.R * BALL.R;
    return {
      id: nextId++, kind: 'ball', m, im: 1 / m, iI: [1 / I, 1 / I, 1 / I],
      x: [x, y, z], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0],
      spheres: [[0, 0, 0, BALL.R]], base: [], bound: BALL.R, asleep: false, still: 0, gone: false, isSphere: true,
      gutter: false, hitPins: false,
    };
  }

  /** A fresh simulation. o.bumpers: gutter bumpers up (BUMPER). */
  function createSim(o) { return { pins: [], ball: null, t: 0, events: [], contacts: [], acc: 0, bumpers: !!(o && o.bumpers) }; }

  /** Stand pins. which: array of pin numbers (default all ten), or an array of {n, x, z}. */
  function rack(sim, which) {
    const list = which || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    sim.pins = list.map(p => {
      if (typeof p === 'number') { const s = pinSpot(p); return makePin(p, s.x, s.z); }
      return makePin(p.n, p.x, p.z);
    });
    return sim.pins;
  }
  /** Release a ball: position {x, y (centre height, default resting on the floor), z}, velocity v [3], spin w [3], mass (kg, default 6.8). */
  function launch(sim, o) {
    const b = makeBall(o.x, o.y != null ? Math.max(BALL.R, o.y) : BALL.R + (o.drop || 0), o.z, o.mass);
    b.v = o.v.slice(); b.w = o.w.slice();
    sim.ball = b;
    return b;
  }

  /** Bodies still simulated: in play, or fallen into the pit and still bouncing there. */
  const live = b => !b.gone || (b.gone === 'pit' && !b.asleep);
  function bodies(sim) {
    const out = [];
    if (sim.ball && live(sim.ball)) out.push(sim.ball);
    for (const p of sim.pins) if (live(p)) out.push(p);
    return out;
  }

  function wake(b) { if (b.asleep) { b.asleep = false; b.still = 0; } }

  // ------------------------------------------------------------------ contact generation
  const WP = [0, 0, 0];
  function addContact(list, a, b, nx, ny, nz, px, py, pz, pen, muv, e) {
    list.push({ a, b, n: [nx, ny, nz], p: [px, py, pz], pen, mu: muv, e, jn: 0, jt: [0, 0, 0] });
  }

  /** A sphere against a bumper rail (cross-section [X, X+W] x [below the lane, TOP]). */
  function bumperContact(b, list, cx, cy, cz, r, isBall) {
    const B = BUMPER;
    if (cz > B.Z0 || cz < B.Z1) return;
    const ax = Math.abs(cx), sg = Math.sign(cx) || 1;
    if (ax + r < B.X || ax - r > B.X + B.W || cy - r > B.TOP) return;
    const e = isBall ? B.E_BALL : B.E_PIN;
    if (ax >= B.X && ax <= B.X + B.W && cy <= B.TOP) {   // inside the rail: out through the nearer face
      if (B.TOP - cy < ax - B.X) addContact(list, b, null, 0, 1, 0, cx, B.TOP, cz, B.TOP - cy + r, B.MU, e);
      else addContact(list, b, null, -sg, 0, 0, sg * B.X, cy, cz, ax - B.X + r, B.MU, e);
      return;
    }
    const px = Math.max(B.X, Math.min(B.X + B.W, ax)), py = Math.min(cy, B.TOP);
    const dx = ax - px, dy = cy - py, d = Math.hypot(dx, dy);
    if (d >= r || d < 1e-9) return;
    addContact(list, b, null, sg * dx / d, dy / d, 0, sg * px, py, cz, r - d, B.MU, e);
  }

  function staticContacts(b, list, sim) {
    const L = LANE, isBall = b.kind === 'ball';
    for (const s of b.spheres) {
      qrot(b.q, s[0], s[1], s[2], WP);
      const cx = b.x[0] + WP[0], cy = b.x[1] + WP[1], cz = b.x[2] + WP[2], r = s[3];
      // floor (the lane, the approach, the gutter, the pit). Below the deck's top a body is in
      // the pit even with its centre a hair in front of the edge (the pit's front wall holds it)
      const pit = cz < L.PIT_Z || (cy < -0.02 && cz < L.PIT_Z + r && Math.abs(cx) < L.GUTTER_X);
      const fy = pit ? L.PIT_Y : floorY(cx, cz);
      // the pit's front wall, under the deck edge
      if (cy < -0.02 && cz + r > L.PIT_Z && cz < L.PIT_Z + r && Math.abs(cx) < L.HALF)
        addContact(list, b, null, 0, 0, -1, cx, cy, L.PIT_Z, cz + r - L.PIT_Z, 0.3, isBall ? E.PIT_BALL : E.PIT_PIN);
      if (cy - r < fy) addContact(list, b, null, 0, 1, 0, cx, fy, cz, fy - (cy - r), pit ? 0.5 : mu(cx, cz),
        isBall ? (pit ? E.PIT_BALL : -1) : (pit ? E.PIT_PIN : E.PIN_FLOOR));
      // lane edges (into the gutter) and the deck edge (into the pit): the corner as a line
      if (Math.abs(cx) > L.HALF && cz > L.PIT_Z && cz < 0 && cy < r) {
        const ex = Math.sign(cx) * L.HALF, dx = cx - ex, dy = cy, d = Math.hypot(dx, dy);
        if (d < r && d > 1e-6) addContact(list, b, null, dx / d, dy / d, 0, ex, 0, cz, r - d, 0.1, 0.1);
      }
      if (cz < L.PIT_Z && Math.abs(cx) < L.HALF && cy < r) {
        const dz = cz - L.PIT_Z, dy = cy, d = Math.hypot(dz, dy);
        if (d < r && d > 1e-6) addContact(list, b, null, 0, dy / d, dz / d, cx, 0, L.PIT_Z, r - d, 0.2, 0.1);
      }
      // gutter walls / kickbacks
      if (Math.abs(cx) + r > L.GUTTER_X) {
        const sg = Math.sign(cx);
        addContact(list, b, null, -sg, 0, 0, sg * L.GUTTER_X, cy, cz, Math.abs(cx) + r - L.GUTTER_X, 0.2, isBall ? E.WALL_BALL : E.WALL_PIN);
      }
      if (sim && sim.bumpers) bumperContact(b, list, cx, cy, cz, r, isBall);
      // pit cushion: a padded board behind a heavy curtain, it soaks up most of the hit
      if (cz - r < L.BACK_Z) addContact(list, b, null, 0, 0, 1, cx, cy, L.BACK_Z, L.BACK_Z - (cz - r), 0.5, E.CUSHION);
    }
    for (const p of b.base) {
      qrot(b.q, p[0], p[1], p[2], WP);
      const px = b.x[0] + WP[0], py = b.x[1] + WP[1], pz = b.x[2] + WP[2];
      const fy = floorY(px, pz);
      if (py < fy) addContact(list, b, null, 0, 1, 0, px, fy, pz, fy - py, pz < L.PIT_Z ? 0.5 : mu(px, pz), pz < L.PIT_Z ? E.PIT_PIN : E.PIN_BASE);
    }
  }

  const SA = [], SB = [];
  function worldSpheres(b, out) {
    out.length = b.spheres.length;
    for (let i = 0; i < b.spheres.length; i++) {
      const s = b.spheres[i];
      qrot(b.q, s[0], s[1], s[2], WP);
      out[i] = [b.x[0] + WP[0], b.x[1] + WP[1], b.x[2] + WP[2], s[3]];
    }
    return out;
  }
  function pairContacts(a, b, list, e, muv) {
    const dx = a.x[0] - b.x[0], dy = a.x[1] - b.x[1], dz = a.x[2] - b.x[2], R = a.bound + b.bound;
    if (dx * dx + dy * dy + dz * dz > R * R) return;
    const A = worldSpheres(a, SA), B = worldSpheres(b, SB);
    for (const s of A) for (const t of B) {
      const ex = s[0] - t[0], ey = s[1] - t[1], ez = s[2] - t[2], rr = s[3] + t[3];
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 >= rr * rr || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), nx = ex / d, ny = ey / d, nz = ez / d;
      // contact point halfway into the overlap
      const k = t[3] - (rr - d) / 2;
      addContact(list, a, b, nx, ny, nz, t[0] + nx * k, t[1] + ny * k, t[2] + nz * k, rr - d, muv, e);
    }
  }

  // ------------------------------------------------------------------ solver
  const ITER = 10, SLOP = 0.001, BETA = 0.3;
  const RA = [0, 0, 0], RB = [0, 0, 0], VA = [0, 0, 0], TMP = [0, 0, 0];
  function velAt(b, r, out) {
    if (!b) { out[0] = out[1] = out[2] = 0; return out; }
    out[0] = b.v[0] + b.w[1] * r[2] - b.w[2] * r[1];
    out[1] = b.v[1] + b.w[2] * r[0] - b.w[0] * r[2];
    out[2] = b.v[2] + b.w[0] * r[1] - b.w[1] * r[0];
    return out;
  }
  function applyImpulse(b, r, px, py, pz, sign) {
    if (!b) return;
    b.v[0] += px * b.im * sign; b.v[1] += py * b.im * sign; b.v[2] += pz * b.im * sign;
    invI(b, r[1] * pz - r[2] * py, r[2] * px - r[0] * pz, r[0] * py - r[1] * px, TMP);
    b.w[0] += TMP[0] * sign; b.w[1] += TMP[1] * sign; b.w[2] += TMP[2] * sign;
  }
  /** Effective mass denominator along unit direction d at offsets ra, rb. */
  function kAlong(c, dx, dy, dz) {
    let k = 0;
    for (const [b, r] of [[c.a, c.ra], [c.b, c.rb]]) {
      if (!b) continue;
      const cx = r[1] * dz - r[2] * dy, cy = r[2] * dx - r[0] * dz, cz = r[0] * dy - r[1] * dx;
      invI(b, cx, cy, cz, TMP);
      const ux = TMP[1] * r[2] - TMP[2] * r[1], uy = TMP[2] * r[0] - TMP[0] * r[2], uz = TMP[0] * r[1] - TMP[1] * r[0];
      k += b.im + ux * dx + uy * dy + uz * dz;
    }
    return k;
  }
  function relVel(c, out) {
    velAt(c.a, c.ra, VA);
    velAt(c.b, c.rb, out);
    out[0] = VA[0] - out[0]; out[1] = VA[1] - out[1]; out[2] = VA[2] - out[2];
    return out;
  }

  const VR = [0, 0, 0];
  function solve(contacts, dt, events) {
    for (const c of contacts) {
      c.ra = [c.p[0] - c.a.x[0], c.p[1] - c.a.x[1], c.p[2] - c.a.x[2]];
      c.rb = c.b ? [c.p[0] - c.b.x[0], c.p[1] - c.b.x[1], c.p[2] - c.b.x[2]] : [0, 0, 0];
      c.kn = kAlong(c, c.n[0], c.n[1], c.n[2]);
      relVel(c, VR);
      const vn = VR[0] * c.n[0] + VR[1] * c.n[1] + VR[2] * c.n[2];
      c.vn0 = vn;
      // e < 0: the ball on the lane, softening with the impact speed
      const e = c.e < 0 ? E.BALL_FLOOR / (1 + E.BALL_FLOOR_K * Math.max(0, -vn - 1)) : c.e;
      c.target = vn < -E.BOUNCE_MIN ? -e * vn : 0;
      // penetration is removed by moving the bodies (pushOut), never by adding velocity: a
      // velocity bias would add energy to every landing
    }
    for (let it = 0; it < ITER; it++) {
      for (const c of contacts) {
        const n = c.n;
        relVel(c, VR);
        const vn = VR[0] * n[0] + VR[1] * n[1] + VR[2] * n[2];
        let dj = (c.target - vn) / c.kn;
        const jn = Math.max(0, c.jn + dj);
        dj = jn - c.jn; c.jn = jn;
        if (dj !== 0) { applyImpulse(c.a, c.ra, n[0] * dj, n[1] * dj, n[2] * dj, 1); applyImpulse(c.b, c.rb, n[0] * dj, n[1] * dj, n[2] * dj, -1); }
        // friction
        relVel(c, VR);
        const vn2 = VR[0] * n[0] + VR[1] * n[1] + VR[2] * n[2];
        const tx = VR[0] - vn2 * n[0], ty = VR[1] - vn2 * n[1], tz = VR[2] - vn2 * n[2];
        const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (vt < 1e-7) continue;
        const ux = tx / vt, uy = ty / vt, uz = tz / vt;
        const kt = kAlong(c, ux, uy, uz);
        const d = -vt / kt;
        let nx = c.jt[0] + ux * d, ny = c.jt[1] + uy * d, nz = c.jt[2] + uz * d;
        const max = c.mu * c.jn, m = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (m > max) { const s = max / m; nx *= s; ny *= s; nz *= s; }
        const px = nx - c.jt[0], py = ny - c.jt[1], pz = nz - c.jt[2];
        c.jt[0] = nx; c.jt[1] = ny; c.jt[2] = nz;
        applyImpulse(c.a, c.ra, px, py, pz, 1); applyImpulse(c.b, c.rb, px, py, pz, -1);
      }
    }
    pushOut(contacts);
    // impacts, for sounds and juice
    for (const c of contacts) {
      if (c.vn0 < -0.4 && c.jn > 0.02) {
        const kind = c.b ? (c.a.kind === 'ball' || c.b.kind === 'ball' ? 'ball-pin' : 'pin-pin') : (c.n[1] > 0.7 ? 'floor' : 'wall');
        events.push({ kind, a: c.a, b: c.b, speed: -c.vn0, j: c.jn, x: c.p[0], y: c.p[1], z: c.p[2] });
      }
    }
  }

  /**
   * Position correction (split impulse): each overlapping contact moves its bodies apart along
   * the normal by part of the overlap, shared by inverse mass. Velocities are untouched, so it
   * can never make anything bounce higher.
   */
  function pushOut(contacts) {
    for (let it = 0; it < 2; it++) {
      for (const c of contacts) {
        const a = c.a, b = c.b;
        const ia = a.im, ib = b ? b.im : 0;
        const d = Math.max(0, c.pen - SLOP) * BETA / (ia + ib) / 2;
        if (d <= 0) continue;
        a.x[0] += c.n[0] * d * ia; a.x[1] += c.n[1] * d * ia; a.x[2] += c.n[2] * d * ia;
        if (b && !b.asleep) { b.x[0] -= c.n[0] * d * ib; b.x[1] -= c.n[1] * d * ib; b.x[2] -= c.n[2] * d * ib; }
        c.pen -= d * (ia + ib);
      }
    }
  }

  function integrate(b, dt) {
    b.x[0] += b.v[0] * dt; b.x[1] += b.v[1] * dt; b.x[2] += b.v[2] * dt;
    const q = b.q, wx = b.w[0], wy = b.w[1], wz = b.w[2];
    const h = 0.5 * dt;
    const nx = q[0] + h * (wx * q[3] + wy * q[2] - wz * q[1]);
    const ny = q[1] + h * (wy * q[3] + wz * q[0] - wx * q[2]);
    const nz = q[2] + h * (wz * q[3] + wx * q[1] - wy * q[0]);
    const nw = q[3] - h * (wx * q[0] + wy * q[1] + wz * q[2]);
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    q[0] = nx / l; q[1] = ny / l; q[2] = nz / l; q[3] = nw / l;
  }

  const DT = 1 / 480;
  /** Advance one fixed step. Events (impacts) of this step are appended to sim.events. */
  function step(sim) {
    const dt = DT, all = bodies(sim), awake = all.filter(b => !b.asleep);
    for (const b of awake) {
      b.v[1] -= G * dt;
      if (b.kind === 'pin') {
        // air drag and a little rolling resistance on the deck
        const lin = b.x[1] < 0.1 ? 0.6 : 0.05, ang = b.x[1] < 0.1 ? 1.2 : 0.1;
        b.v[0] *= 1 - lin * dt; b.v[2] *= 1 - lin * dt;
        b.w[0] *= 1 - ang * dt; b.w[1] *= 1 - ang * dt; b.w[2] *= 1 - ang * dt;
      }
    }
    const list = [];
    for (const b of awake) staticContacts(b, list, sim);
    const ball = sim.ball && !sim.ball.gone ? sim.ball : null;
    if (ball && !ball.gutter && live(ball)) {
      for (const p of sim.pins) {
        if (!live(p)) continue;
        const n = list.length;
        pairContacts(ball, p, list, E.BALL_PIN, 0.17);
        if (list.length > n) { wake(p); p.touched = true; ball.hitPins = true; staticContacts(p, list, sim); }
      }
    }
    for (let i = 0; i < sim.pins.length; i++) {
      const a = sim.pins[i];
      if (!live(a)) continue;
      for (let j = i + 1; j < sim.pins.length; j++) {
        const b = sim.pins[j];
        if (!live(b) || (a.asleep && b.asleep)) continue;
        const n = list.length;
        pairContacts(a, b, list, E.PIN_PIN, 0.25);
        if (list.length > n) {
          for (const p of [a, b]) if (p.asleep) { wake(p); p.touched = true; staticContacts(p, list, sim); }
        }
      }
    }
    const events = sim.events;
    solve(list, dt, events);
    sim.contacts = list;
    for (const b of all) if (!b.asleep) integrate(b, dt);
    // sleeping and leaving play
    for (const b of all) {
      if (b.asleep) continue;
      if (b.gone === 'pit') {
        // out of play, still bouncing in the pit: rests (or is put to rest) there
        b.pitT = (b.pitT || 0) + dt;
        const sv = Math.hypot(b.v[0], b.v[1], b.v[2]);
        if (b.pitT > 3 || (sv < 0.05 && b.pitT > 0.3) || b.x[1] < -2) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; }
        continue;
      }
      if ((b.x[2] < LANE.PIT_Z && b.x[1] < -0.1) || b.x[2] < LANE.BACK_Z - 0.3 || b.x[1] < -2) { b.gone = 'pit'; b.pitT = 0; continue; }
      if (b.kind === 'ball' && b.x[2] > LANE.APPROACH_END - 0.3) { b.gone = 'back'; b.asleep = true; continue; }
      const sv = Math.hypot(b.v[0], b.v[1], b.v[2]), sw = Math.hypot(b.w[0], b.w[1], b.w[2]);
      if (b.kind === 'pin' && sv < 0.04 && sw < 0.35) { b.still += dt; if (b.still > 0.35) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; } }
      else b.still = 0;
      if (b.kind === 'ball') {
        if (Math.abs(b.x[0]) > LANE.HALF && b.x[1] < BALL.R - 0.012 && b.x[2] > LANE.PIT_Z) b.gutter = true;
        if (sv < 0.05 && b.x[1] < BALL.R + 0.01) { b.still += dt; if (b.still > 0.5) b.asleep = true; } else b.still = 0;
      }
    }
    sim.t += dt;
  }

  /** Advance by a frame time (fixed steps inside). Returns this frame's impact events. */
  function advance(sim, frameDt, maxSteps) {
    sim.events = [];
    sim.acc += frameDt;
    let n = 0;
    const cap = maxSteps || 40;
    while (sim.acc >= DT && n < cap) { step(sim); sim.acc -= DT; n++; }
    if (n >= cap) sim.acc = 0;
    return sim.events;
  }

  /** Pin's own up axis in the world. */
  function pinUp(p) { return qrot(p.q, 0, 1, 0, [0, 0, 0]); }
  /** Still standing on the deck (counts as not knocked down). */
  function standing(p) {
    if (p.gone) return false;
    const u = pinUp(p);
    return u[1] > 0.82 && Math.abs(p.x[0]) < LANE.HALF && p.x[2] > LANE.PIT_Z && p.x[1] > PIN.COM - 0.03 && p.x[1] < PIN.COM + 0.03;
  }
  /** Every pin's fate is clear: standing pins are still, the rest are down (a down pin may
   * still slide or roll in the gutter, but it will not stand up again). */
  function decided(sim) {
    for (const p of sim.pins) {
      if (p.gone || p.asleep) continue;
      if (standing(p) && (Math.hypot(p.w[0], p.w[1], p.w[2]) > 0.5 || Math.hypot(p.v[0], p.v[1], p.v[2]) > 0.08)) return false;
      if (!standing(p) && pinUp(p)[1] > 0.5 && p.x[1] > 0.1) return false;   // still falling over
    }
    return true;
  }
  /** Everything has stopped moving (or left play). */
  function settled(sim) {
    for (const p of sim.pins) if (!p.gone && !p.asleep) return false;
    return true;
  }

  const api = { LANE, BUMPER, PIN, BALL, E, PIN_PROFILE, PIN_SPHERES, DT, mu, floorY, pinSpot, createSim, rack, launch, step, advance, pinUp, standing, settled, decided, qrot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.BW = root.BW || {}; root.BW.Phys = api; }
})(typeof window !== 'undefined' ? window : null);
