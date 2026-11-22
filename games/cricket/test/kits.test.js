// Kits, flags and faces (kits.js): every side dressed, real flags for the nations, no trademarks,
// the canvas layout sound. Drawing runs against a stand-in 2D context (no browser).
// Run: node games/cricket/test/kits.test.js
'use strict';
const path = require('path');
const K = require(path.join(__dirname, '..', 'kits.js'));
const T = require(path.join(__dirname, '..', 'teams.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}

/** A 2D context that accepts every call and records what was drawn where. */
function fakeCtx() {
  const log = { calls: 0, text: [], fills: new Set(), bad: [] };
  const grad = { addColorStop() {} };
  const num = (k, args) => { if (args.some(a => typeof a === 'number' && !Number.isFinite(a))) log.bad.push(k); };
  const ctx = new Proxy({}, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'measureText') return s => ({ width: String(s).length * (parseInt(String(o.font || '10px').match(/(\d+)px/)[1], 10) * 0.55) });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { num(k, a); return grad; };
      if (k === 'fillText' || k === 'strokeText') return (s, ...a) => { num(k, a); log.calls++; log.text.push(String(s)); };
      return (...a) => { num(k, a); log.calls++; if (k === 'fill' || k === 'fillRect') log.fills.add(o.fillStyle); };
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  return { ctx, log };
}

const hex = /^#[0-9a-f]{6}$/i;
check('a kit for every side (and the umpire), all colours valid', T.TEAMS.every(t => { const k = K.KITS[t.id]; return k && ['base', 'deep', 'accent', 'trim', 'pants', 'word'].every(c => hex.test(k[c])); }) && !!K.KITS.ump);
check('every nation wears its real flag; franchises do not', T.TEAMS.every(t => (t.kind === 'nation') === K.FLAGS.includes(t.id)));
check('the word across the chest: the country, or the franchise city', K.WORD.ind === 'INDIA' && K.WORD.pak === 'PAKISTAN' && T.TEAMS.every(t => typeof K.WORD[t.id] === 'string' && K.WORD[t.id].length > 2));
const MARKS = ['BCCI', 'PCB', 'ICC', 'CRICKET AUSTRALIA', 'ECB', 'CSA', 'NZC', 'DREAM11', 'ADIDAS', 'NIKE', 'PUMA', 'BYJU', 'OPPO', 'EMIRATES', 'TATA', 'IPL', 'SUPER KINGS', 'KNIGHT RIDERS', 'ROYAL CHALLENGERS', 'SUNRISERS'];
check('no board crest, league or sponsor name anywhere on a kit (trademarks)', Object.values(K.WORD).every(w => !MARKS.some(m => w.includes(m))));

{
  const L = K.LAYOUT, names = Object.keys(L).filter(k => Array.isArray(L[k]));
  const inside = names.every(n => { const [x, y, w, h] = L[n]; return x >= 0 && y >= 0 && x + w <= L.W && y + h <= L.H; });
  check('every canvas region inside the 512x512 canvas', inside);
  // the blink copies (eyes and shoes again 64 px lower) must not land on another region
  const rects = names.map(n => [n, L[n]]).concat([['eyesShut', [L.eyes[0], L.eyes[1] + 64, L.eyes[2], L.eyes[3]]], ['shoeShut', [L.shoe[0], L.shoe[1] + 64, L.shoe[2], L.shoe[3]]]]);
  const over = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, A] = rects[i], [b, B] = rects[j];
    if (A[0] < B[0] + B[2] && B[0] < A[0] + A[2] && A[1] < B[1] + B[3] && B[1] < A[1] + A[3]) over.push(a + '/' + b);
  }
  check('no two regions overlap (shut eyes and their shoes included)', over.length === 0, over);
  check('the blink offset is the 64 px shift', Math.abs(K.BLINK - 64 / 512) < 1e-9);
}

for (const id of K.FLAGS) {
  const { ctx, log } = fakeCtx();
  K.drawFlag(ctx, id, 0, 0, 90, 60);
  check(`flag ${id}: drawn, finite`, log.calls > 3 && log.bad.length === 0, log.bad);
}
{
  const f = id => { const { ctx, log } = fakeCtx(); K.drawFlag(ctx, id, 0, 0, 90, 60); return log.fills; };
  const ind = f('ind'), pak = f('pak');
  check('India: saffron, white, green, the navy chakra', ['#ff9933', '#ffffff', '#138808', '#000080'].every(c => ind.has(c)));
  check('Pakistan: dark green with the white band, crescent and star', ['#01411c', '#ffffff'].every(c => pak.has(c)));
}

{
  let ok = true; const bad = [];
  for (const t of T.TEAMS) {
    const nums = T.numbers(t);
    t.players.forEach((name, i) => {
      const { ctx, log } = fakeCtx();
      try { K.drawPlayer(ctx, t, { name, number: nums[i], look: t.looks[i], style: T.style(name, t.looks[i]) }); }
      catch (e) { ok = false; bad.push(t.id + ':' + name + ' ' + e.message); return; }
      if (log.bad.length) { ok = false; bad.push(t.id + ':' + name + ' ' + log.bad.join()); }
      if (i === 0 && !(log.text.includes(K.backName(name)) && log.text.includes(String(nums[i])) && log.text.includes(K.WORD[t.id]))) { ok = false; bad.push(t.id + ' missing name/number/word'); }
    });
  }
  check('every player of every side: shirt drawn with his name, number and the side\'s word, nothing NaN', ok, bad.slice(0, 4));
  const { ctx, log } = fakeCtx();
  K.drawPlayer(ctx, { id: 'ump' }, { name: 'Umpire', number: null, look: { skin: 2, beard: 1, hair: 'g' }, style: { beard: 'trim' } });
  check('the umpire: a plain shirt, no number, no name', !log.text.some(s => /\d/.test(s)) && !log.text.includes('UMPIRE'));
}
{
  // every beard style on every skin tone draws
  const styles = ['clean', 'stubble', 'trim', 'full', 'long', 'goatee', 'moustache'];
  let ok = true;
  for (const beard of styles) for (let skin = 0; skin < 5; skin++) for (const hair of ['short', 'crop']) {
    const { ctx, log } = fakeCtx();
    try { K.drawFace(ctx, { skin, beard: 1, hair: 'k' }, { beard, hair }); } catch (e) { ok = false; }
    if (log.bad.length) ok = false;
  }
  check('every beard style, skin tone and crop draws a face', ok);
}
{
  const { ctx, log } = fakeCtx();
  K.drawGear(ctx, 'ind');
  check('gear texture: eight colour cells and the flag', log.fills.has('#ff9933') && log.fills.has('#138808') && log.calls > 10);
}
check('back names: the surname', K.backName('Virat Kohli') === 'KOHLI' && K.backName('MS Dhoni') === 'DHONI' && K.backName('Rassie van der Dussen') === 'DUSSEN');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
