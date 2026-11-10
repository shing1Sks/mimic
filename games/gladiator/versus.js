/*
 * Iron Ludus - VERSUS: two phones, one PC, one arena. Best of three rounds.
 *
 * Why split screen, first person (side by side) and not a shared third-person camera:
 * everything in Iron Ludus is judged on the blade *as you see it* - a cut lands where your drawn
 * blade sweeps over them, a block is your blade across theirs on your screen. In first person each
 * phone keeps its 1:1 sword and the same reading the ladder taught ("show one side, cut the other",
 * meet the cut late to parry). A side-on shared camera would have to remap each phone's rotation
 * into a profile view (mirrored for one of the two), shows blades edge-on (so you cannot read a
 * guard) and turns a duel of feints into button timing. Both players stand in one world: each sees
 * the other's body (the same rigged gladiators as the ladder) holding the other's real sword, so
 * what one player sees as "their blade crossed mine" is the same geometry on both screens.
 *
 * The rules are combat.js for both fighters: swings (stamina, rushed cuts, whiffs leave you open,
 * flailing), cut zones and edge alignment (resolveCut), and the defence (resolveDefense through
 * pvpExchange): blade held = block, blade that arrives just in time = parry, heavy cut breaks a
 * guard, shield (hold A / Vol Down) = cheaper block, raise it late to parry.
 *
 * Classic script: defines window.LudusVersus.create(core); game.js owns the renderer and the loop.
 */
