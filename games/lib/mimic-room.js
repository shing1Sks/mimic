/*
 * Mimic online room: play with a friend who is somewhere else. Same QR flow, one more link.
 *
 * The host's game page runs the match. A friend opens the room link on their own laptop
 * (games/room/?room=..): it joins the host's signaling room as a viewer and gets
 *   - a live video of THEIR OWN view of the game (the host renders a second view for them, the
 *     game decides which: in cricket the friend's end of the pitch), with the game's sound;
 *   - the game's HUD and menus, mirrored as real DOM (crisp text, CSS transitions intact);
 *   - a QR for their phone, which then connects straight to the host's game like any phone.
 * Their phone carries &guest=<viewer id>, so the host knows which seat plays from far away
 * and how late that player sees the game: every streamed frame carries the host's clock in a
 * strip of blocks under the picture; the viewer reads it back as the frame is shown and reports
 * the delay (median, ms), so the game can judge that player's timing against what they saw.
 *
 * Host page (after mimic-link.js):
 *   MimicRoom.host({ mirror: ['hud', 'pause'], audio: () => ({ ctx, node }), game: 'cricket' })
 *   each frame, after drawing:  MimicRoom.frame(canvas, x, y, w, h)  (CSS px of the guest's view)
 *   MimicRoom.viewers()   [{ id, name, open, delayMs, aspect, phone }]
 *   MimicRoom.active      a viewer is connected
 *   MimicRoom.aspect      the viewer's screen aspect (w / h) to render their view at
 *   MimicRoom.delayFor(guestId)  ms the viewer's picture runs behind the game (0 if unknown)
 *   MimicRoom.inviteUrl() the link for the friend
 *   MimicRoom.on('change', fn)
 * Guest page: games/room/index.html calls MimicRoom.guest().
 */
