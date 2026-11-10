/*
 * Iron Ludus - surfaces drawn in code: wood grain, sackcloth, rope, stitched leather, linen,
 * brushed iron. Each comes as a colour map plus a normal map made from the same height field, so
 * leather shows its stitches and sacking its weave under the arena sun. Cached: built once.
 * Classic script: defines window.LudusMat.
 */
(function () {
  'use strict';
  const T = THREE;
  const cache = {};
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  /** A normal map from a greyscale height canvas (brighter = higher). */
  function normalFrom(hc, strength) {
    const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const g = out.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return out;
  }
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function tex(c, srgb, rx, ry) {
    const t = new T.CanvasTexture(c);
    if (srgb) t.encoding = T.sRGBEncoding;
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx || 1, ry || 1); t.anisotropy = 4;
    return t;
  }
  /**
   * draw(colourCtx, heightCtx, w, h) paints both; returns { map, normalMap } (repeat rx, ry).
   */
  function surface(key, w, h, draw, strength, rx, ry) {
    const k = key + ':' + (rx || 1) + ':' + (ry || 1);
    if (cache[k]) return cache[k];
    const c = canvas(w, h), hc = canvas(w, h);
    const cg = c.getContext('2d'), hg = hc.getContext('2d');
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, w, h);
    draw(cg, hg, w, h);
    return (cache[k] = { map: tex(c, true, rx, ry), normalMap: tex(normalFrom(hc, strength), false, rx, ry) });
  }

  /** Weathered oak, grain running along V (the texture's height). */
  function wood(tone) {
    return surface('wood' + (tone || ''), 128, 256, (g, hg, w, h) => {
      const base = tone === 'dark' ? [58, 38, 22] : tone === 'pale' ? [150, 118, 82] : [112, 80, 50];
      g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const x = rnd() * w, l = 0.75 + rnd() * 0.45, wd = 0.6 + rnd() * 2.2;
        g.strokeStyle = `rgba(${base.map(v => Math.round(v * l)).join(',')},0.7)`; g.lineWidth = wd;
        hg.strokeStyle = `rgba(${l > 1 ? 160 : 90},${l > 1 ? 160 : 90},${l > 1 ? 160 : 90},0.6)`; hg.lineWidth = wd;
        for (const c of [g, hg]) { c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + rnd() * 6 - 3, h * 0.33, x + rnd() * 6 - 3, h * 0.66, x + rnd() * 4 - 2, h); c.stroke(); }
      }
      for (let i = 0; i < 3; i++) {   // knots
        const x = rnd() * w, y = rnd() * h, r = 4 + rnd() * 6;
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(30,18,8,0.9)'); gr.addColorStop(1, 'rgba(30,18,8,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 2.2, 0, 0, 7); g.fill();
        hg.fillStyle = 'rgba(40,40,40,0.8)'; hg.beginPath(); hg.ellipse(x, y, r * 0.7, r * 1.6, 0, 0, 7); hg.fill();
      }
      for (let i = 0; i < 14; i++) {   // cracks and weathering
        const x = rnd() * w, y = rnd() * h, len = 20 + rnd() * 60;
        hg.strokeStyle = 'rgba(20,20,20,0.9)'; hg.lineWidth = 1; hg.beginPath(); hg.moveTo(x, y); hg.lineTo(x + rnd() * 3 - 1.5, y + len); hg.stroke();
        g.strokeStyle = 'rgba(25,15,8,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd() * 3 - 1.5, y + len); g.stroke();
      }
    }, 3);
  }
  /** Coarse sackcloth: a loose basket weave, stained. */
  function burlap(rx, ry) {
    return surface('burlap', 128, 128, (g, hg, w, h) => {
      g.fillStyle = '#b39462'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
        const over = ((x + y) / 4) % 2 === 0, l = 0.85 + rnd() * 0.3;
        g.fillStyle = `rgb(${Math.round(176 * l)},${Math.round(146 * l)},${Math.round(98 * l)})`;
        g.fillRect(x, y, over ? 4 : 3, over ? 3 : 4);
        hg.fillStyle = over ? '#c8c8c8' : '#9a9a9a'; hg.fillRect(x, y, over ? 4 : 3, over ? 3 : 4);
        hg.fillStyle = '#303030'; hg.fillRect(x + 3, y + 3, 1, 1);
      }
      for (let i = 0; i < 8; i++) {   // stains
        const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 20;
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(70,45,20,0.28)'); gr.addColorStop(1, 'rgba(70,45,20,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }, 2.5, rx, ry);
  }
  /** Twisted hemp rope; strands run diagonally along U. */
  function rope(rx, ry) {
    return surface('rope', 64, 32, (g, hg, w, h) => {
      g.fillStyle = '#8a6d43'; g.fillRect(0, 0, w, h);
      for (let i = -4; i < 12; i++) {
        const x = i * 8;
        const gr = g.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, '#5e4526'); gr.addColorStop(0.5, '#b08d5a'); gr.addColorStop(1, '#5e4526');
        g.fillStyle = gr; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 8, 0); g.lineTo(x + 16, h); g.lineTo(x + 8, h); g.fill();
        const hr = hg.createLinearGradient(x, 0, x + 8, 0); hr.addColorStop(0, '#202020'); hr.addColorStop(0.5, '#ffffff'); hr.addColorStop(1, '#202020');
        hg.fillStyle = hr; hg.beginPath(); hg.moveTo(x, 0); hg.lineTo(x + 8, 0); hg.lineTo(x + 16, h); hg.lineTo(x + 8, h); hg.fill();
      }
    }, 4, rx, ry);
  }
  /** Oiled leather with a fine grain and a stitched seam along each long edge. */
  function leather(tone) {
    return surface('leather' + (tone || ''), 128, 128, (g, hg, w, h) => {
      const base = tone === 'dark' ? [46, 28, 17] : [74, 46, 28];
      g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const x = rnd() * w, y = rnd() * h, l = 0.8 + rnd() * 0.4;
        g.fillStyle = `rgba(${base.map(v => Math.round(v * l)).join(',')},0.6)`; g.fillRect(x, y, 2, 2);
        hg.fillStyle = l > 1 ? 'rgba(170,170,170,0.5)' : 'rgba(90,90,90,0.5)'; hg.fillRect(x, y, 2, 2);
      }
      for (const x of [10, w - 10]) {   // seams with stitches
        hg.fillStyle = '#4a4a4a'; hg.fillRect(x - 1, 0, 2, h);
        for (let y = 2; y < h; y += 8) {
          g.fillStyle = 'rgba(214,190,150,0.85)'; g.fillRect(x + 2, y, 2, 5);
          hg.fillStyle = '#d0d0d0'; hg.fillRect(x + 2, y, 2, 5);
        }
      }
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.5, 'rgba(255,220,180,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, 2.5);
  }
  /** Undyed linen with soft folds running along V. */
  function linen() {
    return surface('linen', 128, 128, (g, hg, w, h) => {
      g.fillStyle = '#d8ccb4'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(120,100,70,${0.05 + rnd() * 0.06})`; g.fillRect(0, y, w, 1); }
      for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(120,100,70,${0.04 + rnd() * 0.05})`; g.fillRect(x, 0, 1, h); }
      for (let i = 0; i < 7; i++) {   // folds
        const x = rnd() * w, wd = 6 + rnd() * 10;
        const gr = hg.createLinearGradient(x - wd, 0, x + wd, 0); gr.addColorStop(0, 'rgba(128,128,128,0)'); gr.addColorStop(0.5, 'rgba(210,210,210,0.8)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
        hg.fillStyle = gr; hg.fillRect(x - wd, 0, wd * 2, h);
        const cg = g.createLinearGradient(x - wd, 0, x + wd, 0); cg.addColorStop(0, 'rgba(90,70,40,0)'); cg.addColorStop(0.15, 'rgba(90,70,40,0.12)'); cg.addColorStop(0.5, 'rgba(255,250,235,0.1)'); cg.addColorStop(1, 'rgba(90,70,40,0)');
        g.fillStyle = cg; g.fillRect(x - wd, 0, wd * 2, h);
      }
    }, 2);
  }
  /** Hammered, brushed iron: fine streaks along U, a few dents. */
  function iron() {
    return surface('iron', 128, 128, (g, hg, w, h) => {
      g.fillStyle = '#8d9096'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const y = rnd() * h, l = rnd();
        g.fillStyle = `rgba(${l > 0.5 ? '210,214,220' : '60,62,66'},0.12)`; g.fillRect(0, y, w, 1);
        hg.fillStyle = `rgba(${l > 0.5 ? '150,150,150' : '110,110,110'},0.5)`; hg.fillRect(0, y, w, 1);
      }
      for (let i = 0; i < 10; i++) {
        const x = rnd() * w, y = rnd() * h, r = 4 + rnd() * 9;
        const gr = hg.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(60,60,60,0.6)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
        hg.fillStyle = gr; hg.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }, 2);
  }
  /** Rough sandstone for plinths. */
  function stone() {
    return surface('stone', 128, 128, (g, hg, w, h) => {
      g.fillStyle = '#a8957a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1600; i++) {
        const x = rnd() * w, y = rnd() * h, l = 0.82 + rnd() * 0.36, s = 1 + rnd() * 2;
        g.fillStyle = `rgba(${Math.round(168 * l)},${Math.round(149 * l)},${Math.round(122 * l)},0.7)`; g.fillRect(x, y, s, s);
        hg.fillStyle = `rgba(${Math.round(128 * l)},${Math.round(128 * l)},${Math.round(128 * l)},0.7)`; hg.fillRect(x, y, s, s);
      }
    }, 2.5);
  }
  const lin = c => new T.Color(c).convertSRGBToLinear();
  /** A standard material on one of the surfaces. */
  function mat(surf, o) {
    o = o || {};
    const m = new T.MeshStandardMaterial({ map: surf.map, normalMap: surf.normalMap, roughness: o.rough === undefined ? 0.8 : o.rough, metalness: o.metal || 0,
      envMapIntensity: o.env === undefined ? 0.8 : o.env });
    if (o.tint) m.color = lin(o.tint);
    if (o.normal) m.normalScale.set(o.normal, o.normal);
    return m;
  }

  window.LudusMat = { wood, burlap, rope, leather, linen, iron, stone, mat, normalFrom };
})();
