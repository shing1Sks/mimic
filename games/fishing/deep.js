/*
 * Tidecast: Depths - the world under the surface. A drop-off around the cast: a sunlit reef shelf
 * with coral, a kelp forest over a wreck, the blue-black twilight with jellies, and the abyss
 * floor. Light, fog and colour follow the depth; god rays and caustics near the top, marine snow
 * everywhere, plankton and the lure's lamp in the dark. Fish are bold procedural models whose
 * bodies swim with a travelling wave (a vertex shader), one material per fish for its own phase.
 */
(function () {
  'use strict';
  const T = THREE, DZ = TideDepths;
  const col = c => new T.Color(c);
  const rnd = (() => { let s = 12345; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  const glowTex = canvasTex(64, 64, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });

  // ------------------------------------------------------------------ fish models
  /*
   * Every species is drawn from its own design: a dorsal and a ventral profile and a width profile
   * along the body (nose at z -0.5, tail base at +0.5) give each its silhouette; fins are cut from
   * outlines in the same body space so they ride the swimming wave with the body. motion tunes the
   * wave (amplitude, wavelength), the tail beat per m/s of speed, and how the pectorals scull.
   * Heights are fractions of the body length.
   */
  const P = (...pts) => pts;
  const DESIGN = {
    perch: { top: P([0, .02], [.12, .13], [.4, .21], [.75, .1], [1, .045]), bot: P([0, .02], [.15, .09], [.45, .15], [.8, .07], [1, .04]), wid: .1,
      dorsal: P([.18, 0], [.22, .12], [.3, .14], [.38, .12], [.42, .05], [.46, .09], [.62, .1], [.7, 0]), anal: P([.6, 0], [.66, -.08], [.74, -.07], [.78, 0]),
      tail: 'fork', tailH: .19, eye: .028, mouth: 'small', motion: { amp: .045, wave: 6, beat: 2.2, fin: 7 }, sheen: .2 },
    mackerel: { top: P([0, .01], [.18, .065], [.5, .085], [.82, .035], [1, .012]), bot: P([0, .012], [.2, .06], [.5, .075], [.85, .03], [1, .01]), wid: .085,
      dorsal: P([.3, 0], [.33, .07], [.42, .03], [.46, 0]), dorsal2: P([.58, 0], [.6, .05], [.66, .02], [.68, 0]), anal: P([.6, 0], [.62, -.045], [.68, -.02], [.7, 0]),
      finlets: true, tail: 'lunate', tailH: .2, eye: .022, mouth: 'small', motion: { amp: .03, wave: 7, beat: 3.4, fin: 4 }, sheen: .75 },
    puffer: { top: P([0, .07], [.15, .21], [.45, .27], [.8, .15], [1, .05]), bot: P([0, .06], [.2, .2], [.5, .26], [.8, .12], [1, .045]), wid: .25,
      dorsal: P([.78, 0], [.82, .1], [.88, .08], [.9, 0]), anal: P([.78, 0], [.82, -.09], [.88, -.07], [.9, 0]),
      tail: 'round', tailH: .14, eye: .05, mouth: 'beak', pect: 1.2, motion: { amp: .012, wave: 4, beat: .8, fin: 14 }, sheen: .15 },
    snapper: { top: P([0, .03], [.1, .17], [.3, .23], [.7, .12], [1, .042]), bot: P([0, .02], [.2, .1], [.5, .14], [.85, .06], [1, .036]), wid: .09,
      dorsal: P([.2, 0], [.24, .13], [.35, .14], [.5, .1], [.64, .12], [.72, 0]), anal: P([.62, 0], [.66, -.1], [.74, -.08], [.78, 0]),
      tail: 'fork', tailH: .22, eye: .03, mouth: 'jaw', motion: { amp: .04, wave: 6, beat: 2, fin: 6 }, sheen: .35 },
    eel: { top: P([0, .02], [.06, .04], [.5, .042], [.9, .03], [1, .01]), bot: P([0, .018], [.06, .036], [.5, .038], [.9, .026], [1, .008]), wid: .036,
      ribbon: true, tail: 'none', eye: .014, mouth: 'jaw', motion: { amp: .085, wave: 14, beat: 1.4, fin: 3 }, sheen: .4 },
    tarpon: { top: P([0, .025], [.2, .1], [.5, .125], [.85, .05], [1, .02]), bot: P([0, .035], [.2, .095], [.5, .105], [.85, .04], [1, .02]), wid: .08,
      dorsal: P([.48, 0], [.5, .1], [.53, .16], [.56, .05], [.6, 0]), anal: P([.66, 0], [.68, -.08], [.74, -.04], [.76, 0]),
      tail: 'fork', tailH: .3, eye: .026, mouth: 'up', motion: { amp: .032, wave: 6.5, beat: 2.6, fin: 4 }, sheen: .9 },
    bass: { top: P([0, .02], [.15, .1], [.45, .15], [.8, .07], [1, .036]), bot: P([0, .02], [.2, .08], [.5, .11], [.85, .05], [1, .03]), wid: .085,
      dorsal: P([.24, 0], [.28, .1], [.36, .11], [.44, .06], [.48, .09], [.64, .08], [.7, 0]), anal: P([.62, 0], [.66, -.07], [.74, -.06], [.77, 0]),
      tail: 'fork', tailH: .18, eye: .025, mouth: 'jaw', motion: { amp: .042, wave: 6, beat: 2, fin: 6 }, sheen: .4 },
    pike: { top: P([0, .008], [.18, .04], [.5, .068], [.85, .06], [1, .03]), bot: P([0, .006], [.2, .036], [.5, .058], [.85, .045], [1, .025]), wid: .06,
      dorsal: P([.72, 0], [.76, .09], [.86, .07], [.9, 0]), anal: P([.74, 0], [.78, -.07], [.88, -.05], [.9, 0]),
      tail: 'fork', tailH: .14, eye: .016, mouth: 'duck', motion: { amp: .05, wave: 5.5, beat: 2.4, fin: 3 }, sheen: .3 },
    scorpion: { top: P([0, .05], [.15, .17], [.4, .2], [.8, .1], [1, .05]), bot: P([0, .045], [.2, .12], [.5, .13], [.85, .07], [1, .042]), wid: .15,
      spines: true, dorsal: P([.5, 0], [.54, .09], [.7, .08], [.76, 0]), anal: P([.6, 0], [.64, -.08], [.72, -.06], [.75, 0]),
      tail: 'round', tailH: .16, eye: .03, mouth: 'jaw', pect: 2.6, flaps: true, motion: { amp: .025, wave: 5, beat: 1.4, fin: 3 }, sheen: .1 },
    ray: { top: P([0, .01], [.2, .03], [.5, .035], [.8, .02], [1, .01]), bot: P([0, .008], [.2, .02], [.5, .024], [.8, .014], [1, .008]), wid: 1,
      widCurve: P([0, .06], [.25, .48], [.5, .44], [.75, .16], [1, .03]), tail: 'whip', eye: .014, eyeTop: true, mouth: 'none',
      motion: { amp: 0, wave: 0, beat: 1, fin: 0, flap: .1 }, sheen: .15 },
    lantern: { top: P([0, .03], [.2, .11], [.5, .13], [.8, .07], [1, .03]), bot: P([0, .03], [.2, .1], [.5, .12], [.8, .06], [1, .028]), wid: .07,
      dorsal: P([.42, 0], [.45, .09], [.55, .06], [.58, 0]), anal: P([.62, 0], [.64, -.06], [.74, -.04], [.76, 0]),
      tail: 'fork', tailH: .2, eye: .06, mouth: 'small', photo: true, motion: { amp: .04, wave: 7, beat: 3, fin: 6 }, sheen: .6 },
    squid: { squid: true, eye: .05, motion: { amp: .02, wave: 4, beat: 1, fin: 5 }, sheen: .3 },
    gulper: { top: P([0, .1], [.2, .22], [.45, .16], [.8, .05], [1, .02]), bot: P([0, .17], [.2, .24], [.45, .12], [.8, .04], [1, .02]), wid: .18,
      dorsal: P([.62, 0], [.66, .06], [.76, .03], [.78, 0]), tail: 'whip2', eye: .012, mouth: 'fangs', motion: { amp: .05, wave: 5, beat: 1.4, fin: 4 }, sheen: .2 },
    grouper: { top: P([0, .045], [.15, .17], [.45, .21], [.8, .11], [1, .05]), bot: P([0, .05], [.2, .14], [.5, .17], [.85, .08], [1, .045]), wid: .14,
      dorsal: P([.22, 0], [.26, .1], [.4, .1], [.55, .07], [.7, .1], [.78, 0]), anal: P([.64, 0], [.68, -.1], [.76, -.08], [.79, 0]),
      tail: 'round', tailH: .2, eye: .022, mouth: 'lips', motion: { amp: .03, wave: 5, beat: 1.4, fin: 4 }, sheen: .3 },
    angler: { top: P([0, .13], [.25, .24], [.55, .18], [.85, .07], [1, .03]), bot: P([0, .17], [.25, .24], [.55, .15], [.85, .05], [1, .03]), wid: .25,
      dorsal: P([.72, 0], [.76, .06], [.84, .04], [.86, 0]), tail: 'round', tailH: .12, eye: .014, mouth: 'fangs', lure: true, motion: { amp: .025, wave: 4, beat: 1, fin: 5 }, sheen: .15 },
  };
  /** A smooth (Catmull-Rom) curve through the profile points, so bodies have no kinks. */
  const lerpPts = (pts, u) => {
    for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) {
      const p0 = pts[Math.max(0, i - 2)][1], p1 = pts[i - 1][1], p2 = pts[i][1], p3 = pts[Math.min(pts.length - 1, i + 1)][1];
      const t = (u - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1), t2 = t * t, t3 = t2 * t;
      return Math.max(0.002, 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
    }
    return pts[pts.length - 1][1];
  };
  /** Shape geometry UVs are raw coordinates; spread them over the whole fin texture. */
  function normUV(g) {
    g.computeBoundingBox(); const b = g.boundingBox, uv = g.attributes.uv, pos = g.attributes.position;
    const sx = b.max.z - b.min.z || 1, sy = b.max.y - b.min.y || 1;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getZ(i) - b.min.z) / sx, (pos.getY(i) - b.min.y) / sy);
    return g;
  }
  function skin(sp) {
    const look = sp.look;
    return canvasTex(512, 256, (g, w, h) => {
      // countershading: back to flank to belly
      for (let y = 0; y < h; y++) {
        const t = Math.abs(y / h - 0.5) * 2;
        const c = t < 0.4 ? col(look.belly).lerp(col(look.side), t / 0.4) : col(look.side).lerp(col(look.back), Math.min(1, (t - 0.4) / 0.5));
        g.fillStyle = '#' + c.getHexString(T.SRGBColorSpace); g.fillRect(0, y, w, 1);
      }
      let s = look.back.length * 977 + look.side.charCodeAt(2) * 31;
      const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const both = (fn) => { fn(false); fn(true); };   // the texture wraps round the body: mark both flanks
      g.fillStyle = look.back; g.strokeStyle = look.back;
      if (look.mark === 'bars') { g.globalAlpha = 0.5; for (let i = 0; i < 7; i++) { const x = w * (0.22 + i * 0.1); both(m => { g.beginPath(); g.moveTo(x, m ? h : 0); g.lineTo(x + w * 0.05, m ? h : 0); g.lineTo(x + w * 0.035, m ? h * 0.62 : h * 0.38); g.lineTo(x + w * 0.012, m ? h * 0.62 : h * 0.38); g.fill(); }); } }
      if (look.mark === 'stripes') { g.globalAlpha = 0.45; g.lineWidth = 5; [0.28, 0.36, 0.64, 0.72].forEach(v => { g.beginPath(); g.moveTo(w * 0.15, h * v); g.lineTo(w * 0.98, h * v + (r() - 0.5) * 4); g.stroke(); }); }
      if (look.mark === 'waves') { g.globalAlpha = 0.8; g.lineWidth = 5; for (let k = 0; k < 16; k++) both(m => { const x0 = w * (0.2 + k * 0.05); g.beginPath(); for (let y = 0; y < h * 0.24; y += 4) g.lineTo(x0 + Math.sin(y * 0.09 + k) * 9, m ? h - y : y); g.stroke(); }); }
      if (look.mark === 'spots') { g.globalAlpha = 0.6; for (let i = 0; i < 110; i++) { const y = r() < 0.5 ? r() * h * 0.42 : h - r() * h * 0.42; g.beginPath(); g.arc(w * (0.08 + r() * 0.9), y, 3 + r() * 5, 0, Math.PI * 2); g.fill(); } }
      if (look.mark === 'speckle') { g.globalAlpha = 0.5; for (let i = 0; i < 700; i++) { g.fillStyle = r() < 0.5 ? look.back : look.fin; g.fillRect(w * r(), h * r(), 2 + r() * 3, 2 + r() * 3); } }
      // scales everywhere, finer on small fish
      g.globalAlpha = look.mark === 'scales' ? 0.32 : 0.14; g.strokeStyle = '#ffffff'; g.lineWidth = 1;
      const sc = sp.cls <= 1 ? 7 : 10;
      for (let x = 30; x < w; x += sc) for (let y = 4; y < h; y += sc * 0.75) { g.beginPath(); g.arc(x + ((y / (sc * 0.75)) % 2 ? sc / 2 : 0), y, sc * 0.55, 0.4, Math.PI - 0.4); g.stroke(); }
      // the lateral line and the gill cover
      g.globalAlpha = 0.45; g.strokeStyle = look.back; g.lineWidth = 2;
      both(m => { g.beginPath(); for (let x = w * 0.18; x < w * 0.98; x += 8) g.lineTo(x, m ? h * 0.66 + Math.sin(x * 0.01) * 6 : h * 0.34 - Math.sin(x * 0.01) * 6); g.stroke(); });
      g.globalAlpha = 0.5; g.lineWidth = 3;
      g.beginPath(); g.moveTo(w * 0.17, h * 0.12); g.quadraticCurveTo(w * 0.23, h * 0.5, w * 0.17, h * 0.88); g.stroke();
      // a darker, glossier head
      const hg = g.createLinearGradient(0, 0, w * 0.18, 0); hg.addColorStop(0, 'rgba(0,0,0,0.3)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 1; g.fillStyle = hg; g.fillRect(0, 0, w * 0.18, h);
    });
  }
  /** Fin texture: translucent membrane with rays radiating from the base. */
  const finTexCache = {};
  function finTex(color) {
    if (finTexCache[color]) return finTexCache[color];
    return (finTexCache[color] = canvasTex(128, 128, (g, w, h) => {
      const c = col(color);
      g.fillStyle = `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},0.7)`; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
      for (let i = 0; i < 14; i++) { g.beginPath(); g.moveTo(w * 0.5, h); g.lineTo(i / 13 * w, 0); g.stroke(); }
      const e = g.createLinearGradient(0, 0, 0, h); e.addColorStop(0, 'rgba(255,255,255,0.25)'); e.addColorStop(0.3, 'rgba(255,255,255,0)'); g.fillStyle = e; g.fillRect(0, 0, w, h);
    }));
  }
  /** Half the body's width at u: real fish are thick (about half as wide as deep), not cut-outs. */
  const WF = 1.6;
  function halfW(d, u) {
    if (d.widCurve) return lerpPts(d.widCurve, u);
    const topMax = Math.max(...d.top.map(p => p[1])), botMax = Math.max(...d.bot.map(p => p[1]));
    return d.wid * 0.5 * WF * Math.max(lerpPts(d.top, u) / topMax, lerpPts(d.bot, u) / botMax) * (u < 0.08 ? 0.6 + u * 5 : 1);
  }
  const sp08 = v => Math.sign(v) * Math.pow(Math.abs(v), 0.8);   // a fuller, rounder cross-section than an ellipse
  function bodyGeo(d) {
    const NU = d.ribbon ? 80 : 48, NV = 24, pos = [], uv = [], idx = [];
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, t = lerpPts(d.top, u), b = lerpPts(d.bot, u);
      const ww = halfW(d, u);
      const nose = u < 0.04 ? Math.sqrt(u / 0.04) : 1;
      for (let j = 0; j <= NV; j++) {
        const a = j / NV * Math.PI * 2, ca = sp08(Math.cos(a)), sa = sp08(Math.sin(a));
        const y = (ca > 0 ? ca * t : ca * b) * nose, x = sa * ww * nose;
        pos.push(x, y, -0.5 + u); uv.push(u, j / NV);
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b2 = a + NV + 1; idx.push(a, b2, a + 1, b2, b2 + 1, a + 1); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  /** A fin outline [(u, height)] standing on the back (or hanging from the belly) in body space. */
  function finGeo(d, pts, below) {
    const s = new T.Shape();
    pts.forEach(([u, hh], i) => { const base = below ? -lerpPts(d.bot, u) : lerpPts(d.top, u), y = base + hh * (below ? 1 : 1); const z = -0.5 + u; i ? s.lineTo(z, y) : s.moveTo(z, y); });
    const g = new T.ShapeGeometry(s); g.rotateY(-Math.PI / 2);   // shape x -> body z
    return normUV(g);
  }
  function tailGeo(d) {
    const H = d.tailH || 0.15, z0 = 0.5, s = new T.Shape(), p = (z, y) => [-z, y];   // after rotateY(-pi/2), shape x maps to -z
    const pts = d.tail === 'fork' ? [[z0 - .01, .03], [z0 + .2, H], [z0 + .13, 0], [z0 + .2, -H], [z0 - .01, -.03]]
      : d.tail === 'lunate' ? [[z0 - .01, .02], [z0 + .12, H * 0.7], [z0 + .2, H], [z0 + .1, 0], [z0 + .2, -H], [z0 + .12, -H * 0.7], [z0 - .01, -.02]]
      : d.tail === 'round' ? [[z0 - .01, .03], [z0 + .07, H * 0.85], [z0 + .15, H * 0.6], [z0 + .17, 0], [z0 + .15, -H * 0.6], [z0 + .07, -H * 0.85], [z0 - .01, -.03]]
      : d.tail === 'whip2' ? [[z0 - .01, .01], [z0 + .35, .008], [z0 + .35, -.008], [z0 - .01, -.01]] : null;
    if (!pts) return null;
    pts.forEach(([z, y], i) => { const q = p(z, y); i ? s.lineTo(q[0], q[1]) : s.moveTo(q[0], q[1]); });
    const g = new T.ShapeGeometry(s); g.rotateY(Math.PI / 2);
    return normUV(g);
  }
  const cache = {};
  function parts(sp) {
    if (cache[sp.id]) return cache[sp.id];
    const d = DESIGN[sp.id] || DESIGN.perch, look = sp.look;
    const out = { d, map: skin(sp), fin: new T.MeshStandardMaterial({ map: finTex(look.fin), transparent: true, opacity: 0.85, side: T.DoubleSide, roughness: 0.6, depthWrite: false, emissive: sp.glow ? col(look.fin) : 0x000000, emissiveIntensity: sp.glow ? 0.3 : 0 }) };
    if (d.squid) out.geo = squidGeo();
    else {
      out.geo = bodyGeo(d);
      out.dorsal = d.dorsal && finGeo(d, d.dorsal); out.dorsal2 = d.dorsal2 && finGeo(d, d.dorsal2); out.anal = d.anal && finGeo(d, d.anal, true);
      out.tail = tailGeo(d);
      if (d.ribbon) { out.dorsal = finGeo(d, [[0.15, 0], [0.2, 0.025], [0.97, 0.03], [1, 0]]); out.anal = finGeo(d, [[0.45, 0], [0.5, -0.02], [0.97, -0.025], [1, 0]], true); }
    }
    out.pect = (() => { const s = new T.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(0.05, 0.05, 0.11, 0.035); s.quadraticCurveTo(0.12, -0.01, 0.1, -0.03); s.quadraticCurveTo(0.05, -0.02, 0, 0); return new T.ShapeGeometry(s); })();
    return (cache[sp.id] = out);
  }
  function squidGeo() {
    // mantle first (pointed, at the front), the head and its big eyes behind it
    const d = { top: P([0, .005], [.12, .05], [.45, .085], [.62, .09], [.7, .07], [.8, .085], [.9, .06], [1, .04]), bot: P([0, .005], [.12, .05], [.45, .085], [.62, .09], [.7, .07], [.8, .085], [.9, .06], [1, .04]), wid: .17 };
    return bodyGeo(d);
  }
  const eyeMat = new T.MeshStandardMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.5 });
  const ringMats = {};
  const ringMat = c => ringMats[c] || (ringMats[c] = new T.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.6 }));
  const toothMat = new T.MeshStandardMaterial({ color: 0xf4efe0, roughness: 0.3 });
  const glowBulb = new T.MeshBasicMaterial({ color: 0xc8fff4 });
  const RIM = { value: new T.Color(0x9fe8ff) };   // shared by every fish; the world below dims it with the light
  const glint = new T.MeshBasicMaterial({ color: 0xffffff });
  /** Scales as relief: rows of overlapping arcs that catch the light as the fish turns. */
  const scaleBump = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); g.lineWidth = 2;
    for (let x = 0; x < w + 12; x += 9) for (let y = 0; y < h + 8; y += 7) {
      const ox = (Math.round(y / 7) % 2) * 4.5;
      g.strokeStyle = '#d0d0d0'; g.beginPath(); g.arc(x + ox, y, 5, 0.3, Math.PI - 0.3); g.stroke();
      g.strokeStyle = '#404040'; g.beginPath(); g.arc(x + ox, y + 1.5, 5, 0.5, Math.PI - 0.5); g.stroke();
    }
  });
  const cyl = new T.CylinderGeometry(1, 1, 1, 8);

  /** A body material that swims: a travelling wave sideways, stronger toward the tail; rays flap their wings. */
  function waveMat(base, u) {
    const m = base.clone();
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'uniform float uT, uAmp, uFreq, uFlap;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
         float kk = clamp(position.z + 0.5, 0.0, 1.2);
         transformed.x += sin(position.z * uFreq - uT) * uAmp * (0.15 + kk * kk);
         transformed.y += sin(uT * 0.35 - abs(position.x) * 3.0) * uFlap * position.x * position.x * 6.0;`);
      // rim light: water-lit edges that show the body's roundness, and a little light through the skin
      sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
         float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
         float rim = pow(1.0 - ndv, 2.6);
         totalEmissiveRadiance += (uRim * 0.28 + diffuseColor.rgb * uRim * 0.5) * rim;`);
    };
    m.customProgramCacheKey = () => 'tide-wave3';
    return m;
  }

  /**
   * A fish model, 1 m of body along -Z (nose at -0.5); scale by its length. opts.simple: no
   * pectorals or extras (distant schoolers). Returns a Group with .swim(dt, speed, opts).
   */
  function makeFish(sp, opts) {
    opts = opts || {};
    const Pt = parts(sp), d = Pt.d, g = new T.Group(), look = sp.look, mo = d.motion;
    const u = { uT: { value: Math.random() * 6 }, uAmp: { value: mo.amp }, uFreq: { value: mo.wave }, uFlap: { value: mo.flap || 0 }, uRim: RIM };
    const body = new T.Mesh(Pt.geo, waveMat(new T.MeshStandardMaterial({ map: Pt.map, roughness: 0.38 - d.sheen * 0.18, metalness: 0.06 + d.sheen * 0.4,
      transparent: !!d.squid, opacity: d.squid ? 0.78 : 1, emissive: sp.glow ? col(look.side) : 0x000000, emissiveIntensity: sp.glow ? 0.35 : 0 }), u));
    g.add(body);
    const finM = waveMat(Pt.fin, u);
    for (const k of ['dorsal', 'dorsal2', 'anal', 'tail']) if (Pt[k]) g.add(new T.Mesh(Pt[k], finM));
    const ud = { u, sp, mo, pect: [], body };
    // eyes: a dark lens in a coloured iris, set where this species carries them
    const eyeR = d.eye || 0.025, ez = d.squid ? 0.18 : -0.5 + (d.mouth === 'duck' ? 0.12 : 0.085), ey = d.eyeTop ? lerpPts(d.top, 0.2) : d.squid ? 0 : lerpPts(d.top, ez + 0.5) * 0.35;
    [-1, 1].forEach(s => {
      const ex = d.eyeTop ? s * 0.06 : s * (d.squid ? 0.1 : Math.max(0.01, (d.widCurve ? 0.04 : halfW(d, ez + 0.5)) * 0.9));
      const iris = new T.Mesh(new T.SphereGeometry(eyeR * 1.25, 12, 8), ringMat(sp.glow ? 0x9fe0ff : look.fin)); iris.position.set(ex, ey, ez); iris.scale.x = 0.45; g.add(iris);
      const pupil = new T.Mesh(new T.SphereGeometry(eyeR * 0.8, 10, 8), eyeMat); pupil.position.set(ex * 1.06, ey, ez); pupil.scale.x = 0.6; g.add(pupil);
      const hi = new T.Mesh(new T.SphereGeometry(eyeR * 0.22, 6, 4), glint); hi.position.set(ex * 1.06 + s * eyeR * 0.45, ey + eyeR * 0.35, ez - eyeR * 0.3); g.add(hi);   // the wet glint that makes it look alive
    });
    // mouths that tell you what it eats
    if (d.mouth === 'fangs') {
      const jaw = new T.Group(); jaw.position.set(0, -lerpPts(d.bot, 0.1) * 0.3, -0.42); g.add(jaw); ud.jaw = jaw;
      for (let i = 0; i < 14; i++) {
        const a = (i / 13 - 0.5) * 2.6, tt = new T.Mesh(new T.ConeGeometry(0.008, 0.04 + (i % 3) * 0.025, 4), toothMat);
        tt.position.set(Math.sin(a) * d.wid * 0.4, i % 2 ? 0.02 : -0.02, -0.07 + Math.abs(Math.sin(a)) * 0.05); tt.rotation.x = i % 2 ? Math.PI : 0; (i % 2 ? g : jaw).add(tt);
      }
    } else if (d.mouth === 'lips') { const lip = new T.Mesh(new T.TorusGeometry(0.045, 0.02, 6, 14), body.material); lip.position.set(0, -0.01, -0.49); g.add(lip); }
    else if (d.mouth === 'beak') { const bk = new T.Mesh(new T.SphereGeometry(0.035, 10, 6), new T.MeshStandardMaterial({ color: 0xf0e8d0, roughness: 0.4 })); bk.position.set(0, 0, -0.5); bk.scale.z = 0.6; g.add(bk); }
    else if (d.mouth === 'up') { const lj = new T.Mesh(new T.ConeGeometry(0.03, 0.08, 6), body.material); lj.rotation.x = -Math.PI / 2 - 0.4; lj.position.set(0, -0.01, -0.5); g.add(lj); }
    if (!opts.simple && !d.squid && d.tail !== 'whip') {
      // pectoral fins scull at the sides, behind the gill cover
      const pz = -0.5 + 0.2, py = -lerpPts(d.bot, 0.2) * 0.3;
      [-1, 1].forEach(s => {
        const pg = new T.Group(); pg.position.set(s * (d.widCurve ? 0.03 : halfW(d, 0.2) * 0.92), py, pz);
        const m = new T.Mesh(Pt.pect, Pt.fin); m.rotation.set(0, s > 0 ? -1.9 : -1.2, s * 0.6); m.scale.setScalar(d.pect || 1); pg.add(m);
        g.add(pg); ud.pect.push({ g: pg, s });
      });
    }
    if (d.tail === 'whip') { const wh = new T.Mesh(cyl, Pt.fin); wh.scale.set(0.008, 0.9, 0.008); wh.rotation.x = Math.PI / 2; wh.position.z = 0.9; g.add(wh); ud.whip = wh; }
    if (d.finlets) for (let i = 0; i < 5; i++) [1, -1].forEach(sg => { const f = new T.Mesh(new T.ConeGeometry(0.008, 0.025, 3), Pt.fin); f.position.set(0, sg * lerpPts(sg > 0 ? d.top : d.bot, 0.78 + i * 0.04) * 1.02, 0.28 + i * 0.04); f.rotation.x = sg > 0 ? -1.2 : 1.2; g.add(f); });
    if (d.spines && !opts.simple) for (let i = 0; i < 9; i++) { const sv = new T.Mesh(new T.ConeGeometry(0.008, 0.12 + Math.sin(i * 1.3) * 0.04, 4), Pt.fin.clone()); sv.material.transparent = false; sv.material.color.set(look.fin); sv.position.set(0, lerpPts(d.top, 0.18 + i * 0.035) + 0.04, -0.32 + i * 0.035); sv.rotation.x = 0.35; g.add(sv); }
    if (d.flaps && !opts.simple) for (let i = 0; i < 10; i++) { const fl = new T.Mesh(new T.ConeGeometry(0.012, 0.035, 4), body.material); const a = i / 10 * Math.PI * 2; fl.position.set(Math.cos(a) * halfW(d, 0.15) * 0.95, Math.sin(a) * 0.08, -0.35 + (i % 3) * 0.05); fl.lookAt(fl.position.clone().multiplyScalar(2)); fl.rotateX(Math.PI / 2); g.add(fl); }
    if (d.photo) { ud.photo = []; for (let i = 0; i < 9; i++) [1, -1].forEach(sg => { const ph = new T.Mesh(new T.SphereGeometry(0.012, 6, 4), new T.MeshBasicMaterial({ color: 0x9fe8ff })); ph.position.set(sg * halfW(d, 0.2 + i * 0.07) * 0.7, -lerpPts(d.bot, 0.2 + i * 0.07) * 0.6, -0.3 + i * 0.07); g.add(ph); ud.photo.push(ph); }); }
    if (d.lure) {
      const st = new T.Mesh(new T.TubeGeometry(new T.QuadraticBezierCurve3(new T.Vector3(0, lerpPts(d.top, 0.2), -0.3), new T.Vector3(0, 0.42, -0.42), new T.Vector3(0, 0.3, -0.62)), 10, 0.006, 5), Pt.fin);
      g.add(st);
      const bulb = new T.Mesh(new T.SphereGeometry(0.03, 10, 8), glowBulb.clone()); bulb.position.set(0, 0.3, -0.62); g.add(bulb);
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0x9effe6, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); halo.scale.setScalar(0.9); bulb.add(halo);
      ud.esca = { bulb, halo };
    }
    if (d.squid) {
      ud.arms = [];
      for (let i = 0; i < 10; i++) {
        const long = i >= 8, a = i / 8 * Math.PI * 2, len = long ? 0.75 : 0.42;
        const arm = new T.Group(); arm.position.set(Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0.5); g.add(arm);
        const m = new T.Mesh(new T.ConeGeometry(long ? 0.008 : 0.014, len, 5), body.material); m.geometry.translate(0, -len / 2, 0); m.rotation.x = Math.PI / 2; arm.add(m);
        if (long) { const club = new T.Mesh(new T.SphereGeometry(0.018, 6, 4), body.material); club.position.z = len; arm.add(club); }
        ud.arms.push({ arm, a, long });
      }
      [-1, 1].forEach(s => { const fs = new T.Shape(); fs.moveTo(0, 0); fs.lineTo(0.13, -0.02); fs.lineTo(0.02, 0.2); fs.lineTo(0, 0.18); const fm = new T.Mesh(new T.ShapeGeometry(fs), Pt.fin); fm.position.set(s * 0.02, 0, -0.45); fm.rotation.set(Math.PI / 2, 0, s > 0 ? 0 : Math.PI); fm.scale.x = s; g.add(fm); ud.pect.push({ g: fm, s, squid: true }); });
    }
    if (sp.glow) {
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: col(sp.id === 'lantern' ? '#7ad8ff' : sp.id === 'squid' ? '#b0f0ff' : '#9effe6'), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.45, fog: false }));
      halo.scale.setScalar(sp.id === 'lantern' ? 1.4 : 1); g.add(halo); ud.halo = halo;
    }
    if (sp.id === 'puffer' && !opts.simple) {
      const spikes = new T.Group();
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), n = new T.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a));
        const c = new T.Mesh(new T.ConeGeometry(0.01, 0.06, 4), toothMat);
        c.position.copy(n).multiply(new T.Vector3(d.wid * 0.5, 0.25, 0.4)); c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), n); spikes.add(c);
      }
      spikes.scale.setScalar(0.2); g.add(spikes); ud.spikes = spikes;
    }
    g.userData = ud;
    g.swim = swimFn;
    return g;
  }
  /**
   * Animate one frame. speed m/s drives the tail beat (each species has its own beat per m/s);
   * o.tired 0..1 rolls a played-out fish onto its side; o.thrash shakes it hard.
   */
  function swimFn(dt, speed, o) {
    const ud = this.userData, u = ud.u, mo = ud.mo, t = (u.uT.value += dt * (2.2 + speed * mo.beat * 2.4) * (o && o.thrash ? 2.2 : 1));
    u.uAmp.value = mo.amp * (0.6 + Math.min(1.6, speed * 0.45)) * (o && o.thrash ? 1.8 : 1);
    const ft = performance.now() / 1000;
    ud.pect.forEach(p => { if (p.squid) p.g.rotation.y = (p.s > 0 ? 0 : Math.PI) + Math.sin(ft * mo.fin) * 0.4; else p.g.rotation.set(Math.sin(ft * mo.fin + p.s) * 0.5, 0, p.s * Math.sin(ft * mo.fin * 0.5) * 0.25); });
    if (ud.arms) { const jet = 0.5 + 0.5 * Math.sin(ft * 2.4); ud.body.scale.set(1 - jet * 0.12, 1 - jet * 0.12, 1); ud.arms.forEach(a => { a.arm.rotation.set(Math.sin(ft * 3 + a.a) * 0.25 * (1 - jet) + (a.long ? 0 : Math.cos(a.a) * 0.35 * jet), Math.sin(ft * 2.6 + a.a * 2) * 0.3, 0); }); }
    if (ud.jaw) ud.jaw.rotation.x = 0.25 + Math.sin(ft * 0.7) * 0.15;
    if (ud.esca) { const k = 0.6 + 0.4 * Math.sin(ft * 2.1); ud.esca.halo.material.opacity = k; ud.esca.bulb.position.y = 0.3 + Math.sin(ft * 1.3) * 0.03; }
    if (ud.photo) { const k = 0.5 + 0.5 * Math.sin(ft * 3 + ud.u.uT.value * 0.1); ud.photo.forEach((p, i) => { p.visible = Math.sin(ft * 4 + i) > -0.6 * k; }); }
    if (ud.whip) ud.whip.rotation.y = Math.sin(t * 0.8) * 0.2;
    if (ud.halo) ud.halo.material.opacity = 0.3 + 0.2 * Math.sin(ft * 2.2 + ud.u.uFreq.value);
    this.rotation.z = o && o.tired ? o.tired * 1.2 : 0;
  }

  // ------------------------------------------------------------------ the world below
  function create(W) {
    const scene = W.scene;
    const root = new T.Group(); root.visible = false; scene.add(root);
    const env = new T.Group(); root.add(env);
    const time = { v: 0 };
    // caustics + depth tint injected into the rock materials
    const causticU = { uTime: time && { value: 0 } };
    function withCaustics(mat) {
      mat.onBeforeCompile = sh => {
        sh.uniforms.uTime = causticU.uTime;
        sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'uniform float uTime; varying vec3 vWp;\n' + sh.fragmentShader.replace('#include <fog_fragment>', `
          vec2 cp = vWp.xz * 1.1 + vec2(vWp.y * 0.6, -vWp.y * 0.4);
          float c1 = sin(cp.x * 2.3 + uTime * 1.3 + sin(cp.y * 1.7 + uTime * 0.7)) + sin(cp.y * 2.1 - uTime * 1.1 + sin(cp.x * 1.9 - uTime * 0.6));
          float c2 = sin((cp.x - cp.y) * 3.3 + uTime * 1.7) + sin((cp.x + cp.y) * 2.9 - uTime * 1.2);
          float caus = pow(clamp(1.0 - abs(c1) * 0.6, 0.0, 1.0), 8.0) + pow(clamp(1.0 - abs(c2) * 0.6, 0.0, 1.0), 8.0) * 0.6;
          gl_FragColor.rgb += vec3(0.6, 0.9, 0.95) * caus * 0.28 * exp(vWp.y * 0.11);
          #include <fog_fragment>`);
      };
      mat.customProgramCacheKey = () => 'tide-caustic';
      return mat;
    }

    // the drop-off: a noisy rock shaft, wide on the reef, closing over the kelp, falling away into the dark
    const R = d => d < 20 ? 30 : d < 60 ? 30 - (d - 20) * 0.15 : d < 200 ? 24 + (d - 60) * 0.1 : 38;
    const wallGeo = new T.CylinderGeometry(1, 1, DZ.FLOOR + 10, 72, 120, true);
    {
      const pos = wallGeo.attributes.position, cols = [];
      const zc = { reef: col('#c9a77a'), reef2: col('#6ab0a0'), kelp: col('#4a5a3a'), twi: col('#2a3a56'), aby: col('#14161e') };
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), yl = pos.getY(i), y = yl - (DZ.FLOOR + 10) / 2, d = -y;
        const a = Math.atan2(z, x);
        const n = Math.sin(a * 7 + d * 0.13) * 1.6 + Math.sin(a * 17 - d * 0.31) * 0.7 + Math.sin(d * 0.07 + a * 3) * 2.2;
        const r = R(d) + n;
        pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
        let c = d < 20 ? zc.reef.clone().lerp(zc.reef2, 0.5 + 0.5 * Math.sin(a * 5 + d)) : d < 60 ? zc.kelp.clone() : d < 200 ? zc.twi.clone() : zc.aby.clone();
        c.multiplyScalar(0.85 + 0.3 * Math.max(0, Math.sin(a * 11 + d * 0.5)));
        cols.push(c.r, c.g, c.b);
      }
      wallGeo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      wallGeo.computeVertexNormals();
    }
    const wall = new T.Mesh(wallGeo, withCaustics(new T.MeshLambertMaterial({ vertexColors: true, side: T.BackSide })));
    env.add(wall);
    // the shelves: sculpted sand floors (the reef at ~19 m, the kelp bed at ~58 m) with ridges,
    // hollows and a slope up to the wall; ripples and grain live in the sand texture
    const noise2 = (x, z) => Math.sin(x * 0.41 + Math.sin(z * 0.23) * 1.7) * Math.cos(z * 0.37 - Math.sin(x * 0.19) * 1.3);
    const ridge = (x, z) => 1 - Math.abs(Math.sin(x * 0.21 + z * 0.13 + Math.sin(z * 0.09 + x * 0.05) * 2.2));
    const floorY = (d, r0, x, z) => -d + (Math.hypot(x, z) - r0) * 0.12 + noise2(x, z) * 0.9 + ridge(x, z) * 0.7 + Math.sin(x * 1.1 + z * 0.7) * 0.12;
    const reefY = (x, z) => floorY(19.3, 13, x, z), kelpY = (x, z) => floorY(58.3, 9, x, z);
    const TAU = Math.PI * 2;
    const sandTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#d6bf8e'; g.fillRect(0, 0, w, h);
      // wave ripples: wavy crests with a lit face and a shadowed face (frequencies tile across the edge)
      for (let k = 0; k < 14; k++) {
        const y0 = k * h / 14;
        for (const [off, c] of [[0, 'rgba(255,246,222,0.22)'], [7, 'rgba(120,96,62,0.1)']]) {
          g.strokeStyle = c; g.lineWidth = 10; g.filter = 'blur(3px)'; g.beginPath();
          for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 + off + Math.sin(x * TAU * 5 / w + k * 0.7) * 4 + Math.sin(x * TAU * 2 / w + k) * 4);
          g.stroke();
        }
      }
      g.filter = 'none';
      for (let i = 0; i < 9000; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(90,70,40,0.14)' : 'rgba(255,255,240,0.18)'; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
    });
    sandTex.wrapS = sandTex.wrapT = T.RepeatWrapping;
    const sandMat = withCaustics(new T.MeshStandardMaterial({ map: sandTex, bumpMap: sandTex, bumpScale: 0.12, vertexColors: true, roughness: 1 }));
    function shelf(fy, r0, r1, base, algae) {
      const g = new T.RingGeometry(r0, r1, 160, 26); g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position, uv = g.attributes.uv, cols = [], c = new T.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), y = fy(x, z);
        pos.setY(i, y); uv.setXY(i, x * 0.22, z * 0.22);
        const rg = ridge(x, z), patch = noise2(x * 0.55 + 3, z * 0.55 - 2);
        c.copy(base).multiplyScalar(0.72 + 0.38 * rg);                       // crests catch the light, hollows hold shade
        if (patch > 0.45) c.lerp(algae, Math.min(0.75, (patch - 0.45) * 2.2));  // algae and seagrass ground
        cols.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      g.computeVertexNormals();
      const m = new T.Mesh(g, sandMat); env.add(m); return m;
    }
    shelf(reefY, 13, 31.5, col('#fff4dc'), col('#7a9a52'));
    shelf(kelpY, 9, 27.5, col('#7a7a5e'), col('#3a5228'));
    const floor = new T.Mesh(new T.CircleGeometry(44, 40), new T.MeshLambertMaterial({ color: 0x15171c })); floor.rotation.x = -Math.PI / 2; floor.position.y = -DZ.FLOOR; env.add(floor);

    const covers = [];
    const pol = (r0, r1, d) => { const a = rnd() * Math.PI * 2, r = r0 + rnd() * (r1 - r0); return new T.Vector3(Math.cos(a) * r, -d, Math.sin(a) * r); };
    const reefTmp = new T.Group();
    // reef: branching coral, brain coral, lattice fans, tube sponges, anemones, starfish, sea grass
    const coralCols = [0xff6a4a, 0xffa23a, 0xe0508a, 0xf4c84a, 0x3ac8a8, 0xff4f6e, 0x9a6aff, 0xff8a5a];
    const fanTex = canvasTex(128, 64, (g, w, h) => {
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      for (let i = 0; i < 18; i++) { const a = Math.PI * (i / 17); g.beginPath(); g.moveTo(w / 2, h); g.quadraticCurveTo(w / 2 + Math.cos(a) * w * 0.25, h - Math.sin(a) * h * 0.5, w / 2 + Math.cos(a) * w * 0.5, h - Math.sin(a) * h); g.stroke(); }
      g.lineWidth = 1; for (let r = 8; r < h; r += 7) { g.beginPath(); g.arc(w / 2, h, r, Math.PI, 0); g.stroke(); }
    });
    const brainTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.lineCap = 'round';
      // grooves follow a swirling flow field, so they meander side by side like the real thing
      for (let i = 0; i < 260; i++) {
        let x = rnd() * w, y = rnd() * h;
        g.strokeStyle = 'rgba(40,20,10,0.42)'; g.lineWidth = 3.2; g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 14; k++) { const a = Math.sin(x * 0.045) * 2.2 + Math.cos(y * 0.05) * 2.2; x += Math.cos(a) * 4; y += Math.sin(a) * 4; g.lineTo(x, y); }
        g.stroke();
      }
    });
    const coralMat = c => new T.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: c, emissiveIntensity: 0.06 });
    const lighter = (c, k) => col(c).lerp(col(0xfff4e8), k);
    function branch(g, m, from, dir, len, rad, depthLeft) {
      const to = from.clone().addScaledVector(dir, len);
      const b = new T.Mesh(new T.CylinderGeometry(rad * 0.6, rad, 1, 6), m);
      b.position.copy(from).lerp(to, 0.5); b.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); b.scale.y = len; g.add(b);
      if (depthLeft <= 0) { const tip = new T.Mesh(new T.SphereGeometry(rad * 0.8, 6, 4), m.userData.tip || m); tip.position.copy(to); g.add(tip); return; }
      for (let k = 0; k < 3; k++) {
        const d2 = dir.clone().add(new T.Vector3((rnd() - 0.5) * 1.3, 0.2 + rnd() * 0.4, (rnd() - 0.5) * 1.3)).normalize();
        branch(g, m, to, d2, len * (0.6 + rnd() * 0.2), rad * 0.65, depthLeft - 1);
      }
    }
    function coralAt(p, kind, c) {
      const g = new T.Group(); g.position.copy(p); g.rotation.y = rnd() * 6;
      const m = coralMat(c);
      if (kind === 0) { m.userData.tip = coralMat(lighter(c, 0.55)); branch(g, m, new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), 0.5 + rnd() * 0.4, 0.07, 2); }
      else if (kind === 1) {
        const geo = new T.SphereGeometry(0.5 + rnd() * 0.6, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) { const v = new T.Vector3().fromBufferAttribute(pos, i); v.multiplyScalar(1 + Math.sin(v.x * 9) * Math.cos(v.z * 8) * 0.06); pos.setXYZ(i, v.x, v.y, v.z); }
        geo.computeVertexNormals();
        const b = new T.Mesh(geo, new T.MeshStandardMaterial({ color: c, map: brainTex, bumpMap: brainTex, bumpScale: 2, roughness: 0.85 })); b.position.y = -0.15; g.add(b);
      } else if (kind === 2) {
        const f = new T.Mesh(new T.CircleGeometry(0.8 + rnd() * 0.7, 20, 0, Math.PI), new T.MeshStandardMaterial({ color: c, map: fanTex, alphaTest: 0.4, transparent: false, side: T.DoubleSide, roughness: 0.9, emissive: c, emissiveIntensity: 0.15 }));
        g.add(f);
      } else if (kind === 3) {
        for (let k = 0; k < 4; k++) {
          const hgt = 0.6 + rnd() * 1, r = 0.1 + rnd() * 0.1;
          const t = new T.Mesh(new T.CylinderGeometry(r, r * 0.85, hgt, 10, 1, true), new T.MeshStandardMaterial({ color: c, roughness: 0.9, side: T.DoubleSide }));
          t.position.set((rnd() - 0.5) * 0.5, hgt / 2, (rnd() - 0.5) * 0.5); t.rotation.set((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3); g.add(t);
          const lip = new T.Mesh(new T.TorusGeometry(r, 0.02, 4, 10), m); lip.rotation.x = Math.PI / 2; lip.position.copy(t.position); lip.position.y += hgt / 2; g.add(lip);
        }
      } else if (kind === 4) {
        const base = new T.Mesh(new T.CylinderGeometry(0.16, 0.2, 0.25, 10), m); base.position.y = 0.12; g.add(base);
        const tc = [0xffd0f0, 0xffb070, 0xa0fff0, 0xff8ab0][Math.floor(rnd() * 4)];
        for (let k = 0; k < 22; k++) { const a = k / 22 * Math.PI * 2 + rnd() * 0.2, t = new T.Object3D(); t.position.set(Math.cos(a) * 0.13, 0.24, Math.sin(a) * 0.13); t.rotation.set(Math.sin(a) * (0.5 + rnd() * 0.5), 0, -Math.cos(a) * (0.5 + rnd() * 0.5)); t.scale.setScalar(0.8 + rnd() * 0.5); t.userData.tentacle = tc; g.add(t); }
      } else if (kind === 5) {
        const s = new T.Shape(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, r = k % 2 ? 0.08 : 0.24; k ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(r, 0); }
        const st = new T.Mesh(new T.ShapeGeometry(s), coralMat(0xff7a3a)); st.rotation.x = -Math.PI / 2; st.position.y = 0.03; g.add(st);
      } else {
        // table coral: tiers of thin plates with wavy rims on a short stalk
        const stalk = new T.Mesh(new T.CylinderGeometry(0.06, 0.11, 0.5, 6), m); stalk.position.y = 0.25; g.add(stalk);
        for (let k = 0; k < 3; k++) {
          const r = 0.75 - k * 0.2 + rnd() * 0.2, pg = new T.CylinderGeometry(r, r * 0.9, 0.05, 28, 1), pp = pg.attributes.position;
          for (let i = 0; i < pp.count; i++) { const x = pp.getX(i), z = pp.getZ(i), rr = Math.hypot(x, z); pp.setY(i, pp.getY(i) + Math.sin(Math.atan2(z, x) * 7) * 0.05 * rr + rr * rr * 0.1); }
          pg.computeVertexNormals();
          const pl = new T.Mesh(pg, coralMat(lighter(c, k * 0.15))); pl.position.set((rnd() - 0.5) * 0.25, 0.45 + k * 0.22, (rnd() - 0.5) * 0.25); pl.rotation.set((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25); g.add(pl);
        }
      }
      reefTmp.add(g);
      return g;
    }
    for (let i = 0; i < 140; i++) {
      const near = i < 80, p = pol(near ? 13.5 : 18, near ? 20 : 29, 0), kind = i % 7; p.y = reefY(p.x, p.z) - 0.05;
      coralAt(p, kind, coralCols[(i * 3) % coralCols.length]);
      if (kind <= 3 && i % 2 === 0) covers.push({ x: p.x, y: p.y + 0.5, z: p.z, r: 1.2, kind: 'coral' });
    }
    // and on the reef wall itself
    for (let i = 0; i < 50; i++) {
      const d = 3 + rnd() * 15, a = rnd() * Math.PI * 2, r = R(d) - 0.6;
      const g = coralAt(new T.Vector3(Math.cos(a) * r, -d, Math.sin(a) * r), [1, 2, 3, 4][i % 4], coralCols[i % coralCols.length]);
      g.lookAt(0, -d, 0); g.rotateX(Math.PI / 2);
    }
    // one draw call for all the plain-coloured reef pieces: bake them into a single vertex-coloured mesh
    function bake(group) {
      group.updateMatrixWorld(true);
      const pos = [], nor = [], colr = [], idx = [], keep = [];
      group.traverse(o => {
        if (o.userData.tentacle) { tentacles.push({ m: o.matrixWorld.clone(), c: o.userData.tentacle }); return; }
        if (!o.isMesh) return;
        if (o.material.map) { keep.push(o); return; }
        const g = o.geometry.index ? o.geometry : o.geometry.clone().setIndex([...Array(o.geometry.attributes.position.count).keys()]);
        const off = pos.length / 3, P = g.attributes.position, N = g.attributes.normal, c = o.material.color;
        const nm = new T.Matrix3().getNormalMatrix(o.matrixWorld), v = new T.Vector3();
        for (let k = 0; k < P.count; k++) {
          v.fromBufferAttribute(P, k).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z);
          v.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
          colr.push(c.r, c.g, c.b);
        }
        for (const k of g.index.array) idx.push(k + off);
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
      geo.setIndex(idx);
      env.add(new T.Mesh(geo, withCaustics(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, emissive: 0x0c0c0c }))));
      for (const o of keep) { const m = o.clone(); o.matrixWorld.decompose(m.position, m.quaternion, m.scale); env.add(m); }
    }
    const tentacles = [], shallowOnly = [], low = { on: false };   // instanced fields: never frustum-culled (r149 culls them by one blade), hidden below the kelp
    bake(reefTmp);
    /**
     * Sway in world space, after instancing: every blade or tentacle bends with the same slow surge
     * passing over the floor, so the meadow moves as one field. amp: metres of bend at the tip.
     */
    function swayMat(mat, amp, key) {
      mat.onBeforeCompile = sh => {
        sh.uniforms.uTime = causticU.uTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <project_vertex>', `
          vec4 mvPosition = vec4(transformed, 1.0);
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition; ip = instanceMatrix[3].xyz;
          #endif
          vec4 wq = modelMatrix * vec4(ip, 1.0);
          float kk = position.y * position.y;
          float sw = sin(uTime * 1.1 - wq.x * 0.25 - wq.z * 0.12) * 0.8 + sin(uTime * 2.7 + wq.z * 0.9 + wq.x * 0.4) * 0.2;
          mvPosition.x += sw * kk * ${amp.toFixed(3)}; mvPosition.z += sw * kk * ${(amp * 0.4).toFixed(3)}; mvPosition.y -= abs(sw) * kk * ${(amp * 0.15).toFixed(3)};
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
      };
      mat.customProgramCacheKey = () => 'tide-sway-' + key;
      return mat;
    }
    // anemone tentacles: one instanced, swaying draw call
    {
      const tg = new T.ConeGeometry(0.022, 1, 5, 4); tg.translate(0, 0.5, 0); tg.scale(1, 0.42, 1);
      const im = new T.InstancedMesh(tg, swayMat(new T.MeshStandardMaterial({ roughness: 0.5, emissive: 0x201018 }), 0.9, 'anem'), tentacles.length);
      const env0 = new T.Matrix4().copy(env.matrixWorld).invert();
      tentacles.forEach((t, i) => { im.setMatrixAt(i, new T.Matrix4().multiplyMatrices(env0, t.m)); im.setColorAt(i, col(t.c)); });
      im.frustumCulled = false; shallowOnly.push(im); env.add(im);
    }
    // the seagrass meadow: thousands of blades in patches, one instanced draw call
    {
      const bg = new T.PlaneGeometry(0.06, 1, 1, 5); bg.translate(0, 0.5, 0);
      const bp = bg.attributes.position, bc = [];
      for (let i = 0; i < bp.count; i++) { const y = bp.getY(i); bp.setX(i, bp.getX(i) * (1 - y * 0.8)); const c = col(0x1a3a14).lerp(col(0x9ac85a), y); bc.push(c.r, c.g, c.b); }
      bg.setAttribute('color', new T.Float32BufferAttribute(bc, 3));
      const N = 2000, im = new T.InstancedMesh(bg, swayMat(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }), 0.32, 'grass'), N);
      const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3(), p = new T.Vector3(), tint = new T.Color();
      let i = 0;
      while (i < N) {
        const c0 = pol(14, 29, 0), n = 30 + Math.floor(rnd() * 40), hue = rnd();
        for (let k = 0; k < n && i < N; k++, i++) {
          const a = rnd() * TAU, r = Math.sqrt(rnd()) * 1.6;
          p.set(c0.x + Math.cos(a) * r, 0, c0.z + Math.sin(a) * r); p.y = reefY(p.x, p.z) - 0.05;
          e.set((rnd() - 0.5) * 0.35, rnd() * TAU, (rnd() - 0.5) * 0.35); q.setFromEuler(e);
          const hgt = (0.35 + rnd() * 0.8) * (1.2 - r / 2); s.set(1, hgt, 1);
          im.setMatrixAt(i, m4.compose(p, q, s));
          im.setColorAt(i, tint.setRGB(0.8 + hue * 0.3, 0.9 + rnd() * 0.15, 0.6 + (1 - hue) * 0.3));
        }
      }
      im.frustumCulled = false; shallowOnly.push(im); env.add(im);
    }
    // shells, pebbles and coral rubble scattered over both floors
    {
      const mat = withCaustics(new T.MeshStandardMaterial({ roughness: 0.55 }));
      const shellG = new T.ConeGeometry(0.05, 0.12, 9, 1); shellG.rotateX(Math.PI / 2.3); shellG.scale(1, 0.55, 1);
      const scatter = (geo, n, cols, lie) => {
        const im = new T.InstancedMesh(geo, mat, n), m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3(), p = new T.Vector3();
        for (let i = 0; i < n; i++) {
          const deepBed = i % 4 === 0, a = rnd() * TAU, r = deepBed ? 10 + rnd() * 15 : 13.5 + rnd() * 16;
          p.set(Math.cos(a) * r, 0, Math.sin(a) * r); p.y = (deepBed ? kelpY : reefY)(p.x, p.z) + 0.01;
          e.set(lie ? Math.PI / 2 : rnd() * 0.6, rnd() * TAU, rnd() * 0.6); q.setFromEuler(e); s.setScalar(0.6 + rnd());
          im.setMatrixAt(i, m4.compose(p, q, s)); im.setColorAt(i, col(cols[i % cols.length]).multiplyScalar(deepBed ? 0.6 : 1));
        }
        im.frustumCulled = false; shallowOnly.push(im); env.add(im);
      };
      scatter(shellG, 260, ['#fff0dc', '#ffc8a8', '#f4a060', '#e8d0f0', '#fff8e8']);
      scatter(new T.DodecahedronGeometry(0.07, 0), 320, ['#8a8478', '#5a564e', '#a89a84', '#6a6a60']);
      scatter(new T.CylinderGeometry(0.02, 0.03, 0.28, 5), 160, ['#f0e8dc', '#e8dcc8', '#ffd8c8'], true);
    }

    // reef cracks for eels: dark holes in the wall
    // kelp: tall ribbons rising from the kelp bed, swaying (vertex shader)
    const kelpU = { uTime: causticU.uTime };
    const kelpTex = canvasTex(64, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#c8a24a'); gr.addColorStop(0.5, '#7a8a3a'); gr.addColorStop(1, '#3a5a26');
      g.fillStyle = gr; g.fillRect(w / 2 - 2, 0, 4, h);
      for (let y = 10; y < h; y += 22) for (const s of [-1, 1]) {
        g.save(); g.translate(w / 2, y + (s > 0 ? 11 : 0)); g.rotate(s * 0.5); g.beginPath(); g.ellipse(s * 14, 0, 15, 6, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
    });
    const kelpMat = new T.MeshLambertMaterial({ map: kelpTex, alphaTest: 0.5, side: T.DoubleSide });
    kelpMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = kelpU.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float hk = position.y / 32.0; vec4 wp = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        transformed.x += sin(uTime * 0.7 + wp.x * 0.3 + position.y * 0.12) * hk * hk * 2.2;
        transformed.z += cos(uTime * 0.5 + wp.z * 0.3 + position.y * 0.1) * hk * hk * 1.6;`);
    };
    kelpMat.customProgramCacheKey = () => 'tide-kelp';
    for (let i = 0; i < 46; i++) {
      const h = 22 + rnd() * 12, g = new T.PlaneGeometry(1.4 + rnd() * 0.5, h, 1, 16); g.translate(0, h / 2, 0);
      const p = pol(10, 26, 0), m = new T.Mesh(g, kelpMat); p.y = kelpY(p.x, p.z) - 0.1;
      m.position.copy(p); m.rotation.y = rnd() * 3; env.add(m);
      const m2 = new T.Mesh(g, kelpMat); m2.position.copy(p); m2.rotation.y = m.rotation.y + Math.PI / 2; env.add(m2);
      for (let y = 4; y < h; y += 6) covers.push({ x: p.x, y: p.y + y, z: p.z, r: 1.4, kind: 'kelp' });
    }
    // rocks on both shelves: lumpy, cracked and speckled, with moss and algae on the faces that look up
    const rockTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#8a847a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6000; i++) { const v = rnd(); g.fillStyle = v < 0.4 ? 'rgba(40,36,30,0.35)' : v < 0.75 ? 'rgba(210,205,190,0.3)' : 'rgba(80,110,60,0.3)'; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3); }
      g.strokeStyle = 'rgba(30,26,22,0.55)'; g.lineWidth = 1.6;
      for (let i = 0; i < 16; i++) { g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
    });
    const rockMat = withCaustics(new T.MeshStandardMaterial({ map: rockTex, bumpMap: rockTex, bumpScale: 1.5, vertexColors: true, roughness: 0.95 }));
    const rockGeos = [0, 1, 2, 3].map(seed => {
      const g = new T.IcosahedronGeometry(1, 2), pos = g.attributes.position, v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.multiplyScalar(1 + Math.sin(v.x * 2.1 + seed) * 0.16 + Math.sin(v.y * 3.3 + seed * 2) * 0.1 + Math.sin(v.z * 5.1 + v.x * 2 + seed) * 0.06);
        if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.2;   // flat underside, sitting in the sand
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      const nor = g.attributes.normal, cols = [], c = new T.Color(), moss = col('#5a8a3a');
      for (let i = 0; i < pos.count; i++) {
        c.setRGB(0.66, 0.62, 0.56).multiplyScalar(0.6 + 0.35 * (pos.getY(i) + 0.3));
        const up = nor.getY(i); if (up > 0.5) c.lerp(moss, Math.min(0.85, (up - 0.5) * 2.4));
        cols.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      return g;
    });
    for (let i = 0; i < 46; i++) {
      const deepBed = i % 2 === 1, p = pol(deepBed ? 10 : 14, deepBed ? 25 : 29, 0), r = (i < 26 ? 0.8 + rnd() * 1.8 : 0.25 + rnd() * 0.4);
      p.y = (deepBed ? kelpY : reefY)(p.x, p.z) + r * 0.15;
      const m = new T.Mesh(rockGeos[i % 4], rockMat); m.position.copy(p); m.scale.set(r, r * (0.55 + rnd() * 0.3), r * (0.8 + rnd() * 0.4)); m.rotation.y = rnd() * TAU; env.add(m);
      if (i < 26) covers.push({ x: p.x, y: p.y + r * 0.4, z: p.z, r: r + 0.5, kind: 'rock' });
    }
    // the wreck on the kelp bed: a broken hull and a leaning mast
    const wreck = new T.Group(), wood = withCaustics(new T.MeshLambertMaterial({ color: 0x4a3a2a }));
    const hull = new T.Mesh(new T.CylinderGeometry(2.4, 2.4, 13, 12, 1, true, 0, Math.PI * 1.3), new T.MeshLambertMaterial({ color: 0x4a3a2a, side: T.DoubleSide }));
    hull.rotation.z = Math.PI / 2; hull.rotation.x = 0.4; wreck.add(hull);
    const mast = new T.Mesh(cyl, wood); mast.scale.set(0.18, 12, 0.18); mast.position.set(1, 5, 0); mast.rotation.z = 0.5; wreck.add(mast);
    const yard = new T.Mesh(cyl, wood); yard.scale.set(0.1, 5, 0.1); yard.position.set(3.4, 9, 0); yard.rotation.z = Math.PI / 2 + 0.5; wreck.add(yard);
    wreck.position.set(-15, -56.5, 6); wreck.rotation.y = 0.8; env.add(wreck);
    for (let k = -2; k <= 2; k++) covers.push({ x: -15 + k * 2.2, y: -55, z: 6 + k * 1.8, r: 2.5, kind: 'wreck' });
    // twilight jellies: glowing bells trailing threads
    const jellies = [];
    for (let i = 0; i < 40; i++) {
      const g = new T.Group(), c = [0x7af0ff, 0xd08aff, 0x8affc0][i % 3];
      const bell = new T.Mesh(new T.SphereGeometry(0.6 + rnd() * 0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, depthWrite: false }));
      g.add(bell);
      for (let k = 0; k < 7; k++) { const t = new T.Mesh(cyl, new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, depthWrite: false })); t.scale.set(0.015, 2 + rnd() * 2, 0.015); t.position.set(Math.cos(k) * 0.35, -1.4, Math.sin(k) * 0.35); g.add(t); }
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: c, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.6 })); halo.scale.setScalar(3); g.add(halo);
      g.position.copy(pol(4, 20, 70 + rnd() * 120)); g.userData.ph = rnd() * 6; env.add(g); jellies.push(g);
    }
    // abyss: vents and tube worms glowing on the floor
    for (let i = 0; i < 24; i++) {
      const p = pol(2, 30, DZ.FLOOR - 0.2), c = i % 3 ? 0xff5040 : 0x60ffd0;
      const t = new T.Mesh(cyl, new T.MeshBasicMaterial({ color: c })); t.scale.set(0.08, 0.8 + rnd(), 0.08); t.position.copy(p); t.position.y += 0.5; env.add(t);
      const h = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: c, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.7 })); h.scale.setScalar(1.6); h.position.copy(t.position); h.position.y += 0.5; env.add(h);
    }

    // the surface seen from below: through Snell's window (a 97 degree cone straight up) the sky,
    // warm and bright with the sun in it; outside it the surface is a rippling mirror of the deep
    const ceilU = { uTime: causticU.uTime, uSky: { value: col('#ffd7a0') }, uDeep: { value: col('#1f6f80') }, uFog: { value: col('#2f9fb2') }, uFar: { value: 60 } };
    const ceiling = new T.Mesh(new T.PlaneGeometry(600, 600, 1, 1), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, uniforms: ceilU, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform float uTime, uFar; uniform vec3 uSky, uDeep, uFog; varying vec3 vW;
        void main(){
          vec3 V = normalize(vW - cameraPosition);
          vec2 p = vW.xz;
          float n1 = sin(p.x * 0.8 + uTime * 1.3) * sin(p.y * 0.9 - uTime) + sin((p.x + p.y) * 1.7 + uTime * 1.6) * 0.5;
          float n2 = sin(p.x * 3.1 - uTime * 2.1 + n1) * sin(p.y * 2.7 + uTime * 1.7);
          float up = V.y + n1 * 0.035 + n2 * 0.012;
          float win = smoothstep(0.63, 0.69, up);
          vec3 sky = mix(uSky * 0.9, vec3(1.0, 0.97, 0.88), smoothstep(0.8, 1.0, up));
          vec3 refl = uDeep * (0.55 + 0.25 * n1);
          vec3 c = mix(refl, sky * (1.15 + 0.25 * n2), win);
          c += vec3(1.0, 0.95, 0.8) * smoothstep(0.66, 0.67, up) * (1.0 - smoothstep(0.67, 0.71, up)) * 0.6;   // the bright rim of the window
          float d = length(vW - cameraPosition);
          c = mix(c, uFog, smoothstep(uFar * 0.25, uFar, d) * (1.0 - win * 0.7));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    }));
    ceiling.rotation.x = -Math.PI / 2; ceiling.position.y = -0.02; root.add(ceiling);
    // god rays: tall soft shafts hanging from the surface around the camera
    const rayTex = canvasTex(32, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,240,0.55)'); gr.addColorStop(1, 'rgba(255,255,240,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); const gx = g.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, w, h); });
    const rays = [];
    for (let i = 0; i < 9; i++) {
      const m = new T.Mesh(new T.PlaneGeometry(2 + rnd() * 3, 34), new T.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.25, side: T.DoubleSide, fog: false }));
      m.userData = { ox: (rnd() - 0.5) * 30, oz: (rnd() - 0.5) * 30, ph: rnd() * 6 };
      root.add(m); rays.push(m);
    }
    // marine snow around the camera (wraps in a box that travels with it)
    const NS = 900, snowPos = new Float32Array(NS * 3);
    for (let i = 0; i < NS * 3; i++) snowPos[i] = (rnd() - 0.5) * 36;
    const snowGeo = new T.BufferGeometry(); snowGeo.setAttribute('position', new T.BufferAttribute(snowPos, 3));
    const snowMat = new T.PointsMaterial({ size: 0.06, map: glowTex, color: 0xdff6ff, transparent: true, depthWrite: false, opacity: 0.6 });
    const snow = new T.Points(snowGeo, snowMat); snow.frustumCulled = false; root.add(snow);
    const plankMat = new T.PointsMaterial({ size: 0.26, map: glowTex, color: 0x6affe0, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 });
    const plank = new T.Points(snowGeo, plankMat); plank.frustumCulled = false; root.add(plank);
    // bubbles
    const NB = 160, bPos = new Float32Array(NB * 3), bVel = new Float32Array(NB), bLife = new Float32Array(NB);
    const bGeo = new T.BufferGeometry(); bGeo.setAttribute('position', new T.BufferAttribute(bPos, 3));
    const bubbles = new T.Points(bGeo, new T.PointsMaterial({ size: 0.09, map: glowTex, color: 0xe8fbff, transparent: true, depthWrite: false })); bubbles.frustumCulled = false; root.add(bubbles);
    for (let i = 0; i < NB; i++) bPos[i * 3 + 1] = 99;
    let bI = 0;
    function bubble(p, n, spread) {
      for (let k = 0; k < (n || 4); k++) { const i = bI++ % NB; bPos[i * 3] = p.x + (rnd() - 0.5) * (spread || 0.3); bPos[i * 3 + 1] = p.y + (rnd() - 0.5) * (spread || 0.3); bPos[i * 3 + 2] = p.z + (rnd() - 0.5) * (spread || 0.3); bVel[i] = 0.6 + rnd() * 0.8; bLife[i] = 3 + rnd() * 2; }
    }
    // bioluminescent sparks: plankton flaring blue-green where the lure (or a fish) tears through the dark
    const NSP = 300, sPos = new Float32Array(NSP * 3).fill(99), sCol = new Float32Array(NSP * 3), sVel = new Float32Array(NSP * 3), sLife = new Float32Array(NSP);
    const sGeo = new T.BufferGeometry(); sGeo.setAttribute('position', new T.BufferAttribute(sPos, 3)); sGeo.setAttribute('color', new T.BufferAttribute(sCol, 3));
    const sparks = new T.Points(sGeo, new T.PointsMaterial({ size: 0.16, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    sparks.frustumCulled = false; root.add(sparks);
    let sI = 0;
    function spark(p, n, speed) {
      for (let k = 0; k < n; k++) {
        const i = sI++ % NSP;
        sPos[i * 3] = p.x + (rnd() - 0.5) * 0.3; sPos[i * 3 + 1] = p.y + (rnd() - 0.5) * 0.3; sPos[i * 3 + 2] = p.z + (rnd() - 0.5) * 0.3;
        sVel[i * 3] = (rnd() - 0.5) * speed; sVel[i * 3 + 1] = (rnd() - 0.5) * speed; sVel[i * 3 + 2] = (rnd() - 0.5) * speed;
        sLife[i] = 0.8 + rnd() * 1.2;
      }
    }
    // a puff of ink, a cloud of scales: dark or bright billboards that fade
    const puffs = [];
    function puff(p, color, size) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, opacity: 0.9 }));
      s.position.copy(p); s.scale.setScalar(size || 2); root.add(s); puffs.push({ s, t: 0 });
    }

    const tagTex = canvasTex(64, 64, (g, w) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w * 0.5, w * 0.95); g.lineTo(w * 0.15, w * 0.4); g.lineTo(w * 0.85, w * 0.4); g.closePath(); g.fill(); });
    // lures: a silver spoon with a lamp
    // the rig: a painted spoon on a split ring, a treble hook behind it, a swivel and leader ahead
    const steel = new T.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.95, roughness: 0.22 });
    const brass = new T.MeshStandardMaterial({ color: 0xc8a050, metalness: 0.9, roughness: 0.3 });
    const spoonTex = canvasTex(64, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#d8dce4'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#c8ccd4');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff4a2e'; g.fillRect(0, h * 0.18, w, h * 0.1); g.fillStyle = '#1a2a6a'; g.fillRect(0, h * 0.3, w, h * 0.05);
      g.fillStyle = '#f4d040'; g.beginPath(); g.arc(w * 0.5, h * 0.62, w * 0.18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#101010'; g.beginPath(); g.arc(w * 0.5, h * 0.62, w * 0.08, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
    });
    function hookGeo() {
      // one J: shank down the axis, a round bend, the point rising back with a barb
      const pts = [new T.Vector3(0, 0, 0), new T.Vector3(0, 0, 0.026)];
      for (let k = 0; k <= 8; k++) { const a = Math.PI * (k / 8); pts.push(new T.Vector3(0, -0.009 + Math.cos(a) * -0.009 + 0.009, 0.026 + Math.sin(a) * 0.009)); }
      pts.push(new T.Vector3(0, -0.018, 0.012));
      const tube = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, 0.0012, 5);
      const barb = new T.ConeGeometry(0.0022, 0.006, 4); barb.rotateX(-Math.PI / 2 - 0.4); barb.translate(0, -0.0175, 0.01);
      return [tube, barb];
    }
    const [hookTube, hookBarb] = hookGeo();
    const spoonGeo = (() => {
      const g = new T.SphereGeometry(1, 16, 10), pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); pos.setXYZ(i, pos.getX(i) * 0.022, pos.getY(i) * 0.005 + z * z * 0.012, z * 0.04); }
      g.computeVertexNormals(); return g;
    })();
    function makeRig(color) {
      const g = new T.Group();
      const spoon = new T.Mesh(spoonGeo, new T.MeshStandardMaterial({ map: spoonTex, metalness: 0.85, roughness: 0.18, emissive: col(color), emissiveIntensity: 0.08 }));
      g.add(spoon);
      const ringF = new T.Mesh(new T.TorusGeometry(0.006, 0.0011, 5, 12), steel); ringF.position.z = -0.045; ringF.rotation.y = Math.PI / 2; g.add(ringF);
      const ringB = ringF.clone(); ringB.position.z = 0.045; g.add(ringB);
      const treble = new T.Group(); treble.position.z = 0.05;
      for (let k = 0; k < 3; k++) { const h = new T.Group(); h.rotation.z = k * Math.PI * 2 / 3; h.add(new T.Mesh(hookTube, steel), new T.Mesh(hookBarb, steel)); treble.add(h); }
      g.add(treble);
      const swivel = new T.Group(); swivel.position.z = -0.065;
      const sb = new T.Mesh(new T.CylinderGeometry(0.0025, 0.0025, 0.012, 8), brass); sb.rotation.x = Math.PI / 2; swivel.add(sb);
      const e1 = new T.Mesh(new T.TorusGeometry(0.003, 0.0008, 4, 8), steel); e1.position.z = -0.009; swivel.add(e1);
      g.add(swivel);
      const leader = new T.Mesh(new T.CylinderGeometry(0.0006, 0.0006, 0.12, 4), new T.MeshBasicMaterial({ color: 0xdfe8ee, transparent: true, opacity: 0.6 }));
      leader.rotation.x = Math.PI / 2; leader.position.z = -0.135; g.add(leader);
      g.userData = { spoon, treble, tip: new T.Vector3(0, 0, -0.195) };   // where the main line ties on
      return g;
    }
    function makeLure(color) {
      const g = new T.Group();
      const rig = makeRig(color); rig.scale.setScalar(1.8); g.add(rig);
      const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: col(color), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.5 })); glow.scale.setScalar(0.5); g.add(glow);
      const lamp = new T.PointLight(0xd8fff4, 0, 10, 1.6); g.add(lamp);
      const tag = new T.Sprite(new T.SpriteMaterial({ map: tagTex, color: col(color), transparent: true, depthWrite: false, depthTest: false, fog: false }));
      tag.position.y = 0.9; tag.scale.setScalar(0.7); tag.renderOrder = 6; tag.visible = false; g.add(tag);
      root.add(g);
      const tie = new T.Vector3();
      return { g, rig, glow, lamp, tag, tieWorld() { g.updateMatrixWorld(true); return tie.copy(rig.userData.tip).applyMatrix4(rig.matrixWorld); } };
    }
    // the line underwater, with beads every 10 m (depth marks)
    function makeLine(color) {
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(new Float32Array(3 * 24), 3));
      const line = new T.Line(geo, new T.LineBasicMaterial({ color: 0xfff6e0, transparent: true, opacity: 0.85 })); line.frustumCulled = false; root.add(line);
      const beadGeo = new T.BufferGeometry(); beadGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(3 * 40), 3));
      const beads = new T.Points(beadGeo, new T.PointsMaterial({ size: 0.22, map: glowTex, color: col(color), transparent: true, depthWrite: false })); beads.frustumCulled = false; root.add(beads);
      return { line, geo, beads, beadGeo };
    }
    const hot = col('#ff4a2e'), amber = col('#ffb347'), calm = col('#fff6e0');
    /** The line through its rope nodes (pts), ending at `end` (the rig's tie-on); beads mark every 10 m. */
    function drawLine(L, pts, end, tension) {
      const a = L.geo.attributes.position.array, n = Math.min(23, pts.length - 1);
      const thrum = (tension || 0) > 0.85 ? ((tension - 0.85) * 0.06) : 0;
      for (let i = 0; i <= n; i++) {
        const q = i === n ? end : pts[i], w = Math.sin(Math.PI * i / n) * thrum * Math.sin(time.v * 80 + i);
        a[i * 3] = q.x + w; a[i * 3 + 1] = q.y + w; a[i * 3 + 2] = q.z;
      }
      L.geo.setDrawRange(0, n + 1); L.geo.attributes.position.needsUpdate = true;
      const k = Math.min(1, tension || 0);
      L.line.material.color.copy(calm).lerp(amber, Math.max(0, Math.min(1, (k - 0.55) / 0.3))).lerp(hot, Math.max(0, (k - 0.85) / 0.15));
      const b = L.beadGeo.attributes.position.array;
      let acc = 0, next = 10, nb = 0;
      for (let i = 0; i < n && nb < 40; i++) {
        const p0 = pts[i], p1 = i + 1 === n ? end : pts[i + 1], sl = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
        while (acc + sl >= next && nb < 40) { const s = (next - acc) / (sl || 1); b[nb * 3] = p0.x + (p1.x - p0.x) * s; b[nb * 3 + 1] = p0.y + (p1.y - p0.y) * s; b[nb * 3 + 2] = p0.z + (p1.z - p0.z) * s; nb++; next += 10; }
        acc += sl;
      }
      L.beadGeo.setDrawRange(0, nb); L.beadGeo.attributes.position.needsUpdate = true;
    }
    function removeObj(o) { root.remove(o); }

    // ---------------------------------------------------------------- per frame
    const fogC = new T.Color(), tmpA = new T.Color(), tmpB = new T.Color(), tmpC = new T.Color();
    let saved = null;
    /** Switch the scene into the depths (camera below the surface) or back. */
    function setActive(on) {
      if (on === root.visible) return;
      root.visible = on;
      W.setAbove(!on);
      W.lights.sun.castShadow = !on;   // nothing below casts into the dock's shadow map
      if (on) { saved = { near: scene.fog.near, far: scene.fog.far, color: scene.fog.color.clone(), bg: scene.background }; }
      else if (saved) { scene.fog.near = saved.near; scene.fog.far = saved.far; scene.fog.color.copy(saved.color); scene.background = saved.bg; }
    }
    function center(x, z) { env.position.set(x, 0, z); }
    const cv = new T.Vector3();
    /** depth: where the camera is (m); lampOn: light level 0..; called every frame while active. */
    function update(dt, camDepth, lamp) {
      time.v += dt; causticU.uTime.value = time.v;
      if (!root.visible) return;
      const zm = DZ.zoneMix(camDepth);
      // water eats red first: within a zone the colour sinks toward its deep tone as you go down
      const zf = Math.max(0, Math.min(1, (camDepth - zm.a.top) / (zm.a.bottom - zm.a.top)));
      tmpA.set(zm.a.fog).lerp(tmpC.set(zm.a.deep), zf); tmpB.set(zm.b.fog); fogC.copy(tmpA).lerp(tmpB, zm.k);
      fogC.multiplyScalar(0.35 + 0.65 * Math.min(1, zm.light * 1.6 + 0.05));
      scene.fog.color.copy(fogC);
      scene.background = fogC;
      ceilU.uFog.value.copy(fogC); ceilU.uDeep.value.copy(tmpA).multiplyScalar(0.8);
      scene.fog.near = 1;
      scene.fog.far = Math.max(9, 1.0 / zm.density) * (camDepth > 60 ? 0.8 + (lamp || 0) * 0.02 : 1);
      ceilU.uFar.value = scene.fog.far * 1.2;
      // a strong high sun (warm near the top, blue-green lower) over a dim ambient: lit tops, shaded sides
      W.lights.hemi.color.set(0x9fe8ff).multiplyScalar(0.3 + zm.light);
      W.lights.hemi.groundColor.copy(fogC).multiplyScalar(0.35);
      W.lights.hemi.intensity = 0.16 + zm.light * 0.55;
      W.lights.sun.intensity = zm.light * 1.75;
      W.lights.sun.color.set(0x8fe0f0).lerp(tmpC.set(0xfff0c8), Math.max(0, 1 - camDepth / 14));
      W.lights.fill.intensity = 0.05;
      const cam = W.camera.position;
      W.lights.sun.position.set(cam.x + 8, cam.y + 30, cam.z + 6); W.lights.sun.target.position.copy(cam);
      rays.forEach((m, i) => {
        // shafts lean with the sun, sweep slowly as the surface swells, and breathe in width
        const u = m.userData; m.position.set(cam.x + u.ox + Math.sin(time.v * 0.15 + u.ph) * 2, -15, cam.z + u.oz); m.lookAt(cam.x, -15, cam.z);
        m.rotateZ(0.28 + Math.sin(time.v * 0.21 + u.ph) * 0.06); m.scale.x = 0.8 + 0.4 * Math.sin(time.v * 0.5 + u.ph * 2);
        m.material.opacity = Math.max(0, 0.3 - camDepth * 0.009) * (0.5 + 0.5 * Math.sin(time.v * 0.4 + u.ph));
      });
      // snow and plankton wrap around the camera
      snow.position.set(Math.floor(cam.x / 36) * 36, Math.floor(cam.y / 36) * 36, Math.floor(cam.z / 36) * 36);
      plank.position.copy(snow.position);
      const pa = snowGeo.attributes.position.array;
      // the current carries it: a slow drift along x that surges and eases, each flake wandering
      const surge = 0.22 + 0.16 * Math.sin(time.v * 0.23);
      for (let i = 0; i < NS; i++) {
        pa[i * 3 + 1] -= dt * (0.05 + (i % 7) * 0.01); pa[i * 3] += dt * (surge + Math.sin(time.v * 0.9 + i) * 0.06); pa[i * 3 + 2] += Math.cos(time.v * 0.7 + i * 1.3) * dt * 0.04;
        if (pa[i * 3 + 1] < -18) pa[i * 3 + 1] += 36;
        if (pa[i * 3] > 18) pa[i * 3] -= 36;
      }
      snowGeo.attributes.position.needsUpdate = true;
      snowMat.color.set(camDepth > 60 ? 0x5a7090 : 0xdff6ff); snowMat.opacity = camDepth > 200 ? 0.25 : 0.55;
      plankMat.opacity = camDepth < 55 ? 0 : Math.min(0.85, (camDepth - 55) / 30) * (0.6 + 0.4 * Math.sin(time.v * 2.2));
      shallowOnly.forEach(o => { o.visible = camDepth < 85 && !low.on; });
      RIM.value.set(0x9fe8ff).multiplyScalar(0.12 + zm.light * 0.8);
      for (let i = 0; i < NSP; i++) {
        if (sLife[i] <= 0) continue;
        sLife[i] -= dt; const k = Math.max(0, sLife[i]) * (0.7 + 0.3 * Math.sin(time.v * 20 + i));   // flicker as they die
        sPos[i * 3] += sVel[i * 3] * dt; sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt; sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
        sVel[i * 3] *= 0.97; sVel[i * 3 + 1] *= 0.97; sVel[i * 3 + 2] *= 0.97;
        sCol[i * 3] = 0.25 * k; sCol[i * 3 + 1] = 0.95 * k; sCol[i * 3 + 2] = 0.85 * k;
        if (sLife[i] <= 0) sPos[i * 3 + 1] = 99;
      }
      sGeo.attributes.position.needsUpdate = true; sGeo.attributes.color.needsUpdate = true;
      jellies.forEach(j => { j.position.y += Math.sin(time.v * 0.8 + j.userData.ph) * dt * 0.3; j.children[0].scale.y = 0.85 + Math.sin(time.v * 2 + j.userData.ph) * 0.15; });
      for (let i = 0; i < NB; i++) { if (bLife[i] <= 0) continue; bLife[i] -= dt; bPos[i * 3 + 1] += bVel[i] * dt; bPos[i * 3] += Math.sin(time.v * 3 + i) * dt * 0.1; if (bLife[i] <= 0 || bPos[i * 3 + 1] > -0.1) { bLife[i] = 0; bPos[i * 3 + 1] = 99; } }
      bGeo.attributes.position.needsUpdate = true;
      for (let i = puffs.length - 1; i >= 0; i--) { const p = puffs[i]; p.t += dt; p.s.material.opacity = Math.max(0, 0.9 - p.t * 0.4); p.s.scale.multiplyScalar(1 + dt * 0.5); if (p.t > 2.4) { root.remove(p.s); puffs.splice(i, 1); } }
    }
    /** Cover (kelp, coral, rocks, the wreck) in world space. */
    function worldCovers() { return covers.map(c => ({ x: c.x + env.position.x, y: c.y, z: c.z + env.position.z, r: c.r, kind: c.kind })); }
    function addFish(sp, simple) { const m = makeFish(sp, { simple }); root.add(m); return m; }

    return { setLow(on) { low.on = on; }, spark, makeRig, root, setActive, center, update, makeLure, makeLine, drawLine, removeObj, bubble, puff, worldCovers, addFish, makeFish, get active() { return root.visible; } };
  }

  window.TideDeep = { create, makeFish };
})();