(function () {
  'use strict';
  const T = THREE, C = LudusCombat;
  const DIST = 2.1, EYE = 1.65;
  const TEAM = [
    { name: 'RED', css: '#e0503c', color: 0xb42a1e, model: 'champion', tint: 0x8a1c14 },
    { name: 'BLUE', css: '#4a9cf0', color: 0x2a64c8, model: 'axeman', tint: 0x1d3f8a },
  ];
  const HOLD_START = 0.9; // s of holding A / Vol Down to start the match

  function create(core) {
    const { scene, renderer, Sfx, $ } = core;
    const pv = new T.Vector3(), tv = new T.Vector3(), tq = new T.Quaternion();
    let ctls = null, mouseCtl = null;
    const V = { state: 'off', players: [null, null], joined: [null, null], holdT: 0, round: 1, roundT: 0, introT: 0, endT: 0,
      slowT: 0, timeScale: 1, freezeT: 0, gameMs: 0, excite: 0.4, matchWinner: -1, log: [] };

    /* ------------------------------------------------------------ controllers */
    /** The n-th phone (Wand or Grip). Uses the lib's multi-phone API when it exists, else reads the n-th motion pad. */
    function makeCtl(slot) {
      if (typeof MimicController.all === 'function') return new MimicController({ slot });
      const c = new MimicController();
      c._findPad = function () {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [], list = [];
        for (const p of pads) {
          if (!p || !p.connected) continue;
          if ((p.buttons.length === 12 && p.axes.length >= 6) || (/mimic/i.test(p.id) && p.axes.length >= 6 && p.buttons.length < 16)) list.push(p);
        }
        const p = list[slot];
        if (!p || (p.axes[0] === 0 && p.axes[1] === 0 && p.axes[2] === 0 && p.axes[5] === 0)) return null;
        return p;
      };
      return c;
    }
    function ensureCtls() {
      if (ctls) return;
      ctls = [core.mc, makeCtl(1), makeCtl(2), makeCtl(3)];
      mouseCtl = new MimicController(); mouseCtl._findPad = () => null;   // keyboard + mouse, never a phone
    }
    const isPhone = c => c && c !== mouseCtl && c.source === 'phone';

    /* ---------------------------------------------------------------- lobby */
    function enter() {
      ensureCtls();
      V.state = 'lobby'; V.joined = [null, null]; V.holdT = 0;
      core.showScreen('lobby');
      renderLobby();
    }
    function join(ctl) {
      const i = V.joined.indexOf(null);
      if (i < 0 || V.joined.includes(ctl)) return;
      V.joined[i] = ctl; ctl.__latch = true;
      Sfx.play('blade', { vol: 0.6 }); try { ctl.rumble(0.8, 80, 0); } catch (e) { /* no rumble */ }
      renderLobby();
    }
    function leave(i) { if (V.joined[i]) { V.joined[i] = null; Sfx.play('step', { vol: 0.5 }); renderLobby(); } }
    function toggleMouse() {
      ensureCtls();
      const i = V.joined.indexOf(mouseCtl);
      if (i >= 0) leave(i); else join(mouseCtl);
    }
    /** Grip's A in lobby hints: the volume key, HOLD on a browser phone, or both when both are here. */
    function gripA() {
      const g = (ctls || []).filter(c => isPhone(c) && c.mode === 'grip');
      const web = g.some(c => c.via === 'browser'), app = g.some(c => c.via !== 'browser');
      return web && app ? 'Vol Down / HOLD' : web ? 'HOLD' : 'Vol Down';
    }
    function renderLobby() {
      const ga = V.gripA = gripA();
      for (let i = 0; i < 2; i++) {
        const el = $('slot' + i), c = V.joined[i];
        el.classList.toggle('joined', !!c);
        el.querySelector('.sl-ctl').textContent = c ? (c === mouseCtl ? 'Mouse + keyboard' : 'Phone ' + (ctls.indexOf(c) + 1) + ' · ' + core.modeName(c)) : 'Waiting for a phone';
        el.querySelector('.sl-state').innerHTML = c
          ? (c === mouseCtl ? 'Ready. Click LEAVE to give up the slot.' : `Ready. <kbd>${core.word('b', c)}</kbd> to leave.`)
          : `Press <kbd>A</kbd> / <kbd>${ga}</kbd> to join`;
      }
      const both = V.joined[0] && V.joined[1];
      $('lobby-go').classList.toggle('hidden', !both);
      $('lobby-hint').innerHTML = both
        ? `Both ready. Either player: <b>hold</b> <kbd>A</kbd> / <kbd>${ga}</kbd> to enter the sand.`
        : 'Pair each phone in Mimic (Wand or Grip). Testing alone? The mouse can take a slot.';
      const mb = $('lobby-mouse'); if (mb) mb.firstChild.textContent = V.joined.includes(mouseCtl) ? 'LEAVE (MOUSE)' : 'JOIN WITH MOUSE';
    }
    function lobbyFrame(dt) {
      for (const c of ctls) if (c !== core.mc) c.update();
      mouseCtl.update();
      if (gripA() !== V.gripA) renderLobby();   // a phone joined or switched: keep the key names right
      let anyHeld = false;
      ctls.forEach(c => {
        if (!isPhone(c)) { const i = V.joined.indexOf(c); if (i >= 0) leave(i); return; }
        const i = V.joined.indexOf(c);
        if (!c.isDown('a')) c.__latch = false;
        if (i < 0 && c.pressed('a')) join(c);
        else if (i >= 0 && c.pressed('b')) leave(i);
        else if (i >= 0 && c.isDown('a') && !c.__latch) anyHeld = true;
        if (i < 0 && c.pressed('b') && !V.joined[0] && !V.joined[1]) core.quit();
      });
      const both = V.joined[0] && V.joined[1];
      V.holdT = both && anyHeld ? V.holdT + dt : 0;
      $('lobby-go-fill').style.width = Math.min(100, 100 * V.holdT / HOLD_START) + '%';
      if (V.holdT >= HOLD_START) startMatch();
    }

    /* ---------------------------------------------------------------- match */
    // a half screen is narrow: a slightly wider view than the ladder's 68 deg
    const cams = [0, 1].map(() => new T.PerspectiveCamera(72, 1, 0.03, 500));
    let rigs = null;
    function setupRigs() {
      if (rigs) return;
      rigs = [0, 1].map(k => {
        scene.add(cams[k]);
        const R = core.makeRig(cams[k], TEAM[k].tint);
        // your own arm and fist are for your eyes only; the other player sees your body holding the sword
        for (const m of R.armParts) m.traverse(o => o.layers.set(3 + k));
        // the shield you see sits out where your eyes expect it; the other player sees a copy strapped
        // to your body's forearm instead (see placeAvatars), so it never floats beside you
        R.shieldGrp.traverse(o => o.layers.set(3 + k));
        return R;
      });
      cams.forEach((c, k) => { c.layers.enable(3 + k); c.layers.enable(1 + (1 - k)); });
    }
    function freshPlayer(k, ctl) {
      return { k, ctl, team: TEAM[k], hp: C.PVP.hp, stamina: C.STAMINA_MAX, sinceSpend: 9, swing: C.swingTracker(), swished: 0, swingTimes: [],
        shieldUp: false, shieldSince: 0, shieldT: 0, thrustT: 0, thrustCd: 0, thrustHit: false, stunT: 0, overT: 0, knock: 0,
        dodgeT: 0, dodgeDir: 0, dodgeCd: 0, dodgeX: 0, deflectYaw: 0, deflectPitch: 0, kickX: 0, kickY: 0, shake: 0, vignette: 0,
        movedAt: -1e9, angSpeed: 0, angRaw: 0, lastQ: null, dispQ: null, blade: null, prevBlade: null, oppSeg: null, oppSegPrev: null,
        wins: 0, yieldT: 0, aLatch: true, stats: { hits: 0, parries: 0, blocks: 0, best: 0, taken: 0, whiffs: 0, beats: 0 } };
    }
    function startMatch() {
      setupRigs();
      V.players = [freshPlayer(0, V.joined[0]), freshPlayer(1, V.joined[1])];
      V.round = 1; V.matchWinner = -1;
      core.hideScreens(); $('vs-hud').classList.remove('hidden');
      core.fx().clearDecals();
      core.world().sun.shadow.camera.layers.enableAll();
      renderer.shadowMap.autoUpdate = false;
      Sfx.startCrowd(); Sfx.play('cheer', { vol: 0.8 });
      startRound();
    }
    function spawnAvatar(k) {
      const P = V.players[k];
      if (P.avatar) scene.remove(P.avatar.root);
      const prof = { id: 'p' + k, name: TEAM[k].name, model: TEAM[k].model, height: 1.85, hp: 100 };
      const f = new LudusFighters.Fighter(prof, core.assets.models[prof.model], core.assets);
      // the same rigged gladiators as the ladder, untouched; the team shows as a crest ring in the sand
      f.model.traverse(o => { if (o.isMesh) o.layers.set(1 + k); });
      const ring = new T.Mesh(new T.RingGeometry(0.44, 0.52, 48), new T.MeshBasicMaterial({ color: TEAM[k].color, transparent: true, opacity: 0.7, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.layers.set(1 + k); f.root.add(ring);
      f.root.position.set(0, 0, k === 0 ? DIST / 2 : -DIST / 2);
      scene.add(f.root);
      f.drive(new T.Vector3());
      P.avatar = f;
      if (P.bodyShield) scene.remove(P.bodyShield);
      P.bodyShield = null;
      const R = rigs[k];
      if (R.shieldGrip && f.ikEndL) {
        const sh = R.shieldGrp.clone(true);
        // the inner iron rim belongs to the view from behind the shield; seen from the front it hangs off the edge
        sh.traverse(o => { o.layers.set(1 + k); o.renderOrder = 0; if (o.isMesh) o.castShadow = true; });
        sh.children.filter(o => o.isMesh && o.geometry.type === 'TorusGeometry').forEach(o => sh.remove(o));
        scene.add(sh); P.bodyShield = sh;
      }
    }
    function startRound() {
      for (const P of V.players) {
        Object.assign(P, { hp: C.PVP.hp, stamina: C.STAMINA_MAX, sinceSpend: 9, stunT: 0, overT: 0, knock: 0, shieldUp: false, dodgeT: 0, dodgeX: 0,
          thrustT: 0, deflectYaw: 0, deflectPitch: 0, swing: C.swingTracker(), swingTimes: [], aLatch: true });
        spawnAvatar(P.k);
      }
      V.state = 'intro'; V.introT = 0; V.roundT = 0; V.timeScale = 1; V.slowT = 0;
      bigCall(V.round === 3 ? 'FINAL ROUND' : 'ROUND ' + V.round, 'big');
      Sfx.play('cheer', { vol: 0.6 });
      updateHud(true);
    }
    function endRound(winner) {
      V.state = 'roundEnd'; V.endT = 0;
      if (winner >= 0) V.players[winner].wins++;
      const loser = winner >= 0 ? V.players[1 - winner] : null;
      if (loser && loser.hp <= 0) loser.avatar.die();
      V.timeScale = 0.3; V.slowT = 1.3;
      Sfx.play('cheer', { vol: 1, delay: 0.2 }); V.excite = 1.3;
      bigCall(winner < 0 ? 'DRAW' : TEAM[winner].name + ' TAKES THE ROUND', winner < 0 ? 'mid' : 'big', winner);
      for (const P of V.players) rumble(P, 1, 255, P.k === winner ? 2 : 1);
      if (V.players.some(P => P.wins >= C.PVP.rounds)) V.matchWinner = V.players[0].wins > V.players[1].wins ? 0 : 1;
      updateHud(true);
    }
    function showResults() {
      V.state = 'results';
      $('vs-hud').classList.add('hidden');
      const w = V.matchWinner, P = V.players;
      const rows = [['ROUNDS', p => p.wins], ['HITS', p => p.stats.hits], ['BEST HIT', p => p.stats.best], ['PARRIES', p => p.stats.parries],
        ['BLOCKS', p => p.stats.blocks], ['BEAT ASIDE', p => p.stats.beats], ['MISSED SWINGS', p => p.stats.whiffs], ['DAMAGE TAKEN', p => p.stats.taken]];
      core.showResults({
        kicker: 'THE CROWD HAS SPOKEN', title: TEAM[w].name + ' WINS', fame: P[w].wins + ' – ' + P[1 - w].wins, fameLabel: '',
        statsHtml: `<table class="vs-table"><tr><th></th><th style="color:${TEAM[0].css}">P1 · ${TEAM[0].name}</th><th style="color:${TEAM[1].css}">P2 · ${TEAM[1].name}</th></tr>` +
          rows.map(r => `<tr><td>${r[0]}</td><td>${r[1](P[0])}</td><td>${r[1](P[1])}</td></tr>`).join('') + '</table>',
        again: 'REMATCH',
      });
      Sfx.play('cheer', { vol: 1 }); Sfx.play('cheer', { vol: 0.8, delay: 1.4 });
    }
    function exit() {
      V.state = 'off';
      for (const P of V.players) if (P && P.avatar) { scene.remove(P.avatar.root); P.avatar = null; if (P.bodyShield) { scene.remove(P.bodyShield); P.bodyShield = null; } }
      for (const c of cams) scene.remove(c);
      rigs = null;
      $('vs-hud').classList.add('hidden');
      renderer.shadowMap.autoUpdate = true;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, innerWidth, innerHeight);
    }
    function rematch() { V.players.forEach(P => { P.wins = 0; P.stats = freshPlayer(0).stats; }); V.matchWinner = -1; V.round = 1; core.hideScreens(); $('vs-hud').classList.remove('hidden'); startRound(); }

    /* ------------------------------------------------------------ helpers */
    function rumble(P, s, ms, pat) { try { P.ctl.rumble(s, ms, pat); } catch (e) { /* no rumble */ } }
    function toView(cam, v) { pv.copy(v).project(cam); return { x: pv.x * cam.aspect, y: pv.y, ok: pv.z < 1 && pv.z > -1 }; }
    const camRight = new T.Vector3(), camUp = new T.Vector3();
    function rectOf(cam, box) {
      const c = toView(cam, box.center);
      camRight.setFromMatrixColumn(cam.matrixWorld, 0); camUp.setFromMatrixColumn(cam.matrixWorld, 1);
      const r = toView(cam, tv.copy(box.center).addScaledVector(camRight, box.hw));
      const u = toView(cam, tv.copy(box.center).addScaledVector(camUp, box.hh));
      return { cx: c.x, cy: c.y, hw: Math.abs(r.x - c.x), hh: Math.abs(u.y - c.y), name: box.name, center: box.center, ok: c.ok };
    }
    function viewToWorld(cam, p, depthPoint) { const d = depthPoint.clone().project(cam).z; return new T.Vector3(p.x / cam.aspect, p.y, d).unproject(cam); }
    function halfPx(k, cam, p) { const w = innerWidth / 2; return { x: k * w + (p.x / cam.aspect + 1) / 2 * w, y: (1 - p.y) / 2 * innerHeight }; }
    /** A message in one player's half. at: view point, or 'high' / 'center' / 'low'. */
    function pop(k, text, cls, at) {
      let x, y;
      if (at && at.x !== undefined) { const p = halfPx(k, cams[k], at); x = p.x; y = p.y; }
      else { x = (k + 0.5) * innerWidth / 2; y = innerHeight * (at === 'high' ? 0.27 : at === 'low' ? 0.66 : 0.42); }
      core.popAt(text, cls, x, y);
    }
    function bigCall(text, cls, k) { core.popAt(text, (cls || 'big') + ' vs-call' + (k === 0 || k === 1 ? ' t' + k : ''), innerWidth / 2, innerHeight * 0.36); }
    function spend(P, n) { P.stamina = Math.max(0, P.stamina - n); P.sinceSpend = 0; }

    /* ----------------------------------------------------------- the blade */
    const swordQ = new T.Quaternion();
    function poseBlade(P, dt) {
      const c = P.ctl, cam = cams[P.k];
      let q, arm;
      if (isPhone(c)) { q = c.quat; arm = core.continuousArm(q, c.arm, dt, rigs[P.k].armState, P.angSpeed); }
      else { const yaw = c.yaw * 1.15, pitch = c.pitch * 1.25 + 0.5; q = MimicMath.fromEuler(yaw, pitch, -c.yaw * 0.6); arm = MimicMath.armPose(q, 'right'); }
      // rotation speed straight from the orientation stream (as in the ladder)
      if (P.lastQ && dt > 0) {
        const L = P.lastQ, d = Math.min(1, Math.abs(q.x * L.x + q.y * L.y + q.z * L.z + q.w * L.w));
        const raw = 2 * Math.acos(d) / dt; P.angSpeed = (raw + P.angRaw) / 2; P.angRaw = raw;
      }
      P.lastQ = { x: q.x, y: q.y, z: q.z, w: q.w };
      if (P.angSpeed > 1.5) P.movedAt = V.gameMs;
      swordQ.set(q.x, q.y, q.z, q.w);
      if (!P.dispQ) P.dispQ = swordQ.clone();
      const tired = V.state === 'fight' && P.stamina < C.TIRED ? 1 - P.stamina / C.TIRED : 0;
      P.dispQ.slerp(swordQ, tired > 0 ? 1 - Math.exp(-(26 - 18 * tired) * dt) : 1);
      swordQ.copy(P.dispQ);
      if (P.knock > 0) { tq.setFromAxisAngle(tv.set(0, 0, 1), P.knock * 0.9); swordQ.premultiply(tq); }
      if (Math.abs(P.deflectYaw) + Math.abs(P.deflectPitch) > 1e-3) { tq.setFromEuler(new T.Euler(P.deflectPitch, P.deflectYaw, 0, 'YXZ')); swordQ.premultiply(tq); }
      const dk = Math.exp(-7 * dt); P.deflectYaw *= dk; P.deflectPitch *= dk;
      P.shieldT += ((P.shieldUp ? 1 : 0) - P.shieldT) * Math.min(1, dt * 16);
      const w = core.poseRig(rigs[P.k], cam, swordQ, arm, { thrustT: P.thrustT, shieldT: P.shieldT, side: 'right', dt });
      P.prevBlade = P.blade;
      P.blade = { hiltW: w.hiltW, tipW: w.tipW, gripW: rigs[P.k].hand.localToWorld(new T.Vector3(0, 0, -0.01)) };
    }
    function placeCameras(dt) {
      for (const P of V.players) {
        const O = V.players[1 - P.k], cam = cams[P.k], me = P.avatar.root.position, them = O.avatar.root.position;
        const sx = P.shake > 0 ? (Math.random() - 0.5) * P.shake * 0.3 : 0, sy = P.shake > 0 ? (Math.random() - 0.5) * P.shake * 0.3 : 0;
        P.shake = Math.max(0, P.shake - dt * 0.8);
        cam.position.set(me.x + sx, EYE + sy, me.z + (P.k === 0 ? -0.08 : 0.08));
        cam.lookAt(them.x * 0.8, 1.32, them.z);
        if (Math.abs(P.kickX) + Math.abs(P.kickY) > 1e-4) { cam.rotateY(P.kickX); cam.rotateX(P.kickY); }
        const kd = Math.exp(-9 * dt); P.kickX *= kd; P.kickY *= kd;
        cam.updateMatrixWorld(true);
      }
    }
    function placeAvatars(dt, gdt) {
      for (const P of V.players) {
        const f = P.avatar, side = P.k === 0 ? 1 : -1;     // camera right in world x: +1 for P1 (looks to -z)
        const target = P.dodgeT > 0 ? P.dodgeDir * 0.75 : 0;
        P.dodgeX += (target - P.dodgeX) * Math.min(1, dt * 12);
        f.root.position.x = P.dodgeX * side;
      }
      for (const P of V.players) {
        const f = P.avatar, O = V.players[1 - P.k].avatar;
        f.root.rotation.y = Math.atan2(O.root.position.x - f.root.position.x, O.root.position.z - f.root.position.z);
        if (P.blade && !f.dead) f.driveTarget.copy(P.blade.gripW);
        const R = rigs[P.k];
        if (R.shieldGrip && !f.dead && f.ikChainL && f.ikChainL.length === 2) {
          // reach toward the player's own shield, but never past a slightly bent arm
          if (!f.driveTargetL) f.driveTargetL = new T.Vector3();
          const [up, lo] = f.ikChainL;
          up.getWorldPosition(sa); lo.getWorldPosition(sb); f.ikEndL.getWorldPosition(sw);
          const reach = (sa.distanceTo(sb) + sb.distanceTo(sw)) * 0.85;
          R.shieldGrp.localToWorld(f.driveTargetL.copy(R.shieldGrip)).sub(sa);
          if (f.driveTargetL.length() > reach) f.driveTargetL.setLength(reach);
          f.driveTargetL.add(sa);
        }
        const want = P.stunT > 0 ? 'stagger' : 'idle';
        if (f.mode !== want) f.setAction(want);
        f.update(gdt);
        strapShield(P);
      }
    }
    /** The body's shield: turned like the player's own (raised or at rest), its grip on the body's left wrist. */
    const sq = new T.Quaternion(), sw = new T.Vector3(), sa = new T.Vector3(), sb = new T.Vector3();
    function strapShield(P) {
      const sh = P.bodyShield, R = rigs[P.k], f = P.avatar;
      if (!sh || !f || !f.ikEndL) return;
      R.shieldGrp.getWorldQuaternion(sq);
      // grip in the fist: a hand's width past the wrist, along the forearm
      f.ikEndL.getWorldPosition(sw); f.ikChainL[1].getWorldPosition(sb);
      sw.addScaledVector(sb.sub(sw).normalize(), -0.08);
      sh.quaternion.copy(sq);
      sh.position.copy(R.shieldGrip).applyQuaternion(sq).negate().add(sw);
    }

    /* -------------------------------------------------------------- fighting */
    function controls(P, dt) {
      const c = P.ctl, phone = isPhone(c);
      if (!c.isDown('a')) P.aLatch = false;
      const want = c.isDown('a') && !P.aLatch && P.stamina > 2 && P.stunT <= 0;
      if (want && !P.shieldUp) { P.shieldUp = true; P.shieldSince = V.gameMs; Sfx.play('step', { vol: 0.35 }); }
      if (!want) P.shieldUp = false;
      // sidestep: B / Vol Up tap steps away from their blade; Wand Left/Right pick the side
      P.dodgeCd -= dt;
      let dir = c.pressed('left') ? -1 : c.pressed('right') ? 1 : 0;
      if (!dir && c.pressed('b')) dir = P.oppSeg && P.oppSeg.t.x < 0 ? 1 : -1;
      if (dir && P.dodgeCd <= 0 && P.stamina >= C.DODGE_COST * 0.5 && P.stunT <= 0) {
        spend(P, C.DODGE_COST); P.dodgeT = 0.42; P.dodgeDir = dir; P.dodgeCd = 0.7;
        Sfx.play('swish', { vol: 0.5, rate: 0.7 }); Sfx.play('step', { vol: 0.5 });
      }
      // thrust: a jab of the phone (Wand 1 / Grip double-tap Vol Up / F as a backup)
      P.thrustCd -= dt;
      const jab = phone && (c.linearAccel.x * c.forward.x + c.linearAccel.y * c.forward.y + c.linearAccel.z * c.forward.z) > 16 && c.angularSpeed < 4;
      const key = c === mouseCtl && core.takeKeyThrust();
      if ((c.pressed('one') || jab || key) && P.thrustCd <= 0 && !P.shieldUp && P.stunT <= 0 && P.stamina >= C.THRUST_COST * 0.5) {
        spend(P, C.THRUST_COST); P.thrustT = 0.0001; P.thrustCd = 0.6; P.thrustHit = false;
        Sfx.play('swish', { vol: 0.45, rate: 1.3 });
      }
    }
    function defInfo(D) {
      return { arrivedMs: V.gameMs - D.movedAt, swinging: D.swing.active && D.stunT <= 0, swingPower: D.swing.active ? effPower(D) : 0,
        shieldMs: D.shieldUp ? V.gameMs - D.shieldSince : -1, stamina: D.stamina, overextended: D.overT > 0, stunned: D.stunT > 0 };
    }
    function effPower(P) { const sw = P.swing; return C.effectivePower(sw.power, { sinceLastMs: sw.startT - sw.prevEndT, chain: sw.chain, stamina: P.stamina }); }

    function attack(A, dt) {
      const D = V.players[1 - A.k], cam = cams[A.k], sw = A.swing;
      A.blade.h = toView(cam, A.blade.hiltW); A.blade.t = toView(cam, A.blade.tipW); A.blade.ok = A.blade.h.ok && A.blade.t.ok;
      // their blade as you see it
      A.oppSegPrev = A.oppSeg;
      const hs = toView(cam, D.blade.hiltW.clone().lerp(D.blade.tipW, 0.15)), ts = toView(cam, D.blade.tipW);
      A.oppSeg = hs.ok && ts.ok ? { h: hs, t: ts } : null;
      if (!A.blade.ok) return;
      const ev = C.swingStep(sw, { t: V.gameMs, speed: A.stunT > 0 ? 0 : A.angSpeed, tip: A.blade.t });
      if (ev === 'start') {
        A.swished = 0;
        A.swingTimes = A.swingTimes.filter(x => V.gameMs - x < 1500); A.swingTimes.push(V.gameMs);
        if (A.swingTimes.length >= 4) { A.overT = Math.max(A.overT, 0.6); popOnce(A, 'flail', 2.5, 'FLAILING - YOU ARE WIDE OPEN', 'bad', 'center'); }
      }
      if (sw.active && !A.swished && sw.power > 0.25) { A.swished = 1; Sfx.play('swish', { vol: 0.3 + 0.45 * Math.min(1, sw.power), rate: 0.9 + 0.3 * sw.power }); }
      if (ev === 'end' && sw.power > 0.05) {
        spend(A, C.swingCost(sw.power));
        if (!sw.hit && sw.power > 0.3) {
          spend(A, C.WHIFF_COST); A.overT = Math.max(A.overT, 0.45); A.stats.whiffs++;
          popOnce(A, 'whiff', 1.2, 'MISSED - YOU ARE OPEN', 'bad', 'center');
          popOnce(D, 'theymissed', 1.2, 'THEY MISSED - STRIKE', 'sub', 'center');
        }
      }
      if (sw.active && !sw.hit && A.stunT <= 0 && !A.shieldUp && A.prevBlade && A.prevBlade.h && V.state === 'fight') {
        const cut = (bl, k) => ({ x: bl.h.x + (bl.t.x - bl.h.x) * k, y: bl.h.y + (bl.t.y - bl.h.y) * k });
        const pb = A.prevBlade.h ? A.prevBlade : A.blade;
        const a0 = cut(pb, 0.3), b0 = pb.t, a1 = cut(A.blade, 0.3), b1 = A.blade.t;
        let best = null;
        for (const box of D.avatar.boxes()) {
          const r = rectOf(cam, box); if (!r.ok) continue;
          const hit = C.screenSweepHits(a0, b0, a1, b1, r);
          if (hit.hit && (!best || hit.f < best.f - 1e-6)) best = Object.assign(hit, { zone: box.name, center: box.center });
        }
        let clash = null;
        if (A.oppSeg && A.oppSegPrev) {
          const c = C.bladesCross(a0, b0, a1, b1, A.oppSegPrev.h, A.oppSegPrev.t, A.oppSeg.h, A.oppSeg.t, 0.025);
          if (c.hit && (!best || c.f <= best.f + 0.05)) clash = c;
        }
        const motion = { x: b1.x - b0.x, y: b1.y - b0.y };
        const from = C.cutFrom(C.dirName(Math.hypot(motion.x, motion.y) > 1e-4 ? motion : sw.motion));
        const bd = { x: b1.x - a1.x, y: b1.y - a1.y }, bl = Math.hypot(bd.x, bd.y) || 1, ml = Math.hypot(motion.x, motion.y);
        const align = ml > 1e-4 ? Math.abs(bd.x * motion.y - bd.y * motion.x) / (bl * ml) : 1;
        if (clash) { sw.hit = true; exchange(A, D, { contact: 'blade', power: effPower(A), from, zone: 'torso', align: 1, point: clash.point, motion }); }
        else if (best) {
          sw.hit = true;
          if (D.dodgeT > 0) { pop(A.k, 'DODGED', 'sub', best.point); Sfx.play('swish', { vol: 0.5, rate: 0.8 }); }
          else exchange(A, D, { contact: D.shieldUp ? 'shield' : 'body', power: effPower(A), from, zone: best.zone, align, point: best.point, motion, center: best.center });
        }
      }
      // thrust at full extension
      if (A.thrustT > 0.1 && !A.thrustHit && V.state === 'fight') {
        A.thrustHit = true;
        let landed = false;
        for (const box of D.avatar.boxes()) {
          const r = rectOf(cam, box); if (!r.ok) continue;
          if (Math.abs(A.blade.t.x - r.cx) <= r.hw * 1.3 + 0.05 && Math.abs(A.blade.t.y - r.cy) <= r.hh * 1.1 + 0.05) {
            if (D.dodgeT > 0) { pop(A.k, 'DODGED', 'sub', A.blade.t); landed = true; break; }
            exchange(A, D, { contact: D.shieldUp ? 'shield' : 'body', power: C.effectivePower(0.45, { stamina: A.stamina }), from: 'thrust', zone: box.name, align: 1, point: A.blade.t, motion: { x: 0, y: 0.01 }, center: box.center });
            landed = true; break;
          }
        }
        if (!landed) { A.overT = Math.max(A.overT, 0.35); popOnce(A, 'whiff', 1.2, 'THRUST MISSED', 'sub', 'center'); }
      }
    }
    function popOnce(P, key, gap, text, cls, at) {
      P.lastPop = P.lastPop || {};
      if (V.realT - (P.lastPop[key] || -99) < gap) return;
      P.lastPop[key] = V.realT; pop(P.k, text, cls, at);
    }

    /** A's cut (or thrust) reached D: blade, shield or body. Same rules as the ladder (combat.pvpExchange). */
    function exchange(A, D, c) {
      const cam = cams[A.k], fx = core.fx();
      const r = C.pvpExchange({ power: c.power, from: c.from, zone: c.zone, align: c.align, contact: c.contact, def: defInfo(D) });
      V.log.push({ t: Math.round(V.gameMs), a: A.k, contact: c.contact, result: r.result, dmg: r.damage, power: +c.power.toFixed(2) });
      const at = viewToWorld(cam, c.point, c.contact === 'blade' ? D.blade.tipW : (c.center || D.avatar.root.position.clone().setY(1.2)));
      const mlen = Math.hypot(c.motion.x, c.motion.y) || 1;
      const motionW = new T.Vector3(c.motion.x, c.motion.y, 0).applyQuaternion(cam.quaternion).normalize();
      const bounce = (P, s) => { P.deflectYaw += (c.motion.x / mlen) * s * (P === A ? 1 : -1); P.deflectPitch += -(c.motion.y / mlen) * s * 0.8 * (P === A ? 1 : -1); };
      const clashFx = s => { fx.clash(at, s, motionW.clone().negate()); core.flashLight(at, s); };
      if (r.defCost) spend(D, r.defCost);
      switch (r.result) {
        case 'hit': case 'guardbreak': {
          D.hp = Math.max(0, D.hp - r.damage); D.stats.taken += r.damage;
          A.stats.hits++; A.stats.best = Math.max(A.stats.best, r.damage);
          D.vignette = 1; D.shake = 0.2;
          const sx = c.motion.x > 0 ? 1 : -1;
          D.kickX += -0.06 * sx * (D.k === A.k ? 1 : -1); D.kickY += 0.03;
          if (r.result === 'guardbreak') {
            D.stunT = r.stunDef / 1000; D.knock = 1; D.overT = Math.max(D.overT, 0.5);
            Sfx.play('clash', { vol: 1, rate: 0.85 }); Sfx.ring(0.8, false); Sfx.thump(1); clashFx(0.8);
            pop(A.k, 'GUARD BROKEN!', 'big', 'high'); pop(D.k, c.contact === 'shield' ? 'SHIELD SMASHED' : 'HEAVY CUT - GUARD BROKEN', 'bad', 'high');
          } else {
            fx.bleed(at, Math.min(1, c.power), motionW);
            Sfx.play('flesh', { vol: 0.6 + 0.4 * Math.min(1, c.power) }); Sfx.play('grunt', { vol: 0.8, rate: 0.8 + 0.2 * D.k });
            Sfx.thump(0.5 + 0.4 * Math.min(1, c.power));
            V.freezeT = 0.04 + 0.08 * Math.min(1, c.power);
            if (r.counter) { pop(A.k, 'COUNTER!', 'big', 'high'); pop(D.k, 'COUNTERED MID-SWING', 'bad', 'high'); }
            else if (c.zone === 'head' && c.power > 0.4) pop(A.k, 'HEAD!', 'mid', 'high');
            else if (c.align < 0.55) popOnce(A, 'edge', 1.5, 'POOR EDGE - CUT ACROSS', 'sub', 'center');
            else if (c.power < 0.35 && A.swing.startT - A.swing.prevEndT < C.SWING.rushMs) popOnce(A, 'rushed', 1.5, 'RUSHED - CHAMBER YOUR CUTS', 'sub', 'center');
          }
          D.avatar.hitReact(c.motion.x > 0 ? 'right' : 'left', r.result === 'guardbreak' || c.power > 0.9);
          pop(A.k, String(r.damage), 'dmg', c.point);
          pop(D.k, '-' + r.damage, 'bad', c.motion.x > 0 ? { x: -0.5, y: 0.1 } : { x: 0.5, y: 0.1 });
          rumble(A, 0.45 + 0.4 * Math.min(1, c.power), 45, 0); rumble(D, 1, 220, 1);
          V.excite = Math.min(1.4, V.excite + 0.15 + 0.2 * c.power);
          if (c.power > 0.8 || r.counter) Sfx.play('shout', { vol: 0.5, delay: 0.1 });
          break;
        }
        case 'glance':
          popOnce(A, 'glance', 0.8, c.align < 0.25 ? 'FLAT - NO EDGE' : 'TOO SOFT', 'sub', c.point);
          Sfx.play('blade', { vol: 0.25, rate: 1.3 });
          break;
        case 'block':
          D.stats.blocks++;
          bounce(A, 0.18 + 0.3 * Math.min(1, c.power)); bounce(D, 0.12);
          if (c.contact === 'shield') Sfx.play('shield', { vol: 1 }); else { Sfx.play('clash', { vol: 0.9 }); Sfx.ring(0.6, false); }
          clashFx(0.6); rumble(A, 0.6, 50, 0); rumble(D, 0.75, 60, 0);
          D.kickX += 0.02 * Math.sign(c.motion.x || 1); D.shake = 0.06;
          popOnce(A, 'blocked', 0.9, c.contact === 'shield' ? 'ON THE SHIELD' : 'ON THE BLADE - CUT AROUND IT', 'sub', c.point);
          pop(D.k, 'BLOCK', 'mid', 'high');
          if (D.stamina < 25) popOnce(D, 'lowguard', 2, 'YOUR GUARD IS TIRING', 'sub', 'center');
          break;
        case 'parry':
          D.stats.parries++;
          A.stunT = r.stunAtk / 1000; A.overT = Math.max(A.overT, r.stunAtk / 1000); bounce(A, 0.5);
          if (c.contact === 'shield') Sfx.play('shield', { vol: 1 }); else Sfx.play('clash', { vol: 1 });
          Sfx.ring(1, true); clashFx(1); rumble(D, 1, 140, 3); rumble(A, 1, 120, 1);
          V.slowT = 0.35; V.timeScale = 0.3; V.excite = Math.min(1.4, V.excite + 0.45);
          Sfx.play('shout', { vol: 0.55, delay: 0.1 });
          pop(D.k, 'PARRY!', 'big', 'high'); pop(D.k, 'THEY ARE OPEN - STRIKE', 'sub', 'center');
          pop(A.k, 'PARRIED!', 'bad', 'high'); pop(A.k, c.contact === 'shield' ? 'SHIELD RAISED IN TIME' : 'THEIR BLADE MET YOURS', 'sub', 'center');
          break;
        case 'beat': case 'beaten': {
          const W = r.result === 'beat' ? A : D, L = r.result === 'beat' ? D : A;
          W.stats.beats++;
          L.stunT = (r.stunDef || r.stunAtk) / 1000; L.overT = Math.max(L.overT, L.stunT);
          bounce(L, 0.55); bounce(W, 0.15);
          Sfx.play('clash', { vol: 1 }); Sfx.ring(1, true); clashFx(1);
          rumble(W, 1, 140, 3); rumble(L, 1, 120, 1);
          V.freezeT = 0.08; V.excite = Math.min(1.4, V.excite + 0.4);
          pop(W.k, 'BEAT ASIDE!', 'big', 'high'); pop(W.k, 'OPEN - STRIKE', 'sub', 'center');
          pop(L.k, 'BEATEN ASIDE', 'bad', 'high'); pop(L.k, 'THEIR CUT WAS HARDER', 'sub', 'center');
          break;
        }
        default: // clash
          bounce(A, 0.3); bounce(D, 0.3);
          Sfx.play('clash', { vol: 0.9 }); Sfx.ring(0.6, false); clashFx(0.7);
          rumble(A, 0.7, 60, 0); rumble(D, 0.7, 60, 0);
          pop(A.k, 'CLASH', 'mid', c.point); pop(D.k, 'CLASH', 'mid', 'high');
      }
      D.swing.hit = D.swing.hit || r.result === 'clash' || r.result === 'beat' || r.result === 'beaten';
    }

    /* ------------------------------------------------------------- frame */
    function frame(realDt, paused) {
      V.realT = (V.realT || 0) + realDt;
      if (V.state === 'lobby') { lobbyFrame(realDt); return 'menu'; }
      if (V.state === 'off') return 'off';
      for (const c of ctls) if (c !== core.mc) c.update();
      mouseCtl.update();
      if (V.slowT > 0) { V.slowT -= realDt; if (V.slowT <= 0) V.timeScale = 1; }
      let dt = realDt * V.timeScale;
      if (V.freezeT > 0) { V.freezeT -= realDt; dt = 0; }
      if (paused || V.state === 'results') dt = 0;
      V.gameMs += dt * 1000;
      const P = V.players;
      if (!paused && V.state !== 'results') {
        // a phone that drops out pauses the match; any player can pause
        for (const p of P) {
          const c = p.ctl;
          if (c !== mouseCtl && !isPhone(c)) { core.pause('P' + (p.k + 1) + ' (' + p.team.name + ') phone disconnected. Reconnect it to carry on.'); return 'paused'; }
          if (c.pressed('plus') || c.pressed('home')) { core.pause(); return 'paused'; }
          if (isPhone(c) && c.isDown('a') && c.pitch < -1.15) { p.yieldT += realDt; if (p.yieldT > 1.2) { p.yieldT = 0; core.pause(); return 'paused'; } }
          else p.yieldT = 0;
          if (c.pressed('center')) pop(p.k, 'ALIGNED', 'sub', 'low');
        }
      }
      for (const p of P) poseBlade(p, realDt);
      if (V.state === 'intro' && !paused) {
        V.introT += realDt;
        if (V.introT > 1.6 && V.introT - realDt <= 1.6) { bigCall('FIGHT!', 'big'); Sfx.play('cheer', { vol: 0.7 }); }
        if (V.introT > 1.6) V.state = 'fight';
      }
      if (V.state === 'fight' && dt > 0) {
        V.roundT += dt;
        for (const p of P) controls(p, dt);
        for (const p of P) attack(p, dt);
        for (const p of P) {
          p.sinceSpend += dt;
          p.stamina = C.staminaStep(p.stamina, dt, { sinceSpend: p.sinceSpend, shieldUp: p.shieldUp });
          if (p.shieldUp) p.sinceSpend = 0;
          p.overT = Math.max(0, p.overT - dt); p.stunT = Math.max(0, p.stunT - dt); p.dodgeT = Math.max(0, p.dodgeT - dt);
          p.knock = Math.max(0, p.knock - dt * 2.5);
          if (p.thrustT > 0) { p.thrustT += dt; if (p.thrustT > 0.28) p.thrustT = 0; }
        }
        const w = C.pvpRoundWinner(P[0].hp, P[1].hp, V.roundT * 1000 >= C.PVP.roundMs);
        if (w !== null) endRound(w);
      } else if (V.state === 'intro') {
        for (const p of P) { p.blade.h = toView(cams[p.k], p.blade.hiltW); p.blade.t = toView(cams[p.k], p.blade.tipW); }
      }
      if (V.state === 'roundEnd') {
        V.endT += realDt;
        if (V.endT > 3.2) { if (V.matchWinner >= 0) showResults(); else { V.round++; startRound(); } }
      }
      placeAvatars(realDt, dt);
      placeCameras(realDt);
      V.excite += (0.4 - V.excite) * Math.min(1, realDt * 0.35);
      Sfx.crowd(V.excite);
      core.fx().update(dt);
      LudusWorld.update(core.world(), V.realT, Math.min(1, V.excite));
      if (V.state !== 'results') updateHud();
      return V.state === 'results' ? 'menu' : 'play';
    }

    /* ---------------------------------------------------------------- render */
    function render() {
      const Wd = innerWidth, Hd = innerHeight, half = Math.floor(Wd / 2);
      renderer.shadowMap.needsUpdate = true;
      renderer.setScissorTest(true);
      for (let k = 0; k < 2; k++) {
        const cam = cams[k];
        if (Math.abs(cam.aspect - half / Hd) > 1e-3) { cam.aspect = half / Hd; cam.updateProjectionMatrix(); }
        renderer.setViewport(k * half, 0, half, Hd); renderer.setScissor(k * half, 0, half, Hd);
        renderer.render(scene, cam);
      }
      renderer.setScissorTest(false);
      drawOverlay();
    }
    let overlayDrawn = true;
    function drawOverlay() {
      const g = core.og;
      // the overlay is empty most frames: clear the full-screen canvas only when something was on it
      const want = (V.state === 'fight' || V.state === 'intro') && V.players.some(P => P.stunT > 0 || P.overT > 0 || P.shieldUp || P.yieldT > 0.25);
      if (overlayDrawn) g.clearRect(0, 0, innerWidth, innerHeight);
      overlayDrawn = want;
      if (!want) return;
      for (const A of V.players) {
        const D = V.players[1 - A.k], cam = cams[A.k];
        const body = rectOf(cam, D.avatar.boxes()[1]);
        if (!body.ok) continue;
        const c = halfPx(A.k, cam, { x: body.cx, y: body.cy }), hh = body.hh * innerHeight / 2;
        g.textAlign = 'center'; g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 6;
        if (D.stunT > 0 || D.overT > 0) {
          g.font = '700 22px Georgia, serif';
          g.fillStyle = D.stunT > 0 ? 'rgba(255,215,110,0.95)' : 'rgba(244,234,214,0.8)';
          g.fillText(D.stunT > 0 ? 'OPEN!' : 'off balance', c.x, c.y - hh - 26);
        } else if (D.shieldUp) {
          g.font = '600 13px Segoe UI, sans-serif'; g.fillStyle = 'rgba(244,234,214,0.85)';
          g.fillText('SHIELD UP - A HEAVY CUT BREAKS IT', c.x, c.y - hh - 26);
        }
        if (A.yieldT > 0.25) {
          const x = (A.k + 0.5) * innerWidth / 2, y = innerHeight * 0.55, f = Math.min(1, A.yieldT / 1.2);
          g.lineWidth = 6; g.strokeStyle = 'rgba(230,192,102,0.95)';
          g.beginPath(); g.arc(x, y, 34, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); g.stroke();
          g.font = '600 14px Segoe UI, sans-serif'; g.fillStyle = 'rgba(244,234,214,0.95)'; g.fillText('PAUSING...', x, y + 58);
        }
        g.shadowBlur = 0;
      }
    }

    /* ------------------------------------------------------------------ HUD */
    const cache = {};
    function setW(el, key, v) { const k = Math.round(v * 1000) / 10; if (cache[key] !== k) { cache[key] = k; el.style.width = k + '%'; } }
    function updateHud(force) {
      if (force) for (const k in cache) delete cache[k];
      V.players.forEach((P, k) => {
        const root = $('vs-p' + k);
        setW(root.querySelector('.hp i'), 'hp' + k, P.hp / C.PVP.hp); setW(root.querySelector('.hp b'), 'hpb' + k, P.hp / C.PVP.hp);
        setW(root.querySelector('.st i'), 'st' + k, P.stamina / C.STAMINA_MAX);
        root.querySelector('.st').classList.toggle('low', P.stamina < C.TIRED);
        const num = Math.ceil(P.hp);
        if (cache['n' + k] !== num) { cache['n' + k] = num; root.querySelector('.hp-num').textContent = num; }
        const wins = P.wins + '/' + C.PVP.rounds;
        if (cache['w' + k] !== wins) { cache['w' + k] = wins; root.querySelectorAll('.pips i').forEach((el, i) => el.classList.toggle('on', i < P.wins)); }
        const v = $('vs-vig' + k); P.vignette = Math.max(0, P.vignette - 0.016 * 1.6);
        v.style.opacity = Math.max(P.vignette, P.hp < 30 && V.state === 'fight' ? 0.3 + 0.1 * Math.sin(V.realT * 4) : 0);
      });
      const left = Math.max(0, Math.ceil((C.PVP.roundMs / 1000) - V.roundT));
      const clock = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      if (cache.clock !== clock) { cache.clock = clock; $('vs-time').textContent = clock; }
      const rt = V.round === 3 ? 'FINAL ROUND' : 'ROUND ' + V.round;
      if (cache.round !== rt) { cache.round = rt; $('vs-round').textContent = rt; }
      $('vs-time').classList.toggle('low', left <= 10 && V.state === 'fight');
    }

    return { enter, frame, render, exit, rematch, toggleMouse, others: () => (V.players || []).map(p => p && p.ctl).filter(c => c && c !== core.mc && isPhone(c)), go: () => { if (V.joined[0] && V.joined[1]) startMatch(); }, get state() { return V.state; }, V, cams };
  }

  window.LudusVersus = { create };
})();
