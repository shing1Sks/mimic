// node games/lib/test/mimic-sync.test.js
const S = require('../mimic-sync.js');
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL ' + m); } };
const near = (a, b, e) => Math.abs(a - b) <= e;

// quaternions: 32 bits, any rotation, ~1e-3 per component
const rnd = () => { const v = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]; const l = Math.hypot(...v); return v.map(x => x / l); };
let worst = 0;
for (let i = 0; i < 20000; i++) {
  const q = rnd(), u = S.packQuat(...q), r = S.unpackQuat(u, [0, 0, 0, 0]);
  const d = Math.abs(q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3]);
  worst = Math.max(worst, 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI);
}
ok(worst < 0.3, `quaternion round trip within 0.3 deg (worst ${worst.toFixed(3)})`);
ok(S.packQuat(0, 0, 0, 1) === S.packQuat(0, 0, 0, -1), 'q and -q pack the same');

// a fake scene: objects and a figure with bones
const V = () => ({ x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; } });
const Q = () => ({ x: 0, y: 0, z: 0, w: 1, set(a, b, c, d) { this.x = a; this.y = b; this.z = c; this.w = d; } });
const O = () => ({ position: V(), quaternion: Q(), scale: Object.assign(V(), { x: 1, y: 1, z: 1 }), visible: true, parent: null, add(o) { o.parent = this; } });
function world() {
  const ball = O(), fig = O(), p1 = O(), p2 = O(), helm = O();
  p1.add(helm);
  const bones = Array.from({ length: 31 }, O), feet = [bones[1], bones[29]];
  const mat = { opacity: 1, col: 0xff0000 }, num = { v: 0 }, flag = { b: false };
  const R = S.createReplicator({ entities: [
    { obj: () => ball, opacity: { get: () => mat.opacity, set: v => { mat.opacity = v; } }, color: { get: () => mat.col, set: v => { mat.col = v; } } },
    { obj: () => fig, bones: () => bones, boneT: () => feet, extras: [{ get: () => num.v, set: v => { num.v = v; } }], bits: [{ get: () => flag.b, set: v => { flag.b = v; } }] },
    { obj: () => helm, scale: true, parents: () => [p1, p2] },
  ] });
  R.bindBones();
  return { R, ball, fig, bones, feet, mat, num, flag, helm, p1, p2 };
}
const H = world(), G = world();
const step = (t, f) => { f(H); const pk = H.R.encode(t); const d = G.R.decode(pk); G.R.apply(d.snap); return pk.byteLength; };

let sz = step(0, h => { h.ball.position.set(1, 2, 3); });
ok(G.ball.position.x === 1 && G.ball.position.z === 3, 'position arrives');
sz = step(16, h => { const q = rnd(); h.bones[5].quaternion.set(...q); h.helm.quaternion.set(...q); h.mat.opacity = 0.5; h.mat.col = 0x123456; h.num.v = 7.5; h.flag.b = true; h.p2.add(h.helm); h.helm.scale.set(2, 2, 2); h.feet[0].position.set(0.01, 0.02, 0.03); });
const bq = H.bones[5].quaternion, gq = G.bones[5].quaternion;
ok(Math.abs(bq.x * gq.x + bq.y * gq.y + bq.z * gq.z + bq.w * gq.w) > 0.99999, 'bone rotation arrives');
ok(near(G.mat.opacity, 0.5, 0.003) && G.mat.col === 0x123456 && G.num.v === 7.5 && G.flag.b === true, 'opacity, colour, extras, bits arrive');
ok(G.helm.parent === G.p2 && G.helm.scale.x === 2, 'reparenting and scale arrive');
ok(near(G.feet[0].position.y, 0.02, 1e-6), 'bone positions arrive');

// nothing moving: after the redundancy window only the staggered refreshes go out
for (let i = 0; i < S.REDUNDANT + 1; i++) step(32 + i * 16, () => {});
let quiet = 0; for (let i = 0; i < S.REFRESH; i++) quiet += step(200 + i * 16, () => {});
ok(quiet / S.REFRESH < 60, `a still scene costs little (${(quiet / S.REFRESH).toFixed(0)} B/frame)`);

