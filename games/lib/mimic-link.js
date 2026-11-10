/*
 * Mimic browser controller, PC side. Any phone (iPhone included, no app) becomes a Mimic
 * controller: the game shows a QR, the phone opens games/phone/ and talks to this page over a
 * WebRTC DataChannel. Each browser phone shows up in navigator.getGamepads() as a VIRTUAL gamepad
 * shaped exactly like the Mimic app's (Wand / Grip motion pad, or the Pad), so every game and
 * games/lib/mimic.js (MimicController, MimicController.all(), slots, mc.mode) work unchanged.
 *
 * Opt in with one tag (after mimic.js if the page has it):
 *   <script src="../lib/mimic-link.js"></script>
 * Optional attributes on that tag:
 *   data-signal="https://host/signal"  signaling mailbox (default: this server's /signal)
 *   data-phone="https://host/phone/"   phone page (default: this server's /phone/, LAN address when known)
 *   data-button="off" | "bl" | "br" | "tl" | "tr"   the corner "Phone browser" button: none, or its corner.
 *                                      Unset: bottom left, only on pages without a data-mimic-join entry.
 *   data-mode="pad"                    which controller the corner button's QR opens on the phone
 *
 * Page hooks (no JS needed): any element with data-mimic-join gets a "Scan to join" QR
 *   <div data-mimic-join="grip"></div>            mode: wand | grip | pad | '' (phone picks)
 *   <div data-mimic-join="pad" data-size="96"></div>
 *   <div data-mimic-join data-compact></div>      a small "Scan to play" chip that opens the panel
 *
 * API (window.MimicLink):
 *   showQR(container?, mode?)  the QR panel inside container, or as a floating panel
 *   hideQR()                   close the floating panel
 *   phones()                   [{ id, name, mode, index, connected, rttMs, latencyMs, hz }]
 *   rumble(gamepadIndex, strength 0..1, ms, pattern 0..3)  vibrate that browser phone (Android
 *                              only: iOS Safari has no vibration)
 *   on('join' | 'leave' | 'change', fn)
 *   url(mode?)                 the phone URL the QR encodes
 * MimicController#rumble() reaches browser phones too (wrapped here; mimic.js is not changed),
 * and a virtual Pad's gamepad.vibrationActuator.playEffect() works as on a real pad.
 *
 * Protocol and signaling contract: docs/browser-controller.md.
 */
