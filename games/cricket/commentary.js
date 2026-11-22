/*
 * Willowlight - Paaji, the commentator. The scheduler is pure (node games/cricket/test/commentary.test.js);
 * the player fetches and decodes the clips and plays them through the game's WebAudio.
 *
 * One line at a time, and a line once started plays to its end. Only a strictly bigger moment takes
 * over (4: the result, a hat-trick, a hundred; 3: six, wicket, milestone; 2: four, appeal, new
 * batter; 1: dot, chatter), and then it fades the old line out at the next pause between words. An
 * equal or smaller moment waits for the line to finish (a few seconds at most, so it is never stale)
 * or, for a small one (prio 1), is skipped; a small one also waits out a cool-down so quiet balls
 * stay quiet. No line repeats within the last NO_REPEAT played, and a call for a moment more than a
 * second old is dropped (a hidden tab coming back does not unload a backlog). Lines come from
 * commentary-lines.js (bundled: subtitles work even when the audio does not).
 *
 * The voice and the subtitle start together: the caption is shown when the clip actually starts, for
 * as long as the clip runs. A clip that is not decoded yet gets a short grace to become ready; past
 * that the line is dropped (no subtitle with a voice arriving late). The game paces the next ball on
 * `busy` (game.js), so he finishes his line before the bowler runs in.
 */
