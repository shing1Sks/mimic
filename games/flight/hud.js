/*
 * GYROWING instruments: a canvas overlay with round gauges (airspeed, attitude, altimeter,
 * vertical speed, heading), a systems column (throttle, RPM, flaps, gear, trim, brakes),
 * a control-input monitor, warnings and the landing-challenge guidance.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const R2D = 180 / Math.PI, D2R = Math.PI / 180;
  const FONT = '"Bahnschrift", "DIN Alternate", "Segoe UI", system-ui, sans-serif';
  const COL = { face: '#0d1114', bezel: '#2a3036', ink: '#e8edf0', dim: '#8b979f', amber: '#ffb13b', green: '#3ddc84', red: '#ff4d3d', white: '#ffffff', cyan: '#5ad1ff', sky: '#2f78c4', ground: '#7a5530' };

  function HUD(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.s = 1; this.t = 0;
  }
  HUD.prototype.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.round(innerWidth * dpr); this.c.height = Math.round(innerHeight * dpr);
    this.c.style.width = innerWidth + 'px'; this.c.style.height = innerHeight + 'px';
    this.dpr = dpr; this.w = innerWidth; this.h = innerHeight;
    this.s = clamp(Math.min(this.w / 1600, this.h / 900), 0.6, 1.6);   // instruments stay legible on 1366x768 laptops
  };
  HUD.prototype.clear = function () { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.c.width, this.c.height); };

  function txt(ctx, str, x, y, size, color, align, weight) {
    ctx.font = (weight || 600) + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }
  function dialFace(ctx, x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.fillStyle = COL.bezel; ctx.fill();
    const g = ctx.createRadialGradient(x, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#1a2026'); g.addColorStop(1, COL.face);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  }
  function needle(ctx, x, y, ang, len, w, color, tail) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(-w, (tail || 0.15) * len); ctx.lineTo(0, -len); ctx.lineTo(w, (tail || 0.15) * len); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, w * 1.4, 0, Math.PI * 2); ctx.fillStyle = '#3a4248'; ctx.fill();
  }
  function arcBand(ctx, x, y, r, a0, a1, w, color) {
    ctx.beginPath(); ctx.arc(x, y, r, a0 - Math.PI / 2, a1 - Math.PI / 2); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }
  function readout(ctx, x, y, w, h, str, size, color) {
    ctx.fillStyle = '#05080a'; ctx.strokeStyle = '#3d474f'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill(); ctx.stroke();
    txt(ctx, str, x, y + 1, size, color || COL.ink, 'center', 600);
  }

  // ---------------------------------------------------------------- gauges
  HUD.prototype.asi = function (x, y, r, kt) {
    const ctx = this.ctx, s = this.s;
    dialFace(ctx, x, y, r);
    const A = v => clamp(v, 0, 180) / 180 * 330 * D2R;    // 0..180 kt over 330 deg
    arcBand(ctx, x, y, r - 7 * s, A(44), A(85), 5 * s, '#e8edf0');
    arcBand(ctx, x, y, r - 12 * s, A(51), A(128), 5 * s, COL.green);
    arcBand(ctx, x, y, r - 12 * s, A(128), A(160), 5 * s, '#f3c84a');
    arcBand(ctx, x, y, r - 9 * s, A(160), A(163), 11 * s, COL.red);
    ctx.lineWidth = 1.5 * s; ctx.strokeStyle = COL.ink;
    for (let v = 0; v <= 180; v += 10) {
      const a = A(v) - Math.PI / 2, big = v % 20 === 0;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r - 2 * s), y + Math.sin(a) * (r - 2 * s));
      ctx.lineTo(x + Math.cos(a) * (r - (big ? 16 : 10) * s), y + Math.sin(a) * (r - (big ? 16 : 10) * s)); ctx.stroke();
      if (big && v > 0) txt(ctx, String(v), x + Math.cos(a) * (r - 28 * s), y + Math.sin(a) * (r - 28 * s), 11 * s, COL.ink);
    }
    txt(ctx, 'KNOTS', x, y - r * 0.32, 9 * s, COL.dim);
    readout(ctx, x, y + r * 0.42, 50 * s, 22 * s, String(Math.round(kt)), 16 * s);
    needle(ctx, x, y, A(kt), r - 10 * s, 3.2 * s, COL.white);
  };

  HUD.prototype.attitude = function (x, y, r, pitch, bank, slip) {
    const ctx = this.ctx, s = this.s;
    dialFace(ctx, x, y, r);
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r - 2, 0, Math.PI * 2); ctx.clip();
    ctx.translate(x, y); ctx.rotate(-bank * D2R);
    const ppd = r / 28; // pixels per degree
    const off = pitch * ppd;
    ctx.fillStyle = COL.sky; ctx.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
    const gg = ctx.createLinearGradient(0, off, 0, off + r * 2); gg.addColorStop(0, '#8a6034'); gg.addColorStop(1, '#4a3018');
    ctx.fillStyle = gg; ctx.fillRect(-r * 2, off, r * 4, r * 3);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(-r * 2, off); ctx.lineTo(r * 2, off); ctx.stroke();
    ctx.lineWidth = 1.3 * s;
    for (let p = -30; p <= 30; p += 5) {
      if (!p) continue;
      const yy = off - p * ppd, hw = (p % 10 === 0 ? 22 : 11) * s;
      if (Math.abs(yy) > r) continue;
      ctx.beginPath(); ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy); ctx.stroke();
      if (p % 10 === 0) { txt(ctx, String(Math.abs(p)), -hw - 10 * s, yy, 9 * s, '#fff'); txt(ctx, String(Math.abs(p)), hw + 10 * s, yy, 9 * s, '#fff'); }
    }
    ctx.restore();
    // bank scale
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6 * s;
    for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = (b - bank) * D2R - Math.PI / 2, l = (b % 30 === 0 ? 12 : 7) * s;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * (r - 2), Math.sin(a) * (r - 2)); ctx.lineTo(Math.cos(a) * (r - 2 - l), Math.sin(a) * (r - 2 - l)); ctx.stroke();
    }
    // pointer (fixed, top)
    ctx.fillStyle = COL.amber;
    ctx.beginPath(); ctx.moveTo(0, -r + 16 * s); ctx.lineTo(-6 * s, -r + 26 * s); ctx.lineTo(6 * s, -r + 26 * s); ctx.closePath(); ctx.fill();
    // aircraft symbol
    ctx.strokeStyle = COL.amber; ctx.lineWidth = 4 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-r * 0.55, 0); ctx.lineTo(-r * 0.18, 0); ctx.lineTo(-r * 0.1, 8 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r * 0.55, 0); ctx.lineTo(r * 0.18, 0); ctx.lineTo(r * 0.1, 8 * s); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 3 * s, 0, Math.PI * 2); ctx.fillStyle = COL.amber; ctx.fill();
    // slip ball
    const bx = clamp(-slip * 4, -1, 1) * 22 * s;
    ctx.fillStyle = '#05080a'; ctx.fillRect(-28 * s, r * 0.72, 56 * s, 12 * s);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-7 * s, r * 0.72); ctx.lineTo(-7 * s, r * 0.72 + 12 * s); ctx.moveTo(7 * s, r * 0.72); ctx.lineTo(7 * s, r * 0.72 + 12 * s); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, r * 0.72 + 6 * s, 5 * s, 0, Math.PI * 2); ctx.fillStyle = '#ddd'; ctx.fill();
    ctx.restore();
  };

  HUD.prototype.altimeter = function (x, y, r, ft, agl) {
    const ctx = this.ctx, s = this.s;
    dialFace(ctx, x, y, r);
    ctx.lineWidth = 1.5 * s; ctx.strokeStyle = COL.ink;
    for (let i = 0; i < 50; i++) {
      const a = i / 50 * Math.PI * 2 - Math.PI / 2, big = i % 5 === 0;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r - 2 * s), y + Math.sin(a) * (r - 2 * s));
      ctx.lineTo(x + Math.cos(a) * (r - (big ? 14 : 8) * s), y + Math.sin(a) * (r - (big ? 14 : 8) * s)); ctx.stroke();
      if (big) txt(ctx, String(i / 5), x + Math.cos(a) * (r - 25 * s), y + Math.sin(a) * (r - 25 * s), 12 * s, COL.ink);
    }
    txt(ctx, 'ALT FT', x, y - r * 0.32, 9 * s, COL.dim);
    readout(ctx, x, y + r * 0.42, 62 * s, 22 * s, String(Math.round(ft / 10) * 10), 15 * s);
    needle(ctx, x, y, (ft % 10000) / 10000 * Math.PI * 2, r * 0.5, 4.5 * s, '#b9c2c8', 0.1);
    needle(ctx, x, y, (ft % 1000) / 1000 * Math.PI * 2, r - 12 * s, 2.6 * s, COL.white);
    if (agl < 2500) txt(ctx, 'RA ' + Math.max(0, Math.round(agl)), x, y + r + 16 * s, 12 * s, agl < 200 ? COL.amber : COL.cyan, 'center', 700);
  };

  HUD.prototype.vsi = function (x, y, r, fpm) {
    const ctx = this.ctx, s = this.s;
    dialFace(ctx, x, y, r);
    const A = v => -Math.PI / 2 + clamp(v, -2000, 2000) / 2000 * 0.9 * Math.PI; // 0 at 9 o'clock
    ctx.lineWidth = 1.5 * s; ctx.strokeStyle = COL.ink;
    for (let v = -2000; v <= 2000; v += 250) {
      const a = A(v) - Math.PI / 2, big = v % 500 === 0;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r - 2 * s), y + Math.sin(a) * (r - 2 * s));
      ctx.lineTo(x + Math.cos(a) * (r - (big ? 14 : 8) * s), y + Math.sin(a) * (r - (big ? 14 : 8) * s)); ctx.stroke();
      if (v % 1000 === 0) txt(ctx, String(Math.abs(v / 100)), x + Math.cos(a) * (r - 26 * s), y + Math.sin(a) * (r - 26 * s), 12 * s, COL.ink);
    }
    txt(ctx, 'UP', x - r * 0.25, y - r * 0.38, 9 * s, COL.dim); txt(ctx, 'DN', x - r * 0.25, y + r * 0.38, 9 * s, COL.dim);
    txt(ctx, 'FPM x100', x + r * 0.22, y, 8 * s, COL.dim);
    needle(ctx, x, y, A(fpm), r - 10 * s, 3 * s, COL.white);
  };

  HUD.prototype.heading = function (x, y, r, hdg, bug) {
    const ctx = this.ctx, s = this.s;
    dialFace(ctx, x, y, r);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-hdg * D2R);
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.5 * s;
    for (let d = 0; d < 360; d += 5) {
      const a = d * D2R - Math.PI / 2, big = d % 10 === 0;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * (r - 2 * s), Math.sin(a) * (r - 2 * s)); ctx.lineTo(Math.cos(a) * (r - (big ? 12 : 7) * s), Math.sin(a) * (r - (big ? 12 : 7) * s)); ctx.stroke();
      if (d % 30 === 0) {
        ctx.save(); ctx.rotate(d * D2R); const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10);
        txt(ctx, lbl, 0, -r + 24 * s, (d % 90 ? 11 : 14) * s, d % 90 ? COL.ink : COL.amber, 'center', 700); ctx.restore();
      }
    }
    if (bug !== undefined) {
      ctx.save(); ctx.rotate(bug * D2R); ctx.fillStyle = COL.cyan;
      ctx.fillRect(-5 * s, -r + 1, 10 * s, 6 * s); ctx.restore();
    }
    ctx.restore();
    // aircraft + lubber
    ctx.fillStyle = COL.amber;
    ctx.beginPath(); ctx.moveTo(x, y - r + 2); ctx.lineTo(x - 5 * s, y - r - 7 * s); ctx.lineTo(x + 5 * s, y - r - 7 * s); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = COL.amber; ctx.lineWidth = 3 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y - 18 * s); ctx.lineTo(x, y + 16 * s); ctx.moveTo(x - 16 * s, y - 2 * s); ctx.lineTo(x + 16 * s, y - 2 * s); ctx.moveTo(x - 7 * s, y + 13 * s); ctx.lineTo(x + 7 * s, y + 13 * s); ctx.stroke();
    readout(ctx, x, y + r * 0.5, 46 * s, 20 * s, String(Math.round(hdg) % 360 || 360).padStart(3, '0'), 14 * s, COL.amber);
  };

  HUD.prototype.systems = function (x, y, w, h, d) {
    const ctx = this.ctx, s = this.s;
    // throttle
    const bx = x + 10 * s, bw = 18 * s, by = y + 22 * s, bh = h - 50 * s;
    txt(ctx, 'THR', bx + bw / 2, y + 10 * s, 10 * s, COL.dim);
    ctx.fillStyle = '#05080a'; ctx.fillRect(bx, by, bw, bh);
    const tg = ctx.createLinearGradient(0, by + bh, 0, by); tg.addColorStop(0, '#2a6b46'); tg.addColorStop(1, COL.green);
    ctx.fillStyle = tg; ctx.fillRect(bx, by + bh * (1 - d.throttle), bw, bh * d.throttle);
    ctx.strokeStyle = '#3d474f'; ctx.strokeRect(bx, by, bw, bh);
    txt(ctx, Math.round(d.throttle * 100) + '%', bx + bw / 2, by + bh + 13 * s, 11 * s, COL.ink);
    // rpm + trim
    const cx = x + 64 * s;
    txt(ctx, 'RPM', cx, y + 10 * s, 10 * s, COL.dim);
    readout(ctx, cx, y + 32 * s, 54 * s, 20 * s, String(Math.round(d.rpm / 10) * 10), 13 * s, d.rpm > 2700 ? COL.red : COL.ink);
    txt(ctx, 'TRIM', cx, y + 58 * s, 10 * s, COL.dim);
    ctx.fillStyle = '#05080a'; ctx.fillRect(cx - 6 * s, y + 68 * s, 12 * s, 56 * s);
    ctx.strokeStyle = '#3d474f'; ctx.strokeRect(cx - 6 * s, y + 68 * s, 12 * s, 56 * s);
    const ty = y + 96 * s - d.trim * 26 * s;
    ctx.fillStyle = d.trimming ? COL.amber : COL.ink; ctx.fillRect(cx - 10 * s, ty - 2 * s, 20 * s, 4 * s);
    txt(ctx, 'NOSE UP', cx, y + 132 * s, 8 * s, COL.dim);
    // flaps
    const fx = x + 120 * s;
    txt(ctx, 'FLAPS', fx, y + 10 * s, 10 * s, COL.dim);
    ['UP', '10', '20', '30'].forEach((lbl, i) => {
      const yy = y + 30 * s + i * 17 * s, on = d.flapCmd === i;
      txt(ctx, lbl, fx - 8 * s, yy, 11 * s, on ? COL.ink : '#55616a', 'center', on ? 700 : 500);
    });
    const fy = y + 30 * s + d.flapPos * 3 * 17 * s;
    ctx.fillStyle = COL.amber; ctx.beginPath(); ctx.moveTo(fx + 8 * s, fy); ctx.lineTo(fx + 16 * s, fy - 5 * s); ctx.lineTo(fx + 16 * s, fy + 5 * s); ctx.closePath(); ctx.fill();
    // gear
    const gx = x + 176 * s;
    txt(ctx, 'GEAR', gx, y + 10 * s, 10 * s, COL.dim);
    const gearCol = d.gear >= 0.999 ? COL.green : d.gear <= 0.001 ? '#20262b' : COL.red;
    [[gx, y + 34 * s], [gx - 13 * s, y + 58 * s], [gx + 13 * s, y + 58 * s]].forEach(([px, py]) => {
      ctx.beginPath(); ctx.arc(px, py, 7.5 * s, 0, Math.PI * 2); ctx.fillStyle = gearCol; ctx.fill();
      ctx.strokeStyle = '#3d474f'; ctx.lineWidth = 1.5; ctx.stroke();
    });
    txt(ctx, d.gear >= 0.999 ? 'DOWN' : d.gear <= 0.001 ? 'UP' : 'TRANSIT', gx, y + 80 * s, 10 * s, d.gear > 0.001 && d.gear < 0.999 ? COL.red : COL.ink, 'center', 700);
    // brakes / g
    if (d.brake) txt(ctx, 'BRAKE', gx, y + 102 * s, 11 * s, COL.amber, 'center', 700);
    txt(ctx, 'G ' + d.gload.toFixed(1), gx, y + 124 * s, 11 * s, d.gload > 3.6 || d.gload < -1 ? COL.red : COL.ink);
  };

  /** Control-input monitor: stick position, rudder, phone tilt. */
  HUD.prototype.controls = function (x, y, d) {
    const ctx = this.ctx, s = this.s, R = 46 * s;
    ctx.fillStyle = 'rgba(8,12,15,0.55)'; roundRect(ctx, x - R - 14 * s, y - R - 26 * s, 2 * R + 28 * s, 2 * R + 64 * s, 10 * s); ctx.fill();
    txt(ctx, d.sourceLabel, x, y - R - 13 * s, 10 * s, d.phone ? COL.green : COL.dim, 'center', 700);
    ctx.strokeStyle = '#3d474f'; ctx.lineWidth = 1;
    ctx.strokeRect(x - R, y - R, 2 * R, 2 * R);
    ctx.beginPath(); ctx.moveTo(x - R, y); ctx.lineTo(x + R, y); ctx.moveTo(x, y - R); ctx.lineTo(x, y + R); ctx.stroke();
    // phone attitude as a tilted plane silhouette (when connected)
    if (d.phone) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(d.phoneRoll * D2R);
      ctx.strokeStyle = 'rgba(90,209,255,0.45)'; ctx.lineWidth = 2 * s;
      const py = -clamp(d.phonePitch, -45, 45) / 45 * R;
      ctx.beginPath(); ctx.moveTo(-R * 0.8, py); ctx.lineTo(R * 0.8, py); ctx.stroke();
      ctx.restore();
    }
    const px = x + d.aileron * R, py = y + d.elevator * R; // pull = down on the box like a stick seen from above
    ctx.beginPath(); ctx.arc(px, py, 6 * s, 0, Math.PI * 2); ctx.fillStyle = COL.amber; ctx.fill();
    // rudder bar
    const ry = y + R + 12 * s;
    ctx.fillStyle = '#05080a'; ctx.fillRect(x - R, ry, 2 * R, 7 * s);
    ctx.fillStyle = COL.cyan; ctx.fillRect(x + Math.min(0, d.rudder) * R, ry, Math.abs(d.rudder) * R, 7 * s);
    txt(ctx, 'RUDDER', x, ry + 18 * s, 8 * s, COL.dim);
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /** Full HUD draw. d: data assembled by the game. In the cockpit view the real panel replaces the
   * gauge strip; outside it the strip is drawn compact so the world stays the main thing on screen. */
  HUD.prototype.draw = function (d, dt) {
    const ctx = this.ctx; this.t += dt;
    this.clear();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!d.panel) return;
    const s0 = this.s;
    const W = this.w, H = this.h;
    let wy;
    if (!d.cockpit) {
      this.s = s0 * 0.8;
      const s = this.s;
      const r = 66 * s, gap = 12 * s;
      const sysW = 210 * s;
      const total = 5 * (2 * r + 10 * s) + 4 * gap + sysW + gap * 2;
      const x0 = (W - total) / 2, cy = H - r - 24 * s;
      ctx.fillStyle = 'rgba(8,11,14,0.55)';
      roundRect(ctx, x0 - 10 * s, cy - r - 22 * s, total + 20 * s, 2 * r + 48 * s, 14 * s); ctx.fill();
      let x = x0 + r + 5 * s;
      const step = 2 * r + 10 * s + gap;
      this.asi(x, cy, r, d.ias); x += step;
      this.attitude(x, cy, r, d.pitch, d.bank, d.slip); x += step;
      this.altimeter(x, cy, r, d.altFt, d.aglFt); x += step;
      this.vsi(x, cy, r, d.vsFpm); x += step;
      this.heading(x, cy, r, d.hdg, d.bug); x += r + gap;
      this.systems(x, cy - r - 8 * s, sysW, 2 * r + 20 * s, d);
      if (d.showControls) this.controls(x0 - 90 * s, cy - 6 * s, d);
      wy = cy - r - 50 * s;
    } else {
      wy = H * 0.5;
    }
    const s = this.s;
    // ---- warnings
    const blink = Math.floor(this.t * 3) % 2 === 0;
    const warns = [];
    if (d.stall) warns.push(['STALL', COL.red]);
    if (d.gearWarn) warns.push(['GEAR', COL.red]);
    if (d.terrain) warns.push(['TERRAIN  PULL UP', COL.red]);
    if (d.overspeed) warns.push(['OVERSPEED', COL.amber]);
    if (d.gearBlocked) warns.push(['GEAR LOCKED ON GROUND', COL.amber]);
    warns.forEach(([str, c], i) => {
      if (!blink && c === COL.red) return;
      const ww = (str.length * 16 + 40) * s, wx = W / 2 + (i - (warns.length - 1) / 2) * (ww + 12 * s);
      ctx.fillStyle = 'rgba(10,0,0,0.6)'; roundRect(ctx, wx - ww / 2, wy - 18 * s, ww, 36 * s, 6 * s); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 2 * s; ctx.stroke();
      txt(ctx, str, wx, wy + 1, 22 * s, c, 'center', 700);
    });
    this.s = s0;
    // ---- approach guidance (landings)
    if (d.approach) this.approach(d.approach);
  };

  HUD.prototype.approach = function (a) {
    const ctx = this.ctx, s = this.s * 0.85, W = this.w;
    const x = 14 + 120 * s, y = 112 + 100 * s;
    ctx.fillStyle = 'rgba(8,11,14,0.62)'; roundRect(ctx, x - 120 * s, y - 100 * s, 240 * s, 200 * s, 12 * s); ctx.fill();
    txt(ctx, 'APPROACH  RWY ' + (a.rwy || '09'), x, y - 82 * s, 12 * s, COL.amber, 'center', 700);
    txt(ctx, (a.dist / 1852).toFixed(1) + ' NM', x, y - 60 * s, 20 * s, COL.ink, 'center', 700);
    // glideslope (vertical) and localiser (horizontal) dots
    const gx = x, gy = y + 18 * s, R = 52 * s;
    ctx.strokeStyle = '#5a666e'; ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.arc(gx + i * R / 2.2, gy + R + 4 * s, 3 * s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(gx + R + 30 * s, gy + i * R / 2.2, 3 * s, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = '#3d474f'; ctx.strokeRect(gx - R, gy - R, 2 * R, 2 * R);
    // needles show where the path is: above the glidepath -> GS bar below centre; right of course -> LOC bar left
    const lx = gx - clamp(a.loc / 2.5, -1, 1) * R, ly = gy + clamp(a.gs / 0.7, -1, 1) * R;
    ctx.strokeStyle = COL.green; ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(lx, gy - R); ctx.lineTo(lx, gy + R); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx - R, ly); ctx.lineTo(gx + R, ly); ctx.stroke();
    ctx.fillStyle = COL.green;
    ctx.beginPath(); ctx.moveTo(gx + R + 22 * s, ly); ctx.lineTo(gx + R + 14 * s, ly - 6 * s); ctx.lineTo(gx + R + 14 * s, ly + 6 * s); ctx.fill();
    ctx.beginPath(); ctx.moveTo(lx, gy + R + 12 * s); ctx.lineTo(lx - 6 * s, gy + R + 20 * s); ctx.lineTo(lx + 6 * s, gy + R + 20 * s); ctx.fill();
    txt(ctx, 'GS', gx + R + 30 * s, gy - R - 10 * s, 9 * s, COL.dim); txt(ctx, 'LOC', gx - R - 2 * s, gy + R + 18 * s, 9 * s, COL.dim, 'right');
  };

  window.HUD = HUD;
})();
