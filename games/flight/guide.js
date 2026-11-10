/*
 * GYROWING controller guide: a live picture of the controller in your hand (the Mimic Pad as laid
 * out on the phone, a standard gamepad, or the keyboard) that lights up what you press and says
 * what it is doing to the aircraft ("STICK  climb", "POWER 72%"). The first-flight lesson uses it
 * to point at the control for each step, and it shows for the first seconds of every flight.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // the Mimic Pad on a phone held sideways (games' PadLayout: shoulders along the top, the stick
  // left, A/B/X/Y right, D-pad and right stick either side of the centre at the bottom)
  const PAD_SVG = `
<svg viewBox="0 0 320 168" class="g-pad" aria-hidden="true">
  <rect x="4" y="4" width="312" height="160" rx="26" class="g-body"/>
  <rect x="16" y="14" width="56" height="20" rx="8" class="g-key" data-k="l1"/><text x="44" y="28">L1</text>
  <rect x="78" y="14" width="46" height="20" rx="8" class="g-key" data-k="l2"/><text x="101" y="28">L2</text>
  <rect x="196" y="14" width="46" height="20" rx="8" class="g-key" data-k="r2"/><text x="219" y="28">R2</text>
  <rect x="248" y="14" width="56" height="20" rx="8" class="g-key" data-k="r1"/><text x="276" y="28">R1</text>
  <circle cx="66" cy="96" r="34" class="g-key g-stick" data-k="ls"/>
  <path class="g-arrow" data-a="up" d="M66 56 l-7 9 h14 z"/><path class="g-arrow" data-a="down" d="M66 136 l-7 -9 h14 z"/>
  <path class="g-arrow" data-a="left" d="M26 96 l9 -7 v14 z"/><path class="g-arrow" data-a="right" d="M106 96 l-9 -7 v14 z"/>
  <circle cx="66" cy="96" r="13" class="g-dot" data-k="lsdot"/>
  <circle cx="256" cy="72" r="13" class="g-key" data-k="y"/><text x="256" y="77">Y</text>
  <circle cx="232" cy="96" r="13" class="g-key" data-k="x"/><text x="232" y="101">X</text>
  <circle cx="280" cy="96" r="13" class="g-key" data-k="b"/><text x="280" y="101">B</text>
  <circle cx="256" cy="120" r="13" class="g-key" data-k="a"/><text x="256" y="125">A</text>
  <rect x="122" y="112" width="14" height="14" rx="3" class="g-key" data-k="dup"/><rect x="108" y="126" width="14" height="14" rx="3" class="g-key" data-k="dleft"/>
  <rect x="136" y="126" width="14" height="14" rx="3" class="g-key" data-k="dright"/><rect x="122" y="140" width="14" height="14" rx="3" class="g-key" data-k="ddown"/>
  <circle cx="194" cy="136" r="15" class="g-key" data-k="rs"/>
  <text x="129" y="106" class="g-small">FLAPS</text><text x="194" y="116" class="g-small">RUDDER</text>
</svg>`;
  const KEYS = [
    // [label, codes, x, y, w]
    ['Ctrl', ['ControlLeft'], 6, 92, 44], ['Shift', ['ShiftLeft'], 6, 64, 52],
    ['Q', ['KeyQ'], 62, 8, 26], ['W', ['KeyW', 'ArrowUp'], 92, 8, 26], ['E', ['KeyE'], 122, 8, 26],
    ['A', ['KeyA', 'ArrowLeft'], 70, 36, 26], ['S', ['KeyS', 'ArrowDown'], 100, 36, 26], ['D', ['KeyD', 'ArrowRight'], 130, 36, 26],
    ['F', ['KeyF'], 160, 36, 26], ['G', ['KeyG'], 190, 36, 26], ['V', ['KeyV'], 176, 64, 26], ['C', ['KeyC'], 146, 64, 26],
    ['1', ['Digit1'], 220, 8, 26], ['2', ['Digit2'], 250, 8, 26], ['Space', ['Space'], 90, 92, 130],
  ];

  function Guide(el) {
    this.el = el;
    el.innerHTML = '<div class="g-dev">Mimic Pad</div>' + PAD_SVG + this.keyboardSvg() +
      '<div class="g-cap"><span class="g-stickcap"><b>STICK</b><i>centred</i></span><span class="g-pow"><b>POWER</b><em><u></u></em><i>0%</i></span></div>';
    this.pad = el.querySelector('.g-pad'); this.kb = el.querySelector('.g-kb');
    this.k = {}; el.querySelectorAll('[data-k]').forEach(n => { this.k[n.dataset.k] = n; });
    this.arrows = {}; el.querySelectorAll('[data-a]').forEach(n => { this.arrows[n.dataset.a] = n; });
    this.kk = Array.from(el.querySelectorAll('.g-kk'));
    this.dev = el.querySelector('.g-dev'); this.cap = el.querySelector('.g-stickcap i'); this.powI = el.querySelector('.g-pow i'); this.powU = el.querySelector('.g-pow u');
    this.mode = null;
  }
  Guide.prototype.keyboardSvg = function () {
    let s = '<svg viewBox="0 0 284 124" class="g-kb hidden" aria-hidden="true">';
    for (const [l, codes, x, y, w] of KEYS) s += `<g class="g-kk" data-codes="${codes.join(' ')}"><rect x="${x}" y="${y}" width="${w}" height="24" rx="5"/><text x="${x + w / 2}" y="${y + 16}">${l}</text></g>`;
    return s + '</svg>';
  };
  /**
   * o: { device 'pad'|'gamepad'|'kbm', raw (input.raw), keys (input.keys), thr, elev, ail, show
   * (highlights: more, less, stickBack, stickFwd, stickLeft, stickRight, stickCentre) }
   */
  Guide.prototype.update = function (o) {
    const kbm = o.device === 'kbm';
    if (this.mode !== o.device) {
      this.mode = o.device;
      this.pad.classList.toggle('hidden', kbm); this.kb.classList.toggle('hidden', !kbm);
      this.dev.textContent = kbm ? 'Keyboard' : o.device === 'pad' ? 'Mimic Pad' : 'Gamepad';
    }
    const show = new Set(o.show || []);
    if (!kbm) {
      const r = o.raw || {};
      const on = (k, v) => this.k[k] && this.k[k].classList.toggle('on', !!v);
      on('l1', r.l1); on('r1', r.r1); on('l2', r.l2 > 0.3); on('r2', r.r2 > 0.3); on('a', r.a); on('b', r.b); on('x', r.x); on('y', r.y);
      const h = r.hat || {}; on('dup', h.up); on('ddown', h.down); on('dleft', h.left); on('dright', h.right);
      on('rs', Math.abs(r.rx || 0) > 0.2);
      const lx = clamp(r.lx || 0, -1, 1), ly = clamp(r.ly || 0, -1, 1);
      this.k.lsdot.setAttribute('cx', 66 + lx * 22); this.k.lsdot.setAttribute('cy', 96 + ly * 22);
      on('ls', Math.abs(lx) + Math.abs(ly) > 0.15);
      const hl = (k, v) => this.k[k] && this.k[k].classList.toggle('hl', !!v);
      hl('r2', show.has('more')); hl('a', show.has('more')); hl('l2', show.has('less')); hl('b', show.has('less'));
      const stick = show.has('stickBack') || show.has('stickFwd') || show.has('stickLeft') || show.has('stickRight') || show.has('stickCentre');
      hl('ls', stick);
      this.arrows.down.classList.toggle('hl', show.has('stickBack')); this.arrows.up.classList.toggle('hl', show.has('stickFwd'));
      this.arrows.left.classList.toggle('hl', show.has('stickLeft')); this.arrows.right.classList.toggle('hl', show.has('stickRight'));
    } else {
      const keys = o.keys || {};
      const want = { more: ['ShiftLeft'], less: ['ControlLeft'], stickBack: ['KeyS'], stickFwd: ['KeyW'], stickLeft: ['KeyA'], stickRight: ['KeyD'] };
      const hlCodes = new Set(); for (const s of show) (want[s] || []).forEach(c => hlCodes.add(c));
      for (const g of this.kk) {
        const codes = g.dataset.codes.split(' ');
        g.classList.toggle('on', codes.some(c => keys[c] || (c === 'ShiftLeft' && keys.ShiftRight) || (c === 'ControlLeft' && keys.ControlRight)));
        g.classList.toggle('hl', codes.some(c => hlCodes.has(c)));
      }
    }
    // what the inputs are doing to the aircraft, in words
    const e = o.elev || 0, a = o.ail || 0;
    const parts = [];
    if (e > 0.15) parts.push('climb'); else if (e < -0.15) parts.push('dive');
    if (a > 0.15) parts.push('bank right'); else if (a < -0.15) parts.push('bank left');
    this.cap.textContent = parts.length ? parts.join(' + ') : 'centred: holding level';
    const p = Math.round((o.thr || 0) * 100);
    this.powI.textContent = p + '%'; this.powU.style.transform = 'scaleX(' + (o.thr || 0).toFixed(3) + ')';
  };

  window.Guide = Guide;
})();
