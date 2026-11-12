// Play recorder: every game loads this. Add ?rec=1 to a game's URL (or press F8) to record (?demo:
// the same at 60 fps and 20 Mbps with the game's sound and the badge hidden, for promo footage):
//  - video of the whole tab (HUD included) after one click "Share", or of the game canvas if
//    tab capture is refused or unavailable;
//  - every controller sample each frame (Mimic Wand / Pad axes and buttons), mouse moves (also
//    under pointer lock), clicks, wheel and keys;
//  - game events, if the game calls MimicRec.event(name, data).
// Everything streams to the local server (tools/serve.py) as it happens, so closing the tab
// loses at most the last few seconds. Files: recordings/<game>-<time>/video.webm, input.ndjson.
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  // ?demo: footage for a video, not analysis: whole tab (HUD included) at 60 fps and 20 Mbps, badge hidden
  const DEMO = q.has('demo'), FPS = DEMO ? 60 : 30, BITS = DEMO ? 20e6 : 5e6;
  const game = (location.pathname.split('/').filter(Boolean).slice(-1)[0] || 'game').replace(/[^A-Za-z0-9_-]/g, '');
  const pad2 = n => String(n).padStart(2, '0');
  let session = null, t0 = 0, rec = null, stream = null, lines = [], seq = 0, badge = null, rafId = 0, gestureArmed = false;

  function post(file, body, append, sess) {
    sess = sess || session;
    if (!sess) return Promise.resolve();
    return fetch(`/rec/${sess}/${file}${append ? '?append=1' : ''}`, { method: 'POST', body, keepalive: body.size ? body.size < 60000 : body.length < 60000 })
      .catch(() => {});
  }
  const now = () => +(performance.now() - t0).toFixed(1);
  function log(o) { if (session) lines.push(JSON.stringify(Object.assign({ t: now() }, o))); }
  function flushLog() { if (!session || !lines.length) return; const b = lines.join('\n') + '\n'; lines = []; post('input.ndjson', b, true); }

  function showBadge(text) {
    if (!badge) {
      badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147483646;font:600 12px system-ui;color:#fff;background:rgba(200,30,30,.85);padding:4px 9px;border-radius:12px;pointer-events:none;letter-spacing:.06em';
      document.body.appendChild(badge);
    }
    badge.textContent = text; badge.style.display = text ? 'block' : 'none'; badge.style.opacity = autoRec ? '0.55' : '1';
  }

  // ------------------------------------------------------------------ input sampling
  // Polled every 4 ms and logged only when a pad's report changes, so a phone's ~125 Hz stream is
  // kept (a frame-rate log merged reports and missed swing peaks). Axes keep 6 decimals: the app
  // signs its mode in the lowest bit of each int16 axis (value * 32767), which 4 decimals destroyed.
  // ts = the pad's own report time (performance.now clock).
  const lastPad = new Map();
  function samplePads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes.map(a => +a.toFixed(6)), b = p.buttons.reduce((m, x, i) => x.pressed ? m | (1 << i) : m, 0);
      const key = p.id + '|' + ax.join(',') + '|' + b;
      if (lastPad.get(p.index) === key) continue;
      lastPad.set(p.index, key);
      log({ k: 'pad', id: p.id.slice(0, 40), i: p.index, ax, b, ts: +(p.timestamp || 0).toFixed(2) });
    }
  }
  const onMove = e => log({ k: 'mm', dx: e.movementX, dy: e.movementY, x: e.clientX, y: e.clientY, lock: !!document.pointerLockElement });
  const onDown = e => log({ k: 'md', b: e.button, x: e.clientX, y: e.clientY, trusted: e.isTrusted });
  const onUp = e => log({ k: 'mu', b: e.button });
  const onKey = e => { if (!e.repeat) log({ k: e.type === 'keydown' ? 'kd' : 'ku', code: e.code }); };
  const onWheel = e => log({ k: 'wh', dy: Math.sign(e.deltaY) });

  // ------------------------------------------------------------------ video
  let videoKind = '', autoRec = false;
  function startVideo(s, kind) {
    stream = s; videoKind = kind;
    const types = s.getAudioTracks().length ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'] : [];
    const type = types.concat(['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']).find(t => MediaRecorder.isTypeSupported(t));
    rec = new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: BITS, audioBitsPerSecond: 160e3 });
    // the last chunk arrives after stop(): keep this recording's session name for it
    const file = kind === 'tab' ? 'video.webm' : 'video-canvas.webm', first = { v: true }, sess = session;
    rec.ondataavailable = e => { if (e.data && e.data.size) { post(file, e.data, !first.v, sess); first.v = false; } };
    rec.start(3000);
    log({ k: 'video', source: kind, w: s.getVideoTracks()[0] && s.getVideoTracks()[0].getSettings().width });
    showBadge(autoRec ? '● REC' : '● REC ' + (kind === 'tab' ? '' : '(canvas) ') + '· F8 stop');
    if (DEMO) setTimeout(() => { if (badge) badge.style.display = 'none'; }, 2500);   // keep it out of the footage
    s.getVideoTracks().forEach(t => t.addEventListener('ended', () => stop()));
  }
  function canvasVideo() {
    // the canvas that covers most of the screen (the 3D view), not the one with the most pixels (a
    // high-resolution 2D instrument overlay won that, and the video showed only gauges)
    const area = c => { const r = c.getBoundingClientRect(); return Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); };
    const c = [...document.querySelectorAll('canvas')].sort((a, b) => area(b) - area(a) || b.width * b.height - a.width * a.height)[0];
    if (!c || !c.captureStream) { showBadge('● REC input only · F8 stop'); return; }
    startVideo(c.captureStream(FPS), 'canvas');
  }
  let asking = false;
  async function tabVideo() {
    asking = true;
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: FPS }, audio: DEMO ? { suppressLocalAudioPlayback: false } : false, preferCurrentTab: true, selfBrowserSurface: 'include' });
      if (rec && rec.state !== 'inactive') { rec.stop(); if (stream) stream.getTracks().forEach(t => t.stop()); }   // upgrade from canvas
      startVideo(s, 'tab');
    } catch (e) { log({ k: 'video', error: String(e && e.name) }); if (!rec) canvasVideo(); }
    asking = false;
  }

  // ------------------------------------------------------------------ start / stop
  function start(auto) {
    if (session) return;
    auto = autoRec = auto === true;
    const d = new Date();
    session = `${game}-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    t0 = performance.now(); seq = 0; lines = [];
    post('meta.json', JSON.stringify({ game, url: location.href, demo: DEMO, started: d.toISOString(), screen: [innerWidth, innerHeight, devicePixelRatio], ua: navigator.userAgent }), false);
    addEventListener('mousemove', onMove, true); addEventListener('mousedown', onDown, true); addEventListener('mouseup', onUp, true);
    addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true); addEventListener('wheel', onWheel, { capture: true, passive: true });
    lastPad.clear(); rafId = setInterval(samplePads, 4);
    if (auto) {
      // automatic local recording: no share prompt, the game canvas only (wait for it to exist)
      const tryCanvas = (n) => { if (!session || rec) return; if (document.querySelector('canvas')) canvasVideo(); else if (n < 20) setTimeout(() => tryCanvas(n + 1), 500); };
      setTimeout(() => tryCanvas(0), 1500);
      flusher = setInterval(flushLog, 2000);
      return;
    }
    showBadge('● REC · click once to share the tab');
    // tab capture needs a real click or key press; until then record inputs, and fall back to the
    // canvas if no click comes
    gestureArmed = true;
    const arm = e => {
      if (!e.isTrusted || !session || (rec && videoKind === 'tab') || asking) return;
      removeEventListener('pointerdown', arm, true); removeEventListener('keydown', arm, true);
      gestureArmed = false;
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) tabVideo(); else if (!rec) canvasVideo();
    };
    addEventListener('pointerdown', arm, true); addEventListener('keydown', arm, true);
    // no click within a minute (playing with the phone only): record the game canvas meanwhile,
    // and a later click still upgrades to the whole tab (HUD included)
    // (?demo starts the canvas at once: a phone-only session must never end up with no video)
    setTimeout(() => { if (gestureArmed && session && !rec) canvasVideo(); }, DEMO ? 1500 : 60000);
    flusher = setInterval(flushLog, 2000);
  }
  let flusher = 0;
  function stop() {
    if (!session) return;
    log({ k: 'stop' });
    if (rec && rec.state !== 'inactive') rec.stop();
    if (stream) stream.getTracks().forEach(t => t.stop());
    clearInterval(rafId); clearInterval(flusher); flushLog();
    removeEventListener('mousemove', onMove, true); removeEventListener('mousedown', onDown, true); removeEventListener('mouseup', onUp, true);
    removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKey, true); removeEventListener('wheel', onWheel, true);
    showBadge('saved recording ' + session); setTimeout(() => showBadge(''), 4000);
    session = null; rec = null; stream = null;
  }

  addEventListener('keydown', e => { if (e.code === 'F8') { e.preventDefault(); session ? stop() : start(); } }, true);
  addEventListener('pagehide', () => { if (session) { log({ k: 'pagehide' }); flushLog(); } });
  window.MimicRec = {
    start, stop, get active() { return !!session; },
    /** Games may report what happened: MimicRec.event('hit', {power: .8}). */
    event(name, data) { log(Object.assign({ k: 'ev', name }, data || {})); },
  };
  // On this machine's own server every play is recorded (canvas video + inputs) so feedback can
  // point at a real session; ?rec=1 adds the whole-tab video, ?rec=0 turns it off. Never under
  // automation (headless tests) and never on a deployed site.
  const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname) && location.port === '8765';
  const go = q.get('rec') === '1' || DEMO ? () => start() : local && q.get('rec') !== '0' && !navigator.webdriver ? () => start(true) : null;
  if (go) { if (document.readyState === 'loading') addEventListener('DOMContentLoaded', go); else go(); }
})();
