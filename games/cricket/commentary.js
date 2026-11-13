/*
 * Willowlight - Paaji, the commentator. The scheduler is pure (node games/cricket/test/commentary.test.js);
 * the player decodes the clips once and plays them through the game's WebAudio.
 *
 * One line at a time. A bigger moment (4: the result, a hat-trick; 3: six, wicket, milestone)
 * interrupts a smaller one, and a new prio-3 moment cuts off an older one after 1.5 s; a
 * small one (prio 1: dot, between overs) waits out a cool-down so quiet balls stay quiet. No line
 * repeats within the last NO_REPEAT played, and a call for a moment more than a second old is
 * dropped (a hidden tab coming back does not unload a backlog). Lines come from commentary-lines.js
 * (bundled: subtitles work even when the audio does not).
 */
(function (root) {
  'use strict';

  /** o: { lines, now() ms, rng, clips ({ id: { ms } } or null), noRepeat 15, coolDownMs 4000 } */
  function createScheduler(o) {
    const now = o.now, rng = o.rng || Math.random, noRepeat = o.noRepeat || 15, cool = o.coolDownMs || 4000;
    const byMoment = {};
    for (const l of o.lines) (byMoment[l.moment] = byMoment[l.moment] || []).push(l);
    const recent = [];
    let playing = null, lastQuiet = -Infinity;
    const lengthOf = l => (o.clips && o.clips[l.id] && o.clips[l.id].ms) || 900 + l.text.length * 55;
    return {
      setClips(c) { o.clips = c; },
      moment(kind, at) {
        const t = now();
        if (at !== undefined && t - at > 1000) return null;
        const pool = byMoment[kind];
        if (!pool || !pool.length) return null;
        const prio = pool[0].prio;
        // a bigger moment interrupts; an equal big one (prio 3) does once the last has had 1.5 s;
        // results (prio 4) are never cut off
        if (playing && t < playing.until && !(prio > playing.prio || (prio === 3 && playing.prio === 3 && t - playing.at >= 1500))) return null;
        if (prio === 1 && t - lastQuiet < cool) return null;
        const fresh = pool.filter(l => !recent.includes(l.id));
        const line = fresh.length ? fresh[Math.min(fresh.length - 1, Math.floor(rng() * fresh.length))]
          : pool.slice().sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id))[0];
        recent.push(line.id); while (recent.length > noRepeat) recent.shift();
        playing = { id: line.id, prio, at: t, until: t + lengthOf(line) };
        if (prio === 1) lastQuiet = t;
        return line;
      },
      done(id) { if (playing && playing.id === id) playing = null; },
      get playing() { return playing; },
    };
  }

  /**
   * The player. o: { lines, base (URL of the clip folder), audio () => { ctx, out } | null,
   * enabled () => bool, volume () => 0..1, onLine (line) for the subtitle }.
   */
  function createPlayer(o) {
    const buffers = {};
    let src = null, gain = null, lastStart = null;
    const sched = createScheduler({ lines: o.lines, now: () => performance.now(), clips: null });
    async function load() {
      try {
        const man = await (await fetch(o.base + 'manifest.json')).json();
        sched.setClips(man);
        const a = o.audio();
        if (!a) return;
        // big moments first, eight at a time: the first six of the match should already have a voice
        const prio = id => { const l = o.lines.find(x => x.id === id); return l ? l.prio : 0; };
        const ids = Object.keys(man).sort((x, y) => prio(y) - prio(x));
        const next = async () => {
          for (let id = ids.shift(); id; id = ids.shift()) {
            try { buffers[id] = await a.ctx.decodeAudioData(await (await fetch(o.base + man[id].file)).arrayBuffer()); } catch (e) { /* that clip stays subtitle-only */ }
          }
        };
        await Promise.all(Array.from({ length: 8 }, next));
      } catch (e) { /* no audio: subtitles only */ }
    }
    function stop() { if (src) { try { src.onended = null; src.stop(); } catch (e) { /* done */ } src = null; } }
    function moment(kind) {
      const line = sched.moment(kind, performance.now());
      if (!line) return null;
      if (o.onLine) o.onLine(line);
      const a = o.enabled() && o.audio(), buf = buffers[line.id];
      if (a && buf) {
        stop();
        if (!gain) { gain = a.ctx.createGain(); gain.connect(a.out); }
        gain.gain.value = 1.5 * o.volume();
        src = a.ctx.createBufferSource(); src.buffer = buf; src.connect(gain);
        const id = line.id;
        src.onended = () => { sched.done(id); src = null; };
        src.start(); lastStart = performance.now();
      }
      return line;
    }
    return { load, moment, stop, get loaded() { return Object.keys(buffers).length; }, get lastStart() { return lastStart; } };
  }

  const api = { createScheduler, createPlayer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Commentary = api; }
})(typeof window !== 'undefined' ? window : null);
