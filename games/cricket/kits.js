/*
 * Willowlight - kits, flags and faces, drawn in code (node games/cricket/test/kits.test.js for the data).
 *
 * Every player wears one 512x512 canvas: his shirt (front, back with his name and number, the two
 * sleeves), trousers, socks and shoes, and his face (skin, brows, eyes open and shut, lips, beard),
 * laid out as LAYOUT (actors.js gives the model texture coordinates into these regions).
 *
 * National sides wear their own colours and patterns with their country's real flag on the sleeve
 * and the country's name across the chest. No board crest, no sponsor: no one's trademark. City
 * franchises are made up (teams.js): their kits are original designs in their colours.
 */
(function (root) {
  'use strict';
  // regions of the player canvas: [x, y, w, h] in pixels, y down (actors.js unwrap)
  const LAYOUT = {
    W: 512, H: 512,
    front: [0, 0, 192, 224], back: [192, 0, 192, 224],
    sleeveL: [384, 0, 128, 64], sleeveR: [384, 64, 128, 64], plain: [392, 136, 112, 16],
    face: [0, 224, 224, 224], side: [224, 224, 160, 160],
    eyes: [384, 224, 128, 64],          // eyes open; shut: the same 64 px lower (BLINK)
    shoe: [384, 352, 128, 64],          // and again 64 px lower, so a blink never changes the shoes
    skin: [8, 456, 112, 48], hand: [136, 456, 48, 48], trouser: [200, 456, 112, 48], sock: [328, 456, 48, 48], hair: [224, 392, 152, 48],
    scalp: [392, 484, 112, 24],         // the head under the hair: skin, or a crop's stubble
  };
  const BLINK = 64 / 512;               // the eyes' texture offset for shut eyes

  // ------------------------------------------------------------------ kit designs
  // nations: their real colours and the pattern they read as; franchises: original designs
  const KITS = {
    ind: { base: '#1d3f99', deep: '#122a6b', accent: '#ff9933', trim: '#ffffff', pants: '#14295e', word: '#ff9933', pattern: 'india', flag: 'ind', helmet: '#18337d' },
    pak: { base: '#0c7a3e', deep: '#075a2c', accent: '#7cc242', trim: '#ffffff', pants: '#0a4f29', word: '#ffffff', pattern: 'pakistan', flag: 'pak', helmet: '#0a5a2d' },
    aus: { base: '#f7c600', deep: '#e3ad00', accent: '#00703c', trim: '#00703c', pants: '#f2c200', word: '#00703c', pattern: 'australia', flag: 'aus', helmet: '#0e4a2a' },
    eng: { base: '#1b2d6e', deep: '#121f52', accent: '#d62839', trim: '#ffffff', pants: '#16255c', word: '#ffffff', pattern: 'england', flag: 'eng', helmet: '#141f55' },
    rsa: { base: '#4fae3b', deep: '#1f7a3a', accent: '#ffb81c', trim: '#ffb81c', pants: '#1b5e34', word: '#ffb81c', pattern: 'proteas', flag: 'rsa', helmet: '#175a32' },
    nzl: { base: '#141414', deep: '#060606', accent: '#9aa0a6', trim: '#d0d3d6', pants: '#161616', word: '#e8e8e8', pattern: 'blackcaps', flag: 'nzl', helmet: '#111214' },
    mum: { base: '#0e8f8f', deep: '#0a5f63', accent: '#d4af37', trim: '#d4af37', pants: '#12304a', word: '#ffe9a8', pattern: 'wave' },
    che: { base: '#5ec8f2', deep: '#3aa6d6', accent: '#1d3f8f', trim: '#1d3f8f', pants: '#1d3f8f', word: '#1d3f8f', pattern: 'pinstripe' },
    blr: { base: '#c8102e', deep: '#3a0a10', accent: '#d4af37', trim: '#d4af37', pants: '#151515', word: '#ffd86b', pattern: 'fade' },
    kol: { base: '#4b2c82', deep: '#2c1752', accent: '#e0b84a', trim: '#e0b84a', pants: '#24133f', word: '#f2d27a', pattern: 'chevron' },
    hyd: { base: '#f26522', deep: '#c2440e', accent: '#141414', trim: '#141414', pants: '#1a1a1a', word: '#141414', pattern: 'sash' },
    jai: { base: '#e5469b', deep: '#b82a76', accent: '#23234f', trim: '#23234f', pants: '#23234f', word: '#ffffff', pattern: 'panels' },
    del: { base: '#f2f2f2', deep: '#d9d9de', accent: '#c8102e', trim: '#1d2a6b', pants: '#c8102e', word: '#c8102e', pattern: 'sash' },
    ump: { base: '#e9edf2', deep: '#cfd6de', accent: '#2a3446', trim: '#2a3446', pants: '#23262d', word: '#2a3446', pattern: 'umpire', helmet: '#f4f4f0' },
    pun: { base: '#9aa0a8', deep: '#6f757e', accent: '#a50f2d', trim: '#a50f2d', pants: '#6b1020', word: '#a50f2d', pattern: 'hoops' },
  };
  // the word across the chest: the country, or the franchise's city
  const WORD = { ind: 'INDIA', pak: 'PAKISTAN', aus: 'AUSTRALIA', eng: 'ENGLAND', rsa: 'SOUTH AFRICA', nzl: 'NEW ZEALAND',
    mum: 'MUMBAI', che: 'CHENNAI', blr: 'BENGALURU', kol: 'KOLKATA', hyd: 'HYDERABAD', jai: 'JAIPUR', del: 'DELHI', pun: 'PUNJAB', ump: '' };
  const FLAGS = ['ind', 'pak', 'aus', 'eng', 'rsa', 'nzl'];

  const SKIN = ['#f1c8a0', '#e0ac69', '#c68642', '#8d5524', '#5c3a21'];
  const HAIR = { k: '#16100a', b: '#4a2f18', y: '#c9a35a', r: '#9a4a1c', g: '#9a9a9a' };

  // ------------------------------------------------------------------ colour helpers (pure)
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, k) => { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A.map((v, i) => v + (B[i] - v) * k)); };
  const shade = (a, k) => (k < 0 ? mix(a, '#000000', -k) : mix(a, '#ffffff', k));
  const luma = h => { const c = hexRgb(h); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; };

  // ------------------------------------------------------------------ flags (real national flags)
  function star(g, cx, cy, r, points, inner, rot) {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = (rot || -Math.PI / 2) + i * Math.PI / points, rr = i % 2 ? r * inner : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }
  function unionJack(g, x, y, w, h) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = '#012169'; g.fillRect(x, y, w, h);
    const d = Math.hypot(w, h), t = h / 5;
    const diag = (lw, col, off) => {
      g.strokeStyle = col; g.lineWidth = lw;
      g.beginPath(); g.moveTo(x, y + off); g.lineTo(x + w, y + h + off); g.stroke();
      g.beginPath(); g.moveTo(x + w, y - off); g.lineTo(x, y + h - off); g.stroke();
    };
    diag(t * 1.0, '#ffffff', 0);
    diag(t * 0.34, '#c8102e', t * 0.12);
    g.fillStyle = '#ffffff'; g.fillRect(x + w / 2 - t * 0.85, y, t * 1.7, h); g.fillRect(x, y + h / 2 - t * 0.85, w, t * 1.7);
    g.fillStyle = '#c8102e'; g.fillRect(x + w / 2 - t * 0.5, y, t, h); g.fillRect(x, y + h / 2 - t * 0.5, w, t);
    g.restore();
    return d;
  }
  /** Draw nation `id`'s flag into the rectangle (any size; 2:3 proportions look right). */
  function drawFlag(g, id, x, y, w, h) {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    if (id === 'ind') {
      g.fillStyle = '#ff9933'; g.fillRect(x, y, w, h / 3);
      g.fillStyle = '#ffffff'; g.fillRect(x, y + h / 3, w, h / 3);
      g.fillStyle = '#138808'; g.fillRect(x, y + 2 * h / 3, w, h / 3 + 1);
      // the Ashoka Chakra: navy wheel, 24 spokes
      const cx = x + w / 2, cy = y + h / 2, r = h / 6 * 0.92;
      g.strokeStyle = '#000080'; g.lineWidth = Math.max(1, r * 0.16);
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.lineWidth = Math.max(0.6, r * 0.06);
      for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke(); }
      g.fillStyle = '#000080'; g.beginPath(); g.arc(cx, cy, r * 0.2, 0, Math.PI * 2); g.fill();
    } else if (id === 'pak') {
      g.fillStyle = '#ffffff'; g.fillRect(x, y, w / 4, h);
      g.fillStyle = '#01411c'; g.fillRect(x + w / 4, y, w * 0.75 + 1, h);
      const cx = x + w * 0.625, cy = y + h / 2, R = h * 0.3;
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#01411c'; g.beginPath(); g.arc(cx + R * 0.3, cy - R * 0.24, R * 0.86, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; star(g, cx + R * 0.62, cy - R * 0.52, R * 0.36, 5, 0.4, -Math.PI / 2 + 0.6);
    } else if (id === 'aus' || id === 'nzl') {
      g.fillStyle = '#012169'; g.fillRect(x, y, w, h);
      unionJack(g, x, y, w / 2, h / 2);
      if (id === 'aus') {
        g.fillStyle = '#ffffff';
        star(g, x + w / 4, y + h * 0.75, h * 0.15, 7, 0.45);                                // the Commonwealth Star
        [[0.75, 0.83, 0.075], [0.6, 0.47, 0.075], [0.75, 0.2, 0.075], [0.875, 0.4, 0.075]].forEach(([sx, sy, r]) => star(g, x + w * sx, y + h * sy, h * r, 7, 0.45));
        star(g, x + w * 0.81, y + h * 0.55, h * 0.04, 5, 0.42);                            // Epsilon Crucis
      } else {
        [[0.75, 0.82, 0.075], [0.62, 0.45, 0.065], [0.75, 0.2, 0.06], [0.87, 0.38, 0.065]].forEach(([sx, sy, r]) => {
          g.fillStyle = '#ffffff'; star(g, x + w * sx, y + h * sy, h * r * 1.35, 5, 0.42);
          g.fillStyle = '#c8102e'; star(g, x + w * sx, y + h * sy, h * r, 5, 0.42);
        });
      }
    } else if (id === 'eng') {
      g.fillStyle = '#ffffff'; g.fillRect(x, y, w, h);
      g.fillStyle = '#ce1124'; const t = h / 5; g.fillRect(x + w / 2 - t / 2, y, t, h); g.fillRect(x, y + h / 2 - t / 2, w, t);
    } else if (id === 'rsa') {
      g.fillStyle = '#e03c31'; g.fillRect(x, y, w, h / 2);
      g.fillStyle = '#001489'; g.fillRect(x, y + h / 2, w, h / 2);
      const Y = (lw, col) => { g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = 'miter'; g.beginPath(); g.moveTo(x - 2, y - h * 0.02); g.lineTo(x + w * 0.42, y + h / 2); g.lineTo(x - 2, y + h * 1.02); g.moveTo(x + w * 0.42, y + h / 2); g.lineTo(x + w + 2, y + h / 2); g.stroke(); };
      Y(h * 0.33, '#ffffff'); Y(h * 0.2, '#007749');
      g.fillStyle = '#ffb612'; g.beginPath(); g.moveTo(x, y + h * 0.2); g.lineTo(x + w * 0.29, y + h / 2); g.lineTo(x, y + h * 0.8); g.fill();
      g.fillStyle = '#000000'; g.beginPath(); g.moveTo(x, y + h * 0.27); g.lineTo(x + w * 0.22, y + h / 2); g.lineTo(x, y + h * 0.73); g.fill();
    } else {
      // a franchise: its own banner (original: colours, a band, the short name)
      const k = KITS[id] || KITS.mum;
      g.fillStyle = k.base; g.fillRect(x, y, w, h);
      g.fillStyle = k.accent; g.fillRect(x, y + h * 0.36, w, h * 0.28);
      g.fillStyle = luma(k.accent) > 0.5 ? k.deep : '#ffffff';
      g.font = `900 ${Math.round(h * 0.26)}px Bahnschrift, "Segoe UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(id.toUpperCase(), x + w / 2, y + h / 2 + 1);
    }
    g.restore();
  }

  // ------------------------------------------------------------------ the shirt
  /** The pattern of a kit, over the base colour, in rectangle (x, y, w, h). part: 'front'|'back'|'sleeve'. */
  function pattern(g, k, part, x, y, w, h) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    const P = k.pattern, sl = part === 'sleeve';
    if (P === 'india') {
      // deep blue, tonal diagonal strokes, saffron sweeping over the shoulders, tricolour at the collar
      g.globalAlpha = 0.18; g.strokeStyle = k.deep; g.lineWidth = w * 0.035;
      for (let i = -h; i < w + h; i += w * 0.09) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + h * 0.6, y); g.stroke(); }
      g.globalAlpha = 1;
      if (sl) { const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, k.accent); gr.addColorStop(0.55, mix(k.accent, k.base, 0.65)); gr.addColorStop(1, k.base); g.fillStyle = gr; g.fillRect(x, y, w, h); }
      else {
        const gr = g.createLinearGradient(x, y, x, y + h * 0.3); gr.addColorStop(0, k.accent); gr.addColorStop(1, 'rgba(255,153,51,0)');
        g.fillStyle = gr; [[x, 1], [x + w, -1]].forEach(([sx, d]) => { g.beginPath(); g.moveTo(sx, y); g.lineTo(sx + d * w * 0.3, y); g.quadraticCurveTo(sx + d * w * 0.17, y + h * 0.12, sx, y + h * 0.3); g.fill(); });
        // tricolour piping down the sides
        [[k.accent, 0], ['#ffffff', 1], ['#138808', 2]].forEach(([c, i]) => { g.fillStyle = c; g.fillRect(x + w * 0.035 + i * 3, y + h * 0.28, 3, h * 0.72); g.fillRect(x + w * 0.965 - (i + 1) * 3, y + h * 0.28, 3, h * 0.72); });
      }
    } else if (P === 'pakistan') {
      // green, lighter-green angular flashes on the shoulders and sides, white piping
      g.fillStyle = k.accent; g.globalAlpha = 0.9;
      if (sl) { g.fillRect(x, y, w, h * 0.22); g.globalAlpha = 0.35; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + w * (0.1 + i * 0.25), y + h); g.lineTo(x + w * (0.22 + i * 0.25), y + h * 0.25); g.lineTo(x + w * (0.28 + i * 0.25), y + h * 0.25); g.lineTo(x + w * (0.16 + i * 0.25), y + h); g.fill(); } }
      else {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.3, y); g.lineTo(x, y + h * 0.42); g.fill();
        g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w * 0.7, y); g.lineTo(x + w, y + h * 0.42); g.fill();
        g.globalAlpha = 0.22;
        for (let i = 0; i < 7; i++) { const yy = y + h * (0.45 + i * 0.075); g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w * 0.16, yy - h * 0.05); g.lineTo(x + w * 0.16, yy - h * 0.02); g.lineTo(x, yy + h * 0.03); g.fill(); g.beginPath(); g.moveTo(x + w, yy); g.lineTo(x + w * 0.84, yy - h * 0.05); g.lineTo(x + w * 0.84, yy - h * 0.02); g.lineTo(x + w, yy + h * 0.03); g.fill(); }
        g.globalAlpha = 1; g.fillStyle = '#ffffff'; g.fillRect(x + w * 0.03, y + h * 0.42, 2, h * 0.58); g.fillRect(x + w * 0.97 - 2, y + h * 0.42, 2, h * 0.58);
      }
      g.globalAlpha = 1;
    } else if (P === 'australia') {
      // canary yellow, green and gold bands sweeping across the shoulders and down the sleeves
      g.fillStyle = k.accent;
      if (sl) { g.fillRect(x, y, w, h * 0.3); g.fillStyle = '#ffffff'; g.fillRect(x, y + h * 0.3, w, h * 0.04); }
      else {
        g.beginPath(); g.moveTo(x, y + h * 0.05); g.quadraticCurveTo(x + w / 2, y + h * 0.2, x + w, y + h * 0.05); g.lineTo(x + w, y); g.lineTo(x, y); g.fill();
        g.globalAlpha = 0.25; g.fillStyle = k.deep;
        for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(x, y + h * (0.55 + i * 0.07)); g.quadraticCurveTo(x + w / 2, y + h * (0.48 + i * 0.07), x + w, y + h * (0.55 + i * 0.07)); g.lineTo(x + w, y + h * (0.575 + i * 0.07)); g.quadraticCurveTo(x + w / 2, y + h * (0.505 + i * 0.07), x, y + h * (0.575 + i * 0.07)); g.fill(); }
        g.globalAlpha = 1; g.fillStyle = k.accent; g.fillRect(x, y + h * 0.3, w * 0.045, h * 0.7); g.fillRect(x + w * 0.955, y + h * 0.3, w * 0.045, h * 0.7);
      }
    } else if (P === 'england') {
      // navy, a red and sky-blue fade across the shoulders, red side panels
      if (sl) { g.fillStyle = k.accent; g.fillRect(x, y + h * 0.82, w, h * 0.06); g.fillStyle = '#7fb2e5'; g.fillRect(x, y + h * 0.9, w, h * 0.04); }
      else {
        const gr = g.createLinearGradient(x, y, x, y + h * 0.35); gr.addColorStop(0, 'rgba(127,178,229,0.55)'); gr.addColorStop(1, 'rgba(127,178,229,0)');
        g.fillStyle = gr; g.fillRect(x, y, w, h * 0.35);
        g.fillStyle = k.accent; g.fillRect(x, y + h * 0.32, w * 0.05, h * 0.68); g.fillRect(x + w * 0.95, y + h * 0.32, w * 0.05, h * 0.68);
      }
    } else if (P === 'proteas') {
      // green with a darker green fade below, gold flashes at the shoulders
      const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, k.base); gr.addColorStop(1, k.deep); g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.fillStyle = k.accent;
      if (sl) { g.fillRect(x, y, w, h * 0.12); g.fillRect(x, y + h * 0.86, w, h * 0.06); }
      else { g.beginPath(); g.moveTo(x, y + h * 0.2); g.lineTo(x + w * 0.22, y); g.lineTo(x + w * 0.3, y); g.lineTo(x, y + h * 0.28); g.fill(); g.beginPath(); g.moveTo(x + w, y + h * 0.2); g.lineTo(x + w * 0.78, y); g.lineTo(x + w * 0.7, y); g.lineTo(x + w, y + h * 0.28); g.fill(); }
    } else if (P === 'blackcaps') {
      // black, charcoal side panels and grey shoulders
      g.fillStyle = '#2a2a2c';
      if (sl) g.fillRect(x, y, w, h * 0.4);
      else { g.fillRect(x, y + h * 0.25, w * 0.12, h); g.fillRect(x + w * 0.88, y + h * 0.25, w * 0.12, h); g.fillStyle = '#3a3b3e'; g.fillRect(x, y, w, h * 0.08); }
      g.fillStyle = k.accent; if (!sl) { g.fillRect(x + w * 0.12, y + h * 0.25, 2, h); g.fillRect(x + w * 0.88 - 2, y + h * 0.25, 2, h); }
    } else if (P === 'wave') {
      g.strokeStyle = k.deep; g.lineWidth = h * 0.025; g.globalAlpha = 0.55;
      for (let i = 0; i < 9; i++) { const yy = y + h * (0.35 + i * 0.08); g.beginPath(); for (let s = 0; s <= 20; s++) g.lineTo(x + w * s / 20, yy + Math.sin(s * 0.9 + i) * h * 0.02); g.stroke(); }
      g.globalAlpha = 1; g.fillStyle = k.accent; if (sl) g.fillRect(x, y + h * 0.84, w, h * 0.08); else { g.fillRect(x, y + h * 0.28, w, h * 0.022); }
    } else if (P === 'pinstripe') {
      g.fillStyle = k.accent; g.globalAlpha = 0.35;
      for (let i = 0; i < w; i += w * 0.07) g.fillRect(x + i, y, Math.max(1, w * 0.008), h);
      g.globalAlpha = 1; if (sl) g.fillRect(x, y + h * 0.84, w, h * 0.1);
      else { g.fillRect(x, y, w, h * 0.05); }
    } else if (P === 'fade') {
      const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, k.base); gr.addColorStop(0.55, k.base); gr.addColorStop(1, k.deep); g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.fillStyle = k.accent; if (sl) g.fillRect(x, y + h * 0.84, w, h * 0.07); else { g.fillRect(x, y + h * 0.3, w * 0.03, h * 0.7); g.fillRect(x + w * 0.97, y + h * 0.3, w * 0.03, h * 0.7); }
    } else if (P === 'chevron') {
      g.fillStyle = k.accent; g.globalAlpha = 0.9;
      if (sl) g.fillRect(x, y + h * 0.82, w, h * 0.1);
      else { g.beginPath(); g.moveTo(x, y + h * 0.18); g.lineTo(x + w / 2, y + h * 0.4); g.lineTo(x + w, y + h * 0.18); g.lineTo(x + w, y + h * 0.25); g.lineTo(x + w / 2, y + h * 0.47); g.lineTo(x, y + h * 0.25); g.fill(); }
      g.globalAlpha = 0.2; g.fillStyle = k.deep; if (!sl) { g.beginPath(); g.moveTo(x, y + h * 0.55); g.lineTo(x + w / 2, y + h * 0.77); g.lineTo(x + w, y + h * 0.55); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.fill(); }
      g.globalAlpha = 1;
    } else if (P === 'sash') {
      g.fillStyle = k.accent;
      if (sl) g.fillRect(x, y + h * 0.8, w, h * 0.12);
      else { const back = part === 'back'; g.beginPath(); const a = back ? x + w : x; const b2 = back ? x : x + w; g.moveTo(a, y + h * 0.05); g.lineTo(a + (b2 - a) * 0.22, y); g.lineTo(b2, y + h * 0.78); g.lineTo(b2, y + h * 0.98); g.fill(); g.fillStyle = k.trim; g.globalAlpha = 0.9; g.beginPath(); g.moveTo(a, y + h * 0.1); g.lineTo(b2, y + h * 1.02); g.lineTo(b2, y + h * 1.06); g.lineTo(a, y + h * 0.14); g.fill(); g.globalAlpha = 1; }
    } else if (P === 'panels') {
      g.fillStyle = k.accent;
      if (sl) g.fillRect(x, y, w, h * 0.25);
      else { g.fillRect(x, y + h * 0.2, w * 0.14, h); g.fillRect(x + w * 0.86, y + h * 0.2, w * 0.14, h); g.fillRect(x, y, w, h * 0.06); }
    } else if (P === 'umpire') {
      // a plain collared shirt: a dark placket and collar
      if (!sl) { g.fillStyle = k.accent; g.fillRect(x + w * 0.485, y, w * 0.03, h * 0.3); g.fillStyle = '#ffffff'; [0.1, 0.18, 0.26].forEach(v => { g.beginPath(); g.arc(x + w * 0.5, y + h * v, 1.6, 0, 7); g.fill(); }); }
      else { g.fillStyle = k.deep; g.fillRect(x, y + h * 0.86, w, h * 0.14); }
    } else if (P === 'hoops') {
      g.fillStyle = k.deep; g.globalAlpha = 0.5;
      for (let i = 0; i < 5; i++) g.fillRect(x, y + h * (0.42 + i * 0.12), w, h * 0.05);
      g.globalAlpha = 1; g.fillStyle = k.accent; if (sl) g.fillRect(x, y + h * 0.82, w, h * 0.1); else g.fillRect(x, y + h * 0.3, w, h * 0.06);
    }
    g.restore();
  }
  function fitText(g, text, maxW, size, weight) {
    let s = size;
    do { g.font = `${weight || 800} ${s}px Bahnschrift, "Segoe UI", Arial, sans-serif`; s -= 1; } while (g.measureText(text).width > maxW && s > 6);
    return s + 1;
  }
  /** A number in the block style used on shirt backs: filled, with an outline. */
  function bigNumber(g, n, cx, cy, size, fill, edge) {
    g.font = `900 ${size}px Bahnschrift, "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = Math.max(2, size * 0.09); g.strokeStyle = edge; g.strokeText(String(n), cx, cy);
    g.fillStyle = fill; g.fillText(String(n), cx, cy);
  }

  /** The player canvas. team: { id }, p: { name, number, look:{skin,beard,hair,...}, style:{beard,brow,...} }, keeper: wears the keeper's top. */
  function drawPlayer(g, team, p) {
    const L = LAYOUT, k = KITS[team.id] || KITS.mum;
    const R = (r, fn) => fn(r[0], r[1], r[2], r[3]);
    g.clearRect(0, 0, L.W, L.H);
    const numCol = k.word, edge = luma(k.base) > 0.55 ? shade(k.word, -0.35) : shade(k.base, -0.5);
    // shirt front: base, pattern, collar, the word across the chest, the number below it, the flag at the heart
    R(L.front, (x, y, w, h) => {
      g.fillStyle = k.base; g.fillRect(x, y, w, h);
      pattern(g, k, 'front', x, y, w, h);
      // the collar: a V of the trim colour (India's in the tricolour)
      const cx = x + w / 2;
      if (k.pattern === 'india') { [['#ff9933', 0], ['#ffffff', 4], ['#138808', 8]].forEach(([c, o]) => { g.strokeStyle = c; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - w * 0.17 + o * 0.3, y); g.lineTo(cx, y + h * 0.17 - o * 0.6); g.lineTo(cx + w * 0.17 - o * 0.3, y); g.stroke(); }); }
      else { g.strokeStyle = k.trim; g.lineWidth = 5; g.beginPath(); g.moveTo(cx - w * 0.16, y); g.lineTo(cx, y + h * 0.15); g.lineTo(cx + w * 0.16, y); g.stroke(); }
      g.fillStyle = shade(k.base, -0.25); g.beginPath(); g.moveTo(cx - w * 0.14, y); g.lineTo(cx, y + h * 0.13); g.lineTo(cx + w * 0.14, y); g.fill();
      // the word across the chest (the country, or the city)
      const word = WORD[team.id] !== undefined ? WORD[team.id] : team.id.toUpperCase();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const sz = fitText(g, word, w * 0.56, 28, 900);
      g.font = `italic 900 ${sz}px Bahnschrift, "Segoe UI", Arial, sans-serif`;
      g.lineWidth = 3; g.strokeStyle = edge; g.strokeText(word, cx, y + h * 0.36); g.fillStyle = k.word; g.fillText(word, cx, y + h * 0.36);
      // the number under it, on the right of the chest (his right: the viewer's left)
      if (p.number != null) bigNumber(g, p.number, cx - w * 0.13, y + h * 0.52, 26, numCol, edge);
      // the flag over his heart (his left: the viewer's right), or the franchise's badge
      if (FLAGS.includes(team.id)) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(cx + w * 0.08 - 1, y + h * 0.19 - 1, 29, 20); drawFlag(g, team.id, cx + w * 0.08, y + h * 0.19, 27, 18); }
      else if (team.id !== 'ump') { badge(g, team.id, k, cx + w * 0.16, y + h * 0.23, 12); }
    });
    // shirt back: the name across the shoulders and the big number
    R(L.back, (x, y, w, h) => {
      g.fillStyle = k.base; g.fillRect(x, y, w, h);
      pattern(g, k, 'back', x, y, w, h);
      const cx = x + w / 2;
      g.fillStyle = k.trim; g.fillRect(cx - w * 0.17, y, w * 0.34, 5);
      if (p.number == null) return;
      const nm = backName(p.name);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const sz = fitText(g, nm, w * 0.7, 26, 800);
      g.font = `800 ${sz}px Bahnschrift, "Segoe UI", Arial, sans-serif`;
      g.lineWidth = 3; g.strokeStyle = edge; g.strokeText(nm, cx, y + h * 0.2); g.fillStyle = numCol; g.fillText(nm, cx, y + h * 0.2);
      bigNumber(g, p.number, cx, y + h * 0.44, 74, numCol, edge);
    });
    // sleeves: base, pattern, the flag on the outside of the upper arm (the top of the region), a cuff
    [L.sleeveL, L.sleeveR].forEach((r, i) => R(r, (x, y, w, h) => {
      g.fillStyle = k.base; g.fillRect(x, y, w, h);
      pattern(g, k, 'sleeve', x, y, w, h);
      g.fillStyle = k.trim; g.fillRect(x, y + h * 0.88, w, h * 0.12);
      if (k.pattern === 'india') { g.fillStyle = '#ff9933'; g.fillRect(x, y + h * 0.84, w, 2); g.fillStyle = '#138808'; g.fillRect(x, y + h * 0.94, w, 3); }
      // 0.5 across is the outside of the arm; along the arm the flag sits a third of the way down
      if (FLAGS.includes(team.id)) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + w * 0.5 - 15, y + h * 0.3 - 1, 30, 21); drawFlag(g, team.id, x + w * 0.5 - 14, y + h * 0.3, 28, 19); }
      else if (team.id !== 'ump') badge(g, team.id, k, x + w * 0.5, y + h * 0.45, 11);
    }));
    R(L.plain, (x, y, w, h) => { g.fillStyle = k.base; g.fillRect(x, y, w, h); });
    // trousers, socks, shoes (white spikes, a dark sole, the kit's colour on the heel tab)
    R(L.trouser, (x, y, w, h) => { g.fillStyle = k.pants; g.fillRect(x, y, w, h); });
    R(L.sock, (x, y, w, h) => { g.fillStyle = '#f2f2f2'; g.fillRect(x, y, w, h); });
    const shoe = (x, y, w, h) => {
      g.fillStyle = '#f4f4f2'; g.fillRect(x, y, w, h);
      g.fillStyle = '#d9dbe0'; g.fillRect(x, y + h * 0.35, w, h * 0.12);
      g.fillStyle = k.accent; g.beginPath(); g.moveTo(x + w * 0.25, y + h * 0.3); g.lineTo(x + w * 0.62, y + h * 0.55); g.lineTo(x + w * 0.55, y + h * 0.66); g.lineTo(x + w * 0.2, y + h * 0.45); g.fill();
      g.fillStyle = '#5a5e66'; g.fillRect(x, y + h * 0.8, w, h * 0.2);
    };
    R(L.shoe, shoe);
    R(L.shoe, (x, y, w, h) => shoe(x, y + 64, w, h));
    drawFace(g, p.look || { skin: 2, beard: 1, hair: 'k' }, p.style || {});
    if (api.debugGrid) {
      // calibration: a tenth grid over the face, side and eyes
      [L.face, L.side, L.eyes].forEach(([x, y, w, h]) => { for (let i = 0; i <= 10; i++) { g.fillStyle = i === 5 ? '#ff00ff' : i % 2 ? '#00ffff' : '#ffff00'; g.fillRect(x + w * i / 10, y, 1, h); g.fillRect(x, y + h * i / 10, w, 1); } });
    }
  }
  const backName = name => { const parts = String(name).toUpperCase().split(' '); return parts.length > 1 ? parts[parts.length - 1] : parts[0]; };
  /** A franchise's own badge: a shield in its colours with its short code (original, no real logo). */
  function badge(g, id, k, cx, cy, r) {
    g.save();
    g.fillStyle = k.accent; g.beginPath(); g.moveTo(cx - r, cy - r); g.lineTo(cx + r, cy - r); g.lineTo(cx + r, cy + r * 0.2); g.quadraticCurveTo(cx, cy + r * 1.4, cx - r, cy + r * 0.2); g.closePath(); g.fill();
    g.fillStyle = k.base; g.beginPath(); g.moveTo(cx - r * 0.7, cy - r * 0.7); g.lineTo(cx + r * 0.7, cy - r * 0.7); g.lineTo(cx + r * 0.7, cy + r * 0.1); g.quadraticCurveTo(cx, cy + r * 1.0, cx - r * 0.7, cy + r * 0.1); g.closePath(); g.fill();
    g.fillStyle = k.accent; star(g, cx, cy - r * 0.05, r * 0.45, 5, 0.45);
    g.restore();
  }

  // ------------------------------------------------------------------ the face
  /**
   * The face region is the head seen from the front: u = x across (-0.28..0.28 model units), v = y
   * down from the hairline (4.676) to the chin (4.118). Measured on the model (fractions of the
   * region): brows 0.28 (the model's own, in its hair), eyes 0.375 at 0.28 either side of the
   * middle, nose tip 0.55, mouth 0.69, chin 1. The side region: z from the face (0.3, u = 0) to the
   * back of the head (-0.4, u = 1), the ear at u 0.5, v 0.47; the jaw runs from under the ear (0.47,
   * 0.62) to the chin (0.03, 0.98).
   */
  const FACE = { brow: 0.28, eye: 0.375, eyeX: 0.28, nose: 0.55, mouth: 0.69, chin: 0.985 };
  function drawFace(g, look, style) {
    const L = LAYOUT, skin = SKIN[look.skin] !== undefined ? SKIN[look.skin] : SKIN[2], hair = HAIR[look.hair] || HAIR.k;
    const beard = style.beard || ['clean', 'stubble', 'full'][look.beard] || 'clean';
    const dark = shade(skin, -0.22), lip = mix(shade(skin, -0.12), '#a8463f', 0.32);
    const stubble = mix(skin, hair, 0.5);
    // flat skin everywhere a texel of skin is needed; hands a touch lighter (palms)
    g.fillStyle = skin; g.fillRect(L.skin[0], L.skin[1], L.skin[2], L.skin[3]);
    g.fillStyle = shade(skin, 0.04); g.fillRect(L.hand[0], L.hand[1], L.hand[2], L.hand[3]);
    // hair colour for the model's hair and brows (a little sheen)
    { const [x, y, w, h] = L.hair; const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, shade(hair, 0.1)); gr.addColorStop(1, shade(hair, -0.08)); g.fillStyle = gr; g.fillRect(x, y, w, h); }
    // the scalp: skin under the hair, or a close crop (the model's hair is hidden for a crop)
    const crop = style.hair === 'crop';
    { const [x, y, w, h] = L.scalp; g.fillStyle = crop ? mix(skin, hair, 0.72) : skin; g.fillRect(x, y, w, h); }
    const soft = (cx, cy, r, col, a) => { const c = g.createRadialGradient(cx, cy, 0.5, cx, cy, r); c.addColorStop(0, col.replace('A', a)); c.addColorStop(1, col.replace('A', 0)); g.fillStyle = c; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); };
    // ---- the front of the face
    {
      const [x, y, w, h] = L.face, X = u => x + u * w, Y = v => y + v * h;
      g.fillStyle = skin; g.fillRect(x, y, w, h);
      // modelling: a little darker toward the edges, the brow ridge and eye sockets in shadow, warm cheeks, a lit nose
      const gr = g.createRadialGradient(X(0.5), Y(0.5), w * 0.15, X(0.5), Y(0.52), w * 0.6); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.18)');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      [-1, 1].forEach(s => {
        soft(X(0.5 + s * FACE.eyeX), Y(FACE.eye - 0.01), w * 0.12, 'rgba(45,20,10,A)', 0.28);
        soft(X(0.5 + s * 0.27), Y(0.56), w * 0.12, 'rgba(205,85,65,A)', 0.13);
      });
      soft(X(0.5), Y(0.47), w * 0.05, 'rgba(255,240,220,A)', 0.18);
      // the beard, then the lips and moustache over it
      drawBeard(g, beard, X, Y, w, h, hair, stubble, skin, 'front');
      // a crop: the hairline across the top of the forehead, and brows of his own (the model's are in its hair)
      if (crop) {
        g.fillStyle = mix(skin, hair, 0.72); g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(1), Y(0)); g.lineTo(X(1), Y(0.08)); g.quadraticCurveTo(X(0.5), Y(0.02), X(0), Y(0.08)); g.fill();
        g.fillStyle = hair; [-1, 1].forEach(s => { g.beginPath(); g.ellipse(X(0.5 + s * 0.24), Y(FACE.brow + 0.01), w * 0.12, h * 0.02, s * -0.1, 0, Math.PI * 2); g.fill(); });
      }
      // brows: thicken the model's own for a 'thick' style
      if (style.brow === 'thick') {
        g.fillStyle = shade(hair, 0.05);
        [-1, 1].forEach(s => { g.beginPath(); g.ellipse(X(0.5 + s * 0.24), Y(FACE.brow + 0.012), w * 0.13, h * 0.022, s * -0.08, 0, Math.PI * 2); g.fill(); });
      }
      // nose: the nostrils' shadow under the tip, a soft line down its shaded side
      g.fillStyle = 'rgba(55,22,10,0.28)'; g.beginPath(); g.ellipse(X(0.5), Y(FACE.nose + 0.03), w * 0.07, h * 0.017, 0, 0, Math.PI * 2); g.fill();
      [-1, 1].forEach(s => { g.fillStyle = 'rgba(40,14,8,0.45)'; g.beginPath(); g.ellipse(X(0.5 + s * 0.04), Y(FACE.nose + 0.032), w * 0.014, h * 0.009, 0, 0, Math.PI * 2); g.fill(); });
      soft(X(0.56), Y(0.46), w * 0.05, 'rgba(60,25,10,A)', 0.12);
      // lips: the upper darker with a cupid's bow, the lower fuller and lit, the line between
      const M = FACE.mouth;
      g.fillStyle = shade(lip, -0.16); g.beginPath(); g.moveTo(X(0.39), Y(M)); g.quadraticCurveTo(X(0.45), Y(M - 0.032), X(0.5), Y(M - 0.02)); g.quadraticCurveTo(X(0.55), Y(M - 0.032), X(0.61), Y(M)); g.closePath(); g.fill();
      g.fillStyle = lip; g.beginPath(); g.moveTo(X(0.4), Y(M)); g.quadraticCurveTo(X(0.5), Y(M + 0.05), X(0.6), Y(M)); g.closePath(); g.fill();
      soft(X(0.5), Y(M + 0.02), w * 0.035, 'rgba(255,220,200,A)', 0.25);
      g.strokeStyle = 'rgba(45,12,8,0.7)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(X(0.39), Y(M)); g.quadraticCurveTo(X(0.5), Y(M + 0.008), X(0.61), Y(M)); g.stroke();
      soft(X(0.5), Y(M + 0.08), w * 0.06, 'rgba(50,20,10,A)', 0.15);       // under the lower lip
      // the moustache over the lip
      if (['full', 'trim', 'moustache', 'long'].includes(beard)) {
        g.fillStyle = beard === 'trim' ? mix(hair, skin, 0.2) : hair;
        g.beginPath(); g.moveTo(X(0.35), Y(M + 0.015)); g.quadraticCurveTo(X(0.4), Y(M - 0.07), X(0.5), Y(M - 0.06)); g.quadraticCurveTo(X(0.6), Y(M - 0.07), X(0.65), Y(M + 0.015));
        g.quadraticCurveTo(X(0.6), Y(M - 0.022), X(0.5), Y(M - 0.026)); g.quadraticCurveTo(X(0.4), Y(M - 0.022), X(0.35), Y(M + 0.015)); g.fill();
        if (beard === 'moustache') { g.fillRect(X(0.345), Y(M - 0.01), w * 0.025, h * 0.07); g.fillRect(X(0.63), Y(M - 0.01), w * 0.025, h * 0.07); }   // a horseshoe, down past the mouth
      }
    }
    // ---- the side of the head: the ear, a sideburn, the beard along the jaw
    {
      const [x, y, w, h] = L.side, X = u => x + u * w, Y = v => y + v * h;
      g.fillStyle = skin; g.fillRect(x, y, w, h);
      const gr = g.createLinearGradient(x, y, x + w, y); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = gr; g.fillRect(x, y, w, h);
      // the shadow under the jaw on the neck
      g.fillStyle = 'rgba(40,15,8,0.16)'; g.beginPath(); g.moveTo(X(0.03), Y(1.0)); g.lineTo(X(0.47), Y(0.64)); g.lineTo(X(0.6), Y(0.7)); g.lineTo(X(0.2), Y(1.0)); g.fill();
      // the ear: a darker hollow and rim
      g.fillStyle = dark; g.globalAlpha = 0.55; g.beginPath(); g.ellipse(X(0.52), Y(0.47), w * 0.045, h * 0.065, 0.15, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      // sideburn: from the hairline down in front of the ear
      g.fillStyle = hair; g.beginPath(); g.moveTo(X(0.39), Y(0.2)); g.lineTo(X(0.47), Y(0.2)); g.lineTo(X(0.465), Y(beard === 'clean' || beard === 'moustache' ? 0.42 : 0.5)); g.lineTo(X(0.41), Y(beard === 'clean' || beard === 'moustache' ? 0.42 : 0.5)); g.fill();
      drawBeard(g, beard, X, Y, w, h, hair, stubble, skin, 'side');
    }
    // ---- the eyes, open, and shut (64 px lower)
    {
      const [x, y, w, h] = L.eyes;
      const iris = style.eyes || (look.hair === 'y' || look.hair === 'r' ? '#4f6f8f' : look.skin <= 0 ? '#5b4a32' : '#3a2416');
      for (const shut of [false, true]) {
        const oy = shut ? 64 : 0;
        g.fillStyle = skin; g.fillRect(x, y + oy, w, h);
        [-1, 1].forEach(s => {
          const cx = x + w * (0.5 + s * 0.33), cy = y + oy + h * 0.5, rx = w * 0.15, ry = h * 0.4;
          if (!shut) {
            g.fillStyle = '#e4ddd2'; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
            g.fillStyle = iris; g.beginPath(); g.arc(cx - s * rx * 0.05, cy + ry * 0.05, ry * 0.7, 0, Math.PI * 2); g.fill();
            g.fillStyle = shade(iris, 0.2); g.beginPath(); g.arc(cx - s * rx * 0.05, cy + ry * 0.12, ry * 0.42, 0, Math.PI); g.fill();
            g.fillStyle = '#0b0705'; g.beginPath(); g.arc(cx - s * rx * 0.05, cy + ry * 0.05, ry * 0.28, 0, Math.PI * 2); g.fill();
            g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(cx - s * rx * 0.05 - rx * 0.2, cy - ry * 0.28, ry * 0.15, 0, Math.PI * 2); g.fill();
            // the upper lid: a dark line and its shadow on the white
            g.fillStyle = 'rgba(60,30,20,0.35)'; g.beginPath(); g.ellipse(cx, cy - ry * 0.55, rx * 1.02, ry * 0.5, 0, Math.PI, 0); g.fill();
            g.strokeStyle = '#140b07'; g.lineWidth = 3.5; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
          } else {
            g.fillStyle = shade(skin, -0.06); g.beginPath(); g.ellipse(cx, cy, rx * 1.05, ry * 1.05, 0, 0, Math.PI * 2); g.fill();
            g.strokeStyle = '#140b07'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - rx, cy + ry * 0.05); g.quadraticCurveTo(cx, cy + ry * 0.5, cx + rx, cy + ry * 0.05); g.stroke();
          }
        });
      }
    }
  }
  /** A beard style on the front (X, Y map the face region) or the side of the head. */
  function drawBeard(g, beard, X, Y, w, h, hair, stubble, skin, part) {
    if (beard === 'clean' || beard === 'moustache') return;
    const front = part === 'front', M = FACE.mouth;
    const grain = (col, alpha, x0, y0, x1, y1, n) => {
      g.fillStyle = col; g.globalAlpha = alpha;
      let s = 1234;
      for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; const u = (s % 1000) / 1000; s = (s * 16807) % 2147483647; const v = (s % 1000) / 1000; g.fillRect(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, 1.5, 1.5); }
      g.globalAlpha = 1;
    };
    // the beard on the front: from the sideburns down the cheeks to the corners of the mouth, round the chin
    const jaw = (cheek, lower) => {
      g.beginPath();
      g.moveTo(X(-0.02), Y(cheek)); g.quadraticCurveTo(X(0.16), Y(cheek + 0.17), X(0.34), Y(M - 0.02));
      g.lineTo(X(0.36), Y(M + 0.04)); g.quadraticCurveTo(X(0.5), Y(M + 0.07 + lower), X(0.64), Y(M + 0.04)); g.lineTo(X(0.66), Y(M - 0.02));
      g.quadraticCurveTo(X(0.84), Y(cheek + 0.17), X(1.02), Y(cheek));
      g.lineTo(X(1.02), Y(1.02)); g.lineTo(X(-0.02), Y(1.02)); g.closePath();
    };
    // the side: in front of the ear from the sideburn, along the cheek to the jaw, never down the neck
    const side = (cheek) => {
      g.beginPath(); g.moveTo(X(0.41), Y(0.42)); g.lineTo(X(0.47), Y(0.42)); g.lineTo(X(0.48), Y(0.63));
      g.lineTo(X(0.02), Y(1.02)); g.lineTo(X(-0.02), Y(1.02)); g.lineTo(X(-0.02), Y(cheek + 0.12)); g.quadraticCurveTo(X(0.2), Y(cheek), X(0.41), Y(0.42)); g.closePath();
    };
    if (beard === 'goatee') {
      if (!front) return;
      g.fillStyle = hair; g.beginPath(); g.moveTo(X(0.4), Y(M + 0.04)); g.quadraticCurveTo(X(0.5), Y(M + 0.07), X(0.6), Y(M + 0.04)); g.quadraticCurveTo(X(0.62), Y(FACE.chin), X(0.5), Y(FACE.chin + 0.01)); g.quadraticCurveTo(X(0.38), Y(FACE.chin), X(0.4), Y(M + 0.04)); g.fill();
      return;
    }
    if (beard === 'stubble') {
      g.save(); if (front) jaw(0.5, 0); else side(0.6); g.clip();
      g.fillStyle = stubble; g.globalAlpha = 0.5; g.fillRect(X(-0.1), Y(0), w * 1.2, h * 1.1); g.globalAlpha = 1;
      grain(hair, 0.4, X(0), Y(0.4), X(1), Y(1), 600);
      g.restore();
      if (front) { g.fillStyle = mix(skin, stubble, 0.5); g.globalAlpha = 0.6; g.beginPath(); g.ellipse(X(0.5), Y(M - 0.035), w * 0.1, h * 0.02, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
      return;
    }
    // trim, full, long: the hair colour, a short trim lighter where skin shows through
    const col = beard === 'trim' ? mix(hair, skin, 0.2) : hair;
    g.save();
    if (front) jaw(beard === 'trim' ? 0.5 : 0.44, beard === 'long' ? 0.25 : 0);
    else side(beard === 'trim' ? 0.62 : 0.56);
    g.fillStyle = col; g.fill();
    g.clip(); grain(shade(col, 0.22), 0.45, X(-0.1), Y(0.35), X(1.1), Y(1.05), 900);
    g.restore();
    if (front && beard === 'long') {
      // a long beard runs on under the chin: darker at the bottom edge so it reads as hanging
      const gr = g.createLinearGradient(0, Y(0.86), 0, Y(1)); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(X(0.1), Y(0.86), w * 0.8, h * 0.14);
    }
  }

  // ------------------------------------------------------------------ gear (gear.js): colour cells and the flag
  /** The side's gear texture, 128x64: eight 16 px colour cells across the top, the flag (or badge) below. */
  function drawGear(g, id) {
    const k = KITS[id] || KITS.mum;
    const cells = ['#f4f4f0', k.accent, k.base, k.pants, '#1d2026', '#7c838c', k.helmet || k.pants, '#c9a27a'];
    cells.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 16, 0, 16, 26); });
    g.fillStyle = k.helmet || k.pants; g.fillRect(0, 26, 128, 38);
    if (FLAGS.includes(id)) drawFlag(g, id, 4, 30, 48, 32);
    else if (id === 'ump') { g.fillStyle = '#f4f4f0'; g.fillRect(4, 30, 48, 32); }
    else { g.fillStyle = k.helmet || k.pants; g.fillRect(4, 30, 48, 32); badge(g, id, k, 28, 44, 12); }
  }

  // ------------------------------------------------------------------ the stands: flags for the crowd
  /** A strip of flags for the stands' waving flags: [team A, team B, white] side by side (w = 3h*1.5). */
  function drawFlagStrip(g, a, b, w, h) {
    const cw = w / 3;
    drawFlag(g, a, 0, 0, cw, h);
    drawFlag(g, b, cw, 0, cw, h);
    g.fillStyle = '#f4f4f0'; g.fillRect(cw * 2, 0, cw, h);
  }

  const api = { drawGear, LAYOUT, BLINK, KITS, WORD, FLAGS, SKIN, HAIR, FACE, drawFlag, drawFlagStrip, drawPlayer, drawFace, backName, mix, shade, luma };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Kits = api; }
})(typeof window !== 'undefined' ? window : null);