(function (global) {
  'use strict';
  if (global.MimicRoom) return;
  const doc = global.document;
  const now = () => performance.now();
  const P = () => global.MimicProto;
  const listeners = { change: [] };
  const emit = ev => (listeners[ev] || []).forEach(f => { try { f(); } catch (e) { console.warn(e); } });

  // the picture: at most this big (a 1080p laptop's view scaled to 720p lines), 30 frames a second
  const MAX_W = 1280, MAX_H = 720, FPS = 30;
  // the clock strip under the picture: NB blocks, sync (white, black), 20 bits of the host's
  // performance.now() in ms (wraps every 17 min; the viewer unwraps it), parity, black
  const STRIP = 16, NB = 24, BITS = 20, MASK = (1 << BITS) - 1;

  /** Make b's content and attributes appear in a, keeping a's nodes where they match (transitions run). */
  function morph(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b.cloneNode(true)); return; }
    if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    if (a.nodeType !== 1) return;
    for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of Array.from(b.attributes)) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    const ac = a.childNodes, bc = b.childNodes;
    let i = 0;
    for (; i < bc.length; i++) {
      if (i < ac.length) morph(ac[i], bc[i]);
      else a.appendChild(bc[i].cloneNode(true));
    }
    while (ac.length > bc.length) a.removeChild(a.lastChild);
  }

  // =========================================================================== host
  const H = { on: false, opts: null, viewers: new Map(), sc: null, sx: null, stream: null, lastDraw: 0, dirty: new Set(), lastDom: 0, obs: [] };

  function host(opts) {
    if (H.on) return api;
    H.on = true; H.opts = Object.assign({ mirror: ['hud'], game: '' }, opts || {});
    if (global.MimicLink) MimicLink.on('change', phonesChanged);
    for (const id of H.opts.mirror) {
      const el = doc.getElementById(id);
      if (!el) continue;
      const mo = new MutationObserver(() => H.dirty.add(id));
      mo.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
      H.obs.push(mo);
    }
    return api;
  }

  /** The stream: a 2D canvas the guest's view is copied into, plus the game's sound. */
  function ensureStream() {
    if (H.stream) return H.stream;
    const sc = H.sc = doc.createElement('canvas');
    sc.width = MAX_W; sc.height = MAX_H + STRIP;
    H.sx = sc.getContext('2d', { alpha: false });
    H.sx.fillStyle = '#000'; H.sx.fillRect(0, 0, sc.width, sc.height);
    const st = H.stream = sc.captureStream(FPS);
    const v = st.getVideoTracks()[0];
    try { v.contentHint = 'motion'; } catch (e) { /* older browser */ }
    try {
      const a = H.opts.audio && H.opts.audio();
      if (a && a.ctx && a.node) {
        const dest = a.ctx.createMediaStreamDestination();
        a.node.connect(dest);
        dest.stream.getAudioTracks().forEach(t => st.addTrack(t));
      }
    } catch (e) { console.warn('[mimic-room] no game sound in the stream', e); }
    return st;
  }

  /** Copy the guest's view (CSS px of canvas) into the stream, with the clock strip under it. */
  function frame(canvas, x, y, w, h) {
    if (!H.stream || !active()) return;
    const t = now();
    if (t - H.lastDraw < 1000 / FPS - 2) { sendDom(t); return; }
    H.lastDraw = t;
    const k = canvas.width / (canvas.clientWidth || canvas.width);
    // the stream's size follows the view's aspect (whole pixels, even numbers for the encoder)
    let sw = MAX_W, sh = Math.round(MAX_W * h / w);
    if (sh > MAX_H) { sh = MAX_H; sw = Math.round(MAX_H * w / h); }
    sw -= sw % 2; sh -= sh % 2;
    const sc = H.sc, g = H.sx;
    if (sc.width !== sw || sc.height !== sh + STRIP) { sc.width = sw; sc.height = sh + STRIP; for (const v of H.viewers.values()) if (v.open) send(v, { t: 'dims', w: sw, h: sh + STRIP }); }
    try { g.drawImage(canvas, x * k, y * k, w * k, h * k, 0, 0, sw, sh); } catch (e) { return; }
    // the clock: when this picture was drawn, on the host's clock
    const ms = Math.round(t) & MASK, bw = sw / NB;
    let par = 0;
    g.fillStyle = '#000'; g.fillRect(0, sh, sw, STRIP);
    g.fillStyle = '#fff'; g.fillRect(0, sh, Math.ceil(bw), STRIP);
    for (let i = 0; i < BITS; i++) {
      const bit = (ms >> (BITS - 1 - i)) & 1; par ^= bit;
      if (bit) g.fillRect(Math.floor((2 + i) * bw), sh, Math.ceil(bw), STRIP);
    }
    if (par) g.fillRect(Math.floor((2 + BITS) * bw), sh, Math.ceil(bw), STRIP);
    sendDom(t);
  }

  function sendDom(t, force, only) {
    if (!force && t - H.lastDom < 66) return;
    const ids = force ? H.opts.mirror : Array.from(H.dirty);
    if (!ids.length) return;
    H.lastDom = t; if (!force) H.dirty.clear();
    const msgs = [];
    for (const id of ids) { const el = doc.getElementById(id); if (el) msgs.push({ t: 'dom', id, html: el.outerHTML }); }
    const list = only ? [only] : Array.from(H.viewers.values());
    for (const v of list) if (v.open) for (const m of msgs) send(v, m);
  }

  /** Start the video near a sharp picture instead of WebRTC's cautious ~300 kbps ramp (Chrome reads these fmtp keys). */
  function fastStart(sdp) {
    const NL = String.fromCharCode(13, 10), lines = sdp.split(NL), out = [];
    let video = false, skip = new Set();
    const fm = {};
    lines.forEach(l => { const m = /^a=fmtp:(\d+) /.exec(l); if (m) fm[m[1]] = true; });
    lines.forEach(l => { const m = /^a=rtpmap:(\d+) (rtx|red|ulpfec|flexfec)/i.exec(l); if (m) skip.add(m[1]); });
    for (const l of lines) {
      if (/^m=/.test(l)) video = /^m=video/.test(l);
      const f = video && /^a=fmtp:(\d+) /.exec(l);
      if (f && !skip.has(f[1]) && !/x-google-start-bitrate/.test(l)) { out.push(l + ';x-google-start-bitrate=2500;x-google-min-bitrate=600'); continue; }
      out.push(l);
      const r = video && /^a=rtpmap:(\d+) /.exec(l);
      if (r && !skip.has(r[1]) && !fm[r[1]]) out.push(`a=fmtp:${r[1]} x-google-start-bitrate=2500;x-google-min-bitrate=600`);
    }
    return out.join(NL);
  }

  function send(v, m) { try { if (v.dc && v.dc.readyState === 'open') v.dc.send(JSON.stringify(m)); } catch (e) { /* closing */ } }

  /** Signaling from a viewer (mimic-link hands us every message from an id starting "v-"). */
  async function onSignal(m, sig) {
    const d = m.data || {};
    if (m.type === 'offer' && d.kind === 'view') return accept(m.from, d, sig);
    const v = H.viewers.get(m.from);
    if (!v || d.sid !== v.sid) return;
    if (m.type === 'ice' && d.c) { if (v.pc.remoteDescription) v.pc.addIceCandidate(d.c).catch(() => {}); else v.iceQ.push(d.c); }
    else if (m.type === 'bye') drop(v);
  }

  async function accept(id, d, sig) {
    if (!H.on || typeof d.sdp !== 'string') return;
    const old = H.viewers.get(id);
    if (old && old.sid === d.sid) return;
    if (old) drop(old, true);
    const ice = P().iceServers ? await P().iceServers(sig.base) : P().STUN;
    const v = { id, sid: d.sid, name: String(d.name || 'Friend').slice(0, 24), pc: new RTCPeerConnection({ iceServers: ice }), iceQ: [], dc: null, open: false,
      delayMs: null, aspect: 16 / 9, phone: null };
    H.viewers.set(id, v);
    const pc = v.pc;
    pc.onicecandidate = e => { if (e.candidate && H.viewers.get(id) === v) sig.send(id, 'ice', { sid: v.sid, c: e.candidate.toJSON() }).catch(() => {}); };
    pc.onconnectionstatechange = () => { if (/failed|closed/.test(pc.connectionState) && H.viewers.get(id) === v) drop(v); };
    pc.ondatachannel = e => bind(v, e.channel);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      const st = ensureStream();
      for (const tr of st.getTracks()) pc.addTrack(tr, st);
      const ans = await pc.createAnswer();
      try { await pc.setLocalDescription({ type: 'answer', sdp: fastStart(ans.sdp) }); } catch (e) { await pc.setLocalDescription(ans); }
      for (const c of v.iceQ.splice(0)) pc.addIceCandidate(c).catch(() => {});
      await sig.send(id, 'answer', { sid: v.sid, sdp: pc.localDescription.sdp });
      // a game picture: keep the frame rate, let the resolution give; room for a sharp picture
      for (const s of pc.getSenders()) {
        if (!s.track || s.track.kind !== 'video') continue;
        const p = s.getParameters();
        p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
        p.encodings[0].maxBitrate = 4500000; p.encodings[0].maxFramerate = FPS;
        p.degradationPreference = 'maintain-framerate';
        s.setParameters(p).catch(() => {});
      }
    } catch (e) { console.warn('[mimic-room] viewer', id, 'failed', e); drop(v); return; }
    setTimeout(() => { if (H.viewers.get(id) === v && !v.open) drop(v); }, 25000);
    emit('change');
  }

  function bind(v, dc) {
    v.dc = dc;
    dc.onopen = () => {
      v.open = true;
      send(v, { t: 'hello', game: H.opts.game, phone: phoneUrl(v) });
      if (H.sc) send(v, { t: 'dims', w: H.sc.width, h: H.sc.height });
      sendDom(now(), true, v);
      phonesChanged();
      emit('change');
    };
    dc.onclose = () => { if (H.viewers.get(v.id) === v) drop(v); };
    dc.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'ping') send(v, { t: 'pong', g: m.g, h: now() });
      else if (m.t === 'delay' && typeof m.ms === 'number' && m.ms >= 0 && m.ms < 3000) { v.delayMs = m.ms; emit('change'); }
      else if (m.t === 'size' && m.w > 0 && m.h > 0) { v.aspect = Math.min(2.6, Math.max(1, m.w / m.h)); emit('change'); }
    };
  }

  function drop(v, quiet) {
    try { v.pc.close(); } catch (e) { /* gone */ }
    if (H.viewers.get(v.id) === v) H.viewers.delete(v.id);
    if (!quiet) emit('change');
  }

  /** The phone link for a viewer's phone: the host's own phone URL, marked with the viewer. */
  function phoneUrl(v) {
    if (!global.MimicLink) return '';
    let u = MimicLink.url('grip');
    return u + (u.includes('?') ? '&' : '?') + 'guest=' + encodeURIComponent(v.id);
  }

  function phonesChanged() {
    if (!global.MimicLink) return;
    const ps = MimicLink.phones();
    for (const v of H.viewers.values()) {
      const p = ps.find(x => x.guest === v.id) || null;
      const was = v.phone && v.phone.connected;
      v.phone = p;
      if (v.open) send(v, { t: 'phone', joined: !!(p && p.connected), name: p ? p.name : '', url: phoneUrl(v) });
      if (!!(p && p.connected) !== !!was) emit('change');
    }
  }

  function active() { for (const v of H.viewers.values()) if (v.open) return true; return false; }
  function first() { for (const v of H.viewers.values()) if (v.open) return v; return null; }

  /** The friend's link: the phone link's server and room, the room page instead of the phone page. */
  function inviteUrl() {
    if (!global.MimicLink) return '';
    try {
      const u = new URL(MimicLink.url());
      u.pathname = u.pathname.replace(/phone\/?$/, 'room/');
      ['mode', 'rec'].forEach(k => u.searchParams.delete(k));
      if (H.opts && H.opts.game) u.searchParams.set('game', H.opts.game);
      return u.toString();
    } catch (e) { return ''; }
  }

  // =========================================================================== guest
  function guest(o) {
    o = o || {};
    const qs = new URLSearchParams(location.search);
    const room = qs.get('room'), game = /^[a-z0-9-]{1,24}$/.test(qs.get('game') || '') ? qs.get('game') : '';
    const SIG = qs.get('sig') || (location.origin + '/signal');   // as the phone page: the site and the dev server both answer /signal
    const $ = id => doc.getElementById(id);
    const status = t => { const s = $('r-status'); if (s) s.textContent = t; };
    if (!room || !P().SAFE_ID.test(room)) { status('This link has no room in it. Ask your friend for the link again.'); return; }
    // the game's own stylesheet, and its folder as the base for anything the mirrored HTML points at
    if (game) {
      const base = doc.createElement('base'); base.href = new URL(`../${game}/`, location.href).href; doc.head.prepend(base);
      const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = base.href + 'style.css'; doc.head.insertBefore(l, doc.head.querySelector('style'));
    }
    const me = 'v-' + P().randomId(8);
    const sig = new (P().Signal)(SIG, room, me, onMsg, { wait: 8000 });
    const S = { pc: null, dc: null, sid: null, dims: null, off: null, bestRtt: Infinity, delays: [], joined: false, phoneUrl: '', started: false };
    const video = $('r-video');
    let iceQ = [];

    async function connect() {
      if (S.pc) try { S.pc.close(); } catch (e) { /* gone */ }
      const sid = S.sid = P().randomId(6);
      iceQ = [];
      status('Connecting to the game…');
      const ice = P().iceServers ? await P().iceServers(SIG) : P().STUN;
      if (S.sid !== sid) return;
      const pc = S.pc = new RTCPeerConnection({ iceServers: ice });
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      const dc = S.dc = pc.createDataChannel('room', { ordered: true });
      dc.onopen = () => { status(''); doc.body.classList.add('live'); size(); ping(); };
      dc.onclose = () => { if (S.sid === sid) lost(); };
      dc.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onData(m); };
      pc.ontrack = e => {
        const st = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
        if (video.srcObject !== st) video.srcObject = st;
        video.play().catch(() => {});
      };
      pc.onicecandidate = e => { if (e.candidate && S.sid === sid) sig.send('host', 'ice', { sid, c: e.candidate.toJSON() }).catch(() => {}); };
      pc.onconnectionstatechange = () => { if (S.sid === sid && pc.connectionState === 'failed') lost(); };
      await pc.setLocalDescription(await pc.createOffer());
      await sig.send('host', 'offer', { sid, sdp: fastStart(pc.localDescription.sdp),   /* the host's encoder reads its start rate from here */ kind: 'view', name: o.name || 'Friend' });
      setTimeout(() => { if (S.sid === sid && (!S.dc || S.dc.readyState !== 'open')) lost(); }, 20000);
    }
    function lost() {
      doc.body.classList.remove('live');
      status('Lost the game. Reconnecting…');
      setTimeout(connect, 1500);
    }
    function onMsg(m) {
      const d = m.data || {};
      if (m.from !== 'host' || d.sid !== S.sid) return;
      if (m.type === 'answer') S.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }).then(() => { for (const c of iceQ.splice(0)) S.pc.addIceCandidate(c).catch(() => {}); }).catch(() => lost());
      else if (m.type === 'ice' && d.c) { if (S.pc.remoteDescription) S.pc.addIceCandidate(d.c).catch(() => {}); else iceQ.push(d.c); }
    }
    function onData(m) {
      if (m.t === 'dom' && typeof m.id === 'string' && typeof m.html === 'string') applyDom(m.id, m.html);
      else if (m.t === 'dims' && m.w > 0 && m.h > STRIP) { S.dims = { w: m.w, h: m.h }; layout(); }
      else if (m.t === 'pong') {
        const t = now(), rtt = t - m.g;
        if (rtt <= S.bestRtt * 1.5 + 2) { const off = m.h + rtt / 2 - t; S.off = S.off === null || rtt < S.bestRtt ? off : S.off * 0.8 + off * 0.2; S.bestRtt = Math.min(S.bestRtt, rtt); }
      } else if (m.t === 'hello' || m.t === 'phone') {
        if (m.phone || m.url) S.phoneUrl = m.phone || m.url;
        if (m.t === 'phone') S.joined = !!m.joined;
        renderPhone(m.name);
      }
    }
    const mirror = $('r-mirror');
    function applyDom(id, html) {
      const t = doc.createElement('template'); t.innerHTML = html.trim();
      const nu = t.content.firstElementChild;
      if (!nu) return;
      const cur = mirror.querySelector('#' + CSS.escape(id));
      if (cur) morph(cur, nu); else mirror.appendChild(nu);
    }
    function renderPhone(name) {
      const box = $('r-phone');
      if (!box) return;
      box.classList.toggle('joined', S.joined);
      if (S.joined) { box.innerHTML = `<b>Phone connected</b><span>${String(name || '').replace(/[&<>"]/g, '')}</span>`; return; }
      if (!S.phoneUrl || !global.MimicQR) return;
      if (box.dataset.url === S.phoneUrl) return;
      box.dataset.url = S.phoneUrl;
      box.innerHTML = `<div class="qr">${MimicQR.svg(S.phoneUrl, { ecc: 'M', border: 2 })}</div><div><b>Scan with your phone</b><span>Your phone becomes your bat and ball. Then press HOLD on it to take your seat.</span></div>`;
    }
    function ping() {
      if (!S.dc || S.dc.readyState !== 'open') return;
      S.dc.send(JSON.stringify({ t: 'ping', g: now() }));
      setTimeout(ping, S.bestRtt === Infinity ? 250 : 1000);
    }
    function size() { if (S.dc && S.dc.readyState === 'open') S.dc.send(JSON.stringify({ t: 'size', w: innerWidth, h: innerHeight })); layout(); }
    addEventListener('resize', size);
    /** The picture fills the window (letterboxed if the host could not match its shape); the strip stays out of sight. */
    function layout() {
      const box = $('r-pic'), D = S.dims;
      if (!box || !D) return;
      const ph = D.h - STRIP, k = Math.min(innerWidth / D.w, innerHeight / ph);
      box.style.width = D.w * k + 'px'; box.style.height = ph * k + 'px';
      box.style.left = (innerWidth - D.w * k) / 2 + 'px'; box.style.top = (innerHeight - ph * k) / 2 + 'px';
      video.style.width = D.w * k + 'px'; video.style.height = D.h * k + 'px';
    }

    // reading the host's clock off each frame as it is shown
    const rc = doc.createElement('canvas'); rc.width = NB; rc.height = 1;
    const rx = rc.getContext('2d', { willReadFrequently: true });
    function onFrame(t, meta) {
      video.requestVideoFrameCallback(onFrame);
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh || S.off === null || !S.dims) return;
      // the strip: the bottom STRIP rows of the host's frame, scaled with whatever size the encoder sent
      const rows = STRIP * vh / S.dims.h;
      try { rx.drawImage(video, 0, vh - rows / 2 - 1, vw, 2, 0, 0, NB, 1); } catch (e) { return; }
      const px = rx.getImageData(0, 0, NB, 1).data, lum = i => (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
      if (lum(0) < 150 || lum(1) > 100) return;
      let ms = 0, par = 0;
      for (let i = 0; i < BITS; i++) { const b = lum(2 + i) > 128 ? 1 : 0; ms = (ms << 1) | b; par ^= b; }
      if (((lum(2 + BITS) > 128) ? 1 : 0) !== par) return;
      const shown = (meta && meta.expectedDisplayTime) || t;
      const e = Math.round(shown + S.off), full = e - ((((e & MASK) - ms) % (MASK + 1)) + (MASK + 1)) % (MASK + 1);
      const d = shown + S.off - full;
      if (d < 0 || d > 3000) return;
      S.delays.push(d); if (S.delays.length > 45) S.delays.shift();
    }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame);
    setInterval(() => {
      if (!S.delays.length || !S.dc || S.dc.readyState !== 'open') return;
      const s = S.delays.slice().sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
      S.dc.send(JSON.stringify({ t: 'delay', ms: Math.round(med) }));
      const el = $('r-lag'); if (el) el.textContent = Math.round(med) + ' ms';
    }, 1000);

    // sound needs a click on most browsers: the join button is that click
    const go = $('r-go');
    const start = () => { if (S.started) return; S.started = true; doc.body.classList.add('started'); video.muted = false; video.play().catch(() => {}); };
    if (go) go.addEventListener('click', start);
    sig.start();
    connect();
    return { state: S, start };
  }

  const api = {
    host, frame, guest, morph, inviteUrl,
    viewers: () => Array.from(H.viewers.values()).map(v => ({ id: v.id, name: v.name, open: v.open, delayMs: v.delayMs, aspect: v.aspect, phone: v.phone })),
    get active() { return active(); },
    get aspect() { const v = first(); return v ? v.aspect : 16 / 9; },
    delayFor(gid) { const v = H.viewers.get(gid); return v && v.open && v.delayMs != null ? v.delayMs : 0; },
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    _onSignal: onSignal, _viewers: () => H.viewers,
    STRIP, NB, BITS,
  };
  global.MimicRoom = api;
})(typeof window !== 'undefined' ? window : this);