(function (root) {
  'use strict';

  /** How long a moment may wait for the line in progress to finish, by priority (ms). */
  const WAIT = { 1: 0, 2: 2000, 3: 3500, 4: 10000 };
  /** The game holds the next ball while he talks, but never more than this (s) past its usual pause. */
  const PACE_CAP = 4.0;
  /** busy: the player's (or scheduler's) busy; over: seconds past the ball's usual pause. */
  const holds = (busy, over) => !!busy && over < PACE_CAP;

  /**
   * o: { lines, now() ms, rng, clips ({ id: { ms } } or null), noRepeat 15, coolDownMs 4000 (any quiet line),
   *      sameQuietMs 0 (the same quiet moment again: dot after dot),
   *      ready (id) => bool: whether a line's clip can play right now (prefer those) }
   */
  function createScheduler(o) {
    const now = o.now, rng = o.rng || Math.random, noRepeat = o.noRepeat || 15, cool = o.coolDownMs || 4000, same = o.sameQuietMs || 0;
    const byMoment = {};
    for (const l of o.lines) (byMoment[l.moment] = byMoment[l.moment] || []).push(l);
    const recent = [], queued = {};
    let playing = null, lastQuiet = -Infinity, pending = [];
    const lastOf = {};
    const lengthOf = l => (o.clips && o.clips[l.id] && o.clips[l.id].ms) || 900 + l.text.length * 55;
    // weighted: a line with w (his own famous lines, w 3) is picked w times as readily
    const pick = ls => { const W = ls.reduce((a, l) => a + (l.w || 1), 0); let r = rng() * W; for (const l of ls) { r -= l.w || 1; if (r < 0) return l; } return ls[ls.length - 1]; };
    /** The line this moment will use next (picked ahead, so the player can have its clip ready). */
    function upcoming(kind) {
      const pool = byMoment[kind];
      if (!pool || !pool.length) return null;
      if (!queued[kind] || recent.includes(queued[kind].id)) {
        const fresh = pool.filter(l => !recent.includes(l.id));
        queued[kind] = fresh.length ? pick(fresh) : pool.slice().sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id))[0];
      }
      return queued[kind];
    }
    function start(kind, t) {
      const pool = byMoment[kind], prio = pool[0].prio;
      let line = upcoming(kind);
      // its clip not ready (still loading): another fresh line of this moment that is
      if (o.ready && !o.ready(line.id)) {
        const alt = pool.filter(l => !recent.includes(l.id) && o.ready(l.id));
        if (alt.length) line = pick(alt);
      }
      delete queued[kind];
      recent.push(line.id); while (recent.length > noRepeat) recent.shift();
      playing = { id: line.id, kind, prio, at: t, until: t + lengthOf(line) };
      if (prio === 1) lastQuiet = lastOf[kind] = t;
      return line;
    }
    const live = t => !!playing && t < playing.until;
    const fresh = t => { pending = pending.filter(p => t <= p.until); return pending; };
    return {
      setClips(c) { o.clips = c; },
      upcoming,
      /**
       * A moment happened. Returns the line to play now, or null (skipped, or waiting its turn:
       * next() hands it out once the line in progress ends). at: when it happened (ms).
       * opts.queue: never take over; wait up to this many ms for the line in progress instead.
       */
      moment(kind, at, opts) {
        const t = now(), q = opts && opts.queue;
        if (at !== undefined && t - at > 1000) return null;
        const pool = byMoment[kind];
        if (!pool || !pool.length) return null;
        const prio = pool[0].prio;
        if (live(t)) {
          if (prio > playing.prio && !q) return start(kind, t);
          const wait = q || WAIT[prio] || 0;
          if (wait > 0 && !pending.some(p => p.kind === kind)) pending.push({ kind, prio, at: t, until: t + wait });
          return null;
        }
        if (prio === 1 && !q && (t - lastQuiet < cool || t - (lastOf[kind] || -Infinity) < same)) return null;
        return start(kind, t);
      },
      /** The line in progress is over (it ended, or the player could not voice it). */
      done(id) { if (playing && playing.id === id) playing = null; },
      /** It was never heard (its clip did not come in time): free it for another time. */
      cancel(id) { if (playing && playing.id === id) playing = null; const i = recent.lastIndexOf(id); if (i >= 0) recent.splice(i, 1); },
      /** When the line will really end (its voice started late, after a fade-over or a decode). */
      endAt(id, until) { if (playing && playing.id === id) playing.until = until; },
      /** Once free: the waiting moment to play now (biggest first, then the oldest), or null. */
      next() {
        const t = now();
        if (live(t)) return null;
        const p = fresh(t).slice().sort((a, b) => b.prio - a.prio || a.at - b.at)[0];
        if (!p) return null;
        pending = pending.filter(x => x !== p);
        return start(p.kind, t);
      },
      /** Forget the line in progress and everything waiting (a new match, back to the menu). */
      clear() { playing = null; pending = []; },
      /** Talking, or a moment waiting for its turn. */
      busy() { const t = now(); return live(t) || fresh(t).length > 0; },
      get playing() { return playing; },
    };
  }

  /**
   * Where to fade a line out for a bigger one: the first pause between words (a 20 ms window much
   * quieter than the clip's speech) within maxS after `from`, as seconds from `from`; the quietest
   * window if there is no pause. data: the clip's samples, sr: its sample rate.
   */
  function quietPoint(data, sr, from, maxS) {
    const win = Math.max(1, Math.round(sr * 0.02)), i0 = Math.max(0, Math.round(from * sr)), i1 = Math.min(data.length, i0 + Math.round(maxS * sr));
    if (i1 - i0 < win) return 0;
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 7) { sum += data[i] * data[i]; n++; }
    const speech = Math.sqrt(sum / Math.max(1, n)), quiet = Math.max(0.004, speech * 0.15);
    let best = 0, bestR = Infinity;
    for (let i = i0; i + win <= i1; i += win) {
      let s = 0;
      for (let j = i; j < i + win; j++) s += data[j] * data[j];
      const r = Math.sqrt(s / win);
      if (r < quiet) return (i - i0) / sr;
      if (r < bestR) { bestR = r; best = (i - i0) / sr; }
    }
    return best;
  }

  /**
   * The player. o: { lines, base (URL of the clip folder), audio () => { ctx, out, duck () => [GainNode] } | null,
   * enabled () => bool, volume () => 0..1, onLine (line, secs) shows the subtitle for secs;
   * for tests: now, setTimeout, clearTimeout, fetch }.
   */
  function createPlayer(o) {
    const now = o.now || (() => performance.now()), later = o.setTimeout || ((f, ms) => setTimeout(f, ms)), unlater = o.clearTimeout || (h => clearTimeout(h));
    const get = o.fetch || (u => fetch(u));
    const READY_MS = 600, FADE = 0.12, GAP_MS = 250, TAKEOVER_LOOK = 0.45;
    const bytes = {}, bufs = {}, decoding = {}, failed = {};
    let man = null, cur = null, waiting = null, gapT = null, decodeCtx = null, ducked = false, voiced = false;
    const prioOf = {}, momentPrio = {};
    o.lines.forEach(l => { prioOf[l.id] = l.prio; momentPrio[l.moment] = l.prio; });
    const moments = Object.keys(momentPrio).sort((a, b) => momentPrio[b] - momentPrio[a]);
    // he finishes every line before the next ball, so a line on every dot ball would slow the game: every other one
    const sched = createScheduler({ lines: o.lines, now, rng: o.rng, clips: null, sameQuietMs: 12000, ready: id => !!bufs[id] });
    const audioOn = () => { const a = o.enabled() && o.audio(); return a && a.ctx.state === 'running' ? a : null; };

    function decoder() {
      const a = o.audio();
      if (a) return a.ctx;
      const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null;
      return OAC ? (decodeCtx = decodeCtx || new OAC(1, 1, 48000)) : null;   // decodes before the first click
    }
    async function fetchClip(id) {
      if (bytes[id] || failed[id] || !man || !man[id]) return;
      try { const r = await get(o.base + man[id].file); if (!r.ok) throw new Error(r.status); bytes[id] = await r.arrayBuffer(); } catch (e) { failed[id] = true; }
    }
    /** The decoded clip for a line (fetching it first if need be), or null if it cannot be had. */
    function decode(id) {
      if (bufs[id]) return Promise.resolve(bufs[id]);
      if (decoding[id]) return decoding[id];
      return (decoding[id] = (async () => {
        try {
          await fetchClip(id);
          const ctx = decoder();
          if (!bytes[id] || !ctx) return null;
          // decodeAudioData detaches the bytes it is given: keep ours for a later decode
          const buf = await ctx.decodeAudioData(bytes[id].slice(0));
          bufs[id] = buf; voiced = true;
          return buf;
        } catch (e) { failed[id] = true; return null; } finally { delete decoding[id]; }
      })());
    }
    /**
     * Keep each moment's next line decoded (and nothing else: all of them decoded at once would be
     * ~250 MB of samples), biggest moments first.
     */
    function prime() {
      if (!man) return;
      const keep = new Set(moments.map(k => { const l = sched.upcoming(k); return l && l.id; }));
      if (cur) keep.add(cur.id);
      if (waiting) keep.add(waiting.line.id);
      for (const id in bufs) if (!keep.has(id)) delete bufs[id];
      (async () => { for (const k of moments) { const l = sched.upcoming(k); if (l && !bufs[l.id] && !failed[l.id]) await decode(l.id); } })();
    }
    /** Fetch the clips (no AudioContext needed, so this starts at page load): each moment's next line first. */
    async function load() {
      try {
        man = await (await get(o.base + 'manifest.json')).json();
        sched.setClips(man);
      } catch (e) { return; }   // no clips: subtitles only
      const first = moments.map(k => sched.upcoming(k)).filter(Boolean).map(l => l.id);
      const rest = Object.keys(man).filter(id => !first.includes(id)).sort((x, y) => (prioOf[y] || 0) - (prioOf[x] || 0));
      const worker = async list => { for (let id = list.shift(); id; id = list.shift()) await fetchClip(id); };
      const q1 = first.slice();
      await Promise.all(Array.from({ length: 6 }, () => worker(q1)));
      prime();
      const q2 = rest.slice();
      await Promise.all(Array.from({ length: 3 }, () => worker(q2)));
    }

    function duck(on, a) {
      if (on === ducked || !a || !a.duck) return;
      ducked = on;
      const t = a.ctx.currentTime;
      // the crowd (and the chants) dip under his voice and come back up after it
      for (const g of a.duck()) {
        if (!g) continue;
        if (g.__paajiBase === undefined) g.__paajiBase = g.gain.value;
        g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(g.__paajiBase * (on ? 0.6 : 1), t, on ? 0.08 : 0.4);
      }
    }
    function afterLine() {
      unlater(gapT);
      gapT = later(() => { const l = sched.next(); if (l) play(l); else if (!cur && !waiting) duck(false, o.audio()); prime(); }, GAP_MS);
    }
    /** Fade the line in progress out at its next pause; returns the seconds until it is gone. */
    function fadeOut() {
      if (!cur) return 0;
      const c = cur; cur = null;
      if (!c.src) { unlater(c.timer); return 0; }   // subtitle-only
      const ctx = c.ctx;
      c.src.onended = () => c.gain.disconnect();
      if (ctx.currentTime < c.t0) { try { c.src.stop(); } catch (e) { /* not started */ } return 0; }   // not begun: never heard
      const el = ctx.currentTime - c.t0;
      const at = quietPoint(c.buf.getChannelData(0), c.buf.sampleRate, el, TAKEOVER_LOOK), t = ctx.currentTime + at;
      c.gain.gain.setValueAtTime(c.gain.gain.value, t); c.gain.gain.linearRampToValueAtTime(0.0001, t + FADE);
      try { c.src.stop(t + FADE + 0.02); } catch (e) { /* already done */ }
      return at + FADE;
    }
    function voice(line, buf, a, delay) {
      const ctx = a.ctx, gain = ctx.createGain(), src = ctx.createBufferSource();
      gain.gain.value = 1.5 * o.volume(); gain.connect(a.out);
      src.buffer = buf; src.connect(gain);
      const t0 = ctx.currentTime + delay;
      src.start(t0);
      const c = cur = { id: line.id, line, src, gain, buf, ctx, t0 };
      sched.endAt(line.id, now() + (delay + buf.duration) * 1000);
      src.onended = () => { gain.disconnect(); if (cur === c) { cur = null; sched.done(line.id); afterLine(); } };
      duck(true, a);
      if (o.onVoice) o.onVoice(line, delay);   // (the online room: the friend's page says it too)
      const show = () => { if (cur === c && o.onLine) o.onLine(line, buf.duration + 0.3); };
      if (delay > 0.005) later(show, delay * 1000); else show();
    }
    function subtitleOnly(line) {
      const secs = (sched.playing ? sched.playing.until - now() : 2500) / 1000;
      const c = cur = { id: line.id, line, src: null };
      c.timer = later(() => { if (cur === c) { cur = null; sched.done(line.id); afterLine(); } }, secs * 1000);
      if (o.onLine) o.onLine(line, secs + 0.3);
    }
    function play(line) {
      unlater(gapT);
      if (waiting) { unlater(waiting.timer); sched.cancel(waiting.line.id); waiting = null; }
      const lead = fadeOut();
      const a = audioOn();
      // no voice to be had at all (no running audio, no clips, a browser that cannot decode them): the
      // subtitle alone. One clip that failed while the others play: that line is skipped instead.
      if (!a || !man || (failed[line.id] && !voiced)) { subtitleOnly(line); return; }
      if (failed[line.id]) { sched.cancel(line.id); afterLine(); return; }
      if (bufs[line.id]) { voice(line, bufs[line.id], a, lead); return; }
      // not decoded yet: a short grace, then voice and subtitle together, or nothing at all
      const w = waiting = { line, t: now() };
      const giveUp = () => { if (waiting === w) { waiting = null; sched.cancel(line.id); afterLine(); } };
      w.timer = later(giveUp, READY_MS);
      decode(line.id).then(buf => {
        if (waiting !== w) return;
        waiting = null; unlater(w.timer);
        const late = now() - w.t, a2 = audioOn();
        if (buf && a2 && late <= READY_MS) voice(line, buf, a2, Math.max(0, lead - late / 1000));
        else { sched.cancel(line.id); afterLine(); }
      });
    }
    /** at: when the moment happened (ms); a delayed or throttled call more than 1 s late is dropped. */
    function moment(kind, at, opts) {
      const line = sched.moment(kind, at === undefined ? now() : at, opts);
      if (line) { play(line); prime(); }
      return line;
    }
    /** Say this line now (a friend's page, told by the host which line): no scheduling, just the voice. */
    function playId(id, delay) {
      const line = o.lines.find(l => l.id === id);
      if (!line) return;
      unlater(gapT);
      if (waiting) { unlater(waiting.timer); waiting = null; }
      const lead = Math.max(fadeOut(), delay || 0), a = audioOn();
      if (!a || !man) { if (o.onLine) o.onLine(line, 3); return; }
      const t0 = now();
      decode(id).then(buf => { const a2 = audioOn(); if (buf && a2) voice(line, buf, a2, Math.max(0, lead - (now() - t0) / 1000)); });
    }
    function stop() {
      unlater(gapT);
      if (waiting) { unlater(waiting.timer); sched.cancel(waiting.line.id); waiting = null; }
      if (cur) fadeOut();
      sched.clear();
      duck(false, o.audio());
    }
    return {
      load, moment, stop, playId,
      get loaded() { return Object.keys(bytes).length; },
      get decoded() { return Object.keys(bufs).length; },
      get speaking() { return !!cur; },
      /** Talking, about to (a clip decoding), or a moment waiting its turn: the next ball waits. */
      get busy() { return !!cur || !!waiting || sched.busy(); },
    };
  }

  const api = { createScheduler, createPlayer, quietPoint, holds, WAIT, PACE_CAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Commentary = api; }
})(typeof window !== 'undefined' ? window : null);
