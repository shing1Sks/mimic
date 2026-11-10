// Ironfern audio (Stage C): Web Audio on the shared context from DH.Assets.audioContext().
// Buses: master -> (sfx, ambience, music). Positional sounds use an HRTF PannerNode with distance
// falloff plus a little air absorption; the listener follows the camera. Gunshots can send into a
// short outdoor "slap" (two filtered delays with feedback) so they ring out across the jungle.
//   DH.Audio.play(key, { pos, volume, rate, detune, bus, echo, delay, ref, rolloff, maxVoices }) -> handle
//   DH.Audio.loop(key, { volume, bus, pos, fadeIn }) -> handle      handle: stop(fade), setVolume(v), setPos(v)
//   DH.Audio.setVolume(v) (master), DH.Audio.bus(name) -> GainNode, DH.Audio.resume()
(function () {
  'use strict';
  const DH = window.DH = window.DH || {};
  let ac = null, master = null, echoIn = null, volume = 0.9;
  const buses = {};
  const voices = new Map(); // key -> [handle]
  const NOOP = { stop() {}, setVolume() {}, setPos() {}, ended: true };

  function setup() {
    if (ac) return true;
    try { ac = DH.Assets.audioContext(); } catch (e) { console.warn('[audio] no Web Audio', e); return false; }
    master = ac.createGain(); master.gain.value = volume;
    // gentle bus limiter so a full-auto burst plus echoes never clips
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.18;
    master.connect(comp); comp.connect(ac.destination);
    for (const b of ['sfx', 'ambience', 'music']) { const g = ac.createGain(); g.connect(master); buses[b] = g; }
    buses.ambience.gain.value = 0.7; buses.music.gain.value = 0.6;

    // outdoor slap: band-limited send -> early reflection (treeline) + a later, darker one, with
    // a filtered feedback loop for the tail
    echoIn = ac.createGain();
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    echoIn.connect(hp); hp.connect(lp);
    const out = ac.createGain(); out.gain.value = 0.55; out.connect(buses.sfx);
    const d1 = ac.createDelay(2); d1.delayTime.value = 0.17;
    const d2 = ac.createDelay(2); d2.delayTime.value = 0.41;
    const fbLp = ac.createBiquadFilter(); fbLp.type = 'lowpass'; fbLp.frequency.value = 1300;
    const fb = ac.createGain(); fb.gain.value = 0.38;
    lp.connect(d1); d1.connect(out);
    d1.connect(fbLp); fbLp.connect(fb); fb.connect(d1);
    const g2 = ac.createGain(); g2.gain.value = 0.6;
    lp.connect(d2); d2.connect(g2); g2.connect(fbLp); g2.connect(out);
    return true;
  }

  const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3();

  function setParam(p, v) { if (p) p.value = v; }
  function placePanner(pn, pos) {
    if (pn.positionX) { setParam(pn.positionX, pos.x); setParam(pn.positionY, pos.y); setParam(pn.positionZ, pos.z); }
    else pn.setPosition(pos.x, pos.y, pos.z);
  }

  function track(key, h, max) {
    let list = voices.get(key);
    if (!list) voices.set(key, list = []);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].ended) list.splice(i, 1);
    list.push(h);
    while (list.length > max) list.shift().stop(0.03);
  }

  function start(key, o, looped) {
    if (!setup()) return NOOP;
    const buf = DH.Assets.get(key);
    if (!buf || !(buf instanceof AudioBuffer)) return NOOP;
    o = o || {};
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = !!looped;
    if (o.rate) src.playbackRate.value = o.rate;
    if (o.detune && src.detune) src.detune.value = o.detune;
    const g = ac.createGain();
    const vol = o.volume == null ? 1 : o.volume;
    let node = g, panner = null;
    src.connect(g);
    if (o.pos) {
      panner = ac.createPanner();
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = o.ref || 4; panner.rolloffFactor = o.rolloff == null ? 1 : o.rolloff; panner.maxDistance = 1000;
      placePanner(panner, o.pos);
      // air absorption: far sounds lose their top end
      const cam = DH.ctx && DH.ctx.camera;
      if (cam) {
        const d = cam.position.distanceTo(o.pos);
        if (d > 25) {
          const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
          lp.frequency.value = Math.max(900, 18000 * Math.exp(-d / 90));
          g.connect(lp); node = lp;
        }
      }
      node.connect(panner); node = panner;
    }
    node.connect(buses[o.bus || 'sfx'] || buses.sfx);
    if (o.echo && echoIn) { const s = ac.createGain(); s.gain.value = o.echo; node.connect(s); s.connect(echoIn); }
    const t0 = ac.currentTime + (o.delay || 0);
    if (o.fadeIn) { g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + o.fadeIn); }
    else g.gain.value = vol;
    const h = {
      source: src, gain: g, panner, ended: false,
      stop(fade) {
        if (h.ended) return; h.ended = true;
        const t = ac.currentTime, f = fade == null ? 0.05 : fade;
        try {
          g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0, t + f); src.stop(t + f + 0.02);
        } catch (e) { /* already stopped */ }
      },
      setVolume(v) { g.gain.setTargetAtTime(v, ac.currentTime, 0.05); },
      setPos(p) { if (panner) placePanner(panner, p); },
    };
    src.onended = () => { h.ended = true; try { src.disconnect(); g.disconnect(); if (panner) panner.disconnect(); } catch (e) { /* ok */ } };
    src.start(t0);
    if (!looped) track(key, h, o.maxVoices || 10);
    return h;
  }

  DH.Audio = {
    init(ctx) { volume = ctx && ctx.settings && ctx.settings.volume != null ? ctx.settings.volume : volume; setup(); },
    resume() { if (setup() && ac.state === 'suspended') ac.resume().catch(() => {}); },
    play(key, o) { return start(key, o, false); },
    loop(key, o) { return start(key, o, true); },
    setVolume(v) { volume = v; if (master) master.gain.setTargetAtTime(v, ac.currentTime, 0.05); },
    bus(name) { setup(); return buses[name] || null; },
    get context() { return ac; },
    update(dt, ctx) {
      if (!ac || !ctx || !ctx.camera) return;
      if (ctx.settings && ctx.settings.volume !== volume) DH.Audio.setVolume(ctx.settings.volume);
      const cam = ctx.camera, L = ac.listener;
      cam.getWorldPosition(_p);
      _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
      _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
      if (L.positionX) {
        L.positionX.value = _p.x; L.positionY.value = _p.y; L.positionZ.value = _p.z;
        L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z;
        L.upX.value = _u.x; L.upY.value = _u.y; L.upZ.value = _u.z;
      } else { L.setPosition(_p.x, _p.y, _p.z); L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
    },
  };
})();
