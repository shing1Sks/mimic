/*
 * GYROWING flight model: a light single-prop trainer (generic low-wing, retractable tricycle gear).
 * Pure JS, no DOM or three.js: loads in the browser (window.FM) and in Node (require).
 *
 * Frames
 *   world    three.js: x east, y up, z south (heading 0 = north = -z, 90 = east = +x)
 *   body     three.js style: right +x, up +y, forward -z. state.quat rotates body -> world.
 *   aero     classic flight dynamics: x forward, y right, z down. Coefficients, wheel positions
 *            and state.omega (p, q, r) live here. a2b / b2a convert between aero and body.
 *
 * Model
 *   Lift from angle of attack (linear to the critical AoA, then a stall that loses ~30% of the
 *   lift and blends into flat-plate behaviour), parasitic + induced drag (ground effect reduces
 *   induced drag), propeller thrust falling with airspeed and density, gravity.
 *   Stability derivatives give moments: control surfaces, static stability, rate damping,
 *   dihedral, weathercock, adverse yaw, P-factor. Stalling kills roll damping and drops a wing.
 *   Wheels are spring-damper struts with rolling, braking and side friction, nosewheel steering.
 *   Non-wheel points (prop, belly, wingtips, tail) detect crashes and scrapes.
 */
(function (root) {
  'use strict';
  const G = 9.80665, RHO0 = 1.225, DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const AIRCRAFT = {
    name: 'GW-1 Wren-class trainer',
    mass: 1050, S: 16.2, b: 11.0, c: 1.5, e: 0.8,
    Ixx: 1285, Iyy: 1825, Izz: 2667,
    thrustStatic: 3100, propVmax: 90, idle: 0.05, spool: 0.6,
    CL0: 0.22, CLa: 5.0, alphaCrit: 15 * DEG, alphaCritNeg: -13 * DEG,
    CD0: 0.027, gearCD: 0.012, flapCD: 0.05, flapCL: 0.6, flapAlphaLoss: 1.5 * DEG,
    CYb: -0.4, CYdr: 0.12,
    Clb: -0.1, Clp: -0.47, Clr: 0.1, Clda: 0.065,
    Cm0: 0.035, Cma: -0.9, Cmq: -16, Cmde: 0.37, Cmflap: -0.07,
    Cnb: 0.07, Cnr: -0.1, Cnp: -0.04, Cndr: 0.075, Cnda: -0.012, pFactor: 0.005,
    propWash: 0.06,
    flapDetents: [0, 1 / 3, 2 / 3, 1], flapRate: 0.22, gearTime: 6,
    maxSteer: 11 * DEG,
    // aero frame (x fwd, y right, z down) metres from the CG; z = strut bottom at full extension
    wheels: [
      { name: 'nose', p: { x: 1.7, y: 0, z: 1.25 }, k: 40000, c: 3000, nose: true },
      { name: 'left', p: { x: -0.35, y: -1.4, z: 1.3 }, k: 60000, c: 5000 },
      { name: 'right', p: { x: -0.35, y: 1.4, z: 1.3 }, k: 60000, c: 5000 },
    ],
    gearTravel: 0.35,
    points: [
      { name: 'prop', p: { x: 2.15, y: 0, z: 0.9 } },
      { name: 'nose', p: { x: 1.5, y: 0, z: 0.45 } },
      { name: 'belly', p: { x: 0.6, y: 0, z: 0.8 } },
      { name: 'belly', p: { x: -1.6, y: 0, z: 0.7 } },
      { name: 'tail', p: { x: -5.6, y: 0, z: -0.12 } },
      { name: 'wing', p: { x: -0.4, y: -5.5, z: 0.0 } },
      { name: 'wing', p: { x: -0.4, y: 5.5, z: 0.0 } },
      { name: 'fin', p: { x: -6.0, y: 0, z: -1.6 } },
    ],
  };
  AIRCRAFT.AR = AIRCRAFT.b * AIRCRAFT.b / AIRCRAFT.S;
  AIRCRAFT.k = 1 / (Math.PI * AIRCRAFT.e * AIRCRAFT.AR);

  // ---------------------------------------------------------------- math
  const v3 = (x, y, z) => ({ x, y, z });
  const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
  const scale = (a, k) => v3(a.x * k, a.y * k, a.z * k);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const len = a => Math.sqrt(dot(a, a));
  const a2b = v => v3(v.y, -v.z, -v.x);
  const b2a = v => v3(-v.z, v.x, -v.y);
  function qmul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }
  function qrot(q, v) {
    // v' = v + 2w(u x v) + 2 u x (u x v)
    const u = v3(q.x, q.y, q.z);
    const t = scale(cross(u, v), 2);
    return add(add(v, scale(t, q.w)), cross(u, t));
  }
  function qnorm(q) { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; q.x /= l; q.y /= l; q.z /= l; q.w /= l; return q; }
  function qFromEuler(yaw, pitch, roll) { // 'YXZ' like three.js
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
    return qmul(qmul({ x: 0, y: sy, z: 0, w: cy }, { x: sp, y: 0, z: 0, w: cp }), { x: 0, y: 0, z: sr, w: cr });
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- atmosphere / aero
  const density = alt => RHO0 * Math.exp(-Math.max(0, alt) / 9500);

  function alphaCritFor(flap) { return AIRCRAFT.alphaCrit - AIRCRAFT.flapAlphaLoss * flap; }

  /** Lift coefficient vs angle of attack (rad) and flap fraction 0..1. */
  function liftCoefficient(alpha, flap) {
    const A = AIRCRAFT;
    const ac = alphaCritFor(flap || 0), an = A.alphaCritNeg;
    const cl0 = A.CL0 + A.flapCL * (flap || 0);
    const lin = a => cl0 + A.CLa * a;
    const flat = 1.15 * Math.sin(2 * alpha);
    if (alpha >= an && alpha <= ac) return lin(alpha);
    const x = alpha > ac ? alpha - ac : an - alpha;
    const edge = alpha > ac ? lin(ac) : lin(an);
    const u = Math.min(1, x / (2 * DEG)), t = smoothstep(0, 12 * DEG, x);
    return (1 - t) * edge * (1 - 0.32 * u) + t * flat;
  }
  /** 0 below the stall, rising to 1 a few degrees past the critical AoA. */
  function stallFactor(alpha, flap) {
    const ac = alphaCritFor(flap || 0), an = AIRCRAFT.alphaCritNeg;
    return Math.max(smoothstep(ac - 1 * DEG, ac + 4 * DEG, alpha), smoothstep(-an - 1 * DEG, -an + 4 * DEG, -alpha));
  }
  function dragCoefficient(CL, alpha, beta, flap, gear, geFactor) {
    const A = AIRCRAFT;
    const st = stallFactor(alpha, flap);
    const sa = Math.sin(alpha);
    return A.CD0 + A.gearCD * gear + A.flapCD * flap * flap + A.k * CL * CL * geFactor +
      st * 1.6 * sa * sa + 0.5 * beta * beta;
  }
  function thrustAt(power, V, rho) {
    const A = AIRCRAFT;
    return power * A.thrustStatic * Math.max(0, 1 - V / A.propVmax) * (rho / RHO0);
  }
  /**
   * Ground effect for a wing h metres above the surface: { induced: factor on induced drag
   * (McCormick), lift: factor on the lift coefficient (the "float" in a flare) }.
   */
  function groundEffect(h) {
    const r = 16 * Math.max(0.05, h) / AIRCRAFT.b, ge = r * r;
    return { induced: ge / (1 + ge), lift: 1 + 0.12 * Math.exp(-Math.max(0, h) / (0.25 * AIRCRAFT.b)) };
  }
  /** Wind shear: fraction of the free-stream wind felt h metres above the ground (log profile). */
  function windProfile(h) {
    const z0 = 0.05, zRef = 150;
    return clamp(Math.log(Math.max(h, 0.3) / z0) / Math.log(zRef / z0), 0.15, 1);
  }
  const powerFromThrottle = thr => AIRCRAFT.idle + (1 - AIRCRAFT.idle) * clamp(thr, 0, 1);

  // ---------------------------------------------------------------- state
  function controls() {
    return { elevator: 0, aileron: 0, rudder: 0, throttle: 0, trim: 0, brake: 0, flaps: 0, gear: true };
  }

  function baseState(seed) {
    return {
      pos: v3(0, 0, 0), vel: v3(0, 0, 0), quat: { x: 0, y: 0, z: 0, w: 1 }, omega: v3(0, 0, 0),
      power: AIRCRAFT.idle, rpm: 700, flap: 0, flapCmd: 0, gear: 1, gearCmd: true,
      alpha: 0, beta: 0, airspeed: 0, tas: 0, CL: 0, stall: 0, stalled: false, stallWarn: false,
      gload: 1, agl: 0, onGround: false, wheelsDown: [false, false, false], contacts: 0,
      airTime: 0, groundSpeed: 0, rollSpeed: 0, scraping: false,
      crashed: false, crashReason: '', events: [], dropSign: 0, buffet: v3(0, 0, 0), gust: v3(0, 0, 0), gustRoll: 0, turb: 0, ap: null,
      surfaces: { elevator: 0, aileron: 0, rudder: 0 },
      rng: mulberry(seed || 12345), time: 0, trim: null,
    };
  }

  /** Parked on the ground at (x, z) facing heading (deg), wheels on a surface at `elevation`. */
  function groundState(o) {
    const s = baseState(o.seed);
    const h = (o.heading || 0) * DEG;
    // level the struts: nose and mains at their static compression
    s.quat = qFromEuler(-h, 0, 0);
    s.pos = v3(o.x || 0, (o.elevation || 0) + 1.3 - 0.07, o.z || 0);
    s.onGround = true; s.contacts = 3;
    return s;
  }

  /**
   * Find steady straight flight at a true airspeed. Give either gamma (flight path, degrees;
   * the throttle is solved) or throttle (0..1; the flight path is solved).
   */
  function solveTrim(o) {
    const A = AIRCRAFT;
    const V = o.speed, rho = density(o.alt || 0), flap = A.flapDetents[o.flaps || 0];
    const gear = o.gear === false ? 0 : 1;
    const qS = 0.5 * rho * V * V * A.S, W = A.mass * G;
    const fixGamma = o.throttle === undefined;
    let gamma = fixGamma ? (o.gamma || 0) * DEG : 0, thr = fixGamma ? 0.5 : o.throttle, alpha = 0.05, CL = 0.4;
    for (let i = 0; i < 300; i++) {
      const T = thrustAt(powerFromThrottle(thr), V, rho);
      CL = (W * Math.cos(gamma) - T * Math.sin(alpha)) / qS;
      alpha = (CL - (A.CL0 + A.flapCL * flap)) / A.CLa;
      const D = qS * dragCoefficient(CL, alpha, 0, flap, gear, 1);
      if (fixGamma) {
        const need = (D + W * Math.sin(gamma)) / Math.cos(alpha);
        const unit = thrustAt(1, V, rho);
        const p = unit > 0 ? need / unit : 1;
        thr = clamp((p - A.idle) / (1 - A.idle), 0, 1);
      } else {
        gamma = Math.asin(clamp((T * Math.cos(alpha) - D) / W, -1, 1));
      }
    }
    const trim = -(A.Cm0 + A.Cma * alpha + A.Cmflap * flap) / A.Cmde;
    return { alpha, gamma, throttle: thr, trim, CL, speed: V, flap, gear };
  }

  function trimState(o) {
    const s = baseState(o.seed);
    const tr = solveTrim(o);
    const h = (o.heading || 0) * DEG, theta = tr.alpha + tr.gamma;
    s.quat = qFromEuler(-h, theta, 0);
    const fwd = v3(Math.sin(h), 0, -Math.cos(h));
    s.vel = v3(fwd.x * o.speed * Math.cos(tr.gamma), o.speed * Math.sin(tr.gamma), fwd.z * o.speed * Math.cos(tr.gamma));
    s.pos = v3(o.x || 0, o.alt || 1000, o.z || 0);
    s.power = powerFromThrottle(tr.throttle);
    s.rpm = rpmTarget(s.power, o.speed);
    s.flapCmd = o.flaps || 0; s.flap = tr.flap;
    s.gear = tr.gear; s.gearCmd = !!tr.gear;
    s.trim = tr; s.tas = o.speed; s.alpha = tr.alpha; s.CL = tr.CL;
    s.airTime = 10;
    derive(s, null, { groundHeight: () => -1e9 });
    return s;
  }

  function rpmTarget(power, V) { return 600 + 2050 * power * (0.8 + 0.2 * Math.min(V / 50, 1)) + V * 5; }

  // ---------------------------------------------------------------- environment
  function flatEnv(elevation) {
    return { groundHeight: () => elevation || 0, waterLevel: -Infinity, wind: v3(0, 0, 0), turbulence: 0 };
  }

  // ---------------------------------------------------------------- step
  function event(s, type, data) { const e = Object.assign({ type }, data || {}); s.events.push(e); return e; }
  function crash(s, reason) {
    if (s.crashed) return;
    const sp = len(s.vel);
    if (!/water/.test(reason) && (sp > 45 || s.vel.y < -9)) reason = 'Flew into the ground at ' + Math.round(sp * 1.944) + ' kt';
    s.crashed = true; s.crashReason = reason;
    event(s, 'crash', { reason, speed: len(s.vel) });
  }

  function systems(s, c, dt) {
    const A = AIRCRAFT;
    // flaps (electric, ~4.5 s full travel)
    const fIdx = clamp(c.flaps | 0, 0, 3);
    if (fIdx !== s.flapCmd) { s.flapCmd = fIdx; }
    const fT = A.flapDetents[s.flapCmd];
    const wasMoving = s.flapMoving;
    if (Math.abs(fT - s.flap) > 1e-4) {
      s.flap += clamp(fT - s.flap, -A.flapRate * dt, A.flapRate * dt);
      s.flapMoving = true;
      if (!wasMoving) event(s, 'flaps', { phase: 'start', target: s.flapCmd });
    } else if (wasMoving) { s.flapMoving = false; s.flap = fT; event(s, 'flaps', { phase: 'stop', target: s.flapCmd }); }

    // gear (weight-on-wheels switch stops a retraction on the ground)
    const want = c.gear !== false;
    if (want !== s.gearCmd) {
      if (!want && s.contacts > 0) { if (!s._gearBlockedSent) { event(s, 'gearBlocked'); s._gearBlockedSent = true; } }
      else { s.gearCmd = want; s._gearBlockedSent = false; event(s, 'gear', { phase: 'start', down: want }); }
    } else s._gearBlockedSent = false;
    const gT = s.gearCmd ? 1 : 0;
    if (s.gear !== gT) {
      s.gear += clamp(gT - s.gear, -dt / A.gearTime, dt / A.gearTime);
      if (Math.abs(s.gear - gT) < 1e-6) { s.gear = gT; event(s, 'gear', { phase: 'locked', down: s.gearCmd }); }
    }

    // engine
    const pT = powerFromThrottle(c.throttle);
    s.power += (pT - s.power) * (1 - Math.exp(-dt / A.spool));
    s.rpm += (rpmTarget(s.power, s.tas) - s.rpm) * (1 - Math.exp(-dt / 0.45));

    // surfaces follow the stick with a little lag (servo-free cable feel)
    const sf = s.surfaces, k = 1 - Math.exp(-dt / 0.06);
    sf.elevator += (clamp(c.elevator + c.trim, -1, 1) - sf.elevator) * k;
    sf.aileron += (clamp(c.aileron, -1, 1) - sf.aileron) * k;
    sf.rudder += (clamp(c.rudder, -1, 1) - sf.rudder) * k;
  }

  function surfaceHeight(env, x, z) {
    const gh = env.groundHeight(x, z);
    const wl = env.waterLevel === undefined ? -Infinity : env.waterLevel;
    return gh < wl ? { h: wl, water: true } : { h: gh, water: false };
  }

  function substep(s, c, dt, env) {
    const A = AIRCRAFT;
    const q = s.quat;
    // aero axes in world
    const Xa = qrot(q, v3(0, 0, -1)), Ya = qrot(q, v3(1, 0, 0)), Za = qrot(q, v3(0, -1, 0));
    const toA = v => v3(dot(v, Xa), dot(v, Ya), dot(v, Za));
    const toW = v => add(add(scale(Xa, v.x), scale(Ya, v.y)), scale(Za, v.z));

    const rho = density(s.pos.y);
    // ground effect and wind shear from the height over the surface below the CG
    const sh = surfaceHeight(env, s.pos.x, s.pos.z);
    const hW = Math.max(0.1, s.pos.y - sh.h);
    const geo = groundEffect(hW - 0.45);
    const wind = add(scale(env.wind || v3(0, 0, 0), windProfile(hW - 1.2)), s.gust);
    const va = toA(v3(s.vel.x - wind.x, s.vel.y - wind.y, s.vel.z - wind.z));
    const V = len(va);
    const alpha = V > 0.5 ? Math.atan2(va.z, va.x) : 0;
    const beta = V > 0.5 ? Math.asin(clamp(va.y / V, -1, 1)) : 0;
    const qbar = 0.5 * rho * V * V;
    const flap = s.flap, gear = s.gear;

    const geFactor = geo.induced;

    let CL = liftCoefficient(alpha, flap) * geo.lift;
    const st = stallFactor(alpha, flap);
    if (st > 0.2 && s.dropSign === 0) s.dropSign = Math.sign(s.omega.x + 4 * beta) || (s.rng() < 0.5 ? -1 : 1);
    if (st < 0.05) s.dropSign = 0;
    const CD = dragCoefficient(CL, alpha, beta, flap, gear, geFactor);
    const CY = A.CYb * beta + A.CYdr * s.surfaces.rudder;

    const power = s.power;
    const T = thrustAt(power, V, rho);
    const qS = qbar * A.S;

    // forces (aero frame)
    let F = v3(T, 0, 0);
    if (V > 0.5) {
      const vh = scale(va, 1 / V);
      let ld = v3(vh.z, 0, -vh.x); const ll = len(ld); ld = ll > 1e-6 ? scale(ld, 1 / ll) : v3(0, 0, -1);
      F = add(F, scale(ld, qS * CL));
      F = add(F, scale(vh, -qS * CD));
      F = add(F, v3(0, qS * CY, 0));
    }

    // moments (aero frame)
    const Vd = Math.max(V, 3);
    const p = s.omega.x, qq = s.omega.y, r = s.omega.z;
    const ph = p * A.b / (2 * Vd), qh = qq * A.c / (2 * Vd), rh = r * A.b / (2 * Vd);
    const qCtl = qbar + A.propWash * T; // prop wash keeps the tail alive at low speed
    // buffet noise (smoothed random) when the wing is stalling
    const bf = s.buffet, kb = 1 - Math.exp(-dt / 0.05);
    bf.x += ((s.rng() - 0.5) * 2 - bf.x) * kb; bf.y += ((s.rng() - 0.5) * 2 - bf.y) * kb;
    const Cl = A.Clb * beta + A.Clp * (1 - 1.25 * st) * ph + A.Clr * rh + st * (0.03 * s.dropSign + 0.012 * bf.x) + s.gustRoll;
    const Cm = A.Cm0 + A.Cma * alpha + A.Cmq * qh + A.Cmflap * flap - 0.08 * st + 0.02 * st * bf.y;
    const Cn = A.Cnb * beta + A.Cnr * rh + A.Cnp * ph - A.pFactor * Math.max(0, power - 0.3) * clamp((alpha - 4 * DEG) / (8 * DEG), 0, 1.5);
    let M = v3(qS * A.b * Cl, qS * A.c * Cm, qS * A.b * Cn);
    const qcS = qCtl * A.S;
    M = add(M, v3(qbar * A.S * A.b * A.Clda * s.surfaces.aileron,
      qcS * A.c * A.Cmde * s.surfaces.elevator,
      qcS * A.b * A.Cndr * s.surfaces.rudder + qbar * A.S * A.b * A.Cnda * s.surfaces.aileron));

    // gravity + aero to world
    let Fw = toW(F);
    Fw.y -= A.mass * G;
    const aeroOnlyW = toW(F);

    // ---- ground contacts
    let contacts = 0; s.scraping = false;
    const wasAir = s.contacts === 0;
    const gearDown = gear > 0.98;
    const wheelsDown = [false, false, false];
    let maxSinkAtContact = 0;
    const omegaW = toW(s.omega);
    const pointVel = rW => add(s.vel, cross(omegaW, rW));
    if (gearDown) {
      for (let i = 0; i < A.wheels.length; i++) {
        const w = A.wheels[i];
        const rW = toW(w.p);
        const px = s.pos.x + rW.x, py = s.pos.y + rW.y, pz = s.pos.z + rW.z;
        const sfc = surfaceHeight(env, px, pz);
        const pen = sfc.h - py;
        if (pen <= 0) continue;
        if (sfc.water) { crash(s, 'Ditched in the water'); return; }
        const vp = pointVel(rW);
        if (wasAir) maxSinkAtContact = Math.max(maxSinkAtContact, -vp.y);
        if (pen > A.gearTravel) { crash(s, 'Gear collapsed on a hard landing'); return; }
        let N = w.k * pen - w.c * vp.y; if (N < 0) N = 0;
        // wheel direction on the ground (nosewheel steers with the rudder pedals)
        let fx = Xa.x, fz = Xa.z;
        if (w.nose) {
          const steer = s.surfaces.rudder * A.maxSteer * clamp(1 - s.groundSpeed / 32, 0.25, 1);
          const cs = Math.cos(steer), sn = Math.sin(steer);
          // rotate forward about world up (positive steer = nose right)
          const nx = fx * cs - fz * sn, nz = fx * sn + fz * cs; fx = nx; fz = nz;
        }
        const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
        const lx = -fz, lz = fx; // right of the wheel direction
        const vf = vp.x * fx + vp.z * fz, vl = vp.x * lx + vp.z * lz;
        const surf = env.surfaceAt ? env.surfaceAt(px, pz) : 'paved';
        const roll = surf === 'paved' ? 0.02 : 0.06;
        const muB = w.nose ? 0 : 0.65 * clamp(c.brake, 0, 1);
        const Ff = -(roll + muB) * N * clamp(vf / 0.05, -1, 1);
        const Fl = -0.85 * N * clamp(vl / 0.1, -1, 1);
        const Fc = v3(fx * Ff + lx * Fl, N, fz * Ff + lz * Fl);
        Fw = add(Fw, Fc);
        M = add(M, cross(w.p, toA(Fc)));
        contacts++; wheelsDown[i] = true;
      }
    }
    for (const pt of A.points) {
      if (gearDown && pt.name === 'belly') continue;
      const rW = toW(pt.p);
      const px = s.pos.x + rW.x, py = s.pos.y + rW.y, pz = s.pos.z + rW.z;
      const sfc = surfaceHeight(env, px, pz);
      const pen = sfc.h - py;
      if (pen <= 0) continue;
      const vp = pointVel(rW), sp = len(vp);
      if (sfc.water) { crash(s, 'Ditched in the water'); return; }
      if (pt.name === 'prop' || pt.name === 'nose' || pt.name === 'fin') { if (sp > 2) { crash(s, pt.name === 'fin' ? 'Flipped over' : 'Prop strike: nosed into the ground'); return; } }
      else if (pt.name === 'belly') { if (sp > 4) { crash(s, gear < 0.02 ? 'Gear-up landing' : 'Landed before the gear locked down'); return; } }
      else if (pt.name === 'wing') { if (sp > 9 || vp.y < -2) { crash(s, 'Caught a wingtip'); return; } }
      else if (pt.name === 'tail') { if (vp.y < -4.5) { crash(s, 'Tail strike: the tail hit hard'); return; } if (!s._tailEv) { event(s, 'tailstrike'); s._tailEv = true; } }
      let N = 80000 * pen - 8000 * vp.y; if (N < 0) N = 0;
      const hx = vp.x, hz = vp.z, hs = Math.hypot(hx, hz);
      const fr = hs > 1e-3 ? -0.5 * N * Math.min(1, hs / 0.2) / hs : 0;
      const Fc = v3(hx * fr, N, hz * fr);
      Fw = add(Fw, Fc);
      M = add(M, cross(pt.p, toA(Fc)));
      s.scraping = true; contacts++;
    }
    if (wasAir && contacts > 0 && s.airTime > 0.4) {
      const sink = Math.max(maxSinkAtContact, -s.vel.y);
      event(s, 'touchdown', { sink, x: s.pos.x, z: s.pos.z, speed: len(s.vel), time: s.time });
      if (sink > 4.0) { crash(s, 'Gear collapsed on a hard landing'); return; }
    }
    if (!s.scraping) s._tailEv = false;
    s.contacts = contacts; s.wheelsDown = wheelsDown;
    s.airTime = contacts > 0 ? 0 : s.airTime + dt;

    // ---- integrate (semi-implicit Euler)
    const m = A.mass;
    s.vel = add(s.vel, scale(Fw, dt / m));
    s.pos = add(s.pos, scale(s.vel, dt));
    const o = s.omega;
    const dp = (M.x - (A.Izz - A.Iyy) * o.y * o.z) / A.Ixx;
    const dq = (M.y - (A.Ixx - A.Izz) * o.x * o.z) / A.Iyy;
    const dr = (M.z - (A.Iyy - A.Ixx) * o.x * o.y) / A.Izz;
    s.omega = v3(o.x + dp * dt, o.y + dq * dt, o.z + dr * dt);
    const wb = a2b(s.omega);
    const dq4 = qmul(q, { x: wb.x, y: wb.y, z: wb.z, w: 0 });
    s.quat = qnorm({ x: q.x + 0.5 * dq4.x * dt, y: q.y + 0.5 * dq4.y * dt, z: q.z + 0.5 * dq4.z * dt, w: q.w + 0.5 * dq4.w * dt });

    // outputs of this substep
    s.alpha = alpha; s.beta = beta; s.tas = V; s.CL = CL; s.stall = st; s.rho = rho;
    s.thrust = T;
    const specific = scale(add(aeroOnlyW, v3(0, 0, 0)), 1 / (m * G));
    s.gload = -dot(specific, Za) + 0; // along body up
  }

  function derive(s, c, env) {
    const sh = surfaceHeight(env, s.pos.x, s.pos.z);
    s.agl = s.pos.y - sh.h - 1.23;
    s.groundSpeed = Math.hypot(s.vel.x, s.vel.z);
    s.onGround = s.contacts > 0;
    const A = AIRCRAFT;
    const rho = density(s.pos.y);
    s.airspeed = s.tas * Math.sqrt(rho / RHO0);
    s.stalled = s.alpha > alphaCritFor(s.flap) + 0.5 * DEG || s.alpha < A.alphaCritNeg - 0.5 * DEG;
    if (s.onGround && s.airspeed < 20) s.stalled = false;
    s.stallWarn = !s.onGround && s.tas > 5 && s.alpha > alphaCritFor(s.flap) - 4 * DEG;
    s.rollSpeed = s.onGround ? s.groundSpeed : 0;
  }

  /**
   * Turbulence: gusts as Ornstein-Uhlenbeck processes (a defined rms and correlation time, the
   * same at any frame rate), stronger low over the ground where the air churns over terrain,
   * plus a small rolling moment so the wings get bumped. s.turb reports the intensity felt
   * (0 calm, ~0.3 light, ~0.8 moderate) so the HUD and the coach can say so.
   */
  function gauss(rng) { const u = Math.max(1e-9, rng()), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function ou(x, sigma, tau, dt, rng) { const a = Math.exp(-dt / tau); return x * a + sigma * Math.sqrt(1 - a * a) * gauss(rng); }
  function updateGust(s, env, dt) {
    const tu = env.turbulence || 0;
    if (tu <= 0) {
      const a = Math.exp(-dt / 1.5);   // die away, never snap to zero
      s.gust = v3(s.gust.x * a, s.gust.y * a, s.gust.z * a); s.gustRoll *= a; s.turb = 0; return;
    }
    const sh = surfaceHeight(env, s.pos.x, s.pos.z);
    const low = 1 + 0.6 * (1 - smoothstep(0, 300, s.pos.y - sh.h));
    const sig = 1.4 * tu * low;   // m/s rms: light chop (0.15) ~0.2, gusty (0.5) ~0.7
    const g = s.gust;
    s.gust = v3(ou(g.x, sig, 3.0, dt, s.rng), ou(g.y, sig * 0.75, 1.4, dt, s.rng), ou(g.z, sig, 3.0, dt, s.rng));
    s.gustRoll = ou(s.gustRoll, 0.0025 * tu * low, 0.8, dt, s.rng);
    s.turb = tu * low;
  }

  /** Start an aircraft moving with the air mass (spawned in a wind without a jolt). */
  function matchWind(s, wind) {
    if (!wind || s.onGround) return s;
    const f = windProfile(Math.max(1, s.agl + 1.2));
    s.vel = v3(s.vel.x + wind.x * f, s.vel.y + (wind.y || 0) * f, s.vel.z + wind.z * f);
    return s;
  }

  /** Advance the aircraft by dt seconds (internally at 240 Hz). Mutates and returns s. */
  function step(s, c, dt, env) {
    env = env || flatEnv(0);
    if (s.crashed) return s;
    systems(s, c, dt);
    updateGust(s, env, dt);
    const n = Math.max(1, Math.ceil(dt * 240 - 1e-9)), h = dt / n;
    for (let i = 0; i < n; i++) { substep(s, c, h, env); if (s.crashed) break; s.time += h; }
    derive(s, c, env);
    return s;
  }

  /** Heading (deg, 0 north, 90 east), pitch and bank (deg, right wing down positive). */
  function attitude(s) {
    const q = s.quat;
    // rotation matrix elements needed for 'YXZ' decomposition
    const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
    const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2, yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
    const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
    const m13 = xz + wy, m33 = 1 - (xx + yy), m21 = xy + wz, m22 = 1 - (xx + zz), m23 = yz - wx;
    const pitch = Math.asin(clamp(-m23, -1, 1));
    let yaw, roll;
    if (Math.abs(m23) < 0.9999) { yaw = Math.atan2(m13, m33); roll = Math.atan2(m21, m22); }
    else { yaw = 0; roll = 0; }
    let heading = (-yaw / DEG) % 360; if (heading < 0) heading += 360;
    return { heading, pitch: pitch / DEG, bank: -roll / DEG };
  }

  /**
   * Pilot assists (pure apart from the small controller memory kept in s.ap). Returns new controls.
   * opt.autoRudder: coordinate turns by nulling sideslip (plus adverse-yaw feed-forward).
   *   It used to also chase the yaw rate of a coordinated turn; that fed the roll-from-yaw
   *   coupling and turned every small bank into a slow spiral dive (the mid-flight "push").
   * opt.level: 'off' raw surfaces; 'leveller' (= the old opt.assist) bank limit, wing leveller
   *   near neutral, stall guard; 'steady' attitude command: the stick or the phone's tilt sets a
   *   bank angle and a climb/descent angle, neutral holds wings level and altitude, with bank,
   *   stall and overspeed protection. opt.dt: frame time (for the steady integrators).
   */
  function applyAssists(s, c, opt) {
    const out = Object.assign({}, c);
    const level = opt.level || (opt.assist ? 'leveller' : 'off');
    if ((opt.autoRudder || level === 'steady') && !s.onGround && s.tas > 15) {
      // null the sideslip, lead the adverse yaw, and damp the yaw rate (keeps the spiral mode stable)
      const assist = 1.8 * s.beta + 0.12 * c.aileron - 0.3 * s.omega.z;
      out.rudder = clamp(c.rudder + clamp(assist, -0.6, 0.6), -1, 1);
    }
    if (level === 'steady') return steady(s, c, out, opt.dt || 1 / 60);
    if (level === 'leveller' && !s.onGround) {
      const bank = attitude(s).bank;
      if (Math.abs(c.aileron) < 0.12) out.aileron = clamp(c.aileron - bank * 0.012 - s.omega.x * 0.2, -0.5, 0.5);
      if (Math.abs(bank) > 50 && Math.sign(c.aileron) === Math.sign(bank)) out.aileron = c.aileron * clamp(1 - (Math.abs(bank) - 50) / 15, 0, 1) - Math.sign(bank) * 0.1;
      const lim = alphaCritFor(s.flap) - 2.5 * DEG;
      if (s.alpha > lim && s.tas > 10) out.elevator = Math.min(out.elevator, out.elevator - (s.alpha - lim) / DEG * 0.25);
    }
    return out;
  }

  /** Stall speed (equivalent airspeed, m/s) in level flight at 1 g, gear and weight as built. */
  function stallSpeed(flap) {
    const A = AIRCRAFT, CLmax = liftCoefficient(alphaCritFor(flap || 0), flap || 0);
    return Math.sqrt(2 * A.mass * G / (RHO0 * A.S * CLmax));
  }
  const STEADY = { maxBank: 33 * DEG, sportBank: 60 * DEG, maxGamma: 10 * DEG, minGamma: -12 * DEG, stuntAgl: 150 };
  function steady(s, c, out, dt) {
    const ap = s.ap || (s.ap = { ie: 0, ia: 0, on: false });
    if (s.onGround || s.tas < 20) { ap.on = false; ap.stunt = null; return out; }   // the takeoff roll and rotation are flown raw
    const A = AIRCRAFT, att = attitude(s), bank = att.bank * DEG, V = Math.max(s.tas, 20);
    // ---- stunts (c.stunt: 'rollLeft' | 'rollRight' | 'loop', one frame, from the input's double
    // flick): a scripted roll or loop, then back to attitude hold
    const gest = { roll: c.stunt === 'rollRight' ? 1 : c.stunt === 'rollLeft' ? -1 : 0, loop: c.stunt === 'loop' ? 1 : 0 };
    if (!ap.stunt && (gest.roll || gest.loop) && s.agl <= STEADY.stuntAgl) ap.refused = 'low';
    if (!ap.stunt && s.agl > STEADY.stuntAgl) {
      const start = kind => { if (!ap.on) ap.ie = s.surfaces.elevator - (c.trim || 0); return { kind, acc: 0, t: 0, phase: 'pull' }; };
      // a trainer needs energy: ~80 kt for a roll, a dive to ~125 kt for a loop (else the game says so)
      if (gest.roll) { if (s.airspeed > 41) ap.stunt = Object.assign(start('roll'), { dir: gest.roll }); else ap.refused = 'roll'; }
      else if (gest.loop > 0) { if (s.airspeed > 64) ap.stunt = start('loop'); else ap.refused = 'loop'; }
    }
    if (ap.stunt) {
      const st = ap.stunt; st.t += dt;
      // pitch rate command through the same inner loop as attitude hold, the wing kept below its stall
      const lim = alphaCritFor(s.flap) - 2.5 * DEG;
      const qLoop = q => {
        if (s.alpha > lim) q = Math.min(q, s.omega.y - 3 * (s.alpha - lim));
        const qe = q - s.omega.y; ap.ie = clamp(ap.ie + 1.2 * qe * dt, -1, 1);
        return clamp(ap.ie + 1.0 * qe - (c.trim || 0), -1.5, 1.5);
      };
      if (st.kind === 'roll') {
        // a barrel roll: raise the nose ~15 deg, then full aileron with light back pressure
        if (st.phase === 'pull') {
          out.elevator = qLoop(0.45); out.aileron = clamp(-1.6 * bank - 0.8 * s.omega.x, -1, 1);
          if (att.pitch > 10 || st.t > 1.3) st.phase = 'roll';
        } else {
          st.acc += s.omega.x * dt * st.dir;
          out.aileron = st.dir;
          out.elevator = qLoop(0.12 * Math.cos(bank) + 0.06);
          if (st.acc > 2 * Math.PI - 0.3 || st.t > 10) ap.stunt = null;
        }
      } else {
        st.acc += s.omega.y * dt;
        out.elevator = qLoop(clamp(3.4 * G / V, 0.3, 1.1));   // ~3.5 g at the bottom, floating over the top
        out.aileron = clamp(-s.omega.x * 0.6, -0.4, 0.4);
        if (st.acc > 2 * Math.PI - 0.5 || s.airspeed < 22 || st.t > 16) ap.stunt = null;
      }
      if (!ap.stunt) { ap.on = false; ap.done = st.kind; }
      return out;
    }
    if (!ap.on) { ap.on = true; ap.ie = s.surfaces.elevator - (c.trim || 0); ap.ia = 0; }   // bumpless engage
    // ---- roll: target bank from the stick, roll-rate inner loop with feed-forward
    // near the ground the bank is kept shallow: 14 deg below 100 ft, the full 33 deg from 500 ft;
    // well clear of the ground the last 15% of the stick opens it up to a sporty 60 deg
    const maxBank = STEADY.maxBank * (0.42 + 0.58 * smoothstep(30, 150, s.agl));
    const ail = clamp(c.aileron, -1, 1), sport = smoothstep(150, 300, s.agl) * smoothstep(0.85, 1, Math.abs(ail));
    const bankT = ail * maxBank + Math.sign(ail) * sport * (STEADY.sportBank - STEADY.maxBank);
    const pCmd = clamp(1.6 * (bankT - bank), -0.7, 0.7);
    const pGain = A.b / (2 * V) * Math.abs(A.Clp) / A.Clda;   // aileron for a steady roll rate
    ap.ia = clamp(ap.ia + 0.4 * (bankT - bank) * dt, -0.15, 0.15);
    out.aileron = clamp(pCmd * pGain + 0.8 * (pCmd - s.omega.x) + ap.ia, -1, 1);
    // ---- pitch: target flight-path angle, pitch-rate inner loop with an integrator (finds trim)
    const sp = Math.hypot(s.vel.x, s.vel.y, s.vel.z) || 1;
    const gamma = Math.asin(clamp(s.vel.y / sp, -1, 1));
    const e = c.elevator;
    const gammaT = e >= 0 ? e * STEADY.maxGamma : -e * STEADY.minGamma;
    const qTurn = G * Math.sin(Math.abs(bank)) * Math.tan(Math.min(Math.abs(bank), 60 * DEG)) / V;
    let qCmd = clamp(0.9 * (gammaT - gamma), -0.12, 0.12) + qTurn;
    // stall protection, as a speed floor: 1.2 x the stall speed for these flaps and this bank, so
    // a full pull climbs at a good speed instead of hanging on the stall warning (the user's
    // recording: stick held back for a minute at 48 kt, STALL flashing). The AoA limit, below the
    // warning, is the backstop.
    const vFloor = 1.2 * stallSpeed(s.flap) / Math.sqrt(Math.max(0.3, Math.cos(bank)));
    if (s.airspeed < vFloor + 3) qCmd = Math.min(qCmd, qTurn - 0.035 * (vFloor + 3 - s.airspeed));
    const lim = alphaCritFor(s.flap) - 4.5 * DEG;
    if (s.alpha > lim) qCmd = Math.min(qCmd, -2.5 * (s.alpha - lim));
    if (s.airspeed > 75) qCmd = Math.max(qCmd, 0.05 * (s.airspeed - 75));   // overspeed: ease the dive
    const qe = qCmd - s.omega.y;
    ap.ie = clamp(ap.ie + 1.2 * qe * dt, -1, 1);
    out.elevator = clamp(ap.ie + 1.0 * qe - (c.trim || 0), -1.5, 1.5);
    return out;
  }

  const FM = {
    AIRCRAFT, G, DEG, controls, groundState, trimState, solveTrim, step, attitude, applyAssists, matchWind, STEADY, stallSpeed,
    liftCoefficient, stallFactor, dragCoefficient, thrustAt, density, flatEnv, alphaCritFor, groundEffect, windProfile,
    qrot, qmul, qFromEuler, a2b, b2a,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = FM;
  if (root) root.FM = FM;
})(typeof window !== 'undefined' ? window : null);