// a lost packet heals by the next one (changes are repeated for a few frames)
H.ball.position.set(9, 9, 9); H.R.encode(600);       // lost
step(616, () => {});
ok(G.ball.position.x === 9, 'a lost change arrives with the next packet');
// an older packet arriving late is ignored
const old = H.R.encode(632); step(648, h => { h.ball.position.set(5, 5, 5); });
ok(G.R.decode(old) === null && G.ball.position.x === 5, 'a late packet is dropped');

// a busy figure: every bone turning every frame
let busy = 0; for (let i = 0; i < 10; i++) busy += step(700 + i * 16, h => { h.bones.forEach(b => b.quaternion.set(...rnd())); h.fig.position.set(i, 0, i); });
ok(busy / 10 < 31 * 4 + 60, `a moving figure is ~4 bytes a bone (${(busy / 10).toFixed(0)} B/frame)`);

// mixing: half way between two states, rotations stay unit length, a jump snaps
const a = new Float32Array(G.R.size), b = new Float32Array(G.R.size);
const d1 = (() => { H.ball.position.set(0, 0, 0); H.fig.position.set(0, 0, 0); return G.R.decode(H.R.encode(900)).snap; })();
const d2 = (() => { H.ball.position.set(1, 0, 0); H.fig.position.set(10, 0, 0); return G.R.decode(H.R.encode(916)).snap; })();
const m = G.R.mix(d1, d2, 0.5); G.R.apply(m);
ok(near(G.ball.position.x, 0.5, 1e-6), 'positions blend');
ok(G.fig.position.x === 10, 'a jump of more than 2 m is not smeared');
ok(near(Math.hypot(G.bones[3].quaternion.x, G.bones[3].quaternion.y, G.bones[3].quaternion.z, G.bones[3].quaternion.w), 1, 1e-5), 'blended rotations stay unit');
void a; void b;

// playout: steady 60 Hz frames, 30 ms floor, a few ms of jitter: draws ~33 ms behind, evenly paced
const P = S.createPlayout({});
let t = 0, shown = [], rng = 1;
const rand = () => { rng = (rng * 16807) % 2147483647; return rng / 2147483647; };
const arrivals = [];
for (let i = 0; i < 400; i++) { const ht = i * 1000 / 60; arrivals.push([ht + 30 + rand() * rand() * 6, ht]); }
arrivals.sort((x, y) => x[0] - y[0]);
let ai = 0;
for (let gnow = 0; gnow < 6600; gnow += 1000 / 60) {
  while (ai < arrivals.length && arrivals[ai][0] <= gnow) { const [arr, ht] = arrivals[ai++]; P.push(ht, arr, new Float32Array([ht])); }
  const p = P.pick(gnow);
  if (p && gnow > 2000) shown.push([gnow, p.t, p.delay]);
}
const del = shown.map(x => x[0] - x[1]).sort((x, y) => x - y);
ok(del[Math.floor(del.length / 2)] < 30 + 6 + 1 + 1000 / 60 + 0.5, `playout delay stays near floor + jitter (median ${del[Math.floor(del.length / 2)].toFixed(1)} ms)`);
const gaps = shown.slice(1).map((x, i) => x[1] - shown[i][1]);
if (process.env.DBG) console.log(shown.slice(0, 40).map(x => [x[1].toFixed(1), x[2].toFixed(1)].join('/')).join(' '));
const even = gaps.filter(g => Math.abs(g - 1000 / 60) < 0.5).length / gaps.length;
ok(even > 0.93, `frames come out evenly paced (${(even * 100).toFixed(1)}% one frame apart)`);
// smooth: one frame more delay, never a stepped or repeated frame
const P2 = S.createPlayout({ smooth: true }); ai = 0; const sh2 = [];
for (let gnow = 0; gnow < 6600; gnow += 1000 / 60) {
  while (ai < arrivals.length && arrivals[ai][0] <= gnow) { const [arr, ht] = arrivals[ai++]; P2.push(ht, arr, new Float32Array([ht])); }
  const p = P2.pick(gnow); if (p && gnow > 2000) sh2.push(p.t);
}
const g2 = sh2.slice(1).map((x, i) => x - sh2[i]);
ok(g2.filter(g => Math.abs(g - 1000 / 60) < 0.5).length / g2.length > 0.93, 'smooth mode is evenly paced too');

console.log(fails ? `${fails}/${n} FAILED` : `all ${n} passed`);
process.exit(fails ? 1 : 0);
