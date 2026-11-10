// Ironfern HUD and screens: crosshair, hit markers, hurt vignette, objective, key guide, prompts
// (dodge / reload / scope), threat markers, off-screen arrows, hurt direction, spotter callouts, vitals, ammo, score feed, banners, and the title, select,
// briefing, pause and results screens. Phone (Mimic Grip mode) controls come first everywhere.
(function () {
  'use strict';
  const DH = window.DH = window.DH || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const call = (mod, fn, ...a) => { const m = DH[mod]; if (m && typeof m[fn] === 'function') { try { return m[fn](...a); } catch (e) { console.warn('[hud]', mod, fn, e); } } };

  // Mimic Grip mode: the phone in your fist sends its motion (aim) and the volume keys; CENTRE is the
  // one on-screen button. Mouse + keyboard shown small.
  const CONTROLS = {
    fire: { phone: 'VOL DOWN', verb: 'fire', key: 'click' },
    reload: { phone: 'TAP VOL UP', verb: 'reload', key: 'R' },
    align: { phone: 'CENTRE', verb: 'align', key: 'V' },
    switch: { phone: 'DOUBLE VOL UP', verb: 'switch', key: 'Q' },
    dodge: { phone: 'FLICK', verb: 'dodge', key: 'Space' },
    scope: { phone: 'HOLD STEADY', verb: 'scope', key: 'right click' },
    pause: { phone: 'HOLD VOL UP 2 S', verb: 'pause', key: 'Esc' },
  };
  // seconds before impact when the prompt switches from GET READY to DODGE (a dodge lasts ~0.55 s)
  const DODGE_CALL = Math.min(0.5, ((DH.Player && DH.Player.DODGE_WINDOW) || 0.55) - 0.05);
  const ORDER_KEYS = ['fire', 'reload', 'align', 'switch', 'dodge', 'pause'];
  const chip = (id, cls) => { const c = CONTROLS[id]; return `<span class="kc ${cls || ''}"><b>${c.phone}</b><em>${c.verb}</em><small>${c.key}</small></span>`; };
  const ALIGN_TIP = 'Hold the phone the way you like, point it at the centre of the screen, then press CENTRE on the phone (or hold VOL UP). Do it again any time the crosshair feels off.';
  const PAIR_TIP = 'On your phone: open Mimic, choose <b>Grip</b>, and pair over Bluetooth. The phone is read as a motion controller: just point it.';
  /** Mimic family hint bar: what the Grip (and the mouse) does on each screen. */
  const kb = (k, t) => `<span><kbd>${k}</kbd>${t}</span>`;
  const HINTS = {
    title: kb('Vol Down / click', 'start'),
    select: kb('Point phone / mouse', 'choose') + kb('Vol Down / click', 'play mission') + kb('Vol Up / R', 'back'),
    briefing: kb('Vol Down / click', 'begin') + kb('Vol Up / R', 'missions'),
    pause: kb('Vol Down / click', 'choose') + kb('Vol Up / R', 'resume'),
    results: kb('Vol Down / click', 'choose') + kb('Vol Up / R', 'missions'),
    settings: kb('Point + Vol Down / click', 'change') + kb('Vol Up / R', 'done'),
  };
  function family(state) {
    let b = $('mbadge'), h = $('mhint');
    if (!b) {
      b = document.createElement('div'); b.id = 'mbadge'; b.className = 'mimic-badge'; b.innerHTML = '<b>Mimic</b><i></i><span></span>'; document.body.appendChild(b);
      h = document.createElement('div'); h.id = 'mhint'; h.className = 'mimic-hint'; document.body.appendChild(h);
    }
    b.classList.toggle('hidden', state === 'play' || state === 'loading');
    badge();
    h.innerHTML = HINTS[state] || '';
    h.classList.toggle('hidden', !HINTS[state]);
  }
  /** The badge says what is driving the game: the phone (Grip / Wand) or mouse + keys. */
  function badge() {
    const b = $('mbadge'); if (!b) return;
    const ph = DH.Input && DH.Input.phone, mc = ph && ph.mc;
    const t = ph && ph.connected ? (mc.mode === 'grip' ? 'Grip connected' : 'Wand connected') : 'No phone: mouse + keys';
    const s = b.querySelector('span'); if (s.textContent !== t) s.textContent = t;
    b.classList.toggle('on', !!(ph && ph.connected));
  }
  const stars = (n, max) => { let s = ''; for (let i = 0; i < (max || 3); i++) s += `<i class="${i < n ? 'on' : ''}">&#9733;</i>`; return `<span class="stars">${s}</span>`; };
  const fmtT = s => { s = Math.max(0, Math.ceil(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const num = n => (n < 0 ? '−' : '') + Math.abs(Math.round(n || 0)).toLocaleString('en-US');
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n || 0)).toLocaleString('en-US');

  let ctx = null;
  const el = {};
  const H = { hitA: 0, hurtA: 0, prompt: null, flash: null, keysT: 0, banner: null, lastScreen: null, callout: null, near: 0, hurtDirs: [], marks: [] };

  // ---------------------------------------------------------------- HUD build
  function build() {
    $('hitmarker').innerHTML = '<i></i><i></i><i></i><i></i>';
    $('objective').innerHTML = '<div class="ob-head"><span class="ob-title"></span><span class="ob-score"></span></div>'
      + '<div class="ob-row"><span class="ob-text"></span><span class="ob-timer"></span></div><div class="ob-note"></div>';
    $('keys').innerHTML = ORDER_KEYS.map(k => chip(k)).join('');
    $('prompt').innerHTML = '<div class="pr-ring"><svg viewBox="0 0 88 88"><circle class="bg" cx="44" cy="44" r="38"/><circle class="fg" cx="44" cy="44" r="38"/></svg>'
      + '<span class="pr-phone"></span></div><div class="pr-word"></div><div class="pr-key"></div>';
    $('vitals').innerHTML = '<span class="vt-lbl">HEALTH</span><div class="vt-bar"><i></i></div><span class="vt-num">100</span>';
    $('ammo').innerHTML = '<div class="am-name">—</div><div class="am-count"><b>–</b><span></span></div><div class="am-reload"><i></i></div><div class="am-hint"></div>';
    let b = $('banner');
    if (!b) { b = document.createElement('div'); b.id = 'banner'; $('hud').appendChild(b); }
    const mk = (id, cls) => { let n = $(id); if (!n) { n = document.createElement('div'); n.id = id; if (cls) n.className = cls; $('hud').insertBefore(n, $('objective')); } return n; };
    el.marks = mk('marks'); el.hurtdir = mk('hurtdir'); el.callout = mk('callout');
    el.hurtdir.innerHTML = '<i></i><i></i><i></i>';
    el.near = document.createElement('div'); el.near.id = 'nearmiss'; el.near.textContent = 'CLOSE'; $('hud').appendChild(el.near);
    Object.assign(el, {
      cross: $('crosshair'), hit: $('hitmarker'), hurt: $('hurt'), prompt: $('prompt'), banner: b, keys: $('keys'), feed: $('feed'),
      obTitle: $('objective').querySelector('.ob-title'), obScore: $('objective').querySelector('.ob-score'), obText: $('objective').querySelector('.ob-text'),
      obTimer: $('objective').querySelector('.ob-timer'), obNote: $('objective').querySelector('.ob-note'), objective: $('objective'),
      ring: $('prompt').querySelector('.fg'), prPhone: $('prompt').querySelector('.pr-phone'), prWord: $('prompt').querySelector('.pr-word'), prKey: $('prompt').querySelector('.pr-key'),
      hpBar: $('vitals').querySelector('.vt-bar i'), hpNum: $('vitals').querySelector('.vt-num'), vitals: $('vitals'),
      amName: $('ammo').querySelector('.am-name'), amMag: $('ammo').querySelector('.am-count b'), amRes: $('ammo').querySelector('.am-count span'),
      amReload: $('ammo').querySelector('.am-reload'), amReloadBar: $('ammo').querySelector('.am-reload i'), amHint: $('ammo').querySelector('.am-hint'), ammo: $('ammo'),
    });
  }

  // ---------------------------------------------------------------- events
  function hitmarker(kind, big) {
    el.hit.className = (kind || '') + (big ? ' big' : '');
    H.hitA = 1.4; // held at full for ~0.15 s, then fades
  }
  function addFeed(text, points, kind) {
    const d = document.createElement('div');
    d.className = 'fd ' + (kind || '');
    d.innerHTML = (points != null && points !== 0 ? `<b>${signed(points)}</b>` : '') + `<span>${esc(text)}</span>`;
    el.feed.prepend(d);
    while (el.feed.children.length > 5) el.feed.lastChild.remove();
    setTimeout(() => d.classList.add('out'), 2200);
    setTimeout(() => d.remove(), 2700);
  }
  function showBanner(b) {
    el.banner.className = 'show ' + (b.kind || 'info');
    el.banner.innerHTML = `<div class="bn-text">${esc(b.text)}</div>` + (b.sub ? `<div class="bn-sub">${esc(b.sub)}</div>` : '');
    H.banner = { until: now() + (b.dur || 2.2) };
  }
  const now = () => (ctx ? ctx.time : performance.now() / 1000);
  function hook() {
    const on = (e, f) => DH.bus.on(e, d => f(d || {}));
    on('shot:hit', d => {
      const weak = d.zone === 'head' || d.zone === 'eye' || d.zone === 'mouth';
      hitmarker(d.killed ? 'kill' : '', weak);
    });
    on('mission:target', () => hitmarker('', false));
    on('player:hurt', d => {
      H.hurtA = Math.min(1, 0.45 + (d.damage || 10) / 40);
      if (d.from && ctx && DH.Signs) {
        const ang = DH.Signs.hurtAngle(ctx.camera.rotation.y, DH.Signs.bearingTo(ctx.camera.position, d.from));
        H.hurtDirs.unshift({ ang, t0: now() }); H.hurtDirs.length = Math.min(H.hurtDirs.length, 3);
      }
    });
    on('shot:near', () => { H.near = now(); });
    on('shot:spit', () => { hitmarker('kill', false); H.flash = { text: 'SPIT DOWN', until: now() + 0.6 }; });
    on('mission:callout', d => { H.callout = { text: d.text, side: d.side, until: now() + 2.6 }; el.callout.textContent = d.text; el.callout.className = 'show ' + (d.side || ''); });
    on('dino:attack', d => {
      if (!d.dodgeable && !d.duckable) return;
      H.prompt = { kind: 'dodge', t0: now(), dur: Math.max(0.15, (d.windowMs || 700) / 1000) };
    });
    on('player:dodged', () => { H.prompt = null; H.flash = { text: 'DODGED', until: now() + 0.7 }; });

    on('player:hurt', () => { H.prompt = null; });
    on('mission:feed', d => addFeed(d.text, d.points, d.kind));
    on('mission:banner', showBanner);
    on('mission:retry', () => { H.hurtA = 0; H.prompt = null; H.hurtDirs = []; });
    on('aim:aligned', () => { H.flash = { text: 'ALIGNED', until: now() + 0.6 }; H.needAlign = false; });
  }

  // ---------------------------------------------------------------- threat markers
  // Every animal you must deal with is findable: a small chevron over it when it is on screen (a
  // red TAG with range for tagged ones, a ring on practice plates), an arrow on the screen edge
  // when it is not. Red and pulsing while it winds up an attack.
  const _p = typeof THREE !== 'undefined' ? new THREE.Vector3() : null, _q = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  let marksOut = [];
  function markNode(i) {
    while (H.marks.length <= i) { const n = document.createElement('div'); n.className = 'mk'; n.innerHTML = '<i></i><span></span>'; el.marks.appendChild(n); H.marks.push(n); }
    return H.marks[i];
  }
  function marks(c, scoped) {
    marksOut = [];
    const M = DH.Missions && DH.Missions.state, D = DH.Dinos;
    let n = 0;
    if (M && M.active && (M.mode === 'stand' || M.mode === 'ride' || M.mode === 'clear') && D && DH.Signs) {
      const ph = M.phaseDef, tagOnly = !!(ph && ph.objective && ph.objective.tagged);
      const cam = c.camera, W = innerWidth, Hh = innerHeight, list = [];
      D.list().forEach(d => {
        if (!d.alive || !d.root.visible || d.species === 'grazer' || (tagOnly && !d.tagged)) return;
        const top = d.species === 'ptero' ? 1.2 : d.inst.tpl.height * 1.05;
        list.push({ obj: d, pos: _q.copy(d.pos).setY(d.pos.y + top).clone(), tag: d.tagged, hot: d.brain.state === 'telegraph', dist: d.pos.distanceTo(cam.position), big: d.species === 'rex' || d.species === 'trike' });
      });
      const plates = DH.Missions.targets ? DH.Missions.targets() : [];
      plates.forEach(t => { if (!t.down) list.push({ obj: t, pos: t.plate.getWorldPosition(new THREE.Vector3()), plate: true, dist: 0 }); });
      for (const m of list) {
        _p.copy(m.pos).project(cam);
        const behind = _p.z > 1;
        const arrow = DH.Signs.edgeArrow(_p.x, _p.y, behind, 0.07);
        const node = markNode(n++);
        let cls = 'mk ' + (m.plate ? 'plate' : m.tag ? 'tag' : 'foe') + (m.hot ? ' hot' : '');
        let x, y, rot = 0, label = '';
        if (arrow) { cls += ' edge'; x = (arrow.x + 1) / 2 * W; y = (1 - arrow.y) / 2 * Hh; rot = -arrow.ang * 180 / Math.PI; label = m.plate ? '' : Math.round(m.dist) + 'm'; }
        else {
          x = (_p.x + 1) / 2 * W; y = (1 - _p.y) / 2 * Hh;
          // close, big animals need no chevron unless they are winding up
          if (!m.plate && !m.tag && !m.hot && (m.dist < 14 || (m.big && m.dist < 30))) cls += ' quiet';
          label = m.tag ? 'TAG ' + Math.round(m.dist) + 'm' : '';
        }
        node.className = cls;
        node.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
        node.firstChild.style.transform = arrow ? `rotate(${rot.toFixed(1)}deg)` : '';
        if (node.lastChild.textContent !== label) node.lastChild.textContent = label;
        marksOut.push({ obj: m.obj, x, y, on: !arrow });
      }
    }
    for (let i = n; i < H.marks.length; i++) if (H.marks[i].className !== 'mk off') H.marks[i].className = 'mk off';
  }
  function hurtDirs() {
    const t = now(), nodes = el.hurtdir.children;
    for (let i = 0; i < nodes.length; i++) {
      const h = H.hurtDirs[i], k = h ? Math.max(0, 1 - (t - h.t0) / 1.4) : 0;
      nodes[i].style.opacity = k.toFixed(2);
      if (h) nodes[i].style.transform = `rotate(${(h.ang * 180 / Math.PI).toFixed(1)}deg)`;
    }
  }

  // ---------------------------------------------------------------- per-frame HUD
  function update(dt, c) {
    ctx = c || ctx;
    if (ctx && ctx.state !== 'play') badge();
    if (!ctx || ctx.state !== 'play') return;
    const W = DH.Weapons || {}, w = W.current, p = ctx.player || {}, M = DH.Missions && DH.Missions.state;
    const aim = ctx.aim || { cx: 0, cy: 0 };
    const cn = ctx.crossNdc ? ctx.crossNdc() : { x: aim.cx, y: -aim.cy };
    const x = (cn.x + 1) / 2 * innerWidth, y = (1 - cn.y) / 2 * innerHeight;
    const tr = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;

    // crosshair + hitmarker
    const scoped = !!W.scoped;
    el.cross.style.transform = tr;
    el.cross.classList.toggle('off', scoped || !!p.ducking);
    marks(c, scoped);
    hurtDirs();
    if (H.callout && now() > H.callout.until) { el.callout.className = ''; H.callout = null; }
    el.near.style.transform = tr;
    el.near.style.opacity = Math.max(0, 1 - (now() - H.near) / 0.5).toFixed(2);
    const spread = w && typeof w.spread === 'number' ? w.spread : 0.01;
    // spread is a cone half-angle (rad): show it at its true size on screen
    const focal = innerHeight / 2 / Math.tan(((ctx.camera ? ctx.camera.fov : 70) * Math.PI / 180) / 2);
    el.cross.style.setProperty('--gap', Math.max(4, Math.min(70, 3 + spread * focal)).toFixed(1) + 'px');
    H.hitA = Math.max(0, H.hitA - dt * 2.6);
    el.hit.style.transform = scoped ? `translate(${innerWidth / 2}px,${innerHeight / 2}px)` : tr;
    el.hit.style.opacity = Math.min(1, H.hitA).toFixed(2);

    // hurt vignette
    H.hurtA = Math.max(0, H.hurtA - dt * 1.4);
    const hp = p.hp == null ? 100 : p.hp, maxHp = p.maxHp || 100;
    el.hurt.style.opacity = Math.max(H.hurtA, hp < 30 ? 0.6 : 0).toFixed(2);
    el.hurt.classList.toggle('low', hp < 30 && hp > 0);

    // vitals
    el.hpBar.style.width = Math.max(0, 100 * hp / maxHp).toFixed(1) + '%';
    el.hpNum.textContent = Math.ceil(hp);
    el.vitals.classList.toggle('low', hp < 30);

    // ammo
    let needReload = false, empty = false;
    if (w) {
      el.amName.textContent = w.name || w.id || '';
      el.amMag.textContent = w.mag == null ? '–' : w.mag;
      el.amRes.textContent = w.reserve == null ? '' : '/ ' + w.reserve;
      el.amMag.classList.toggle('low', w.mag != null && w.magSize && w.mag <= Math.max(1, Math.floor(w.magSize / 5)));
      if (w.reloading) {
        el.amReload.classList.add('on'); // reloadT: 0..1 progress
        el.amReloadBar.style.width = (100 * Math.max(0, Math.min(1, w.reloadT || 0))).toFixed(0) + '%';
      } else el.amReload.classList.remove('on');
      needReload = w.mag === 0 && !w.reloading && w.reserve > 0;
      empty = w.mag === 0 && !w.reloading && !(w.reserve > 0);
      el.amHint.textContent = empty ? 'DOUBLE VOL UP: switch' : '';
    } else { el.amName.textContent = 'Carbine'; el.amMag.textContent = '–'; el.amRes.textContent = ''; }

    // prompt: attack telegraph > result flash > reload > mission hint
    const t = now();
    let pr = null;
    if (H.prompt) {
      const left = H.prompt.dur - (t - H.prompt.t0);
      if (left <= -0.15) H.prompt = null;
      else {
        // A dodge only protects for ~0.55 s (player.js), so during a long wind-up (a charge can
        // telegraph 3 s ahead) say GET READY and only call DODGE in the last half second.
        // Ducking is held, so DUCK shows from the start.
        const wait = H.prompt.kind === 'dodge' && left > DODGE_CALL;
        pr = { cls: 'attack ' + H.prompt.kind + (wait ? ' wait' : ''), ctl: H.prompt.kind,
          word: wait ? 'GET READY' : 'DODGE', frac: Math.max(0, left / H.prompt.dur) };
      }
    }
    if (!pr && H.flash) { if (t < H.flash.until) pr = { cls: 'flash', word: H.flash.text }; else H.flash = null; }
    if (!pr && H.needAlign && t - H.playT < 7) pr = { cls: 'hint small', ctl: 'align', word: 'POINT AT THE CENTRE, THEN ALIGN' };
    if (!pr && needReload) pr = { cls: 'hint', ctl: 'reload', word: 'RELOADING' };
    if (!pr && empty) pr = { cls: 'hint', ctl: 'switch', word: 'SWITCH' };
    if (!pr && M && M.mode === 'stand' && w && w.id === 'marksman' && !scoped && M.t < 25) pr = { cls: 'hint small', ctl: 'scope', word: 'SCOPE' };
    if (pr) {
      el.prompt.className = 'show ' + pr.cls;
      el.prWord.textContent = pr.word;
      const c = pr.ctl && CONTROLS[pr.ctl];
      const hint = pr.cls.indexOf('hint') >= 0;
      el.prPhone.textContent = c ? c.phone : '';
      el.prKey.innerHTML = !c ? '' : hint ? `<b>${c.phone}</b>${esc(c.key)}` : esc(c.key);
      el.ring.style.strokeDashoffset = (238.76 * (1 - (pr.frac == null ? 1 : pr.frac))).toFixed(1);
    } else el.prompt.className = '';

    // objective
    if (M && M.id) {
      el.obTitle.textContent = M.title;
      const v = M.view;
      el.obText.textContent = v ? v.text : (M.mode === 'ride' ? 'On the move' : '');
      el.obTimer.textContent = v && v.timer != null ? fmtT(v.timer) : '';
      el.obTimer.classList.toggle('urgent', !!(v && v.timer != null && v.timer < 15));
      el.obNote.textContent = M.note || '';
      el.objective.classList.toggle('done', !!(v && v.done));
      const st = M.stats;
      el.obScore.textContent = st ? num(Math.max(0, st.killPoints - st.penalty)) + ' pts' : '';
    }

    // the key guide leaves after 12 s of play (pause keeps the full list), so the jungle breathes
    H.keysT += dt;
    el.keys.classList.toggle('dim', H.keysT > 12);

    // banner
    if (H.banner && t > H.banner.until) { el.banner.classList.remove('show'); H.banner = null; }
  }

  // ---------------------------------------------------------------- screens
  const SCREENS = ['loading', 'title', 'select', 'briefing', 'pause', 'results', 'settings'];
  function go(state, data) { call('Core', 'go', state, data); }
  function onClick(id, f) { const n = $(id); if (n) n.addEventListener('click', e => { e.stopPropagation(); f(e); }); }

  function renderTitle() {
    $('title').innerHTML = `
      <div class="ti-wrap">
        <div class="ti-main">
          <div class="brand"><div class="logo">IRONFERN</div><div class="tag">Halcyon Biotech containment failure &middot; day 41</div></div>
          <p class="premise">The park fell six weeks ago. Hold your ground, reach the survivors, put down what owns the island.</p>
          <div class="ti-go">
            <button class="cta" id="ti-start">Vol Down / click to start</button>
            <div class="mimic-scan" data-mimic-join="grip" data-compact data-label="No app? Scan to play"></div>
          </div>
        </div>
        <div class="panel gun">
          <div class="pn-head"><span class="pn-kicker">Best with Mimic Grip mode</span><span class="pn-title">Hold the phone like a pistol</span></div>
          <ul class="ti-how">
            <li><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg><span><b>Point to aim</b> 1:1, no aim assist</span></li>
            <li><svg viewBox="0 0 24 24"><path d="M3 17h18M6 17V9h8l3 4v4"/><circle cx="8" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg><span><b>You never walk</b> hold positions, the jeep moves you</span></li>
            <li><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 3v4h4"/></svg><span><b>Drifting?</b> point at the centre, CENTRE or hold VOL UP</span></li>
          </ul>
          <div class="ctl-grid">${ORDER_KEYS.map(k => chip(k, 'lg')).join('')}</div>
          <details class="more"><summary>More</summary>
            <div class="pair">${PAIR_TIP}</div>
            <div class="small">${esc(ALIGN_TIP)} Mouse and keyboard work too (keys shown small). To pause, keep holding VOL UP for about 2 seconds, or press Esc.</div>
          </details>
        </div>
      </div>`;
    $('title').onclick = () => go('select');
    $('title').querySelector('details').addEventListener('click', e => e.stopPropagation());
  }
  function renderSelect() {
    const list = call('Missions', 'list') || ((DH.Layout && DH.Layout.ORDER) || []).map(id => ({ id, title: DH.Layout.LAYOUT[id].title, blurb: DH.Layout.LAYOUT[id].blurb, best: null }));
    $('select').innerHTML = `
      <div class="sel-wrap">
        <div class="sel-head"><span class="pn-kicker">Ironfern Island &middot; contracts</span><h2>Choose a mission</h2></div>
        <div class="cards">${list.map((m, i) => `
          <button class="mcard" data-id="${esc(m.id)}">
            <span class="mc-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="mc-title">${esc(m.title)}</span>
            <span class="mc-blurb">${esc(m.blurb)}</span>
            <span class="mc-foot">${stars(m.best ? m.best.stars : 0)}<span class="mc-best">${m.best ? 'Best ' + num(m.best.score) : 'Not cleared'}</span></span>
            <span class="mc-go">Deploy &rsaquo;</span>
          </button>`).join('')}</div>
        <div class="sel-foot"><button class="link" id="sel-back">&larr; Title</button><button class="link" id="sel-settings">Settings</button></div>
      </div>`;
    $('select').querySelectorAll('.mcard').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); call('Core', 'startMission', b.dataset.id); }));
    onClick('sel-back', () => go('title'));
    onClick('sel-settings', () => go('settings'));
  }
  function renderBriefing(data) {
    const id = (data && data.id) || (ctx && ctx.missionId);
    const m = call('Missions', 'info', id) || { title: id, brief: '', objective: '', controls: ['fire', 'reload', 'scope'] };
    const ord = (DH.Layout && DH.Layout.ORDER) || [];
    $('briefing').innerHTML = `
      <div class="panel brief">
        <div class="pn-head"><span class="pn-kicker">Mission ${String(ord.indexOf(id) + 1).padStart(2, '0')} &middot; briefing</span><span class="pn-title big">${esc(m.title)}</span></div>
        <p class="br-text">${esc(m.brief)}</p>
        <div class="br-obj"><span>Objective</span><b>${esc(m.objective)}</b></div>
        <div class="br-align"><b>First, align:</b> point at the centre of the screen, press CENTRE (or hold VOL UP).</div>
        <div class="br-ctl-lbl">What you will need</div>
        <div class="ctl-row">${(m.controls || []).slice(0, 3).map(k => chip(k, 'xl')).join('')}</div>
        ${m.best ? `<div class="br-best">${stars(m.best.stars)} Best ${num(m.best.score)}</div>` : ''}
        <button class="cta" id="br-go">Vol Down / click to begin</button>
      </div>`;
    $('briefing').onclick = () => go('play');
  }
  // ---------------------------------------------------------------- settings (pause + settings screen)
  const DEG = 180 / Math.PI;
  const pct = v => Math.round(v * 100) + '%';
  /** The phone turn that covers a stand at this phone aim: the stand's arc either side over the gain. */
  const reachNote = (arc, k, here) => `1.00 = the crosshair turns exactly as far as the phone &middot; ${here ? 'this stand' : 'a typical stand'}: &plusmn;${Math.round(arc * DEG / k)}&deg; of phone turn`;
  function settingsHtml() {
    const S = (ctx && ctx.settings) || {};
    const ps = S.phoneSens || 1, ms = S.sens || 1, vol = S.volume == null ? 0.9 : S.volume;
    return `<div class="set-grid">
        <label class="set wide"><span>Phone aim</span><output id="st-pv">${ps.toFixed(2)}</output>
          <input type="range" id="st-psens" min="0.5" max="2.5" step="0.05" value="${ps}"></label>
        <div class="set-note wide" id="st-pnote"></div>
        <label class="set"><span>Mouse</span><output id="st-sv">${ms.toFixed(2)}</output>
          <input type="range" id="st-sens" min="0.3" max="3" step="0.05" value="${ms}"></label>
        <label class="set"><span>Volume</span><output id="st-vv">${pct(vol)}</output>
          <input type="range" id="st-vol" min="0" max="1" step="0.05" value="${vol}"></label>
        <div class="set"><span>Invert mouse Y</span><button class="tog" id="st-inv"></button></div>
        <div class="set"><span>Graphics</span><button class="tog" id="st-q"></button></div>
        <div class="set-note wide" id="st-qnote"></div>
      </div>`;
  }
  function wireSettings(root, here) {
    const S = ctx && ctx.settings; if (!S) return;
    // pause and settings both hold this block: look inside this screen only (ids repeat)
    const $ = id => root.querySelector('#' + id);
    const onClick = (id, f) => $(id).addEventListener('click', e => { e.stopPropagation(); f(e); });
    const save = () => { try { localStorage.setItem('ironfern.settings', JSON.stringify(S)); } catch (e) { /* storage blocked */ } };
    const arc = here && ctx.view && ctx.view.stand ? ctx.view.stand.arc : 1.2;
    const paint = () => {
      $('st-pnote').innerHTML = reachNote(arc, S.phoneSens || 1, here);
      $('st-inv').textContent = S.invertY ? 'On' : 'Off'; $('st-inv').classList.toggle('on', !!S.invertY);
      const full = (S.quality || 1) >= 1;
      $('st-q').textContent = full ? 'Full' : 'Light'; $('st-q').classList.toggle('on', full);
      let q = full ? 'Full: every tree in detail, 4x MSAA.' : 'Light: a lighter jungle and FXAA, for laptop GPUs.';
      if (here && S.quality !== H.qAtLoad) q += ' Applies from the next mission.';
      $('st-qnote').textContent = q;
    };
    const slider = (id, out, key, fmt) => {
      const r = $(id);
      r.addEventListener('click', e => e.stopPropagation());
      r.addEventListener('input', () => { const v = parseFloat(r.value); $(out).textContent = fmt(v); S[key] = v; save(); paint(); });
    };
    slider('st-psens', 'st-pv', 'phoneSens', v => v.toFixed(2));
    slider('st-sens', 'st-sv', 'sens', v => v.toFixed(2));
    slider('st-vol', 'st-vv', 'volume', pct);
    onClick('st-inv', () => { S.invertY = !S.invertY; save(); paint(); });
    // a choice made here sticks: the automatic Light fallback (core.js) leaves it alone
    onClick('st-q', () => { S.quality = (S.quality || 1) >= 1 ? 0.75 : 1; S.qualityLocked = true; save(); paint(); });
    paint();
  }
  function renderPause() {
    const M = DH.Missions && DH.Missions.state;
    $('settings').innerHTML = '';
    $('pause').innerHTML = `
      <div class="panel pause">
        <div class="pn-head"><span class="pn-kicker">${esc(M && M.title ? M.title : 'Ironfern')}</span><span class="pn-title big">Paused</span></div>
        <div class="btns eq">
          <button class="cta" id="pa-resume">Resume</button>
          <button class="btn" id="pa-restart">Restart stand</button>
          <button class="btn" id="pa-missions">Missions</button>
        </div>
        ${settingsHtml()}
        <div class="ctl-grid">${ORDER_KEYS.map(k => chip(k)).join('')}</div>
      </div>`;
    onClick('pa-resume', () => go('play'));
    onClick('pa-restart', () => { call('Missions', 'retryStand'); go('play'); });
    onClick('pa-missions', () => go('select'));
    wireSettings($('pause'), true);
  }
  function renderSettings() {
    $('pause').innerHTML = '';
    $('settings').innerHTML = `
      <div class="panel pause settings">
        <div class="pn-head"><span class="pn-kicker">Ironfern</span><span class="pn-title big">Settings</span></div>
        ${settingsHtml()}
        <div class="ctl-grid">${ORDER_KEYS.map(k => chip(k)).join('')}</div>
        <button class="cta" id="st-done">Done</button>
      </div>`;
    onClick('st-done', () => go('select'));
    wireSettings($('settings'), false);
  }
  function renderResults(r) {
    r = r || {};
    const rows = [
      ['Kills', r.killPoints], ['Accuracy bonus', r.accuracyBonus], ['Time bonus', r.timeBonus],
      ['Damage taken', r.damagePenalty], ['Retries', r.deathPenalty], ['Penalties', r.penalty],
    ].filter(([, v], i) => i < 3 || v);
    const lay = DH.Layout && DH.Layout.LAYOUT, nextTitle = r.next && lay && lay[r.next] ? lay[r.next].title : '';
    $('results').innerHTML = `
      <div class="panel results">
        <div class="pn-head"><span class="pn-kicker">Mission complete</span><span class="pn-title big">${esc(r.title || r.id || '')}</span></div>
        <div class="rs-stars">${stars(r.stars || 0)}</div>
        <div class="rs-total"><b>${num(r.total)}</b>${r.newBest ? '<span class="nb">New best</span>' : `<span class="bs">Best ${num(r.best ? r.best.score : r.total)}</span>`}</div>
        <div class="rs-stats">
          <div><span>Accuracy</span><b>${Math.round(100 * (r.accuracy || 0))}%</b></div>
          <div><span>Weak-spot kills</span><b>${r.weakKills || 0}</b></div>
          <div><span>Kills</span><b>${r.kills || 0}</b></div>
          <div><span>Time</span><b>${fmtT(r.time)}</b></div>
        </div>
        <table class="rs-break">${rows.map(([k, v]) => `<tr><td>${k}</td><td class="${v < 0 ? 'neg' : ''}">${signed(v)}</td></tr>`).join('')}
          <tr class="tot"><td>Total</td><td>${num(r.total)}</td></tr></table>
        ${r.thresholds ? `<div class="small">Stars at ${num(r.thresholds[0])} and ${num(r.thresholds[1])}</div>` : ''}
        <div class="btns eq">
          <button class="btn" id="rs-retry">Retry</button>
          ${r.next ? `<button class="cta" id="rs-next" title="${esc(nextTitle)}">Next mission</button>` : ''}
          <button class="btn" id="rs-missions">Missions</button>
        </div>
      </div>`;
    onClick('rs-retry', () => call('Core', 'startMission', r.id));
    onClick('rs-next', () => call('Core', 'startMission', r.next));
    onClick('rs-missions', () => go('select'));
  }

  function showScreen(state, data, prev) {
    SCREENS.forEach(s => { const n = $(s); if (n) n.classList.toggle('hidden', s !== state); });
    const hud = $('hud'); if (hud) hud.classList.toggle('hidden', state !== 'play');
    document.body.dataset.state = state;
    if (state === 'loading') { const t = $('loadtext'); if (t && data && data.text) t.textContent = data.text; }
    else if (state === 'title') renderTitle();
    else if (state === 'select') renderSelect();
    else if (state === 'briefing') renderBriefing(data);
    else if (state === 'pause') renderPause();
    else if (state === 'settings') renderSettings();
    else if (state === 'results') renderResults(data);
    else if (state === 'play') {
      if (prev === 'briefing') { H.qAtLoad = ctx && ctx.settings ? ctx.settings.quality : 1; H.keysT = 0; H.hurtA = 0; H.prompt = null; H.flash = null; el.feed.innerHTML = ''; H.needAlign = true; H.playT = now(); H.hurtDirs = []; }
    }
    family(state);
    H.lastScreen = state;
  }

  DH.Hud = {
    CONTROLS,
    init(c) { ctx = c; build(); if (DH.bus) hook(); },
    showScreen, update,
    /** For tests/screenshots: fake a hit marker. */
    hitmarker,
    /** What the HUD is signposting this frame: [{ obj, x, y, on }] (automated play, tests). */
    markers: () => marksOut,
  };
})();
