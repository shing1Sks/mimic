/*
 * GYROWING cockpit: the inside of the aircraft for the cockpit view. A panel with live instruments
 * (six-pack, tachometer, engine and systems block, annunciators) drawn into a canvas texture by the
 * same gauge code as the HUD, a glareshield, windshield posts and roof, side walls, twin yokes that
 * follow the controls and a throttle knob. Body frame: forward -Z, up +Y, right +X.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const D2R = Math.PI / 180;
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const FONT = '"Bahnschrift", "DIN Alternate", "Segoe UI", system-ui, sans-serif';

  // eye point (left seat) and the panel plane
  const EYE = new THREE.Vector3(-0.27, 0.93, 0.08);
  const PANEL = { w: 1.1, h: 0.46, y: 0.47, z: -0.74, tilt: -0.2 };
  const CW = 1100, CH = 460;   // canvas px: 1 px = 1 mm

  function build(plane) {
    const group = plane.parts.cockpit;
    const dark = new THREE.MeshStandardMaterial({ color: lin('#26292d'), roughness: 0.85, metalness: 0.05 });
    const fabric = new THREE.MeshStandardMaterial({ color: lin('#3b3f44'), roughness: 0.95 });
    const frameMat = new THREE.MeshStandardMaterial({ color: lin('#8d9196'), roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: lin('#121315'), roughness: 0.4 });

    // ---- the panel face (live canvas)
    const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CH;
    const tex = new THREE.CanvasTexture(canvas); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8;
    const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.w, PANEL.h), faceMat);
    const panel = new THREE.Group();
    panel.position.set(0, PANEL.y, PANEL.z); panel.rotation.x = PANEL.tilt;
    panel.add(face);
    const backBox = new THREE.Mesh(new THREE.BoxGeometry(PANEL.w + 0.04, PANEL.h + 0.04, 0.12), dark); backBox.position.z = -0.065; panel.add(backBox);
    group.add(panel);
    // glareshield: a hood over the panel
    const glare = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.04, 0.3), black);
    glare.position.set(0, PANEL.y + PANEL.h / 2 + 0.01, PANEL.z - 0.19); glare.rotation.x = 0.1; group.add(glare);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.14, 8).rotateZ(Math.PI / 2), black);
    lip.position.set(0, PANEL.y + PANEL.h / 2 + 0.0, PANEL.z - 0.04); group.add(lip);
    // floor and a nose deck ahead of the glareshield so nothing reads as a hole
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9).rotateX(-Math.PI / 2 - 0.12), new THREE.MeshStandardMaterial({ color: lin('#e9e7e1'), roughness: 0.4 }));
    deck.position.set(0, PANEL.y + PANEL.h / 2 - 0.02, PANEL.z - 0.75); group.add(deck);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.8).rotateX(-Math.PI / 2), fabric); floor.position.set(0, 0.0, -0.2); group.add(floor);
    // lower panel / knee area
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.2), dark); lower.position.set(0, PANEL.y - PANEL.h / 2 - 0.1, PANEL.z + 0.02); group.add(lower);

    // ---- windshield frame: posts, centre strip, roof bow, door posts
    const post = (a, b, w, mat) => {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.7, len), mat || frameMat);
      m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b); group.add(m); return m;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    post(V(-0.56, 0.7, -0.95), V(-0.5, 1.26, -0.32), 0.045);
    post(V(0.56, 0.7, -0.95), V(0.5, 1.26, -0.32), 0.045);
    post(V(0, 0.72, -0.98), V(0, 1.28, -0.36), 0.025);
    post(V(-0.52, 1.27, -0.32), V(0.52, 1.27, -0.32), 0.07);
    post(V(-0.57, 0.62, 0.35), V(-0.52, 1.27, 0.3), 0.07);
    post(V(0.57, 0.62, 0.35), V(0.52, 1.27, 0.3), 0.07);
    post(V(-0.52, 1.28, -0.32), V(-0.52, 1.28, 0.6), 0.05);
    post(V(0.52, 1.28, -0.32), V(0.52, 1.28, 0.6), 0.05);
    // roof (headliner) and side walls below the windows
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.0).rotateX(Math.PI / 2), fabric); roof.position.set(0, 1.31, 0.15); group.add(roof);
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6).rotateY(-sx * Math.PI / 2), fabric);
      wall.position.set(sx * 0.585, 0.32, -0.1); group.add(wall);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 1.5), dark); sill.position.set(sx * 0.56, 0.63, -0.15); group.add(sill);
    }
    // a faint windshield tint so the glass reads as glass
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), new THREE.MeshBasicMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.05, depthWrite: false }));
    ws.position.set(0, 1.0, -0.66); ws.rotation.x = -0.83; group.add(ws);

    // ---- yokes and throttle
    const yokes = [-0.27, 0.27].map(x => {
      const y = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.035), black); y.add(bar);
      for (const sx of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.11, 8), black); h.position.set(0.14 * sx, 0.04, 0); y.add(h);
      }
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.04), dark); y.add(hub);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.24, 8).rotateX(Math.PI / 2), dark); shaft.position.z = -0.12; y.add(shaft);
      y.position.set(x, PANEL.y - 0.06, PANEL.z + 0.26);
      group.add(y); return y;
    });
    const thr = new THREE.Group();
    const thrRod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6).rotateX(Math.PI / 2), frameMat); thrRod.position.z = 0.05; thr.add(thrRod);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 12).rotateX(Math.PI / 2), black); knob.position.z = 0.12; thr.add(knob);
    thr.position.set(0, PANEL.y - PANEL.h / 2 + 0.06, PANEL.z + 0.04); group.add(thr);
    group.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });

    // ---- the gauges, drawn with the HUD's code into the panel canvas
    const g = new HUD(canvas);
    g.dpr = 1; g.s = 1.15; g.w = CW; g.h = CH;
    const ctx = canvas.getContext('2d');
    let drawT = 0;
    function bezelBg() {
      const grd = ctx.createLinearGradient(0, 0, 0, CH);
      grd.addColorStop(0, '#34383d'); grd.addColorStop(1, '#25282c');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      for (let i = 0; i < 60; i++) ctx.fillRect((i * 97) % CW, (i * 53) % CH, 2, 2);
      ctx.strokeStyle = '#1a1c1f'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, CW - 3, CH - 3);
    }
    function label(t, x, y, size, col) { ctx.font = '600 ' + size + 'px ' + FONT; ctx.fillStyle = col || '#c9d0d4'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y); }
    function tach(x, y, r, rpm) {
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.fillStyle = '#2a3036'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#0d1114'; ctx.fill();
      const A = v => (-225 + clamp(v, 0, 3500) / 3500 * 270) * D2R;
      ctx.lineWidth = 6; ctx.strokeStyle = '#3ddc84'; ctx.beginPath(); ctx.arc(x, y, r - 8, A(2100), A(2700)); ctx.stroke();
      ctx.strokeStyle = '#ff4d3d'; ctx.beginPath(); ctx.arc(x, y, r - 8, A(2700), A(2760)); ctx.stroke();
      ctx.strokeStyle = '#e8edf0'; ctx.lineWidth = 2;
      for (let v = 0; v <= 3500; v += 250) {
        const a = A(v), big = v % 500 === 0;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2)); ctx.lineTo(x + Math.cos(a) * (r - (big ? 16 : 10)), y + Math.sin(a) * (r - (big ? 16 : 10))); ctx.stroke();
        if (big && v % 1000 === 0) label(String(v / 100), x + Math.cos(a) * (r - 28), y + Math.sin(a) * (r - 28), 13);
      }
      label('RPM', x, y + r * 0.35, 10, '#8b979f'); label('x100', x, y + r * 0.52, 9, '#8b979f');
      const a = A(rpm);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * (r - 12), y + Math.sin(a) * (r - 12)); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#3a4248'; ctx.fill();
    }
    function turnCoord(x, y, r, rate, slip) {
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.fillStyle = '#2a3036'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#0d1114'; ctx.fill();
      label('TURN COORDINATOR', x, y - r * 0.55, 8, '#8b979f');
      ctx.strokeStyle = '#e8edf0'; ctx.lineWidth = 3;
      for (const s of [-1, 1]) { const a = s * 18 * D2R; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r - 4) * s, y + Math.sin(Math.abs(a)) * (r - 4)); ctx.lineTo(x + Math.cos(a) * (r - 16) * s, y + Math.sin(Math.abs(a)) * (r - 16)); ctx.stroke(); }
      label('L', x - r * 0.75, y + r * 0.55, 12); label('R', x + r * 0.75, y + r * 0.55, 12);
      const bank = clamp(rate / 3 * 18, -30, 30) * D2R;
      ctx.save(); ctx.translate(x, y); ctx.rotate(bank);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-r * 0.62, 0); ctx.lineTo(r * 0.62, 0); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.18); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#05080a'; ctx.fillRect(x - r * 0.5, y + r * 0.25, r, 14);
      const bx = x + clamp(-slip * 4, -1, 1) * r * 0.42;
      ctx.beginPath(); ctx.arc(bx, y + r * 0.25 + 7, 6, 0, Math.PI * 2); ctx.fillStyle = '#ddd'; ctx.fill();
    }
    function annunciator(x, y, w, h, text, on, col) {
      ctx.fillStyle = on ? col : '#1a1d20'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      label(text, x + w / 2, y + h / 2 + 1, 12, on ? '#111' : '#4b545b');
    }

    function draw(d) {
      bezelBg();
      const r = 62, cx = 262, top = 130, bot = 320, dx = 146;
      g.asi(cx - dx, top, r, d.ias); g.attitude(cx, top, r, d.pitch, d.bank, d.slip); g.altimeter(cx + dx, top, r, d.altFt, 99999);
      turnCoord(cx - dx, bot, r, d.turnRate, d.slip); g.heading(cx, bot, r, d.hdg, d.bug); g.vsi(cx + dx, bot, r, d.vsFpm);
      tach(575, top, 56, d.rpm);
      // radio stack (decor) and the systems block
      ctx.fillStyle = '#101214'; ctx.fillRect(515, 215, 120, 150);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = '#0b1a10'; ctx.fillRect(525, 225 + i * 46, 100, 30); label(['122.80', '118.30', 'XPDR 1200'][i], 575, 241 + i * 46, 13, '#55e08a'); }
      g.systems(660, 60, 300, 180, d);
      annunciator(660, 300, 92, 30, 'STALL', d.stall && Math.floor(performance.now() / 250) % 2 === 0, '#ff4d3d');
      annunciator(758, 300, 92, 30, 'GEAR', d.gearWarn, '#ff4d3d');
      annunciator(856, 300, 92, 30, 'BRAKE', d.brake, '#ffb13b');
      annunciator(660, 336, 92, 30, 'TRIM', d.trimming, '#5ad1ff');
      annunciator(758, 336, 92, 30, 'FLAPS', d.flapPos > 0.01 && d.flapPos < 0.99 && Math.abs(d.flapPos * 3 - Math.round(d.flapPos * 3)) > 0.02, '#ffb13b');
      annunciator(856, 336, 92, 30, 'LOW ALT', d.terrain, '#ff4d3d');
      label('GYROWING  GW-1', 990, 420, 12, '#6c767d');
      // night: dim red-tinted panel lighting
      if (d.night > 0.05) { ctx.fillStyle = 'rgba(30,0,0,' + (0.25 * d.night) + ')'; ctx.fillRect(0, 0, CW, CH); }
      tex.needsUpdate = true;
    }

    /** Per frame while the cockpit is shown: gauges at ~20 Hz, yokes and throttle every frame. */
    function update(d, dt) {
      drawT -= dt;
      if (drawT <= 0) { drawT = 0.05; draw(d); }
      for (const y of yokes) { y.position.z = PANEL.z + 0.26 + clamp(d.elevator, -1, 1) * 0.07; y.rotation.z = -clamp(d.aileron, -1, 1) * 0.6; }
      thr.position.z = PANEL.z + 0.04 + clamp(d.throttle, 0, 1) * -0.06 + 0.03;
      faceMat.color.setScalar(1 - 0.35 * (d.night || 0));
    }
    return { update, EYE: EYE.clone(), group };
  }

  window.Cockpit = { build, EYE };
})();
