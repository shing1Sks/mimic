/*
 * Duskwater - gulls, the afterlife. A player who dies comes back as a harbour gull for the rest of
 * the round: it flies over the depot, marks every enemy it can see for its team (through walls, on
 * their screens and radar, and it tells bot teammates), and it can dive at one enemy to blind them
 * for a moment. Gulls can be shot out of the sky; they come back a few seconds later.
 *
 * Top half: pure flight, collision and targeting math (runs in Node for the tests). Bottom half:
 * the gull's body, built from a handful of low-poly three.js meshes, with flapping wings.
 * Classic script: window.ArenaGull. Node: module.exports.
 */
(function (root) {
  'use strict';
  const DEG = Math.PI / 180;

  const GULL = {
    riseAfter: 1.6,          // seconds of death cam before the gull lifts off the body
    speed: 11,               // cruise, m/s
    accel: 4.5,              // how quickly velocity follows the stick (1/s)
    climbRate: 6.5,          // A / Space up, B / Ctrl down (m/s)
    cruise: 9,               // height the gull rises to when it spawns
    minClear: 2.4,           // never lower than this over the floor (or a container top) while flying
    maxY: 22,
    radius: 0.42,            // collision with the level
    spotRange: 40, spotCos: 0.5, spotHold: 2.2, // what the gull sees gets marked for spotHold s
    lockRange: 30, lockCone: 13 * DEG,         // dive target: nearest to the crosshair inside this cone
    diveSpeed: 25, diveMax: 1.6, diveTurn: 7, hitRadius: 1.2,
    swoopSpeed: 21, swoopTime: 0.45,           // no target: a short dash instead
    cooldown: 6, swoopCooldown: 1.2,
    blind: 1.7,              // how long a dive blinds a player (bots lose their aim as long)
    assistWindow: 5, assistCash: 200,          // victim dies this soon after: assist + cash to the gull
    shotRadius: 0.55,        // gulls are a target too
    downTime: 4,             // shot down: back in the air after this
    bounds: { x0: -45, x1: 45, z0: -38, z1: 29.5 },
  };

  /** A fresh gull rising from (x, y, z). */
  function create(team, x, y, z, yaw) {
    return { team, x, y, z, vx: 0, vy: 7, vz: 0, yaw: yaw || 0, heading: yaw || 0, mode: 'rise', t: 0, cd: 0, target: null, blinds: 0 };
  }

  /** Push a sphere out of one box along the shallowest axis. Returns true when it touched. */
  function pushOut(g, s, r) {
    const y0 = g.y - r, y1 = g.y + r;
    if (y1 <= s.y0 || y0 >= s.y1) return false;
    const cx = g.x < s.x0 ? s.x0 : g.x > s.x1 ? s.x1 : g.x;
    const cz = g.z < s.z0 ? s.z0 : g.z > s.z1 ? s.z1 : g.z;
    const dx = g.x - cx, dz = g.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    const inside = d2 < 1e-12;
    const side = inside ? Math.min(g.x - s.x0, s.x1 - g.x, g.z - s.z0, s.z1 - g.z) + r : r - Math.sqrt(d2);
    const up = s.y1 - y0, down = y1 - s.y0;
    if (up <= side && up <= down) { g.y += up; if (g.vy < 0) g.vy = 0; return true; }
    if (down <= side) { g.y -= down; if (g.vy > 0) g.vy = 0; return true; }
    if (inside) {
      const o = [[s.x0 - r - g.x, 0], [s.x1 + r - g.x, 0], [0, s.z0 - r - g.z], [0, s.z1 + r - g.z]];
      o.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
      g.x += o[0][0]; g.z += o[0][1];
    } else {
      const d = Math.sqrt(d2), k = (r - d) / d;
      g.x += dx * k; g.z += dz * k;
    }
    return true;
  }

  /** Move by velocity, then keep the gull inside the harbour, out of solids and above the floor. */
  function move(g, dt, map, M) {
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    const b = GULL.bounds;
    if (g.x < b.x0) { g.x = b.x0; g.vx = Math.max(0, g.vx); } else if (g.x > b.x1) { g.x = b.x1; g.vx = Math.min(0, g.vx); }
    if (g.z < b.z0) { g.z = b.z0; g.vz = Math.max(0, g.vz); } else if (g.z > b.z1) { g.z = b.z1; g.vz = Math.min(0, g.vz); }
    let touched = false;
    if (map) {
      for (const s of map.solids) if (s.kind !== 'invisible' && pushOut(g, s, GULL.radius)) touched = true;
      if (M) {
        // over the water (north of the quay) the floor is the sea, a little below the quay
        const floor = g.z < -30.5 ? -1.2 : M.groundHeight(map, g.x, g.z, g.y);
        const clear = g.mode === 'dive' ? 0.9 : GULL.minClear;
        if (g.y < floor + clear) { g.y = floor + clear; if (g.vy < 0) g.vy = 0; }
      }
    }
    if (g.y > GULL.maxY) { g.y = GULL.maxY; if (g.vy > 0) g.vy = 0; }
    return touched;
  }

  /**
   * Free flight. inp: { mx, my (stick, my + = forward), yaw (camera yaw), climb (-1..1) }.
   * Movement is relative to where the camera looks, like walking.
   */
  function fly(g, inp, dt, map, M) {
    const fx = -Math.sin(inp.yaw), fz = -Math.cos(inp.yaw), rx = Math.cos(inp.yaw), rz = -Math.sin(inp.yaw);
    let tx = rx * inp.mx + fx * inp.my, tz = rz * inp.mx + fz * inp.my;
    const l = Math.hypot(tx, tz); if (l > 1) { tx /= l; tz /= l; }
    const k = 1 - Math.exp(-GULL.accel * dt);
    g.vx += (tx * GULL.speed - g.vx) * k; g.vz += (tz * GULL.speed - g.vz) * k;
    g.vy += (inp.climb * GULL.climbRate - g.vy) * (1 - Math.exp(-6 * dt));
    return move(g, dt, map, M);
  }

  /** Spawn climb: straight up to cruise height, steering allowed. Returns true once there. */
  function rise(g, inp, dt, map, M) {
    const floor = M && map ? M.groundHeight(map, g.x, g.z, g.y) : 0;
    const want = Math.max(GULL.cruise, floor + 5);
    fly(g, Object.assign({}, inp, { climb: 0 }), dt, map, M);
    g.vy = g.y < want ? Math.max(g.vy, 7) : 0;
    return g.y >= want;
  }

  /** Homing dive toward (tx, ty, tz): the gull can turn, but not instantly. 'hit' | 'bonk' (flew into the level) | 'flying'. */
  function diveStep(g, tx, ty, tz, dt, map, M) {
    const dx = tx - g.x, dy = ty - g.y, dz = tz - g.z, d = Math.hypot(dx, dy, dz);
    if (d < GULL.hitRadius) return 'hit';
    const sp = GULL.diveSpeed, k = 1 - Math.exp(-GULL.diveTurn * dt);
    let vx = g.vx + (dx / d * sp - g.vx) * k, vy = g.vy + (dy / d * sp - g.vy) * k, vz = g.vz + (dz / d * sp - g.vz) * k;
    const vl = Math.hypot(vx, vy, vz) || 1;
    g.vx = vx / vl * sp; g.vy = vy / vl * sp; g.vz = vz / vl * sp;
    const touched = move(g, dt, map, M);
    if (Math.hypot(tx - g.x, ty - g.y, tz - g.z) < GULL.hitRadius) return 'hit';
    return touched ? 'bonk' : 'flying';
  }

  /**
   * Which foe a dive goes for: inside the lock cone around the camera ray, in range, in sight;
   * the one closest to the crosshair. foes: [{ x, y, z }] (aim points). los(i) -> bool. Index or -1.
   */
  function pickDiveTarget(g, dir, foes, los) {
    let best = -1, bestScore = Infinity;
    foes.forEach((f, i) => {
      const dx = f.x - g.x, dy = f.y - g.y, dz = f.z - g.z, d = Math.hypot(dx, dy, dz);
      if (d > GULL.lockRange || d < 1e-6) return;
      const a = Math.acos(Math.max(-1, Math.min(1, (dx * dir.x + dy * dir.y + dz * dir.z) / d)));
      // a close foe fills more of the screen: its cone grows by half its angular size
      const slack = Math.atan2(0.8, d) * 0.5;
      if (a > GULL.lockCone + slack || a - slack >= bestScore || (los && !los(i))) return;
      best = i; bestScore = a - slack;
    });
    return best;
  }

  /** Is a foe inside what the gull is looking at (range and view cone; line of sight is the caller's)? */
  function canSpot(g, dir, f) {
    const dx = f.x - g.x, dy = f.y - g.y, dz = f.z - g.z, d = Math.hypot(dx, dy, dz);
    if (d > GULL.spotRange) return false;
    if (d < 4) return true;
    return (dx * dir.x + dy * dir.y + dz * dir.z) / d > GULL.spotCos;
  }

  /** Ray (unit d) against a gull's body sphere: distance or -1. */
  function rayHitsGull(g, ox, oy, oz, dx, dy, dz, maxT) {
    const lx = ox - g.x, ly = oy - g.y, lz = oz - g.z, r = GULL.shotRadius;
    const b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - r * r, disc = b * b - c;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < maxT ? t : -1;
  }

  /** Assist: did this victim die soon enough after a gull blinded them? */
  const earnsAssist = (blindedAt, now) => blindedAt != null && now - blindedAt <= GULL.assistWindow;

  const api = { GULL, create, pushOut, move, fly, rise, diveStep, pickDiveTarget, canSpot, rayHitsGull, earnsAssist };

  // ---------------------------------------------------------------- the bird (browser only)

  const T = root && root.THREE;
  if (T) {
    const mats = {};
    const mat = (hex, opts) => {
      const k = hex + (opts ? JSON.stringify(opts) : '');
      return mats[k] || (mats[k] = new T.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.78, metalness: 0, flatShading: true }, opts)));
    };
    /** A flat wing panel from outline points in the wing's own plane: x outward, z back. */
    const panel = pts => {
      const s = new T.Shape();
      pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
      const g = new T.ShapeGeometry(s);
      g.rotateX(-Math.PI / 2);
      return g;
    };
    let shadowTex = null;
    const geos = {};
    function shared() {
      if (geos.body) return geos;
      // body: a teardrop turned along -z, a little flattened
      const prof = [[0, -0.36], [0.05, -0.3], [0.1, -0.16], [0.135, 0], [0.13, 0.12], [0.1, 0.22], [0.05, 0.29], [0, 0.31]].map(([r, y]) => new T.Vector2(r, y));
      geos.body = new T.LatheGeometry(prof, 9); geos.body.rotateX(-Math.PI / 2); geos.body.scale(1, 0.85, 1);
      geos.head = new T.IcosahedronGeometry(0.095, 1);
      geos.beak = new T.ConeGeometry(0.026, 0.13, 5); geos.beak.rotateX(-Math.PI / 2);
      geos.eye = new T.IcosahedronGeometry(0.016, 0);
      geos.tail = panel([[-0.09, 0], [0.09, 0], [0.07, 0.17], [0, 0.15], [-0.07, 0.17]]);
      // inner wing (shoulder to wrist) and outer wing (wrist to tip), each a tapered blade
      geos.inner = panel([[0, -0.1], [0.36, -0.07], [0.38, 0.1], [0, 0.15]]);
      geos.outer = panel([[0, -0.07], [0.3, -0.02], [0.44, 0.08], [0.2, 0.1], [0, 0.1]]);
      geos.tip = panel([[0.24, -0.015], [0.3, -0.02], [0.44, 0.08], [0.3, 0.095], [0.22, 0.1]]);
      geos.tip.translate(0, 0.004, 0);
      return geos;
    }

    /** One gull. team tints the wing tips (Wardens teal, Corsairs rust) so friend and foe read at range. */
    function makeGull(team, tint) {
      const g = shared();
      const white = mat(0xf2efe8), grey = mat(0x8f99a5, { side: T.DoubleSide }), under = mat(0xe4e1da, { side: T.DoubleSide });
      const tip = mat(tint != null ? tint : (team ? 0x6e3a1c : 0x1f4f5c), { side: T.DoubleSide });
      const root = new T.Group(); root.rotation.order = 'YXZ';
      const body = new T.Group(); root.add(body);
      const torso = new T.Mesh(g.body, white); body.add(torso);
      const back = new T.Mesh(g.body, mat(0xb7bec6)); back.scale.set(0.9, 0.5, 0.86); back.position.y = 0.045; body.add(back);
      const head = new T.Mesh(g.head, white); head.position.set(0, 0.07, -0.32); body.add(head);
      const beak = new T.Mesh(g.beak, mat(0xf0b93a)); beak.position.set(0, 0.05, -0.44); body.add(beak);
      [-1, 1].forEach(s => { const e = new T.Mesh(g.eye, mat(0x111214)); e.position.set(0.062 * s, 0.1, -0.37); body.add(e); });
      const tail = new T.Mesh(g.tail, white); tail.position.set(0, 0.01, 0.28); body.add(tail);
      const wings = [-1, 1].map(s => {
        const shoulder = new T.Group(); shoulder.position.set(0.07 * s, 0.05, -0.06); shoulder.scale.x = s; body.add(shoulder);
        shoulder.add(new T.Mesh(g.inner, grey));
        const lowIn = new T.Mesh(g.inner, under); lowIn.position.y = -0.006; shoulder.add(lowIn);
        const wrist = new T.Group(); wrist.position.x = 0.36; shoulder.add(wrist);
        wrist.add(new T.Mesh(g.outer, grey));
        const lowOut = new T.Mesh(g.outer, under); lowOut.position.y = -0.006; wrist.add(lowOut);
        wrist.add(new T.Mesh(g.tip, tip));
        return { shoulder, wrist, s };
      });
      root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      return {
        root, body, wings, phase: Math.random() * 6, bank: 0, pitch: 0,
        /** Pose from the gull state: flapping while climbing or slow, gliding at cruise, folded in a dive. */
        update(st, dt) {
          root.position.set(st.x, st.y, st.z);
          const sp = Math.hypot(st.vx, st.vz);
          // body faces where it flies, banks into turns
          let want = st.heading;
          if (sp > 0.8 && st.mode !== 'down') want = Math.atan2(-st.vx, -st.vz);
          else if (st.look && st.mode !== 'down') want = st.look.yaw; // hovering: face where the player looks
          let dy = want - root.rotation.y; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
          root.rotation.y += dy * Math.min(1, dt * 6);
          st.heading = root.rotation.y;
          this.bank += (Math.max(-0.7, Math.min(0.7, dy * 1.4)) - this.bank) * Math.min(1, dt * 5);
          const pitchWant = st.mode === 'dive' ? Math.atan2(st.vy, Math.hypot(st.vx, st.vz)) : Math.max(-0.4, Math.min(0.4, st.vy * 0.05));
          this.pitch += (pitchWant - this.pitch) * Math.min(1, dt * 8);
          root.rotation.x = this.pitch; root.rotation.z = this.bank;
          const flapping = st.mode === 'rise' || st.vy > 1 || sp < 4 || st.mode === 'recover';
          this.phase += dt * (flapping ? 13 : 5);
          const fold = st.mode === 'dive' ? 1 : 0;
          const amp = fold ? 0.05 : flapping ? 0.55 : 0.12;
          for (const w of this.wings) {
            const f = Math.sin(this.phase);
            // the shoulder's own rotation applies after its mirror (scale.x = s), so it flips per side;
            // the wrist lives inside the mirrored space and needs no flip
            w.shoulder.rotation.z = w.s * ((0.12 + f * amp) * (1 - fold) + fold * 0.55);
            w.shoulder.rotation.y = -w.s * fold * 0.95;
            w.wrist.rotation.z = (Math.sin(this.phase - 0.9) * amp * 0.6 - 0.05) * (1 - fold) - fold * 0.9;
            w.wrist.rotation.y = -fold * 0.6;
          }
          if (st.mode === 'down') { root.rotation.z = st.t * 9; root.rotation.x = -0.9; }
        },
      };
    }

    /** The round soft shadow a gull drops on the ground. */
    function makeShadow() {
      if (!shadowTex) {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
        shadowTex = new T.CanvasTexture(c);
      }
      const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.rotation.x = -Math.PI / 2;
      return m;
    }

    /** The marker over an enemy a gull has spotted: a bright diamond seen through walls, by the gull's team. */
    let markTex = null;
    function makeSpotMark() {
      if (!markTex) {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const x = c.getContext('2d');
        x.translate(32, 32);
        x.strokeStyle = 'rgba(20,6,4,0.85)'; x.lineWidth = 9;
        x.beginPath(); x.moveTo(0, -22); x.lineTo(18, 0); x.lineTo(0, 22); x.lineTo(-18, 0); x.closePath(); x.stroke();
        x.strokeStyle = '#ff5a3c'; x.lineWidth = 5; x.stroke();
        x.fillStyle = '#ffd2a0'; x.beginPath(); x.moveTo(0, -8); x.lineTo(7, 0); x.lineTo(0, 8); x.lineTo(-7, 0); x.closePath(); x.fill();
        markTex = new T.CanvasTexture(c);
      }
      // fixed size on screen: a mark across the map reads as well as one next door
      const s = new T.Sprite(new T.SpriteMaterial({ map: markTex, depthTest: false, transparent: true, fog: false, sizeAttenuation: false }));
      s.scale.set(0.04, 0.04, 1); s.renderOrder = 6; s.visible = false;
      return s;
    }

    api.makeGull = makeGull;
    api.makeShadow = makeShadow;
    api.makeSpotMark = makeSpotMark;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaGull = api;
})(typeof window !== 'undefined' ? window : this);