(function (global) {
  'use strict';
  if (global.MimicLink) return;
  const doc = global.document;
  const script = doc && doc.currentScript;
  const libBase = script && script.src ? script.src.replace(/[^/]*$/, '') : '../lib/';
  const attr = n => (script && script.getAttribute(n)) || null;
  const httpPage = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  const cfg = {
    signal: attr('data-signal') || (httpPage ? location.origin + '/signal' : 'http://127.0.0.1:8765/signal'),
    phone: attr('data-phone') || null,
    // corner button: 'off', a corner ('bl' 'br' 'tl' 'tr'), or unset = bottom left, but only on a
    // page without its own data-mimic-join entry (a game that places its QRs keeps its HUD clear)
    button: attr('data-button'),
    mode: attr('data-mode') || '',
    ice: [{ urls: 'stun:stun.l.google.com:19302' }],
  };
  const sameOriginSignal = httpPage && cfg.signal === location.origin + '/signal';

  // ------------------------------------------------------------------ dependencies
  function load(src, test) {
    if (test()) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = doc.createElement('script');
      s.src = libBase + src; s.onload = () => res(); s.onerror = () => rej(new Error('could not load ' + src));
      doc.head.appendChild(s);
    });
  }
  const ready = Promise.all([load('mimic-proto.js', () => !!global.MimicProto), load('qr.js', () => !!global.MimicQR)]);
  const P = () => global.MimicProto;

  // ------------------------------------------------------------------ state
  const store = (() => { try { return global.sessionStorage; } catch (e) { return null; } })();
  const sget = k => { try { return store && store.getItem(k); } catch (e) { return null; } };
  const sset = (k, v) => { try { if (store) store.setItem(k, v); } catch (e) { /* private mode */ } };
  let room = sget('mimic.link.room');
  const peers = new Map();          // phone id -> peer
  const listeners = { join: [], leave: [], change: [] };
  const emit = (ev, x) => (listeners[ev] || []).forEach(f => { try { f(x); } catch (e) { console.warn(e); } });
  let signal = null, info = null, infoP = null, joinN = 0;

  function ensureRoom() {
    if (!room) { room = P().randomId(8); sset('mimic.link.room', room); }
    return room;
  }

  // ------------------------------------------------------------------ virtual gamepads
  const nav = global.navigator || {};
  const nativeGet = nav.getGamepads ? nav.getGamepads.bind(nav) : () => [];
  const virtuals = new Map();       // phone id -> { key, index, pad }
  function snapshot(p) {
    const pr = P();
    if (p.mode === 'pad') return pr.padGamepad(0, p.pad, p.ts, p.label);
    return pr.motionGamepad(0, p.axes, p.buttons, p.ts, p.label);
  }
  function virtualList() {
    const out = [];
    for (const p of peers.values()) {
      if (!p.joined) continue;
      let v = virtuals.get(p.id);
      if (!v) { v = { key: p.id, index: p.index }; virtuals.set(p.id, v); }
      const pad = snapshot(p);
      pad.vibrationActuator = actuator(p);
      v.pad = pad;
      out.push(v);
    }
    return out;
  }
  function getGamepads() {
    const real = nativeGet();
    if (!peers.size || !global.MimicProto) return real;
    const list = virtualList();
    if (!list.length) return real;
    const out = P().mergeGamepads(real, list);
    for (const v of list) { const p = peers.get(v.key); if (p) p.index = v.index; }
    return out;
  }
  try { nav.getGamepads = getGamepads; } catch (e) { console.warn('[mimic-link] cannot wrap getGamepads', e); }

  function actuator(p) {
    return {
      type: 'dual-rumble', effects: ['dual-rumble'],
      playEffect(type, o) {
        o = o || {};
        sendRumble(p, Math.max(o.strongMagnitude || 0, o.weakMagnitude || 0), o.duration || 100, 1);
        return Promise.resolve('complete');
      },
      reset() { return Promise.resolve('complete'); },
    };
  }

  function padEvent(type, p) {
    if (!global.dispatchEvent) return;
    try {
      const pads = getGamepads();
      const pad = (p.index !== undefined && pads[p.index]) || snapshot(p);
      const ev = new Event(type);
      Object.defineProperty(ev, 'gamepad', { value: type === 'gamepaddisconnected' ? Object.assign({}, pad, { connected: false }) : pad });
      global.dispatchEvent(ev);
    } catch (e) { /* old browser */ }
  }

  // ------------------------------------------------------------------ rumble
  function sendRumble(p, strength, ms, pattern) {
    if (!p || !p.ctl || p.ctl.readyState !== 'open') return false;
    p.ctl.send(JSON.stringify({ t: 'rumble', s: Math.max(0, Math.min(1, +strength || 0)), ms: Math.max(0, Math.min(1000, Math.round(+ms || 0))), p: pattern & 3 }));
    return true;
  }
  function peerAtIndex(i) { for (const p of peers.values()) if (p.joined && p.index === i) return p; return null; }
  function rumble(index, strength, ms, pattern) { return sendRumble(peerAtIndex(index), strength, ms, pattern || 0); }

  /** MimicController#rumble / #rumbleReady also reach browser phones. Wrapped, mimic.js untouched. */
  function patchMimic() {
    const MC = global.MimicController;
    if (!MC || MC.__mimicWeb) return;
    MC.__mimicWeb = true;
    const orig = MC.prototype.rumble;
    MC.prototype.rumble = function (strength, ms, pattern) {
      const pad = typeof this._findPad === 'function' ? this._findPad() : null;
      if (pad && pad.__mimicWeb) return Promise.resolve(rumble(pad.index, strength, ms, pattern || 0));
      return orig.apply(this, arguments);
    };
    const d = Object.getOwnPropertyDescriptor(MC.prototype, 'rumbleReady');
    if (d && d.get) {
      Object.defineProperty(MC.prototype, 'rumbleReady', {
        configurable: true,
        get() {
          const pad = typeof this._findPad === 'function' ? this._findPad() : null;
          return (pad && pad.__mimicWeb) ? true : d.get.call(this);
        },
      });
    }
  }
  patchMimic();

  // ------------------------------------------------------------------ host: signaling + WebRTC
  function startHost() {
    if (signal) return;
    ensureRoom();
    sset('mimic.link.active', '1');
    signal = new (P().Signal)(cfg.signal, room, 'host', onSignal, { wait: 8000 });
    signal.start();
  }

  function onSignal(m) {
    const d = m.data || {};
    if (!P().SAFE_ID.test(m.from || '')) return;
    if (m.type === 'offer') accept(m.from, d);
    else if (m.type === 'ice') {
      const p = peers.get(m.from);
      if (p && p.sid === d.sid && d.c) {
        if (p.pc.remoteDescription) p.pc.addIceCandidate(d.c).catch(() => {});
        else p.iceQ.push(d.c);
      }
    } else if (m.type === 'bye') {
      const p = peers.get(m.from);
      if (p && (!d.sid || p.sid === d.sid)) drop(p, true);
    }
  }

  async function accept(id, d) {
    if (typeof RTCPeerConnection === 'undefined' || typeof d.sdp !== 'string') return;
    const old = peers.get(id);
    if (old && old.sid === d.sid) return;      // the same offer seen twice
    if (old) closePc(old);
    const p = old || { id, n: ++joinN, index: undefined, joined: false };
    Object.assign(p, {
      sid: d.sid, mode: d.mode === 'pad' || d.mode === 'grip' ? d.mode : 'wand', name: String(d.name || 'Phone').slice(0, 24),
      pc: new RTCPeerConnection({ iceServers: cfg.ice }), iceQ: [], ctl: null, motion: null, open: false,
      axes: [0, 0, 0, 0, 0, 0], buttons: 0, pad: {}, ts: 0, lastSeq: 0,
      rttMs: null, offset: null, bestRtt: Infinity, latencyMs: null, hz: 0, _cnt: 0, _cntT: now(), t0: now(),
    });
    p.label = '';
    peers.set(id, p);
    const pc = p.pc, sid = p.sid;
    pc.onicecandidate = e => { if (e.candidate && p.sid === sid) signal.send(id, 'ice', { sid, c: e.candidate.toJSON() }).catch(() => {}); };
    pc.ondatachannel = e => bindChannel(p, e.channel, sid);
    pc.onconnectionstatechange = () => { if (p.sid === sid && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) drop(p); };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      for (const c of p.iceQ.splice(0)) pc.addIceCandidate(c).catch(() => {});
      await pc.setLocalDescription(await pc.createAnswer());
      await signal.send(id, 'answer', { sid, sdp: pc.localDescription.sdp });
    } catch (e) {
      console.warn('[mimic-link] offer from', id, 'failed', e);
      if (p.sid === sid) drop(p);
      return;
    }
    // a phone that never opens its channels (blocked network, no TURN) is forgotten
    setTimeout(() => { if (p.sid === sid && !p.open) drop(p); }, 20000);
  }

  function bindChannel(p, ch, sid) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'motion') {
      p.motion = ch;
      ch.onmessage = e => { if (p.sid === sid && typeof e.data !== 'string') applyState(p, e.data); };
      return;
    }
    if (ch.label !== 'ctl') return;
    p.ctl = ch;
    ch.onopen = () => { p.open = true; ping(p); };
    if (ch.readyState === 'open') { p.open = true; ping(p); }
    ch.onclose = () => { if (p.sid === sid) drop(p); };
    ch.onmessage = e => {
      if (p.sid !== sid) return;
      if (typeof e.data !== 'string') { applyState(p, e.data); return; }
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'hello' || m.t === 'mode') {
        const mode = m.mode === 'pad' || m.mode === 'grip' ? m.mode : 'wand';
        const changed = p.joined && mode !== p.mode;
        if (changed) padEvent('gamepaddisconnected', p);
        p.mode = mode;
        if (m.name) p.name = String(m.name).slice(0, 24);
        if (!p.joined) { p.joined = true; getGamepads(); padEvent('gamepadconnected', p); emit('join', publicPeer(p)); }
        else if (changed) { getGamepads(); padEvent('gamepadconnected', p); }
        ch.send(JSON.stringify({ t: 'welcome', player: p.n, index: p.index }));
        emit('change', phones());
        renderAll();
      } else if (m.t === 'pong' && typeof m.pc === 'number') {
        const rtt = now() - m.pc;
        p.rttMs = p.rttMs === null ? rtt : p.rttMs * 0.7 + rtt * 0.3;
        if (typeof m.ph === 'number' && rtt <= p.bestRtt * 1.5 + 2) {
          // phone clock minus PC clock (both performance.timeOrigin + now(), in ms)
          const off = m.ph - (m.pc + rtt / 2 + timeOrigin());
          p.offset = p.offset === null || rtt < p.bestRtt ? off : p.offset * 0.8 + off * 0.2;
          p.bestRtt = Math.min(p.bestRtt, rtt);
        }
      }
    };
  }

  const now = () => (global.performance ? performance.now() : Date.now());
  const timeOrigin = () => (global.performance && performance.timeOrigin) || 0;

  function ping(p) {
    if (!p.ctl || p.ctl.readyState !== 'open') return;
    p.ctl.send(JSON.stringify({ t: 'ping', pc: now(), rtt: p.rttMs === null ? undefined : Math.round(p.rttMs) }));
    clearTimeout(p.pingT);
    p.pingT = setTimeout(() => ping(p), p.bestRtt === Infinity || (now() - p.t0) < 5000 ? 250 : 1000);
  }

  function applyState(p, buf) {
    const d = P().decode(buf);
    if (!d || d.seq <= p.lastSeq) return;
    // a packet from before a mode switch (the switch itself comes on the reliable channel)
    if ((d.kind === P().KIND.PAD) !== (p.mode === 'pad')) return;
    p.lastSeq = d.seq;
    p.ts = now();
    if (d.kind === P().KIND.MOTION) { p.axes = d.axes; p.buttons = d.buttons; }
    else p.pad = d.pad;
    if (p.offset !== null) {
      const lat = timeOrigin() + p.ts - (d.t - p.offset);
      p.latencyMs = p.latencyMs === null ? lat : p.latencyMs * 0.9 + lat * 0.1;
    }
    p._cnt++;
    const t = now();
    if (t - p._cntT >= 1000) { p.hz = Math.round(p._cnt * 1000 / (t - p._cntT)); p._cnt = 0; p._cntT = t; }
  }

  function closePc(p) {
    clearTimeout(p.pingT);
    try { if (p.ctl) p.ctl.onclose = null; p.pc.close(); } catch (e) { /* already gone */ }
  }
  function drop(p, quiet) {
    if (peers.get(p.id) !== p) return;
    closePc(p);
    const was = p.joined;
    if (was) padEvent('gamepaddisconnected', p);
    peers.delete(p.id);
    virtuals.delete(p.id);
    if (was) { emit('leave', publicPeer(p)); emit('change', phones()); }
    renderAll();
  }

  const publicPeer = p => ({
    id: p.id, name: p.name, mode: p.mode, index: p.index, player: p.n, connected: !!(p.joined && p.open),
    rttMs: p.rttMs === null ? null : Math.round(p.rttMs * 10) / 10,
    latencyMs: p.latencyMs === null ? null : Math.round(p.latencyMs * 10) / 10, hz: p.hz,
  });
  const phones = () => Array.from(peers.values()).filter(p => p.joined).map(publicPeer);

  // ------------------------------------------------------------------ phone URL
  function fetchInfo() {
    if (!sameOriginSignal) return Promise.resolve(null);
    if (!infoP) infoP = fetch(location.origin + '/signal-info', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null).then(j => (info = j));
    return infoP;
  }
  function phoneBase() {
    if (cfg.phone) return cfg.phone;
    if (!httpPage) return 'http://localhost:8765/phone/';
    if (info && info.lan_bound && info.lan) return `${location.protocol}//${info.lan}:${location.port || (location.protocol === 'https:' ? 443 : 80)}/phone/`;
    const host = location.hostname === '127.0.0.1' ? 'localhost' : location.hostname;
    return `${location.protocol}//${host}${location.port ? ':' + location.port : ''}/phone/`;
  }
  function url(mode) {
    ensureRoom();
    const base = phoneBase();
    let u = base + '?room=' + room + (mode ? '&mode=' + mode : '');
    try {
      const phoneOrigin = new URL(base).origin;
      const sigDefault = phoneOrigin + '/signal';
      const sig = sameOriginSignal ? location.origin + '/signal' : cfg.signal;
      // the phone page served by the same server (any host name) finds /signal by itself
      if (!(sameOriginSignal && !cfg.phone) && sig !== sigDefault) u += '&sig=' + encodeURIComponent(sig);
    } catch (e) { /* keep it short */ }
    return u;
  }
  const usbUrl = mode => `http://localhost:${(httpPage && location.port) || 8765}/phone/?room=${ensureRoom()}${mode ? '&mode=' + mode : ''}`;
  const isDevHttp = () => /^http:/.test(phoneBase()) && sameOriginSignal;

  // ------------------------------------------------------------------ UI
  const C = { bg: '#0A0B0D', panel: '#17191E', raised: '#22252C', line: '#2C3038', text: '#E8EAEE', dim: '#8A909C', acc: '#5EE6D0', good: '#6FD39A', warn: '#F2B866' };
  const MODE_ACC = { wand: '#FFB454', grip: '#FF6B4A', pad: '#A68BFF', '': C.acc };
  const PHONE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const qrCache = new Map();
  function qrSvg(u) {
    if (!qrCache.has(u)) qrCache.set(u, global.MimicQR.svg(u, { ecc: 'M', border: 2, dark: '#0A0B0D', light: '#FFFFFF' }));
    return qrCache.get(u);
  }

  const CSS = `
  .mml-root{all:initial;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:${C.text}}
  .mml-btn{position:fixed;left:14px;bottom:14px;z-index:2147483000;display:flex;align-items:center;gap:7px;padding:7px 12px 7px 10px;border-radius:999px;
    background:rgba(23,25,30,.82);border:1px solid ${C.line};color:${C.text};font:600 12px/1 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer;opacity:.62;
    backdrop-filter:blur(6px);transition:opacity .15s,border-color .15s}
  .mml-btn:hover,.mml-btn:focus-visible{opacity:1;border-color:${C.acc};outline:none}
  .mml-btn .n{background:${C.acc};color:${C.bg};border-radius:999px;padding:2px 6px;font-size:11px}
  .mml-btn.hide{display:none}
  .mml-scrim{position:fixed;inset:0;z-index:2147483001;background:rgba(5,6,8,.55);display:flex;align-items:center;justify-content:center;padding:16px}
  .mml-scrim.hide{display:none}
  .mml-panel{background:${C.panel};border:1px solid ${C.line};border-radius:18px;padding:clamp(14px,2.6vh,20px) 20px;width:min(360px,100%);box-shadow:0 20px 60px rgba(0,0,0,.5);color:${C.text};font:14px/1.45 system-ui,sans-serif;position:relative}
  .mml-panel h3{margin:0 0 2px;font-size:17px;font-weight:650;letter-spacing:.01em}
  .mml-sub{color:${C.dim};font-size:13px;margin:0 0 clamp(8px,1.8vh,14px)}
  .mml-qr{background:#fff;border-radius:12px;padding:8px;width:clamp(150px,30vh,220px);height:clamp(150px,30vh,220px);margin:0 auto;display:block;box-sizing:border-box}
  .mml-qr svg{width:100%;height:100%;display:block}
  .mml-modes{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:clamp(8px,1.8vh,14px) 0 4px}
  .mml-modes button{all:unset;cursor:pointer;padding:5px 0;text-align:center;border-radius:999px;border:1px solid ${C.line};color:${C.dim};font-size:12px;font-weight:600;letter-spacing:.04em}
  .mml-modes button.on{color:${C.bg};background:var(--a);border-color:var(--a)}
  .mml-url{font:12px/1.4 ui-monospace,Consolas,monospace;color:${C.dim};word-break:break-all;text-align:center;margin:clamp(6px,1.2vh,10px) 0 0;user-select:all}
  .mml-list{margin:14px 0 0;padding:0;list-style:none;display:grid;gap:6px}
  .mml-list li{display:flex;justify-content:space-between;gap:8px;background:${C.raised};border-radius:10px;padding:8px 10px;font-size:13px}
  .mml-list .m{color:var(--a);font-weight:600}
  .mml-list .s{color:${C.dim};font-variant-numeric:tabular-nums}
  .mml-tip{margin:clamp(8px,1.8vh,14px) 0 0;padding:8px 12px;border-radius:10px;background:rgba(242,184,102,.08);border:1px solid rgba(242,184,102,.25);color:${C.text};font-size:12.5px}
  .mml-tip b{color:${C.warn}} .mml-tip code{font:12px ui-monospace,Consolas,monospace;color:${C.text};background:rgba(255,255,255,.06);padding:1px 4px;border-radius:4px;word-break:break-all}
  .mml-x{all:unset;position:absolute;right:12px;top:10px;cursor:pointer;color:${C.dim};font-size:22px;line-height:1;padding:4px 8px;border-radius:8px}
  .mml-x:hover{color:${C.text};background:${C.raised}}
  .mml-foot{color:${C.dim};font-size:12px;margin:clamp(6px,1.4vh,12px) 0 0;text-align:center}
  @media (max-height:640px){.mml-foot{display:none}}
  `;
  const JOIN_CSS = `
  .mml-join{display:inline-flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit;text-align:center}
  .mml-join .q{background:#fff;border-radius:10px;padding:5px;box-shadow:0 4px 18px rgba(0,0,0,.35);box-sizing:border-box;max-width:var(--mml-qmax,max(64px,14vh));max-height:var(--mml-qmax,max(64px,14vh))}
  .mml-join .q svg{display:block;width:100%;height:100%}
  .mml-join .t{letter-spacing:.08em;text-transform:uppercase;font-size:11.5px}
  .mml-join .u{font-weight:500;opacity:.65;font-size:10.5px;letter-spacing:.02em}
  .mml-chip{all:unset;display:inline-flex;align-items:center;gap:7px;cursor:pointer;padding:7px 13px 7px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.22);
    background:rgba(10,11,13,.45);color:inherit;font:600 12px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
  .mml-chip:hover,.mml-chip:focus-visible{border-color:${C.acc};color:#fff}
  `;

  let shadow = null, btnEl = null, scrim = null, panelMode = null, inlineHosts = [], hasJoin = false;
  function mountRoot() {
    if (shadow || !doc || !doc.body) return;
    const host = doc.createElement('div');
    host.id = 'mimic-link';
    doc.body.appendChild(host);
    shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    const st = doc.createElement('style'); st.textContent = CSS; shadow.appendChild(st);
    btnEl = doc.createElement('button');
    btnEl.className = 'mml-btn hide';
    btnEl.title = 'Play with your phone’s browser (no app)';
    btnEl.addEventListener('click', e => { e.stopPropagation(); scrim && !scrim.classList.contains('hide') ? hideQR() : showQR(null, cfg.mode); });
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => btnEl.addEventListener(t, e => e.stopPropagation()));
    shadow.appendChild(btnEl);
    scrim = doc.createElement('div');
    scrim.className = 'mml-scrim hide';
    scrim.addEventListener('click', e => { if (e.target === scrim) hideQR(); });
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown'].forEach(t => scrim.addEventListener(t, e => e.stopPropagation()));
    shadow.appendChild(scrim);
    const jst = doc.createElement('style'); jst.textContent = JOIN_CSS; doc.head.appendChild(jst);
    renderButton();
    doc.addEventListener('pointerlockchange', renderButton);
    doc.addEventListener('keydown', e => { if (e.key === 'Escape' && scrim && !scrim.classList.contains('hide')) hideQR(); }, true);
  }
  function renderButton() {
    if (!btnEl) return;
    const n = phones().length;
    const html = PHONE_ICON + '<span>Phone browser</span>' + (n ? `<span class="n">${n}</span>` : '');
    if (btnEl.__html !== html) { btnEl.innerHTML = html; btnEl.__html = html; }
    if (doc.querySelector('[data-mimic-join]')) hasJoin = true;   // once a game shows its own entry, stay out of its HUD
    const pos = cfg.button || (hasJoin ? 'off' : 'bl');
    btnEl.classList.toggle('hide', pos === 'off' || !!doc.pointerLockElement);
    btnEl.style.cssText = pos === 'off' ? '' : `${pos[0] === 't' ? 'top' : 'bottom'}:14px;${pos[1] === 'r' ? 'right' : 'left'}:14px;${pos[0] === 't' ? 'bottom:auto' : 'top:auto'};${pos[1] === 'r' ? 'left:auto' : 'right:auto'}`;
  }

  function panelHtml(mode, closable) {
    const u = url(mode), list = phones();
    const modeBtns = [['', 'Any'], ['grip', 'Grip'], ['wand', 'Wand'], ['pad', 'Pad']]
      .map(([m, l]) => `<button data-m="${m}" class="${m === (mode || '') ? 'on' : ''}" style="--a:${MODE_ACC[m]}">${l}</button>`).join('');
    let tip = '';
    if (isDevHttp()) {
      tip = `<div class="mml-tip"><b>No HTTPS:</b> over Wi-Fi only <b>Pad</b> works. For Grip / Wand, plug in by USB, run
        <code>adb reverse tcp:${(httpPage && location.port) || 8765} tcp:${(httpPage && location.port) || 8765}</code> and open
        <code>${esc(usbUrl(mode))}</code>.${info && !info.lan_bound ? ' Wi-Fi scan needs the server started with <code>--lan</code>.' : ''}</div>`;
    }
    return `${closable ? '<button class="mml-x" aria-label="Close">×</button>' : ''}
      <h3>Play with your phone</h3>
      <p class="mml-sub">Scan with the camera. No app needed. Each phone is a player.</p>
      <div class="mml-qr">${qrSvg(u)}</div>
      <div class="mml-modes">${modeBtns}</div>
      <div class="mml-url">${esc(u)}</div>
      ${list.length ? `<ul class="mml-list">${list.map(p => `<li style="--a:${MODE_ACC[p.mode]}"><span>Phone ${p.player} <span class="m">${p.mode.toUpperCase()}</span></span><span class="s">${p.latencyMs !== null ? Math.max(0, Math.round(p.latencyMs)) + ' ms' : p.rttMs !== null ? Math.round(p.rttMs / 2) + ' ms' : '…'} · ${p.hz} Hz</span></li>`).join('')}</ul>` : ''}
      ${tip}
      <p class="mml-foot">App phones and browser phones play together.</p>`;
  }
  function wirePanel(el, mode, closable, rerender) {
    el.querySelectorAll('.mml-modes button').forEach(b => b.addEventListener('click', () => rerender(b.dataset.m)));
    const x = el.querySelector('.mml-x'); if (x) x.addEventListener('click', hideQR);
  }

  function showQR(container, mode) {
    return ready.then(() => {
      startHost();
      mountRoot();
      fetchInfo().then(() => renderAll());
      mode = mode === undefined || mode === null ? cfg.mode : mode;
      if (container) {
        const h = { el: container, mode };
        inlineHosts = inlineHosts.filter(x => x.el !== container && x.el.isConnected);
        inlineHosts.push(h);
        renderInline(h);
        return;
      }
      panelMode = mode;
      renderFloating();
      scrim.classList.remove('hide');
    });
  }
  function hideQR() { if (scrim) scrim.classList.add('hide'); }
  function renderFloating() {
    if (!scrim || panelMode === null) return;
    const p = scrim.querySelector('.mml-panel') || scrim.appendChild(Object.assign(doc.createElement('div'), { className: 'mml-panel' }));
    p.innerHTML = panelHtml(panelMode, true);
    wirePanel(p, panelMode, true, m => { panelMode = m; renderFloating(); });
  }
  function renderInline(h) {
    if (!h.el.shadowRoot && h.el.attachShadow) { const sr = h.el.attachShadow({ mode: 'open' }); const st = doc.createElement('style'); st.textContent = CSS; sr.appendChild(st); sr.appendChild(Object.assign(doc.createElement('div'), { className: 'mml-panel' })); }
    const root = h.el.shadowRoot || h.el;
    const p = root.querySelector('.mml-panel');
    p.innerHTML = panelHtml(h.mode, false);
    wirePanel(p, h.mode, false, m => { h.mode = m; renderInline(h); });
  }

  // data-mimic-join widgets
  function renderJoin(el) {
    const mode = el.getAttribute('data-mimic-join') || '';
    const u = url(mode);
    if (el.__mml === u + (el.hasAttribute('data-compact') ? 'c' : '')) return;
    el.__mml = u + (el.hasAttribute('data-compact') ? 'c' : '');
    if (el.hasAttribute('data-compact')) {
      el.innerHTML = `<button class="mml-chip" type="button">${PHONE_ICON}<span>${esc(el.getAttribute('data-label') || 'Scan to play')}</span></button>`;
    } else {
      const size = Math.max(64, Math.min(320, parseInt(el.getAttribute('data-size'), 10) || 112));
      el.innerHTML = `<div class="mml-join" title="Scan with your phone camera to join (no app needed)"><div class="q" style="width:${size}px;height:${size}px">${qrSvg(u)}</div>` +
        `<div class="t">${esc(el.getAttribute('data-label') || 'Scan to join')}</div><div class="u">phone camera · no app</div></div>`;
    }
    if (!el.__mmlClick) {
      el.__mmlClick = true;
      el.addEventListener('click', e => { e.stopPropagation(); showQR(null, el.getAttribute('data-mimic-join') || ''); });
      ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
    }
  }
  function scanJoins(root) {
    const els = (root || doc).querySelectorAll ? (root || doc).querySelectorAll('[data-mimic-join]') : [];
    if (!els.length) return;
    ready.then(() => {
      startHost(); mountRoot();
      els.forEach(renderJoin);
      fetchInfo().then(() => doc.querySelectorAll('[data-mimic-join]').forEach(renderJoin));
    });
  }
  function watchJoins() {
    scanJoins(doc);
    if (typeof MutationObserver === 'undefined') return;
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.hasAttribute && n.hasAttribute('data-mimic-join')) scanJoins(n.parentNode || doc);
        else if (n.querySelector && n.querySelector('[data-mimic-join]')) scanJoins(n);
      }
    }).observe(doc.body, { childList: true, subtree: true });
  }

  let uiT = null;
  function renderAll() {
    renderButton();
    if (scrim && !scrim.classList.contains('hide')) renderFloating();
    inlineHosts = inlineHosts.filter(h => h.el.isConnected);
    inlineHosts.forEach(renderInline);
  }
  // refresh latency numbers while a panel is open
  function tickUi() {
    if ((scrim && !scrim.classList.contains('hide')) || inlineHosts.length) renderAll(); else renderButton();
    uiT = setTimeout(tickUi, 1000);
  }

  function boot() {
    patchMimic();
    ready.then(() => {
      mountRoot();
      // a page reload keeps its room: phones that were connected come back by themselves
      if (sget('mimic.link.active')) startHost();
      watchJoins();
      tickUi();
    }).catch(e => console.warn('[mimic-link]', e));
  }
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
  }

  global.MimicLink = {
    ready, showQR, hideQR, phones, rumble, url,
    get room() { return ensureRoomSafe(); },
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    config(o) { Object.assign(cfg, o || {}); qrCache.clear(); renderAll(); },
    start() { return ready.then(startHost); },
    _peers: peers,
  };
  function ensureRoomSafe() { return global.MimicProto ? ensureRoom() : room; }
})(typeof window !== 'undefined' ? window : this);
