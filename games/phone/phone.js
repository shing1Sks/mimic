/*
 * Mimic browser controller, phone side. Opened from the QR a game shows (games/lib/mimic-link.js):
 *   /phone/?room=<room>[&mode=grip|wand|pad][&sig=<signaling url>]
 * Connects to the game over a WebRTC DataChannel and sends exactly what the Mimic app sends over
 * Bluetooth (see games/lib/mimic-proto.js), so the game cannot tell the two apart.
 */
(function () {
  'use strict';
  const P = window.MimicProto;
  const $ = id => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  const SIG = qs.get('sig') || (location.origin + '/signal');
  const MODES = ['grip', 'wand', 'pad'];
  const nowAbs = () => performance.timeOrigin + performance.now();
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const deviceName = isIOS ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Phone';
  const store = (() => { try { return sessionStorage; } catch (e) { return null; } })();
  const sget = k => { try { return store && store.getItem(k); } catch (e) { return null; } };
  const sset = (k, v) => { try { if (store) store.setItem(k, v); } catch (e) { /* private mode */ } };

  let room = qs.get('room');
  if (room && !P.SAFE_ID.test(room)) room = null;
  const hint = MODES.includes(qs.get('mode')) ? qs.get('mode') : '';
  const me = sget('mimic.phone.id') || P.randomId(10);
  sset('mimic.phone.id', me);

  // ------------------------------------------------------------------ state
  const S = {
    mode: '', playing: false,
    buttons: 0,                              // motion buttons, bit per MOTION_BUTTONS
    pad: { buttons: {}, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, dpad: {} },
    q: null, ref: null, centreNext: true, lin: { x: 0, y: 0, z: 0 },
    seq: 0, player: null, rtt: null, conn: 'idle',
    sensor: null, sensorT: 0, sent: 0,
  };

  // ------------------------------------------------------------------ connection
  const C = { pc: null, ctl: null, motion: null, sid: null, iceQ: [], signal: null, retry: 0, timer: null };

  function startSignal() {
    if (!room || C.signal) return;
    C.signal = new P.Signal(SIG, room, me, onSignal, { wait: 8000 });
    C.signal.start();
    connect();
  }

  function setConn(state, text) {
    S.conn = state;
    for (const el of [$('status'), $('cstatus')]) {
      el.className = (el.id === 'status' ? 'status ' : 'cstatus ') + ({ ok: 'ok', wait: 'wait', bad: 'bad' }[state] || '');
      el.querySelector('.txt').textContent = text;
    }
  }
  function statusText() {
    if (S.conn !== 'ok') return;
    const ms = S.rtt !== null ? ` · ${Math.max(1, Math.round(S.rtt / 2))} ms` : '';
    setConn('ok', (S.player ? 'Player ' + S.player : 'Connected') + ms);
  }

  async function connect() {
    clearTimeout(C.timer);
    if (C.pc) { try { C.pc.close(); } catch (e) { /* gone */ } }
    const sid = C.sid = P.randomId(6);
    C.iceQ = [];
    setConn('wait', C.retry ? 'Reconnecting to the game…' : 'Connecting to the game…');
    const pc = C.pc = new RTCPeerConnection({ iceServers: ICE });
    // motion: newest sample wins, a lost one is never resent; ctl: buttons, mode, rumble, pings
    C.motion = pc.createDataChannel('motion', { ordered: false, maxRetransmits: 0 });
    C.ctl = pc.createDataChannel('ctl', { ordered: true });
    C.motion.binaryType = C.ctl.binaryType = 'arraybuffer';
    C.ctl.onopen = () => {
      if (C.sid !== sid) return;
      C.retry = 0;
      setConn('ok', 'Connected');
      sendCtl({ t: 'hello', mode: S.mode || hint || 'wand', name: deviceName });
      sendState(true);
    };
    C.ctl.onclose = () => { if (C.sid === sid) lost(); };
    C.ctl.onmessage = e => { if (C.sid === sid && typeof e.data === 'string') onCtl(e.data); };
    pc.onicecandidate = e => { if (e.candidate && C.sid === sid) C.signal.send('host', 'ice', { sid, c: e.candidate.toJSON() }).catch(() => {}); };
    pc.onconnectionstatechange = () => { if (C.sid === sid && (pc.connectionState === 'failed')) lost(); };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await C.signal.send('host', 'offer', { sid, sdp: pc.localDescription.sdp, mode: S.mode || hint || 'wand', name: deviceName });
    } catch (e) {
      lost();
      return;
    }
    // no answer (game page closed, network blocks WebRTC): try again
    C.timer = setTimeout(() => { if (C.sid === sid && (!C.ctl || C.ctl.readyState !== 'open')) lost(); }, 12000);
  }
  function lost() {
    C.sid = null;
    clearTimeout(C.timer);
    C.retry++;
    S.player = null;
    setConn(C.retry > 2 ? 'bad' : 'wait', C.retry > 2 ? 'Can’t reach the game. Is its page open? Retrying…' : 'Reconnecting…');
    C.timer = setTimeout(connect, Math.min(5000, 600 * C.retry));
  }
  function onSignal(m) {
    const d = m.data || {};
    if (m.from !== 'host' || d.sid !== C.sid || !C.pc) return;
    if (m.type === 'answer' && !C.pc.remoteDescription) {
      C.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }).then(() => {
        for (const c of C.iceQ.splice(0)) C.pc.addIceCandidate(c).catch(() => {});
      }).catch(() => lost());
    } else if (m.type === 'ice' && d.c) {
      if (C.pc.remoteDescription) C.pc.addIceCandidate(d.c).catch(() => {});
      else C.iceQ.push(d.c);
    }
  }
  function sendCtl(obj) { if (C.ctl && C.ctl.readyState === 'open') C.ctl.send(typeof obj === 'string' || obj instanceof ArrayBuffer ? obj : JSON.stringify(obj)); }
  function onCtl(txt) {
    let m; try { m = JSON.parse(txt); } catch (e) { return; }
    if (m.t === 'ping') {
      sendCtl({ t: 'pong', pc: m.pc, ph: nowAbs() });
      if (typeof m.rtt === 'number') { S.rtt = m.rtt; statusText(); }
    } else if (m.t === 'welcome') { S.player = m.player; statusText(); }
    else if (m.t === 'rumble') rumble(m.s, m.ms, m.p);
  }
  addEventListener('pagehide', () => { if (C.signal && C.sid) navigator.sendBeacon && navigator.sendBeacon(`${SIG.replace(/\/+$/, '')}/${room}`, new Blob([JSON.stringify({ from: me, to: 'host', type: 'bye', data: { sid: C.sid } })], { type: 'text/plain' })); });

  /** Phone rumble: Android vibrates (strength becomes length); iOS Safari has no vibration API. */
  function rumble(strength, ms, pattern) {
    if (!navigator.vibrate || !S.playing) return;
    const len = Math.max(10, Math.round((ms || 60) * (0.4 + 0.6 * Math.max(0, Math.min(1, strength)))));
    navigator.vibrate(pattern === 3 ? [len / 2 | 0, 45, len / 2 | 0] : len);
  }

  // ------------------------------------------------------------------ sending
  function flags() { return document.visibilityState === 'visible' ? 1 : 0; }
  /** reliable = through the ordered channel (button changes must arrive); otherwise the motion one. */
  function sendState(reliable) {
    const t = nowAbs();
    let buf;
    if (S.mode === 'pad') buf = P.encodePad(++S.seq, t, S.pad, flags());
    else {
      if (!S.q) return;
      const r = P.relative(S.ref || { x: 0, y: 0, z: 0, w: 1 }, S.q);
      const g = P.gravityInPhone(S.q);
      const acc = { x: g.x + S.lin.x, y: g.y + S.lin.y, z: g.z + S.lin.z };
      buf = P.encodeMotion(++S.seq, t, S.buttons, P.motionAxes(r, acc, S.mode), flags());
    }
    const ch = reliable ? C.ctl : C.motion;
    // never queue motion behind a slow link: a stale sample is worse than a skipped one
    if (ch && ch.readyState === 'open' && (reliable || ch.bufferedAmount < 2048)) { ch.send(buf); S.sent++; }
  }

  // ------------------------------------------------------------------ sensors
  function onQuat(q, src) {
    if (!S.playing || S.mode === 'pad') return;
    if (src === 'event' && S.sensor && performance.now() - S.sensorT < 300) return;  // the Sensor API is feeding
    if (src === 'sensor') S.sensorT = performance.now();
    S.q = q;
    if (S.centreNext) { S.ref = P.yawReference(q); S.centreNext = false; }
    sendState(false);
  }
  addEventListener('deviceorientation', e => {
    if (e.alpha === null && e.beta === null) return;
    onQuat(P.fromDeviceOrientation(e.alpha, e.beta, e.gamma), 'event');
  });
  addEventListener('devicemotion', e => {
    const a = e.acceleration;
    if (!a || a.x === null) return;
    const k = isIOS ? -1 : 1;   // iOS Safari reports acceleration with the opposite sign
    S.lin = { x: (a.x || 0) * k, y: (a.y || 0) * k, z: (a.z || 0) * k };
  });
  function startSensorApi() {
    if (S.sensor || typeof RelativeOrientationSensor === 'undefined') return;
    try {
      const s = new RelativeOrientationSensor({ frequency: 120, referenceFrame: 'device' });
      s.addEventListener('reading', () => { const v = s.quaternion; if (v) onQuat({ x: v[0], y: v[1], z: v[2], w: v[3] }, 'sensor'); });
      s.addEventListener('error', () => { try { s.stop(); } catch (e) { /* */ } S.sensor = null; });
      s.start();
      S.sensor = s;
    } catch (e) { S.sensor = null; }
  }
  async function askMotion() {
    // iOS 13+: must be asked from inside a tap, before any other await
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') return false;
      }
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        await DeviceOrientationEvent.requestPermission();
      }
    } catch (e) { return false; }
    startSensorApi();
    return true;
  }

  // ------------------------------------------------------------------ screen helpers
  let wake = null;
  async function keepAwake() {
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.playing) keepAwake();
    if (document.visibilityState !== 'visible') { releaseAll(); }
  });
  async function goFullscreen(orient) {
    const el = document.documentElement;
    try { if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { /* iPhone: no fullscreen API */ }
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock(orient); } catch (e) { /* not supported / not fullscreen */ }
  }

  // ------------------------------------------------------------------ controls
  const BIT = {}; P.MOTION_BUTTONS.forEach((n, i) => { BIT[n] = i; });
  const surface = $('surface');
  const controls = [];        // { el, key, area? }
  const sticks = [];          // { el, base, knob, cx, cy, r, zr, key: 'l'|'r', pid }
  const MIN_PRESS_MS = 50;    // a tap shorter than a game frame still reaches the game

  function addCtl(key, label, sub, cls, box) {
    const el = document.createElement('div');
    el.className = 'c ' + (cls || '');
    el.dataset.k = key;
    el.innerHTML = label + (sub ? `<small>${sub}</small>` : '');
    Object.assign(el.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
    surface.appendChild(el);
    controls.push({ el, key, downAt: 0, relT: null });
    return el;
  }

  const held = new Map();     // pointerId -> control key (or 'stick:l' / 'stick:r')
  function keyDown(key) {
    return Array.from(held.values()).includes(key);
  }
  function setKey(key, down) {
    const c = controls.find(x => x.key === key);
    if (c) {
      if (down) { clearTimeout(c.relT); c.relT = null; c.downAt = performance.now(); c.el.classList.add('down'); }
      else {
        const left = MIN_PRESS_MS - (performance.now() - c.downAt);
        if (left > 0 && !c.relT) { c.relT = setTimeout(() => { c.relT = null; if (!keyDown(key)) setKey(key, false); }, left); return; }
        c.el.classList.remove('down');
      }
    }
    if (down && navigator.vibrate) navigator.vibrate(key === 'center' ? 14 : 6);
    if (S.mode === 'pad') {
      if (['up', 'down', 'left', 'right'].includes(key)) S.pad.dpad[key] = down;
      else S.pad.buttons[key] = down;
      if (key === 'l2') S.pad.lt = down ? 1 : 0;
      if (key === 'r2') S.pad.rt = down ? 1 : 0;
    } else {
      const b = BIT[key];
      if (b === undefined) return;
      S.buttons = down ? S.buttons | (1 << b) : S.buttons & ~(1 << b);
      if (key === 'center' && down) S.centreNext = true;   // like the app: Centre also re-aims
    }
    sendState(true);
  }
  function hit(x, y) {
    const el = document.elementFromPoint(x, y);
    const c = el && el.closest && el.closest('.c');
    return c && surface.contains(c) ? c.dataset.k : null;
  }
  function stickAt(x, y) {
    const r = surface.getBoundingClientRect();
    for (const s of sticks) { const dx = x - r.left - s.cx, dy = y - r.top - s.cy; if (dx * dx + dy * dy <= s.zr * s.zr) return s; }
    return null;
  }
  function moveStick(s, x, y) {
    const r = surface.getBoundingClientRect();
    let dx = (x - r.left - s.cx) / s.r, dy = (y - r.top - s.cy) / s.r;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    s.knob.style.transform = `translate(${dx * s.r}px, ${dy * s.r}px)`;
    S.pad[s.key + 'x'] = dx; S.pad[s.key + 'y'] = dy;
  }
  function releaseStick(s) {
    s.pid = null; s.el.classList.remove('on'); s.knob.style.transform = '';
    S.pad[s.key + 'x'] = 0; S.pad[s.key + 'y'] = 0;
    sendState(true);
  }

  surface.addEventListener('pointerdown', e => {
    e.preventDefault();
    const s = S.mode === 'pad' ? stickAt(e.clientX, e.clientY) : null;
    if (s && s.pid === null) { s.pid = e.pointerId; s.el.classList.add('on'); held.set(e.pointerId, 'stick:' + s.key); moveStick(s, e.clientX, e.clientY); sendState(true); return; }
    const k = hit(e.clientX, e.clientY);
    if (!k) return;
    const had = keyDown(k);
    held.set(e.pointerId, k);
    if (!had) setKey(k, true);
  }, { passive: false });
  surface.addEventListener('pointermove', e => {
    const cur = held.get(e.pointerId);
    if (cur === undefined) return;
    if (cur.startsWith('stick:')) { const s = sticks.find(x => x.pid === e.pointerId); if (s) moveStick(s, e.clientX, e.clientY); return; }
    // sliding between keys (D-pad, face buttons) moves the press; the big hold area keeps it
    const k = hit(e.clientX, e.clientY);
    if (k === cur || (cur === 'a' && S.mode === 'grip') || !k) return;
    held.set(e.pointerId, k);
    if (!keyDown(cur)) setKey(cur, false);
    if (Array.from(held.values()).filter(v => v === k).length === 1) setKey(k, true);
  });
  const up = e => {
    const cur = held.get(e.pointerId);
    if (cur === undefined) return;
    held.delete(e.pointerId);
    if (cur.startsWith('stick:')) { const s = sticks.find(x => x.pid === e.pointerId); if (s) releaseStick(s); return; }
    if (!keyDown(cur)) setKey(cur, false);
  };
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointercancel', up);
  surface.addEventListener('contextmenu', e => e.preventDefault());

  function releaseAll() {
    for (const [pid, k] of Array.from(held.entries())) { held.delete(pid); if (!k.startsWith('stick:')) setKey(k, false); }
    sticks.forEach(s => { if (s.pid !== null) releaseStick(s); });
    S.buttons = 0; S.pad.buttons = {}; S.pad.dpad = {}; S.pad.lt = S.pad.rt = 0;
    sendState(true);
  }

  // ------------------------------------------------------------------ layouts
  function clear() { surface.innerHTML = ''; controls.length = 0; sticks.length = 0; held.clear(); }

  /** Grip: one hand, the phone in a fist. Centre on top, a huge hold area, B and Switch below. */
  function layoutGrip(W, H) {
    const g = 12, cH = 60, bH = Math.min(96, Math.max(70, H * 0.14));
    addCtl('center', 'CENTRE', 'games say: hold Vol Up', 'centre', { x: 0, y: 0, w: W, h: cH });
    addCtl('a', 'HOLD', 'fire · grip · swing<br>games call this Vol Down', 'hold', { x: 0, y: cH + g, w: W, h: H - cH - bH - 2 * g });
    const half = (W - g) / 2;
    addCtl('b', 'B', 'Vol Up tap', 'mid', { x: 0, y: H - bH, w: half, h: bH });
    addCtl('one', 'SWITCH', 'Vol Up double tap', 'sm', { x: half + g, y: H - bH, w: half, h: bH });
  }

  /** Wand: like the app (D-pad above, A/B under the thumb, small keys below), Centre on top. */
  function layoutWand(W, H) {
    const cH = 52;
    addCtl('center', 'CENTRE', '', 'centre', { x: 0, y: 0, w: W, h: cH });
    const avail = H - cH - 12;
    const k = Math.min(1, avail / 560, W / 330);
    const dk = 58 * k, cross = dk * 2.9, aS = 124 * k, bS = 96 * k, smH = 42 * k, oneS = 58 * k, gap = 20 * k;
    const total = cross + gap + aS + gap + smH + gap * 0.8 + oneS;
    let y = cH + 12 + Math.max(0, (avail - total) / 2);
    const mx = W / 2, cx = mx - cross / 2;
    addCtl('up', '▲', '', 'sm', { x: mx - dk / 2, y, w: dk, h: dk });
    addCtl('left', '◀', '', 'sm', { x: cx, y: y + (cross - dk) / 2, w: dk, h: dk });
    addCtl('right', '▶', '', 'sm', { x: cx + cross - dk, y: y + (cross - dk) / 2, w: dk, h: dk });
    addCtl('down', '▼', '', 'sm', { x: mx - dk / 2, y: y + cross - dk, w: dk, h: dk });
    y += cross + gap;
    const rowW = aS + 18 * k + bS, rx = mx - rowW / 2;
    addCtl('a', 'A', '', 'round big', { x: rx, y, w: aS, h: aS });
    addCtl('b', 'B', '', 'round mid', { x: rx + aS + 18 * k, y: y + aS - bS, w: bS, h: bS });
    y += aS + gap;
    const sw = 72 * k, hw = 84 * k, sg = 14 * k, sx = mx - (sw * 2 + hw + sg * 2) / 2;
    addCtl('minus', '−', '', 'sm', { x: sx, y, w: sw, h: smH });
    addCtl('home', 'HOME', '', 'sm', { x: sx + sw + sg, y, w: hw, h: smH });
    addCtl('plus', '+', '', 'sm', { x: sx + sw + sg + hw + sg, y, w: sw, h: smH });
    y += smH + gap * 0.8;
    addCtl('one', '1', '', 'round sm', { x: mx - oneS - 11 * k, y, w: oneS, h: oneS });
    addCtl('two', '2', '', 'round sm', { x: mx + 11 * k, y, w: oneS, h: oneS });
  }

  /** Pad: port of app/.../input/PadLayout.kt (landscape, centred, nothing overlaps). */
  function padLayout(w, h, scale) {
    const TOP = 28, SIDE = 16 + Math.max(0, 0), BOTTOM = 12, GAP = 10, SHOULDER_H = 44, MIN_SCALE = 0.6;
    const A = (x, y, ww, hh) => ({ x, y, w: ww, h: hh, r: x + ww, b: y + hh });
    const mir = a => A(w - a.x - a.w, a.y, a.w, a.h);
    const overlaps = (p, o) => p.x < o.r - 0.01 && o.x < p.r - 0.01 && p.y < o.b - 0.01 && o.y < p.b - 0.01;
    function build(k) {
      const mid = w / 2;
      const exit = A(mid - 20, 10, 40, 40);
      const l1 = A(SIDE, TOP, 120, SHOULDER_H), l2 = A(l1.r + GAP, TOP, 96, SHOULDER_H);
      const r1 = mir(l1), r2 = mir(l2);
      const rowY = exit.b + 12;
      const home = A(mid - 28, rowY, 56, 38), select = A(home.x - 12 - 80, rowY, 80, 38), start = mir(select);
      const topBand = Math.max(l1.b, home.b) + GAP;
      const lr = 62 * k, lz = lr + 34, lowTop = l1.b + GAP, cyMain = (lowTop + (h - BOTTOM)) / 2;
      const leftZone = A(SIDE, cyMain - lz, lz * 2, lz * 2);
      const fb = 56 * k, d = fb * 1.08, half = d + fb / 2, fcx = w - SIDE - half;
      const face = (dx, dy) => A(fcx + dx - fb / 2, cyMain + dy - fb / 2, fb, fb);
      const y = face(0, -d), x = face(-d, 0), b = face(d, 0), a = face(0, d);
      const dk = 44 * k, rr = 50 * k, rz = rr + 26, c = Math.max(dk * 1.5, rz) + 18;
      const dcx = mid - c, dcy = h - BOTTOM - dk * 1.5;
      const key = (col, row) => A(dcx + (col - 1.5) * dk, dcy + (row - 1.5) * dk, dk, dk);
      let rightZone = A(mid + c - rz, h - BOTTOM - rz * 2, rz * 2, rz * 2);
      if (rightZone.y < topBand) rightZone = A(rightZone.x, topBand, rightZone.w, rightZone.h);
      return { exit, l1, l2, r1, r2, select, home, start, leftZone, leftRadius: lr, rightZone, rightRadius: rr,
        up: key(1, 0), left: key(0, 1), right: key(2, 1), down: key(1, 2), a, b, x, y };
    }
    const all = p => [p.exit, p.l1, p.l2, p.r2, p.r1, p.select, p.home, p.start, p.leftZone, p.rightZone, p.up, p.left, p.right, p.down, p.a, p.b, p.x, p.y];
    const fits = p => { const l = all(p); if (l.some(a => a.x < 0 || a.y < 0 || a.r > w || a.b > h)) return false; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (overlaps(l[i], l[j])) return false; return true; };
    let k = scale || 1, p = build(k);
    while (k > MIN_SCALE && !fits(p)) { k -= 0.05; p = build(k); }
    p.scale = k;
    return p;
  }
  function layoutPad(W, H) {
    const L = padLayout(W, H, Math.min(1.25, Math.max(0.8, Math.min(W / 760, H / 360))));
    const box = a => ({ x: a.x, y: a.y, w: a.w, h: a.h });
    addCtl('l1', 'L1', '', 'sm', box(L.l1)); addCtl('l2', 'L2', '', 'sm', box(L.l2));
    addCtl('r2', 'R2', '', 'sm', box(L.r2)); addCtl('r1', 'R1', '', 'sm', box(L.r1));
    addCtl('select', 'SELECT', '', 'sm', box(L.select)); addCtl('home', 'HOME', '', 'sm', box(L.home)); addCtl('start', 'START', '', 'sm', box(L.start));
    for (const [k, t] of [['up', '▲'], ['left', '◀'], ['right', '▶'], ['down', '▼']]) addCtl(k, t, '', 'sm', box(L[k]));
    addCtl('y', 'Y', '', 'round mid', box(L.y)); addCtl('x', 'X', '', 'round mid', box(L.x));
    addCtl('b', 'B', '', 'round mid', box(L.b)); addCtl('a', 'A', '', 'round mid', box(L.a));
    for (const [key, zone, r] of [['l', L.leftZone, L.leftRadius], ['r', L.rightZone, L.rightRadius]]) {
      const el = document.createElement('div');
      el.className = 'zone';
      Object.assign(el.style, { left: zone.x + 'px', top: zone.y + 'px', width: zone.w + 'px', height: zone.h + 'px' });
      const base = document.createElement('div'), knob = document.createElement('div');
      base.className = 'base'; knob.className = 'knob';
      const kr = r * 0.55, c = zone.w / 2;
      Object.assign(base.style, { left: c - r + 'px', top: c - r + 'px', width: 2 * r + 'px', height: 2 * r + 'px' });
      Object.assign(knob.style, { left: c - kr + 'px', top: c - kr + 'px', width: 2 * kr + 'px', height: 2 * kr + 'px' });
      el.append(base, knob);
      surface.appendChild(el);
      sticks.push({ el, base, knob, key, cx: zone.x + c, cy: zone.y + c, r, zr: zone.w / 2, pid: null });
    }
  }

  function layout() {
    if (!S.playing) return;
    clear();
    const r = surface.getBoundingClientRect();
    const W = r.width, H = r.height;
    const portrait = innerHeight > innerWidth;
    $('rotate').classList.toggle('hidden', !(S.mode === 'pad' && portrait));
    if (S.mode === 'grip') layoutGrip(W, H);
    else if (S.mode === 'wand') layoutWand(W, H);
    else if (!portrait) layoutPad(W, H);
  }
  addEventListener('resize', () => setTimeout(layout, 60));

  // pad: keep the sticks streaming while held; everything else is sent when it changes
  let lastKeep = 0;
  function padLoop(t) {
    if (S.playing && S.mode === 'pad') {
      const moving = sticks.some(s => s.pid !== null);
      if (moving || t - lastKeep > 250) { sendState(false); lastKeep = t; }
    }
    requestAnimationFrame(padLoop);
  }
  requestAnimationFrame(padLoop);

  // ------------------------------------------------------------------ screens
  const secure = window.isSecureContext;
  async function start(mode) {
    if ((mode === 'grip' || mode === 'wand') && !secure) {
      $('secure').classList.remove('hidden');
      $('secure').animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 220 });
      return;
    }
    let motionOk = true;
    if (mode !== 'pad') motionOk = await askMotion();
    if (!motionOk) { setConn('bad', 'Motion access was refused. Allow it in Settings > Safari, or use Pad.'); return; }
    S.mode = mode; S.playing = true; S.centreNext = true; S.q = null;
    document.body.dataset.mode = mode;
    $('home').classList.add('hidden'); $('ctl').classList.remove('hidden');
    keepAwake();
    goFullscreen(mode === 'pad' ? 'landscape' : 'portrait').then(() => setTimeout(layout, 120));
    layout();
    sendCtl({ t: 'mode', mode, name: deviceName });
    sendState(true);
    statusText();
  }
  function home() {
    releaseAll();
    S.playing = false;
    document.body.dataset.mode = '';
    $('ctl').classList.add('hidden'); $('home').classList.remove('hidden');
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* */ }
  }
  $('menu').addEventListener('click', home);
  document.querySelectorAll('.mode').forEach(b => {
    const m = b.dataset.mode;
    if (m === hint) b.classList.add('suggested');
    if (!secure && m !== 'pad') b.classList.add('off');
    b.addEventListener('click', () => start(m));
  });
  if (!secure) {
    $('secure').classList.remove('hidden');
    $('usbUrl').textContent = `http://localhost:${location.port || 8765}/phone/${location.search}`;
  }
  if (hint) { const el = document.querySelector(`.mode[data-mode="${hint}"]`); if (el) el.parentNode.prepend(el); }

  if (room) startSignal();
  else {
    setConn('bad', 'No game yet');
    $('join').classList.remove('hidden');
  }
  $('join').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('roomIn').value.trim();
    if (!P.SAFE_ID.test(v)) return;
    const u = new URL(location.href); u.searchParams.set('room', v); location.replace(u.toString());
  });

  // test / debugging hook (also handy from the remote devtools console)
  window.__mimicPhone = { S, C, start, home, press: (k, d) => setKey(k, d), centre: () => { setKey('center', true); setTimeout(() => setKey('center', false), 80); } };
})();
