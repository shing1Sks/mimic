// Flight coach: from the aircraft's state, the one next thing to do, in the words of the device
// in your hand. Pure; game.js shows it in the hint box.
(function (root) {
  'use strict';
  const KEYS = {
    phone: { thrUp: 'hold D-pad up', thrDown: 'D-pad down', noseUp: 'tilt the phone\'s nose up gently', noseDown: 'tilt the nose down',
      gear: 'press 2', brake: 'hold B', flaps: 'A', flapsUp: 'hold A', turn: 'bank the phone', relevel: 'tap Center to re-level',
      left: 'bank the phone left', right: 'bank the phone right', straighten: 'twist the phone', roll: 'flick the stick to one side twice', loop: 'flick it back twice' },
    pad: { thrUp: 'hold R2 (or A)', thrDown: 'hold L2 (or B)', noseUp: 'pull the left stick back gently', noseDown: 'push the left stick forward',
      gear: 'press X', brake: 'hold B', flaps: 'D-pad right', flapsUp: 'D-pad left', turn: 'push the left stick sideways', relevel: '',
      left: 'left stick left', right: 'left stick right', straighten: 'right stick (rudder)', roll: 'flick the left stick to one side twice', loop: 'flick it back twice' },
    kbm: { thrUp: 'hold Shift', thrDown: 'Ctrl', noseUp: 'hold S gently', noseDown: 'press W',
      gear: 'press G', brake: 'hold Space', flaps: 'F', flapsUp: 'press V', turn: 'A / D to bank', relevel: '',
      left: 'hold A', right: 'hold D', straighten: 'Q / E rudder', roll: 'press 1', loop: 'press 2' },
  };
  const VR = 55;   // kt: lift the nose
  const km = m => (m / 1000).toFixed(1) + ' km';
  const ftStr = f => (Math.round(f / 100) * 100).toLocaleString('en-US');

  /** s: { mode 'runway'|'air'|'landing'|'mission', device 'phone'|'pad'|'kbm', ias kt, aglFt, onGround,
   * gearDown, throttle 0..1, vsFpm, stall, bank (deg, + right wing down), t (s since start), mission? { kind 'takeoff'|'ring'|'waypoint'|'land',
   * name, idx, total, distM, relBearing (deg, + = right), dyM, altFt, crosswind 'left'|'right' } } -> { id, text } */
  function coach(s) {
    const k = KEYS[s.device] || KEYS.kbm;
    const air = !s.onGround;
    if (air && s.stall) return { id: 'stall', text: `Stall! Nose down (${k.noseDown}) and add throttle (${k.thrUp})` };
    // (60 deg is the Steady assist's sport turn; a roll or loop the assist is flying is not a problem)
    if (air && Math.abs(s.bank || 0) > 65 && !s.stunt) {
      const side = s.bank < 0 ? 'right' : 'left';   // bank < 0 = left wing down: roll right
      return { id: 'level', text: `Steep bank (${Math.round(Math.abs(s.bank))}°): roll the wings level, ${k[side]}` };
    }
    // flaps 20+ are for landing: climbing with them is all drag (seen in a real flight)
    const landingNow = s.mode === 'landing' || (s.mission && s.mission.kind === 'land' && s.mission.distM < 9000);
    if (air && (s.flaps || 0) >= 2 && s.aglFt > 250 && !landingNow && s.throttle > 0.6) {
      return { id: 'flapsUp', text: `Flaps up for the climb: ${k.flapsUp} (flaps ${['up', '10', '20', '30'][s.flaps]} is all drag)` };
    }
    if (s.mode === 'mission') return missionCoach(s, k);
    if (s.mode === 'lowpass') return lowpass(s, k);
    if (s.mode === 'free') return s.onGround ? (takeoff(s, k) || free(k, s)) : (s.aglFt < 1000 && s.t < 90 ? { id: 'climb', text: `Climb to 1,000 ft (${Math.round(s.aglFt)} now). Keep the nose a little up, not steep` } : free(k, s));
    if (s.mode === 'runway') {
      const t = takeoff(s, k); if (t) return t;
      if (s.aglFt < 1000) return { id: 'climb', text: `Climb to 1,000 ft (${Math.round(s.aglFt)} now). Keep the nose a little up, not steep` };
      return free(k);
    }
    if (s.mode === 'air') {
      if (s.t < 12) return { id: 'basics', text: `Cruising. ${k.turn} to turn, nose up to climb, down to dive. ${k.relevel}`.trim() };
      return free(k);
    }
    return landing(s, k, null) || { id: 'approach', text: 'Line up with the runway. PAPI lights beside it: 2 white + 2 red = on the glide path' };
  }

  /** Takeoff roll to gear-up; null once that is done. */
  function takeoff(s, k) {
    if (s.onGround && s.throttle < 0.9) return { id: 'throttle', text: `Takeoff: full throttle, ${k.thrUp}` };
    if (s.onGround && s.ias < VR) return { id: 'roll', text: `Rolling: ${Math.round(s.ias)} kt. Keep it straight; lift the nose at ${VR} kt` };
    if (s.onGround) return { id: 'rotate', text: `${VR} kt: nose up now, ${k.noseUp}` };
    if (s.gearDown) return { id: 'gear', text: `You're flying! Gear up: ${k.gear}` };
    return null;
  }

  /** Short final to the stop. m: mission objective (may be null for the landing challenge). */
  function landing(s, k, m) {
    const cw = m && m.crosswind;
    if (s.onGround) return { id: 'brake', text: `Down! Throttle off (${k.thrDown}) and ${k.brake}` };
    if (s.aglFt < 40) return { id: 'flare', text: cw ? `Flare: ${k.noseUp}, and ${k.straighten} to straighten the nose with the runway` : `Flare: ${k.noseUp} just before the wheels touch` };
    if (!s.gearDown) return { id: 'gearDown', text: `Gear down for landing: ${k.gear}` };
    if (s.ias > 80) return { id: 'slow', text: `Too fast (${Math.round(s.ias)} kt): throttle back, ${k.thrDown}` };
    if (s.vsFpm < -1000) return { id: 'sinking', text: 'Sinking fast: add a little throttle and raise the nose a touch' };
    if (cw) return { id: 'crab', text: `Wind from the ${cw}: keep the nose pointed a little ${cw}, into the wind, so you track the centreline` };
    return null;
  }

  function turnText(m, k, what) {
    const side = m.relBearing < 0 ? 'left' : 'right';
    return { id: 'turn', text: `Turn ${side} ${Math.round(Math.abs(m.relBearing))}° toward ${what}, ${km(m.distM)}: ${k[side]}` };
  }

  function missionCoach(s, k) {
    const m = s.mission || {};
    if (m.kind === 'takeoff') return takeoff(s, k) || { id: 'climb', text: 'Climb away: nose a little up, full power' };
    if (!s.onGround && s.gearDown && m.kind !== 'land') return { id: 'gear', text: `Gear up for the flight: ${k.gear}` };
    if (m.kind === 'ring') {
      const what = `ring ${m.idx} of ${m.total}`;
      if (Math.abs(m.relBearing) > 12 && m.distM > 120) return turnText(m, k, what);
      if (m.dyM > 25) return { id: 'climb', text: `Ring ${m.idx}/${m.total} is ${Math.round(m.dyM)} m above you: ${k.noseUp}, add power` };
      if (m.dyM < -25) return { id: 'descend', text: `Ring ${m.idx}/${m.total} is ${Math.round(-m.dyM)} m below you: ease the nose down` };
      return { id: 'ring', text: `Ring ${m.idx}/${m.total} straight ahead, ${Math.round(m.distM)} m: small corrections, through the middle` };
    }
    if (m.kind === 'waypoint') {
      if (Math.abs(m.relBearing) > 15) return turnText(m, k, m.name);
      return { id: 'cruise', text: `On course for ${m.name}, ${km(m.distM)}.` + (m.altFt ? ` Hold about ${ftStr(m.altFt)} ft` : '') };
    }
    if (m.kind === 'land') {
      if (!s.onGround && m.distM > 6000) {
        if (Math.abs(m.relBearing) > 15) return Object.assign(turnText(m, k, 'the runway'), { id: 'navigate' });
        return { id: 'navigate', text: `${m.name}: ${km(m.distM)} ahead. Descend to about 1,000 ft above the field, slow to 70 kt` };
      }
      return landing(s, k, m) || { id: 'approach', text: 'Line up with the runway. PAPI lights beside it: 2 white + 2 red = on the glide path' };
    }
    return free(k);
  }

  /** The low-pass run: get down, keep the chain, use the ground. s.skim: { mult, active } */
  function lowpass(s, k) {
    const sk = s.skim || {};
    if (s.onGround) return takeoff(s, k) || { id: 'lpGo', text: 'Take off and get down low' };
    if (s.ias < 70) return { id: 'lpSlow', text: `Speed up, a skim counts from 70 kt (${Math.round(s.ias)} now): ${k.thrUp}` };
    if (s.aglFt > 200) return { id: 'lpDown', text: `Get down, under 200 ft starts a chain (${Math.round(s.aglFt)} ft now): ${k.noseDown}` };
    if (sk.active && sk.mult >= 3) return { id: 'lpRidge', text: `x${sk.mult}! Cross ridges close and fly between valley walls for bonuses. Climbing away banks the chain` };
    return { id: 'lpLow', text: 'Skimming: the lower and faster, the more it pays. Stay low to build the multiplier' };
  }

  function free(k, s) {
    // every so often, well clear of the ground, a reminder of the fun stuff
    if (s && !s.onGround && s.t > 40 && s.aglFt > 600) {
      const tip = Math.floor(s.t / 14) % 3;
      if (tip === 0) return { id: 'free', text: `Barrel roll: ${k.roll}. A loop: dive past 125 kt, then ${k.loop}` };
      if (tip === 1) return { id: 'free', text: 'Skim: dive under 200 ft at speed and a chain starts. Crest ridges close for bonuses' };
    }
    const n = s && s.nearest;
    if (n) return { id: 'free', text: `Free flight. Nearest runway: ${n.name} ${n.rwy}, ${Math.round(n.distKm)} km ${n.dir}. ${k.turn} to turn` };
    return { id: 'free', text: `Free flight. Try a gentle turn: ${k.turn}. Land back on runway 09 when ready (gear: ${k.gear.replace(/^(press|hold) /, '')}, flaps: ${k.flaps})` };
  }

  const api = { coach, KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlightCoach = api;
})(typeof window !== 'undefined' ? window : this);
