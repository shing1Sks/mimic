/*
 * Iron Ludus - VERSUS: two phones, one PC, one arena. Best of three rounds.
 *
 * Split screen, first person, side by side. Each phone keeps its 1:1 sword: a real 3D blade in one
 * shared arena, so what one player sees as "their blade met mine" is the same geometry on both
 * screens. Each player sees the other's body (the ladder's rigged gladiators) with its sword arm
 * reaching for the other's real hilt. A side-on shared camera would have to remap each phone's
 * rotation into a profile view (mirrored for one of the two) and show the blades edge-on.
 *
 * The rules are the ladder's, for both: blades are swept against each other and against bodies
 * every frame; a blade that beats into the other (much faster toward it) throws it aside, equal
 * blades clash; a cut's damage is its speed and edge at contact, by where it lands; arm and leg
 * wounds weaken cuts and shorten the lunge. No buttons fight: CENTRE lines up, + / Home pauses.
 *
 * Classic script: defines window.LudusVersus.create(core); game.js owns the renderer and the loop.
 */
(function () {
  'use strict';
  const T = THREE, C = LudusCombat;
  const DIST = 1.5;
  const TEAM = [
    { name: 'RED', css: '#e0503c', color: 0xb42a1e, model: 'champion', tint: 0x8a1c14 },
    { name: 'BLUE', css: '#4a9cf0', color: 0x2a64c8, model: 'axeman', tint: 0x1d3f8a },
  ];
  const HOLD_START = 0.9; // s of holding A / Vol Down to start the match
  const ZONE_WORD = { head: 'HEAD', torso: 'BODY', swordArm: 'SWORD ARM', offArm: 'OFF ARM', legs: 'LEG' };

  function create(core) {
    const { scene, renderer, Sfx, $ } = core;
    const pv = new T.Vector3();
    let ctls = null, mouseCtl = null;
    const V = { state: 'off', players: [null, null], joined: [null, null], holdT: 0, round: 1, roundT: 0, introT: 0, endT: 0,
      slowT: 0, timeScale: 1, freezeT: 0, gameMs: 0, excite: 0.4, matchWinner: -1, log: [] };

    /* ------------------------------------------------------------ controllers */
    function makeCtl(slot) { return new MimicController({ slot }); }
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
      if (gripA() !== V.gripA) renderLobby();
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
    // a half screen is narrow: a slightly wider view than the ladder's
    const cams = [0, 1].map(() => new T.PerspectiveCamera(74, 1, 0.03, 500));
    let rigs = null;
    function setupRigs() {
      if (rigs) return;
      rigs = [0, 1].map(k => {
        scene.add(cams[k]);
        const B = core.makeBody(scene);
        B.body.position.set(0, 0, k === 0 ? DIST / 2 : -DIST / 2);
        B.body.rotation.y = k === 0 ? 0 : Math.PI;
        const R = core.makeRig(B.head, TEAM[k].tint);
        // your own arm and fist are for your eyes only; the other player sees your body holding the sword
        for (const m of R.armParts) m.traverse(o => o.layers.set(3 + k));
        return { B, R };
      });
      cams.forEach((c, k) => { c.layers.enable(3 + k); c.layers.enable(1 + (1 - k)); });
    }
    function freshPlayer(k, ctl) {
      const { B, R } = rigs[k];
      const hand = core.makeSwordHand(ctl, R, B, 'right');
      return { k, ctl, team: TEAM[k], hp: C.PVP.hp, wounds: C.woundState(), swing: C.swingTracker(), hand, B, R, stunT: 0,
        kickX: 0, kickY: 0, shake: 0, vignette: 0, wins: 0, yieldT: 0, swingHit: -1, hitT: -9, capsPrev: null, freezeT: 0,
        stats: { hits: 0, parries: 0, clashes: 0, best: 0, fastest: 0, taken: 0, whiffs: 0 } };
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
      core.rec('vs-start', {});
      startRound();
    }
    function spawnAvatar(k) {
      const P = V.players[k];
      if (P.avatar) { P.avatar.remove(); scene.remove(P.avatar.root); }
      const prof = { id: 'p' + k, name: TEAM[k].name, model: TEAM[k].model, weapon: 'sword', height: 1.85, hp: 100 };
      const f = new LudusFighters.Fighter(prof, core.assets.models[prof.model], core.assets);
      f.model.traverse(o => { if (o.isMesh) o.layers.set(1 + k); });
      const ring = new T.Mesh(new T.RingGeometry(0.44, 0.52, 48), new T.MeshBasicMaterial({ color: TEAM[k].color, transparent: true, opacity: 0.7, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.layers.set(1 + k); f.root.add(ring);
      scene.add(f.root);
      f.drive(new T.Vector3());
      P.avatar = f;
    }
    function startRound() {
      for (const P of V.players) {
        Object.assign(P, { hp: C.PVP.hp, wounds: C.woundState(), stunT: 0, swing: C.swingTracker(), swingHit: -1, capsPrev: null });
        P.hand.lungeMul = 1; P.hand.knock = 0;
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
      core.rec('vs-round', { winner, hp: V.players.map(p => p.hp) });
      updateHud(true);
    }
    function showResults() {
      V.state = 'results';
      $('vs-hud').classList.add('hidden');
      const w = V.matchWinner, P = V.players;
      const rows = [['ROUNDS', p => p.wins], ['HITS', p => p.stats.hits], ['BEST HIT', p => p.stats.best], ['FASTEST CUT', p => p.stats.fastest + ' m/s'],
        ['BEAT ASIDE', p => p.stats.parries], ['CLASHES', p => p.stats.clashes], ['MISSED SWINGS', p => p.stats.whiffs], ['DAMAGE TAKEN', p => p.stats.taken]];
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
      for (const P of V.players) if (P && P.avatar) { P.avatar.remove(); scene.remove(P.avatar.root); P.avatar = null; }
      if (rigs) for (const r of rigs) scene.remove(r.B.body);
      for (const c of cams) scene.remove(c);
      rigs = null;
      $('vs-hud').classList.add('hidden');
      renderer.shadowMap.autoUpdate = true;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, innerWidth, innerHeight);
    }
    function rematch() { V.players.forEach(P => { P.wins = 0; P.stats = { hits: 0, parries: 0, clashes: 0, best: 0, fastest: 0, taken: 0, whiffs: 0 }; }); V.matchWinner = -1; V.round = 1; core.hideScreens(); $('vs-hud').classList.remove('hidden'); startRound(); }

    /* ------------------------------------------------------------ helpers */
    function rumble(P, s, ms, pat) { try { P.ctl.rumble(s, ms, pat); } catch (e) { /* no rumble */ } }
    function halfPx(k, v) {
      const cam = cams[k]; pv.copy(v).project(cam);
      if (pv.z > 1) return null;
      const w = innerWidth / 2; return { x: k * w + (pv.x + 1) / 2 * w, y: (1 - pv.y) / 2 * innerHeight };
    }
    /** A message in one player's half. at: world point, or 'high' / 'center' / 'low'. */
    function pop(k, text, cls, at) {
      let p = at && at.isVector3 ? halfPx(k, at) : null;
      if (!p) p = { x: (k + 0.5) * innerWidth / 2, y: innerHeight * (at === 'high' ? 0.27 : at === 'low' ? 0.66 : 0.42) };
      core.popAt(text, cls, Math.max(k * innerWidth / 2 + 80, Math.min((k + 1) * innerWidth / 2 - 80, p.x)), p.y);
    }
    function popOnce(P, key, gap, text, cls, at) {
      P.lastPop = P.lastPop || {};
      if (V.realT - (P.lastPop[key] || -99) < gap) return;
      P.lastPop[key] = V.realT; pop(P.k, text, cls, at);
    }
    function bigCall(text, cls, k) { core.popAt(text, (cls || 'big') + ' vs-call' + (k === 0 || k === 1 ? ' t' + k : ''), innerWidth / 2, innerHeight * 0.36); }

    /* ------------------------------------------------------------- bodies */
    function placeBodies(dt) {
      for (const P of V.players) {
        const k = P.k, base = k === 0 ? DIST / 2 : -DIST / 2, fwd = k === 0 ? -1 : 1;
        P.B.body.position.set(0, 0, base + fwd * P.hand.ext * 0.55);
        P.B.body.updateMatrixWorld(true);
      }
    }
    function placeCameras(dt) {
      for (const P of V.players) {
        const O = V.players[1 - P.k], cam = cams[P.k];
        const eye = LudusArm.cameraAt(P.B, pv);
        const sx = P.shake > 0 ? (Math.random() - 0.5) * P.shake * 0.3 : 0, sy = P.shake > 0 ? (Math.random() - 0.5) * P.shake * 0.3 : 0;
        P.shake = Math.max(0, P.shake - dt * 0.8);
        cam.position.set(eye.x + sx, eye.y + sy, eye.z);
        const them = O.B.body.position;
        cam.lookAt(them.x * 0.5, 1.26, them.z + (P.k === 0 ? -0.6 : 0.6));
        if (Math.abs(P.kickX) + Math.abs(P.kickY) > 1e-4) { cam.rotateY(P.kickX); cam.rotateX(P.kickY); }
        const kd = Math.exp(-9 * dt); P.kickX *= kd; P.kickY *= kd;
        cam.updateMatrixWorld(true);
      }
    }
    function placeAvatars(gdt) {
      for (const P of V.players) {
        const f = P.avatar, O = V.players[1 - P.k];
        f.root.position.copy(P.B.body.position);
        f.root.rotation.y = Math.atan2(O.B.body.position.x - f.root.position.x, O.B.body.position.z - f.root.position.z);
        if (P.hand.blade && !f.dead) f.driveTarget.copy(P.hand.blade.h).lerp(P.hand.blade.t, -0.12);
        const want = P.stunT > 0 ? 'stagger' : 'idle';
        if (f.mode !== want) f.setAction(want);
        f.update(gdt, null);
      }
    }

    /* -------------------------------------------------------------- fighting */
    const segAt = (path, f) => {
      const n = path.length - 1, x = Math.max(0, Math.min(n, f * n)), i = Math.min(n - 1, Math.floor(x)), t = x - i;
      if (n <= 0) return path[0];
      return { h: path[i].h.clone().lerp(path[i + 1].h, t), t: path[i].t.clone().lerp(path[i + 1].t, t) };
    };
    const capsL = (A, B, f) => B.map((c, i) => { const a = A[i] || c; return { zone: c.zone, a: a.a.clone().lerp(c.a, f), b: a.b.clone().lerp(c.b, f), r: c.r, bone: c.bone }; });
    /** Both blades this frame, in time order: blade on blade first, then each blade on the other's body. */
    function fight(dt) {
      const [A, B] = V.players;
      const capsA = A.avatar.capsules(), capsB = B.avatar.capsules();
      const prevA = A.capsPrev || capsA, prevB = B.capsPrev || capsB;
      A.capsPrev = capsA; B.capsPrev = capsB;
      const n = Math.max(A.hand.path.length, B.hand.path.length) - 1, sub = dt / Math.max(1, n);
      let bladeDone = V.realT - (V.lastMeet || -9) < 0.2;
      for (let k = 1; k <= n; k++) {
        const f0 = (k - 1) / n, f1 = k / n;
        const A0 = segAt(A.hand.path, f0), A1 = segAt(A.hand.path, f1), B0 = segAt(B.hand.path, f0), B1 = segAt(B.hand.path, f1);
        if (!bladeDone) {
          const m = C.sweepSegSeg(A0, A1, B0, B1, 0.028);
          if (m) { bladeDone = true; meet(A, B, m, A0, A1, B0, B1, sub); continue; }
        }
        for (const [X, Y, X0, X1, cp, cc] of [[A, B, A0, A1, prevB, capsB], [B, A, B0, B1, prevA, capsA]]) {
          if (X.stunT > 0) continue;
          if (X.swingHit === X.swing.id && (X.swing.active || V.realT - X.hitT < 0.35)) continue;
          const h = C.sweepBody(X0, X1, capsL(cp, cc, f0), capsL(cp, cc, f1), 0.012);
          if (h) cut(X, Y, h, X0, X1, sub);
        }
      }
    }
    /** Two blades met. */
    function meet(A, B, m, A0, A1, B0, B1, sub) {
      V.lastMeet = V.realT;
      const vA = C.pointVel(A0, A1, m.u, sub), vB = C.pointVel(B0, B1, m.w, sub);
      const n = m.normal; // from B toward A
      const intoA = -C.dot(vA, n), intoB = C.dot(vB, n);
      const r = C.bladeMeet({ into: intoA, u: m.u }, { into: intoB, u: m.w });
      const at = new T.Vector3(m.point.x, m.point.y, m.point.z);
      const s = Math.min(1, Math.max(C.len(vA), C.len(vB)) / 20);
      core.fx().clash(at, 0.4 + 0.6 * s, null); core.flashLight(at, 0.4 + 0.6 * s);
      Sfx.play('clash', { vol: 0.6 + 0.4 * s }); Sfx.ring(0.5 + 0.5 * s, r !== 'clash');
      core.rec('clash', { vs: true, result: r, intoA: Math.round(intoA * 10) / 10, intoB: Math.round(intoB * 10) / 10 });
      if (r === 'clash') {
        A.stats.clashes++; B.stats.clashes++;
        for (const P of [A, B]) { rumble(P, 0.6 + 0.4 * s, 60, 0); P.hand.knock = 0.25; P.hand.knockAxis.set(0, 0, 1); }
        V.freezeT = 0.05;
        pop(A.k, 'CLASH', 'mid', at); pop(B.k, 'CLASH', 'mid', at);
      } else {
        const Wn = r === 'aBeats' ? A : B, L = r === 'aBeats' ? B : A;
        Wn.stats.parries++;
        L.stunT = 0.45; L.hand.knock = 1; L.hand.knockAxis.set(Math.random() - 0.5, 0, 1).normalize();
        L.kickX += 0.03 * (Math.random() < 0.5 ? -1 : 1);
        rumble(Wn, 1, 140, 3); rumble(L, 1, 120, 1);
        V.slowT = 0.35; V.timeScale = 0.35; V.excite = Math.min(1.4, V.excite + 0.4);
        Sfx.play('shout', { vol: 0.5, delay: 0.1 });
        pop(Wn.k, 'BEAT ASIDE!', 'big', 'high'); pop(Wn.k, 'THEY ARE OPEN', 'sub', 'center');
        pop(L.k, 'BEATEN ASIDE', 'bad', 'high');
      }
    }
    /** X's blade landed on Y's body. */
    function cut(X, Y, h, X0, X1, sub) {
      const vel = C.pointVel(X0, X1, h.u, sub);
      const cls = C.classifyContact({ hilt: X1.h, tip: X1.t, vel, u: h.u, edge: X.hand.mouse ? null : X1.edge });
      const res = C.strikeDamage({ kind: cls.kind, speed: cls.speed, axial: cls.axial, edge01: cls.edge01, zone: h.zone, armor: 0,
        state: Y.stunT > 0 ? 'stagger' : 'idle', mul: C.woundMods(X.wounds).cut });
      if (res.result === 'touch') return;
      X.swingHit = X.swing.id; X.hitT = V.realT; X.swing.contact = 'body';
      const at = new T.Vector3(h.point.x, h.point.y, h.point.z), motion = new T.Vector3(vel.x, vel.y, vel.z).normalize();
      const dmg = res.damage, speed = Math.round(cls.kind === 'thrust' ? cls.axial : cls.speed);
      Y.hp = Math.max(0, Y.hp - dmg); Y.stats.taken += dmg;
      X.stats.hits++; X.stats.best = Math.max(X.stats.best, dmg); X.stats.fastest = Math.max(X.stats.fastest, speed);
      const wfx = C.applyWound(Y.wounds, h.zone, dmg, {});
      Y.hand.lungeMul = C.woundMods(Y.wounds).lunge;
      core.rec('hit', { vs: true, by: X.k, zone: h.zone, kind: cls.kind, speed: Math.round(cls.speed * 10) / 10, dmg });
      core.fx().bleed(at, Math.min(1, res.power), motion, 1 + Y.k);
      Y.avatar.addWound(at, motion, h.bone || (Y.avatar.capsules()[h.part] || {}).bone, false, res.power);
      Y.avatar.hitReact(motion.x > 0 ? 'right' : 'left', res.stagger);
      if (res.stagger) Y.stunT = Math.max(Y.stunT, 0.35);
      Y.vignette = 1; Y.shake = 0.2; Y.kickX += -0.05 * Math.sign(motion.x || 1); Y.kickY += 0.03;
      Sfx.play('flesh', { vol: 0.6 + 0.4 * Math.min(1, res.power) }); Sfx.play('grunt', { vol: 0.8, rate: 0.8 + 0.2 * Y.k }); Sfx.thump(0.4 + 0.5 * Math.min(1, res.power));
      V.freezeT = 0.035 + 0.07 * Math.min(1, res.power);
      rumble(X, 0.4 + 0.5 * Math.min(1, res.power), 50, 0);
      rumble(Y, 1, h.zone === 'head' ? 255 : 180, h.zone === 'legs' ? 2 : h.zone === 'swordArm' ? 3 : 1);
      V.excite = Math.min(1.4, V.excite + 0.12 + 0.2 * res.power);
      popOnce(X, 'zone', 0.4, (cls.kind === 'thrust' ? 'THRUST' : cls.kind === 'flat' ? 'FLAT' : 'EDGE') + ' · ' + ZONE_WORD[h.zone] + ' · ' + dmg + ' dmg', 'mid', 'high');
      pop(Y.k, '-' + dmg + '  ' + ZONE_WORD[h.zone], 'bad', 'center');
      if (dmg >= 28 || (h.zone === 'head' && dmg >= 20)) { Sfx.play('shout', { vol: 0.5, delay: 0.1 }); V.slowT = 0.35; V.timeScale = 0.35; }
      if (wfx.limp) popOnce(Y, 'limp', 2, 'LEG CUT: SHORTER LUNGE', 'sub', 'low');
      if (h.zone === 'swordArm' && Y.wounds.armLevel > 0) popOnce(Y, 'arm', 2, 'SWORD ARM CUT: WEAKER CUTS', 'sub', 'low');
    }
    function swings(P, dt) {
      const sw = P.swing, O = V.players[1 - P.k];
      const fwd = new T.Vector3(0, 0, P.k === 0 ? -1 : 1), right = new T.Vector3(P.k === 0 ? 1 : -1, 0, 0);
      const ev = C.swingStep(sw, { t: V.realT * 1000, vel: P.hand.tipVel, ang: P.hand.angSpeed, view: { x: right, y: new T.Vector3(0, 1, 0), z: fwd } });
      if (ev === 'start') P.swished = false;
      if (sw.active && !P.swished && sw.peak > 9) { P.swished = true; Sfx.play('swish', { vol: 0.3 + 0.45 * Math.min(1, sw.peak / 25), rate: 0.9 + 0.3 * Math.min(1, sw.peak / 25) }); }
      if (ev === 'end') {
        core.rec('swing', { vs: true, p: P.k, peak: Math.round(sw.peak * 10) / 10, line: sw.line, contact: sw.contact || null });
        if (!sw.contact && sw.peak > C.SWING.big) { P.stats.whiffs++; P.kickX += 0.02 * Math.sign(sw.dir.x || 1) * (P.k === 0 ? 1 : -1); }
      }
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
      const frozen = V.freezeT > 0;
      if (frozen) { V.freezeT -= realDt; dt = 0; }
      if (paused || V.state === 'results') dt = 0;
      V.gameMs += dt * 1000;
      const P = V.players;
      if (!paused && V.state !== 'results') {
        for (const p of P) {
          const c = p.ctl;
          if (c !== mouseCtl && !isPhone(c)) { core.pause('P' + (p.k + 1) + ' (' + p.team.name + ') phone disconnected. Reconnect it to carry on.'); return 'paused'; }
          if (c.pressed('plus') || c.pressed('home')) { core.pause(); return 'paused'; }
          if (isPhone(c) && c.isDown('a') && c.pitch < -1.15) { p.yieldT += realDt; if (p.yieldT > 1.2) { p.yieldT = 0; core.pause(); return 'paused'; } }
          else p.yieldT = 0;
          if (c.pressed('center')) pop(p.k, 'ALIGNED', 'sub', 'low');
        }
      }
      placeBodies(realDt);
      const fighting = V.state === 'fight' && !paused;
      for (const p of P) {
        core.updateSwordHand(p.hand, paused ? 0 : realDt, { fight: fighting, freeze: frozen, keyLunge: fighting && p.ctl === mouseCtl && core.takeKeyLunge() });
        core.poseRig(p.R, cams[p.k], p.hand.q, p.hand.arm, { ext: p.hand.ext, dt: realDt });
      }
      if (V.state === 'intro' && !paused) {
        V.introT += realDt;
        if (V.introT > 1.6 && V.introT - realDt <= 1.6) { bigCall('FIGHT!', 'big'); Sfx.play('cheer', { vol: 0.7 }); }
        if (V.introT > 1.6) V.state = 'fight';
      }
      placeAvatars(dt);
      if (fighting && realDt > 0) {
        V.roundT += dt;
        for (const p of P) swings(p, realDt);
        fight(realDt);
        for (const p of P) p.stunT = Math.max(0, p.stunT - dt);
        const w = C.pvpRoundWinner(P[0].hp, P[1].hp, V.roundT * 1000 >= C.PVP.roundMs);
        if (w !== null) endRound(w);
      }
      if (V.state === 'roundEnd') {
        V.endT += realDt;
        if (V.endT > 3.2) { if (V.matchWinner >= 0) showResults(); else { V.round++; startRound(); } }
      }
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
      const want = (V.state === 'fight' || V.state === 'intro') && V.players.some(P => P.stunT > 0 || P.yieldT > 0.25);
      if (overlayDrawn) g.clearRect(0, 0, innerWidth, innerHeight);
      overlayDrawn = want;
      if (!want) return;
      for (const A of V.players) {
        const D = V.players[1 - A.k];
        g.textAlign = 'center'; g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 6;
        if (D.stunT > 0) {
          const head = D.avatar.capsules().find(c => c.zone === 'head'), p = head && halfPx(A.k, head.b);
          if (p) { g.font = '700 22px Georgia, serif'; g.fillStyle = 'rgba(255,215,110,0.95)'; g.fillText('OPEN!', p.x, Math.max(110, p.y - 26)); }
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
    function woundLine(w) {
      const out = [];
      if (w.head >= 12) out.push('HEAD');
      if (w.armLevel) out.push('SWORD ARM ' + '|'.repeat(w.armLevel));
      if (w.legLevel) out.push('LEG ' + '|'.repeat(w.legLevel));
      return out.length ? 'WOUNDS: <b>' + out.join(' · ') + '</b>' : '';
    }
    function updateHud(force) {
      if (force) for (const k in cache) delete cache[k];
      V.players.forEach((P, k) => {
        const root = $('vs-p' + k);
        setW(root.querySelector('.hp i'), 'hp' + k, P.hp / C.PVP.hp); setW(root.querySelector('.hp b'), 'hpb' + k, P.hp / C.PVP.hp);
        const num = Math.ceil(P.hp);
        if (cache['n' + k] !== num) { cache['n' + k] = num; root.querySelector('.hp-num').textContent = num; }
        const wins = P.wins + '/' + C.PVP.rounds;
        if (cache['w' + k] !== wins) { cache['w' + k] = wins; root.querySelectorAll('.pips i').forEach((el, i) => el.classList.toggle('on', i < P.wins)); }
        const wl = woundLine(P.wounds);
        if (cache['wl' + k] !== wl) { cache['wl' + k] = wl; root.querySelector('.vs-w').innerHTML = wl; }
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
