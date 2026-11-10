/*
 * GYROWING missions: definitions built from the terrain, and a pure tracker that turns the aircraft's
 * position into progress (rings flown, waypoints reached, landings completed) and the one current
 * objective (what, where, how far, which way to turn). No DOM or three.js: loads in Node for tests.
 *
 * Headings: 0 = north = -z, 90 = east = +x (same as the flight model).
 */
(function (root) {
  'use strict';
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap180 = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };
  const fwd = hdg => ({ x: Math.sin(hdg * DEG), z: -Math.cos(hdg * DEG) });

  /**
   * A ring course that follows low ground: from a start point, each leg picks the heading (within
   * +-45 deg of the last) whose straight line crosses the lowest terrain, with a small turn penalty.
   */
  function valleyPath(T, x, z, hdg, n, step) {
    const legs = [];
    for (let i = 0; i < n; i++) {
      let best = null;
      for (let d = -45; d <= 45; d += 5) {
        const h = hdg + d, f = fwd(h);
        let mx = -1e9;
        for (let k = 1; k <= 12; k++) mx = Math.max(mx, T.heightAt(x + f.x * step * k / 12, z + f.z * step * k / 12));
        const cost = mx + Math.abs(d) * 1.5;
        if (!best || cost < best.cost) best = { cost, h, x: x + f.x * step, z: z + f.z * step };
      }
      legs.push({ x0: x, z0: z, x: best.x, z: best.z, hdg: ((best.h % 360) + 360) % 360 });
      x = best.x; z = best.z; hdg = best.h;
    }
    return legs;
  }
  function legMax(T, x0, z0, x1, z1) {
    let mx = -1e9;
    for (let k = 0; k <= 24; k++) mx = Math.max(mx, T.heightAt(x0 + (x1 - x0) * k / 24, z0 + (z1 - z0) * k / 24));
    return Math.max(mx, 0);
  }

  /**
   * A ring course over any terrain (T.heightAt): n rings `step` metres apart following low ground,
   * each `clear` metres above the highest ground on the legs either side of it.
   */
  function ringCourse(T, sx, sz, hdg, n, step, clear) {
    clear = clear || 75;
    const legs = valleyPath(T, sx, sz, hdg, n, step);
    const ringY = legs.map((g, i) => {
      const inMax = legMax(T, g.x0, g.z0, g.x, g.z);
      const out = legs[i + 1] ? legMax(T, g.x, g.z, legs[i + 1].x, legs[i + 1].z) : inMax;
      return Math.max(inMax, out) + clear;
    });
    // a trainer climbs ~4 deg at full power: raise earlier rings so no leg asks for more than 50 m
    for (let i = ringY.length - 2; i >= 0; i--) ringY[i] = Math.max(ringY[i], ringY[i + 1] - 50);
    const rings = legs.map((g, i) => ({ kind: 'ring', x: g.x, y: ringY[i], z: g.z, hdg: g.hdg, r: 42, name: 'Ring ' + (i + 1) }));
    const startAlt = Math.max(ringY[0], legMax(T, sx, sz, legs[0].x, legs[0].z) + clear);
    return { rings, startAlt, legs };
  }

  function build(T) {
    const A = T.AIRPORT, B = T.BROOK, L = T.landmarks, E = A.elev;
    // ---- valley run: ten rings up a valley into the northern mountains
    const sx = 2500, sz = -1600;
    const { rings, startAlt, legs } = ringCourse(T, sx, sz, 10, 10, 650, 75);

    const village = (T.villages && T.villages[0]) || { x: -6500, z: 1800 };
    const defs = {
      rings: {
        id: 'rings', name: 'Valley Run', blurb: 'Ten rings up a valley into the northern mountains. Low, fast, ridges on both sides, light bumps.',
        start: { kind: 'air', x: sx, z: sz, alt: startAlt, hdg: legs[0].hdg, speed: 52 },
        wind: { fromDeg: 270, kt: 4, turb: 0.12 }, par: 150,
        steps: rings,
      },
      xc: {
        id: 'xc', name: 'Cross-country', blurb: 'Gyrowing Field to Brookfield, 9 km east, by way of the lake. Land on runway 36.',
        start: { kind: 'runway', airport: 'GWF' },
        wind: { fromDeg: 120, kt: 6, turb: 0 },
        steps: [
          { kind: 'takeoff', name: 'Take off', say: 'Climb to about 1,500 ft and head for the lake, north-east.' },
          { kind: 'waypoint', name: 'the lake', x: L.lake.x, z: L.lake.z, r: 900, alt: 460, say: 'Over the lake. Brookfield is south-east: look for a north-south runway in the valley.' },
          { kind: 'waypoint', name: 'Brookfield final (south of the field)', x: B.runway.x, z: B.runway.z1 + 2600, r: 600, alt: B.elev + 200, say: 'Turn north and line up with runway 36. Descend: gear down, flaps, slow to 65 kt.' },
          { kind: 'land', airport: 'BRK', name: 'Land on runway 36 at Brookfield', x: B.runway.x, z: B.runway.z1 - B.aimPoint, rwyHdg: 0 },
        ],
      },
      crosswind: {
        id: 'crosswind', name: 'Crosswind landing', blurb: '12 kt from the north across runway 09, gusting. Crab on final, straighten for touchdown.',
        start: { kind: 'air', x: A.runway.x0 - 4000, z: 0, alt: E + 1.25 + (4000 + A.aimPoint - A.runway.x0) * Math.tan(3 * DEG), hdg: 90, speed: 37, flaps: 1, gear: true, final: true },
        wind: { fromDeg: 0, kt: 12, turb: 0.4 },
        steps: [{ kind: 'land', airport: 'GWF', name: 'Land on runway 09 and stop', x: A.aimPoint, z: 0, rwyHdg: 90, scored: true }],
      },
      tour: {
        id: 'tour', name: 'Island tour', blurb: 'Sightseeing: the lighthouse, the lake, the summit and a village. No clock, no score.',
        start: { kind: 'air', x: -1500, z: 1200, alt: E + 450, hdg: 160, speed: 50 },
        wind: { fromDeg: 270, kt: 3, turb: 0 },
        steps: [
          { kind: 'waypoint', name: 'the lighthouse', x: L.lighthouse.x, z: L.lighthouse.z, r: 700, alt: 300, say: 'The south cape lighthouse. Sailboats below; the sea runs all the way to the horizon.' },
          { kind: 'waypoint', name: 'the lake', x: L.lake.x, z: L.lake.z, r: 900, alt: 450, say: 'The lake in the eastern hills: the water you see sits at sea level, ringed by forest.' },
          { kind: 'waypoint', name: 'the summit', x: L.summit.x, z: L.summit.z + 1500, r: 1100, alt: L.summit.y + 250, say: 'The summit, ' + Math.round(L.summit.y * 3.281).toLocaleString('en-US') + ' ft. Keep well clear of the ridges; the air is rougher up here.' },
          { kind: 'waypoint', name: 'the village', x: village.x, z: village.z, r: 700, alt: 300, say: 'A farming village: red roofs, fields and the road back to the airfield.' },
          { kind: 'land', airport: 'GWF', name: 'Land back at Gyrowing Field (runway 09)', x: A.aimPoint, z: 0, rwyHdg: 90 },
        ],
      },
      night: {
        id: 'night', name: 'Night circuit', blurb: 'Take off at night, fly one circuit around the field by the lights and land.',
        start: { kind: 'runway', airport: 'GWF' }, hours: 22.5,
        wind: { fromDeg: 90, kt: 4, turb: 0 },
        steps: [
          { kind: 'takeoff', name: 'Take off', say: 'Climb straight ahead to 700 ft, then turn left.' },
          { kind: 'waypoint', name: 'crosswind leg (turn left)', x: A.runway.x1 + 900, z: -700, r: 450, alt: E + 250, say: 'Crosswind leg. Keep turning left onto downwind, runway lights on your left.' },
          { kind: 'waypoint', name: 'downwind (runway on your left)', x: A.runway.x0 - 700, z: -1200, r: 450, alt: E + 300, say: 'End of downwind: throttle back, gear down, flaps 10, and turn left onto base.' },
          { kind: 'waypoint', name: 'base leg (turn left)', x: A.runway.x0 - 2200, z: -350, r: 450, alt: E + 180, say: 'Turn final: line up with the runway lights, PAPI two white, two red.' },
          { kind: 'land', airport: 'GWF', name: 'Land on runway 09', x: A.aimPoint, z: 0, rwyHdg: 90, scored: true },
        ],
      },
    };
    return defs;
  }

  // ---------------------------------------------------------------- tracker
  function start(def, helpers) {
    return { def, helpers: helpers || {}, i: 0, t: 0, passed: 0, missed: 0, done: false, failed: null, prev: null, touch: null };
  }

  /** p: { x, y, z, onGround, gs (m/s), agl (m) }. Returns events: step (ok or missed), complete, fail. */
  function update(st, p, dt) {
    const ev = [];
    if (st.done) return ev;
    st.t += dt || 0;
    const step = st.def.steps[st.i];
    const prev = st.prev; st.prev = { x: p.x, y: p.y, z: p.z };
    if (!step) return ev;
    const advance = ok => {
      ev.push({ type: 'step', ok, index: st.i, step });
      if (ok) st.passed++; else st.missed++;
      st.i++;
      if (st.i >= st.def.steps.length) { st.done = true; ev.push({ type: 'complete' }); }
    };
    if (step.kind === 'takeoff') {
      if (!p.onGround && p.agl > 15) advance(true);
    } else if (step.kind === 'waypoint') {
      if (Math.hypot(p.x - step.x, p.z - step.z) < step.r) advance(true);
    } else if (step.kind === 'ring') {
      if (prev) {
        const f = fwd(step.hdg);
        const d0 = (prev.x - step.x) * f.x + (prev.z - step.z) * f.z, d1 = (p.x - step.x) * f.x + (p.z - step.z) * f.z;
        if (d0 < 0 && d1 >= 0) {
          const u = d0 / (d0 - d1);
          const ix = prev.x + (p.x - prev.x) * u, iy = prev.y + (p.y - prev.y) * u, iz = prev.z + (p.z - prev.z) * u;
          const off = Math.hypot(ix - step.x, iy - step.y, iz - step.z);
          if (off <= step.r) advance(true);
          else if (off < Math.max(step.r * 4, 600)) advance(false);   // a wide miss moves the run on
        }
      }
    } else if (step.kind === 'land') {
      if (p.onGround && p.gs < 3) {
        const on = st.helpers.onRunway ? st.helpers.onRunway(step.airport, p.x, p.z) : true;
        if (on) advance(true);
        else { st.done = true; st.failed = 'Stopped off the runway'; ev.push({ type: 'fail', reason: st.failed }); }
      }
    }
    return ev;
  }

  /** The current objective for the HUD and the coach. hdg: aircraft heading (deg). */
  function objective(st, p, hdg) {
    const steps = st.def.steps, step = steps[Math.min(st.i, steps.length - 1)];
    const ringsTotal = steps.filter(s => s.kind === 'ring').length;
    const progress = ringsTotal ? `${Math.min(st.passed + st.missed, ringsTotal)} / ${ringsTotal}` : `${Math.min(st.i + 1, steps.length)} / ${steps.length}`;
    const o = { title: st.def.name, progress, kind: step.kind, name: step.name, distM: 0, relBearing: 0, target: null, altFt: null, done: st.done };
    if (st.done) { o.text = st.failed ? st.failed : 'Mission complete'; return o; }
    if (step.kind === 'takeoff') { o.text = 'Take off'; return o; }
    if (step.x !== undefined) {
      const dx = step.x - p.x, dz = step.z - p.z;
      o.distM = Math.hypot(dx, dz);
      const brg = Math.atan2(dx, -dz) / DEG;
      o.relBearing = wrap180(brg - hdg);
      o.bearing = (brg + 360) % 360;
      o.target = { x: step.x, y: step.y !== undefined ? step.y : (step.alt !== undefined ? step.alt : null), z: step.z };
    }
    if (step.y !== undefined) o.altFt = step.y * 3.281;
    else if (step.alt !== undefined) o.altFt = step.alt * 3.281;
    if (step.kind === 'ring') {
      o.text = `Fly through ring ${st.i + 1} of ${ringsTotal}`;
      o.dyM = step.y - p.y;
    } else if (step.kind === 'waypoint') o.text = 'Fly to ' + step.name;
    else o.text = step.name;
    return o;
  }

  const fmtTime = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  /** Summary rows + score (0..100) once a mission ends. */
  function result(st) {
    const d = st.def, rows = [];
    let score = 0, title;
    const rings = d.steps.filter(s => s.kind === 'ring').length;
    if (st.failed) { title = st.failed; score = 0; }
    else if (rings) {
      const timePen = Math.max(0, st.t - (d.par || 150)) / 3;
      score = Math.round(clamp(100 * st.passed / rings - timePen, 0, 100));
      title = st.passed === rings ? 'Clean run!' : st.passed >= rings * 0.7 ? 'Good run' : 'Keep practising';
      rows.push(['Rings', st.passed + ' / ' + rings, '']);
      rows.push(['Time', fmtTime(st.t), 'par ' + fmtTime(d.par || 150)]);
    } else {
      score = st.done ? 70 : 0;
      if (st.touch) {
        const smooth = Math.round(30 * clamp(1 - (st.touch.fpm - 120) / 480, 0, 1));
        score += smooth;
        rows.push(['Touchdown', Math.round(st.touch.fpm) + ' fpm', smooth + ' / 30']);
      } else score += st.done ? 15 : 0;
      title = st.done ? (score >= 90 ? 'Perfect flight' : score >= 75 ? 'Nicely flown' : 'Made it') : 'Not finished';
      rows.unshift(['Time', fmtTime(st.t), '']);
      rows.unshift(['Objectives', st.passed + ' / ' + d.steps.length, '']);
    }
    return { title, rows, score };
  }

  const api = { build, start, update, objective, result, valleyPath, ringCourse, fmtTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Missions = api;
})(typeof window !== 'undefined' ? window : this);
