// Recorded phone samples -> what the game sees each sample (the same maths as games/lib/mimic.js
// update(): phone quaternion to world, rod direction, smoothed angular velocity).
'use strict';
const path = require('path');
const S = Math.SQRT1_2, C = { x: -S, y: 0, z: 0, w: S }, Ci = { x: S, y: 0, z: 0, w: S };
const mul = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
const rot = (q, v) => { const p = mul(mul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w }); return { x: p.x, y: p.y, z: p.z }; };

/** rows: [t, ax0, ax1, ax2, aDown] -> [{t, f, av, a, pitch}] */
function decode(rows) {
  const out = [];
  let last = null;
  for (const [t, x, y, z, a] of rows) {
    const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    const q = mul(mul(C, { x, y, z, w }), Ci);
    const f = rot(q, { x: 0, y: 0, z: -1 });
    const s = { t, q, f, a: !!a, pitch: Math.asin(Math.max(-1, Math.min(1, f.y))), av: { x: 0, y: 0, z: 0 } };
    if (last) {
      const dt = Math.max(1e-3, t - last.t);
      let d = mul(q, { x: -last.q.x, y: -last.q.y, z: -last.q.z, w: last.q.w });
      if (d.w < 0) d = { x: -d.x, y: -d.y, z: -d.z, w: -d.w };
      const sn = Math.hypot(d.x, d.y, d.z), k = sn > 1e-9 ? 2 * Math.atan2(sn, d.w) / sn / dt : 0;
      s.av = { x: last.av.x + (d.x * k - last.av.x) * 0.5, y: last.av.y + (d.y * k - last.av.y) * 0.5, z: last.av.z + (d.z * k - last.av.z) * 0.5 };
    }
    out.push(s); last = s;
  }
  return out;
}
const session = () => require(path.join(__dirname, 'fixtures', 'session-20261110.json'));
module.exports = { decode, session };
