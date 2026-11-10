/*
 * Sunvolley — the arena: court, lines, net, stands, crowd, sky, lights.
 */
(function () {
  'use strict';
  const TN = window.TN = window.TN || {};
  const C = TN.COURT;

  const PAL = {
    court: 0x2350a6,      // playing surface
    surround: 0x1c6a5b,   // run-off
    line: 0xf7f7f2,
    wall: 0x12324a,
    standA: 0x1d2a3d,
    standB: 0x24344b,
    accent: 0xffb547,
    accent2: 0xff5d73,
  };
  TN.PAL = PAL;

  function canvasTex(w, h, draw, opts) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    if (opts && opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
    t.anisotropy = 8;
    return t;
  }
  TN.canvasTex = canvasTex;

  function grainTex(base, amount, seed) {
    return canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      const img = g.getImageData(0, 0, w, h), d = img.data;
      let s = seed || 7;
      for (let i = 0; i < d.length; i += 4) {
        s = (s * 16807) % 2147483647;
        const n = ((s / 2147483647) - 0.5) * amount;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
    }, { repeat: [10, 20] });
  }

  function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }

  // ---------------------------------------------------------------------------------
  function buildSky(scene) {
    const geo = new THREE.SphereGeometry(420, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2a5bc4) },
        mid: { value: new THREE.Color(0x7fb2ee) },
        hor: { value: new THREE.Color(0xffd3a1) },
        sunDir: { value: new THREE.Vector3(-0.55, 0.32, -0.77).normalize() },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sunDir; varying vec3 vP;',
        'void main(){',
        '  float h = clamp(vP.y, -0.2, 1.0);',
        '  vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h));',
        '  c = mix(c, top, smoothstep(0.18, 0.75, h));',
        '  float s = max(dot(vP, sunDir), 0.0);',
        '  c += vec3(1.0, 0.75, 0.45) * (pow(s, 64.0) * 0.9 + pow(s, 6.0) * 0.18);',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;
    scene.add(sky);

    // soft cloud billboards
    const cloudTex = canvasTex(256, 128, (g, w, h) => {
      for (let i = 0; i < 14; i++) {
        const x = w * (0.2 + Math.random() * 0.6), y = h * (0.45 + Math.random() * 0.25), r = 20 + Math.random() * 34;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    });
    const cmat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, color: 0xfff4ea });
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(cmat);
      const a = -Math.PI * 0.5 + (i / 9 - 0.5) * 2.6 + Math.random() * 0.2;
      const d = 300;
      s.position.set(Math.cos(a) * d, 70 + Math.random() * 70, Math.sin(a) * d);
      const sc = 110 + Math.random() * 90;
      s.scale.set(sc, sc * 0.45, 1);
      scene.add(s);
    }
  }

  // ---------------------------------------------------------------------------------
  function buildCourt(scene) {
    const g = new THREE.Group();
    // stadium floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 110), new THREE.MeshLambertMaterial({ color: 0x174f45 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true;
    g.add(floor);
    // run-off
    const run = new THREE.Mesh(new THREE.PlaneGeometry(22, 39), new THREE.MeshLambertMaterial({ map: grainTex(hex(PAL.surround), 14, 3) }));
    run.rotation.x = -Math.PI / 2; run.position.y = -0.005; run.receiveShadow = true;
    run.material.map.repeat.set(6, 10);
    g.add(run);
    // playing surface (doubles footprint)
    const courtMat = new THREE.MeshLambertMaterial({ map: grainTex(hex(PAL.court), 12, 11), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    courtMat.map.repeat.set(4, 8);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(C.HDW * 2 + 0.6, C.HL * 2 + 0.6), courtMat);
    court.rotation.x = -Math.PI / 2; court.receiveShadow = true;
    g.add(court);

    // lines as flat quads
    const lineMat = new THREE.MeshLambertMaterial({ color: PAL.line, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    function line(x0, z0, x1, z1) {
      const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, 0.001, (z0 + z1) / 2);
      m.receiveShadow = true;
      g.add(m);
    }
    const lw = 0.05;
    [-1, 1].forEach(s => {
      // baselines (10 cm), drawn inside the court
      line(-C.HDW - lw, s * C.HL - 0.05, C.HDW + lw, s * C.HL + 0.05);
      // service line
      line(-C.HW, s * C.SERVICE - lw / 2, C.HW, s * C.SERVICE + lw / 2);
      // centre mark
      line(-lw / 2, s * C.HL - s * 0.15, lw / 2, s * C.HL);
      // sidelines
      line(s * C.HW - lw / 2, -C.HL, s * C.HW + lw / 2, C.HL);
      line(s * C.HDW - lw / 2, -C.HL, s * C.HDW + lw / 2, C.HL);
    });
    line(-lw / 2, -C.SERVICE, lw / 2, C.SERVICE);

    // painted wordmarks behind the baselines
    const word = canvasTex(1024, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.font = 'italic 900 150px Bahnschrift, "Segoe UI", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(255,255,255,0.28)';
      c.fillText('SUNVOLLEY', w / 2, h / 2 + 8);
    });
    [-1, 1].forEach(s => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshLambertMaterial({ map: word, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.002, s * 15.6);
      m.receiveShadow = true;
      g.add(m);
    });
    scene.add(g);
  }

  // ---------------------------------------------------------------------------------
  function buildNet(scene) {
    const g = new THREE.Group();
    const N = 40, X = C.POST_X;
    // mesh body
    const netTex = canvasTex(64, 64, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(20,24,30,0.95)'; c.lineWidth = 6;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w, 0); c.moveTo(0, 0); c.lineTo(0, h); c.stroke();
    }, { repeat: [1, 1] });
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const x = -X + (2 * X * i) / N;
      const h = TN.netHeight(x) - 0.05;
      pos.push(x, h, 0, x, 0.0, 0);
      const u = (x + X) / 0.045;
      uv.push(u, h / 0.045, u, 0);
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const net = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: netTex, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, color: 0x222831 }));
    net.castShadow = true;
    g.add(net);
    // tape
    const tp = [], ti = [];
    for (let i = 0; i <= N; i++) {
      const x = -X + (2 * X * i) / N, h = TN.netHeight(x);
      tp.push(x, h + 0.01, 0, x, h - 0.06, 0);
      if (i < N) { const a = i * 2; ti.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    tg.setIndex(ti); tg.computeVertexNormals();
    const tape = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, emissive: 0x333333 }));
    tape.castShadow = true;
    g.add(tape);
    // centre strap
    const strap = new THREE.Mesh(new THREE.PlaneGeometry(0.05, C.NET_C), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    strap.position.set(0, C.NET_C / 2, 0.003); g.add(strap);
    // posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1b2633, metalness: 0.4, roughness: 0.5 });
    [-1, 1].forEach(s => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, C.NET_P + 0.05, 12), postMat);
      p.position.set(s * X, (C.NET_P + 0.05) / 2, 0); p.castShadow = true; g.add(p);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: PAL.accent, roughness: 0.4 }));
      cap.position.set(s * X, C.NET_P + 0.07, 0); g.add(cap);
    });
    scene.add(g);
  }

  // ---------------------------------------------------------------------------------
  function adTexture(words) {
    return canvasTex(2048, 128, (c, w, h) => {
      const grd = c.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#163e5c'); grd.addColorStop(1, '#0c2236');
      c.fillStyle = grd; c.fillRect(0, 0, w, h);
      c.textBaseline = 'middle';
      const seg = w / words.length;
      words.forEach((t, i) => {
        c.fillStyle = i % 2 ? '#ffb547' : '#ffffff';
        c.textAlign = 'center';
        let fs = 72;
        c.font = 'italic 800 ' + fs + 'px Bahnschrift, "Segoe UI", sans-serif';
        const mw = c.measureText(t).width;
        if (mw > seg * 0.82) { fs = Math.floor(fs * seg * 0.82 / mw); c.font = 'italic 800 ' + fs + 'px Bahnschrift, "Segoe UI", sans-serif'; }
        c.fillText(t, seg * i + seg / 2, h / 2 + 4);
        c.fillStyle = 'rgba(255,255,255,0.15)';
        c.fillRect(seg * (i + 1) - 2, 18, 4, h - 36);
      });
    });
  }

  function buildArena(scene) {
    const g = new THREE.Group();
    const BX = 11.5, BZ = 19.5; // inner boundary of the boards
    const wallH = 1.1;
    const words1 = ['SUNVOLLEY', 'SWING FREE', 'MIMIC', 'RALLY ON'];
    const words2 = ['OPEN SOURCE', 'MIMIC', 'NO CABLES', 'GAME, SET'];
    const t1 = adTexture(words1), t2 = adTexture(words2);
    function board(w, x, z, ry, tex) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, 0.25), [
        new THREE.MeshLambertMaterial({ color: PAL.wall }), new THREE.MeshLambertMaterial({ color: PAL.wall }),
        new THREE.MeshLambertMaterial({ color: PAL.wall }), new THREE.MeshLambertMaterial({ color: PAL.wall }),
        new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }),
        new THREE.MeshLambertMaterial({ color: PAL.wall }),
      ]);
      m.position.set(x, wallH / 2, z); m.rotation.y = ry;
      m.receiveShadow = true;
      g.add(m);
    }
    board(BX * 2, 0, -BZ, 0, t1);
    board(BX * 2, 0, BZ, Math.PI, t2);
    board(BZ * 2, -BX, 0, Math.PI / 2, t2);
    board(BZ * 2, BX, 0, -Math.PI / 2, t1);

    // tiered stands -----------------------------------------------------------------
    const rows = 11, rowD = 0.9, rowH = 0.55;
    const seats = []; // {x,y,z,ry}
    const standMatA = new THREE.MeshLambertMaterial({ color: PAL.standA });
    const standMatB = new THREE.MeshLambertMaterial({ color: PAL.standB });
    function stand(cx, cz, len, ry, startOff) {
      const grp = new THREE.Group();
      grp.position.set(cx, 0, cz); grp.rotation.y = ry;
      for (let r = 0; r < rows; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2 + r * rowH, rowD), r % 2 ? standMatA : standMatB);
        step.position.set(0, (1.2 + r * rowH) / 2, -(startOff + r * rowD + rowD / 2));
        grp.add(step);
        const n = Math.floor(len / 0.62);
        for (let i = 0; i < n; i++) {
          if (Math.random() < 0.08) continue; // a few empty seats
          const lx = -len / 2 + (i + 0.5) * (len / n) + (Math.random() - 0.5) * 0.12;
          seats.push({ grp, lx, ly: 1.2 + r * rowH, lz: -(startOff + r * rowD + rowD * 0.55), row: r });
        }
      }
      // rim + roof fascia
      const topY = 1.2 + rows * rowH;
      const rim = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.4), new THREE.MeshLambertMaterial({ color: PAL.accent2, emissive: PAL.accent2, emissiveIntensity: 0.25 }));
      rim.position.set(0, topY + 2.3, -(startOff + rows * rowD + 0.1)); grp.add(rim);
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, 2.5, 0.3), standMatA);
      back.position.set(0, topY + 1.0, -(startOff + rows * rowD + 0.1)); grp.add(back);
      grp.updateMatrixWorld(true);
      g.add(grp);
    }
    // ends (seats face the court): local -z is away from court
    stand(0, -BZ - 0.6, 26, 0, 0);
    stand(0, BZ + 0.6, 26, Math.PI, 0);
    stand(-BX - 0.6, 0, 42, Math.PI / 2, 0);
    stand(BX + 0.6, 0, 42, -Math.PI / 2, 0);

    // crowd as two instanced meshes ------------------------------------------------
    const n = seats.length;
    const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.32, 3, 8);
    bodyGeo.translate(0, 0.36, 0);
    const headGeo = new THREE.SphereGeometry(0.13, 10, 8);
    headGeo.translate(0, 0.86, 0);
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), n);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial(), n);
    const shirtCols = [0xff5d73, 0xffb547, 0xffffff, 0x4fd1c5, 0x6c8cff, 0xf2f2f2, 0xffe066, 0x9b7bff, 0x2ecc71, 0xff8c42, 0x1e90ff, 0xe0e0e0];
    const skinCols = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
    const col = new THREE.Color();
    const crowd = { bodies, heads, n, base: [], phase: new Float32Array(n), excite: 0, t: 0 };
    const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const s = seats[i];
      v.set(s.lx, s.ly, s.lz);
      s.grp.localToWorld(v);
      const ry = s.grp.rotation.y;
      crowd.base.push({ x: v.x, y: v.y, z: v.z, ry, sc: 0.9 + Math.random() * 0.25 });
      crowd.phase[i] = Math.random() * Math.PI * 2;
      bodies.setColorAt(i, col.setHex(shirtCols[(Math.random() * shirtCols.length) | 0]));
      heads.setColorAt(i, col.setHex(skinCols[(Math.random() * skinCols.length) | 0]));
    }
    crowd.update = function (dt) {
      crowd.t += dt;
      crowd.excite = Math.max(0, crowd.excite - dt * 0.35);
      const e = crowd.excite, t = crowd.t;
      const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < n; i++) {
        const b = crowd.base[i];
        const ph = crowd.phase[i];
        let y = b.y + Math.sin(t * 1.3 + ph) * 0.015;
        if (e > 0.02) y += Math.max(0, Math.sin(t * 9 + ph * 3)) * 0.35 * Math.min(1, e) * (0.5 + 0.5 * Math.sin(ph * 7));
        p.set(b.x, y, b.z);
        q.setFromAxisAngle(up, b.ry + Math.sin(t * 0.5 + ph) * 0.15);
        s.set(b.sc, b.sc, b.sc);
        m4.compose(p, q, s);
        bodies.setMatrixAt(i, m4);
        heads.setMatrixAt(i, m4);
      }
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
    };
    crowd.update(0);
    g.add(bodies); g.add(heads);

    // floodlight towers ----------------------------------------------------------
    const towerMat = new THREE.MeshLambertMaterial({ color: 0x2a3442 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6dd });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const x = sx * 22, z = sz * 30;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 30, 8), towerMat);
      pole.position.set(x, 15, z); g.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 0.5), towerMat);
      head.position.set(x, 30.5, z); head.lookAt(0, 0, 0); g.add(head);
      const lamps = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.0), lampMat);
      lamps.position.copy(head.position).multiplyScalar(0.985); lamps.lookAt(0, 0, 0); g.add(lamps);
    });

    // umpire chair: tube frame, ladder, platform, seat with backrest, canopy -------------
    const metal = new THREE.MeshStandardMaterial({ color: 0xdfe5ec, metalness: 0.7, roughness: 0.35 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x14304e, roughness: 0.6 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.7 });
    const tube = (r, a, b, mat) => {   // cylinder from a to b
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 10), mat || metal);
      m.position.copy(va).add(vb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      m.castShadow = true; return m;
    };
    const chair = new THREE.Group();
    [-1, 1].forEach(sz => {
      chair.add(tube(0.035, [-0.45, 0, sz * 0.45], [-0.3, 1.9, sz * 0.38]));
      chair.add(tube(0.035, [0.45, 0, sz * 0.45], [0.3, 1.9, sz * 0.38]));
      chair.add(tube(0.025, [-0.4, 0.9, sz * 0.42], [0.4, 0.9, sz * 0.42]));
      chair.add(tube(0.03, [0.3, 1.9, sz * 0.38], [0.3, 2.55, sz * 0.38]));  // backrest posts
    });
    for (let i = 0; i < 6; i++) chair.add(tube(0.02, [-0.6 - i * 0.06, 0.25 + i * 0.3, -0.3], [-0.6 - i * 0.06, 0.25 + i * 0.3, 0.3]));   // ladder rungs
    chair.add(tube(0.025, [-0.6, 0, -0.3], [-0.95, 1.9, -0.3])); chair.add(tube(0.025, [-0.6, 0, 0.3], [-0.95, 1.9, 0.3]));
    const plat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.86), wood); plat.position.y = 1.92; plat.castShadow = true; chair.add(plat);
    const seatBox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.6), navy); seatBox.position.set(0.05, 2.38, 0); chair.add(seatBox);
    chair.add(tube(0.03, [0.05, 1.96, -0.2], [0.05, 2.34, -0.2])); chair.add(tube(0.03, [0.05, 1.96, 0.2], [0.05, 2.34, 0.2]));
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.7), navy); back.position.set(0.32, 2.65, 0); back.castShadow = true; chair.add(back);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.86), new THREE.MeshStandardMaterial({ color: PAL.accent, roughness: 0.5 }));
    front.position.set(-0.42, 2.16, 0); chair.add(front);
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.08, 20, 1, false), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.8 }));
    canopy.position.set(0.15, 3.45, 0); canopy.castShadow = true; chair.add(canopy);
    chair.add(tube(0.03, [0.3, 2.55, 0], [0.18, 3.42, 0]));
    // stand-in umpire until the character models load (game.js swaps it)
    const ump = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.4, 3, 8), new THREE.MeshLambertMaterial({ color: 0x0f2a44 }));
    ump.position.y = 2.75; ump.castShadow = true; chair.add(ump);
    const uh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshLambertMaterial({ color: 0xd9a066 }));
    uh.position.y = 3.2; chair.add(uh);
    chair.position.set(-7.4, 0, 0);
    g.add(chair);
    crowd.umpire = { chair, standIn: [ump, uh], seat: new THREE.Vector3(-7.35, 2.42, 0) };

    // player benches: frame, slats, backrest, a towel and a kit bag on each
    [-1, 1].forEach(s => {
      const b = new THREE.Group();
      [-0.95, 0.95].forEach(z => {
        b.add(tube(0.025, [0.2, 0, z], [0.2, 0.45, z])); b.add(tube(0.025, [-0.2, 0, z], [-0.2, 0.9, z]));
      });
      for (let i = 0; i < 4; i++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 2.1), wood); sl.position.set(-0.16 + i * 0.11, 0.46, 0); sl.castShadow = true; b.add(sl); }
      for (let i = 0; i < 2; i++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 2.1), wood); sl.position.set(-0.22, 0.62 + i * 0.16, 0); b.add(sl); }
      const towel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: s > 0 ? 0x1aa59a : 0xff5d73, roughness: 0.95 }));
      towel.position.set(0, 0.5, -0.5); towel.rotation.y = 0.2; b.add(towel);
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 12), new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.6 }));
      bag.rotation.x = Math.PI / 2; bag.position.set(0.35, 0.17, 0.3); bag.castShadow = true; b.add(bag);
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0x8fd3ff, roughness: 0.2, transparent: true, opacity: 0.8 }));
      bottle.position.set(0.05, 0.59, 0.4); b.add(bottle);
      b.position.set(-9.6, 0, s * 2.6);
      g.add(b);
    });

    scene.add(g);
    return crowd;
  }

  // ---------------------------------------------------------------------------------
  function buildLights(scene) {
    const hemi = new THREE.HemisphereLight(0xc4dcff, 0x2a3a30, 0.5);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe9cc, 2.0);
    sun.position.set(-14, 26, -10);
    sun.target.position.set(0, 0, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -17; sc.right = 17; sc.top = 21; sc.bottom = -21; sc.near = 5; sc.far = 70;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0x9fc1ff, 0.25);
    fill.position.set(10, 8, 20);
    scene.add(fill);
    return { sun, hemi };
  }

  TN.buildWorld = function (scene) {
    scene.background = new THREE.Color(0x9cc4f0);
    scene.fog = new THREE.Fog(0xcfdcec, 70, 300);
    buildSky(scene);
    buildCourt(scene);
    buildNet(scene);
    const crowd = buildArena(scene);
    const lights = buildLights(scene);
    return { crowd, lights };
  };
})();
