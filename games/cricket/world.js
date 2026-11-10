/*
 * Willowlight - the ground at dusk: sky, outfield, the cut strip, stumps, rope and boards, the
 * stands with their crowd, floodlights, sight screens. Everything is made in code.
 * World: batter's stumps at z = 0, bowler's at z = -20.12, boundary radius 62 round the pitch.
 */
(function () {
  'use strict';
  const CK = window.CK = window.CK || {};
  const T = THREE;
  const PH = CK.Phys;
  const CZ = PH.FIELD.CZ, RB = PH.FIELD.R;

  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const std = (o) => new T.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, o));

  // ------------------------------------------------------------------ sky
  function sky(scene) {
    const geo = new T.SphereGeometry(900, 48, 24);
    const mat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: new T.Vector3(-0.55, 0.06, -0.83).normalize() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 sunDir;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          float h = vP.y;
          vec3 zen = vec3(0.055, 0.075, 0.2), mid = vec3(0.22, 0.2, 0.42), hor = vec3(0.98, 0.52, 0.32), low = vec3(0.35, 0.18, 0.2);
          vec3 c = h > 0.0 ? mix(hor, mid, smoothstep(0.0, 0.22, h)) : mix(hor, low, smoothstep(0.0, -0.1, h));
          c = mix(c, zen, smoothstep(0.18, 0.75, h));
          float s = max(0.0, dot(vP, sunDir));
          c += vec3(1.0, 0.55, 0.25) * pow(s, 9.0) * 0.55 + vec3(1.0, 0.75, 0.45) * pow(s, 220.0) * 1.6;
          // high thin clouds lit from below
          float band = smoothstep(0.05, 0.12, h) * (1.0 - smoothstep(0.16, 0.3, h));
          float n = sin(vP.x * 23.0 + sin(vP.z * 11.0) * 2.0) * sin(vP.z * 17.0 + vP.x * 3.0);
          c = mix(c, vec3(1.0, 0.62, 0.5), band * smoothstep(0.35, 0.9, n) * 0.35);
          float st = step(0.9975, hash(floor(vP * 420.0))) * smoothstep(0.35, 0.8, h);
          c += vec3(st) * 0.8;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const m = new T.Mesh(geo, mat); m.renderOrder = -10;
    scene.add(m);
    return m;
  }

  // ------------------------------------------------------------------ the ground
  function ground(scene) {
    const grass = canvasTex(1024, 1024, (g, w, h) => {
      g.fillStyle = '#336a2c'; g.fillRect(0, 0, w, h);
      const N = 16;   // mown stripes across the ground
      for (let i = 0; i < N; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,230,0.075)' : 'rgba(0,30,0,0.08)'; g.fillRect(i * w / N, 0, w / N, h); }
      for (let i = 0; i < 26000; i++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,50,15' : '140,190,100'},${Math.random() * 0.12})`;
        g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 3);
      }
    });
    const field = new T.Mesh(new T.CircleGeometry(RB + 9, 96), std({ map: grass, roughness: 0.95 }));
    field.rotation.x = -Math.PI / 2; field.position.set(0, 0, CZ); field.receiveShadow = true;
    // the stripe texture spans the whole field
    grass.repeat.set(1, 1);
    scene.add(field);
    // a darker apron between the boards and the stands
    const apron = new T.Mesh(new T.RingGeometry(RB + 8.9, RB + 16, 96), std({ color: 0x2c5428 }));
    apron.rotation.x = -Math.PI / 2; apron.position.set(0, -0.01, CZ); apron.receiveShadow = true;
    scene.add(apron);
    // the square: a lighter, closely mown patch round the strip
    const sq = new T.Mesh(new T.PlaneGeometry(14, 30), std({ color: 0x4f8a3c, roughness: 0.9, transparent: true, opacity: 0.4 }));
    sq.rotation.x = -Math.PI / 2; sq.position.set(0, 0.004, CZ); sq.receiveShadow = true;
    scene.add(sq);
    // the strip: worn at the ends, creases painted
    const pitchTex = canvasTex(256, 2048, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#a88f62'); grd.addColorStop(0.12, '#b59d6e'); grd.addColorStop(0.5, '#a99766'); grd.addColorStop(0.88, '#b59d6e'); grd.addColorStop(1, '#a88f62');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '90,70,40' : '240,225,190'},${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
      // footmarks and the bowlers' rough
      [[0.06, 0.94]].forEach(() => {});
      for (const yy of [0.075, 0.925]) for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(110,85,50,${0.05 + Math.random() * 0.08})`; g.beginPath(); g.ellipse(w * (0.5 + rnd(-0.32, 0.32)), h * (yy + rnd(-0.035, 0.035)), rnd(4, 12), rnd(6, 16), rnd(0, 3), 0, 7); g.fill(); }
      // creases: the strip is 22 m long (texture 0..1), stumps 0.94 m in from each end
      const px = m => h * (m / 22);
      g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 5;
      for (const end of [0.94, 22 - 0.94]) {
        const dir = end < 11 ? 1 : -1;
        const pop = end + dir * 1.22;
        g.beginPath(); g.moveTo(0, px(pop)); g.lineTo(w, px(pop)); g.stroke();                       // popping crease
        g.beginPath(); g.moveTo(w * 0.22, px(end)); g.lineTo(w * 0.78, px(end)); g.stroke();      // bowling crease
        for (const x of [0.22, 0.78]) { g.beginPath(); g.moveTo(w * x, px(end - dir * 0.6)); g.lineTo(w * x, px(pop)); g.stroke(); }   // return creases
      }
    });
    const strip = new T.Mesh(new T.PlaneGeometry(3.05, 22), std({ map: pitchTex, roughness: 0.92 }));
    strip.rotation.x = -Math.PI / 2; strip.position.set(0, 0.008, CZ); strip.receiveShadow = true;
    scene.add(strip);
  }

  // ------------------------------------------------------------------ stumps
  function stumpSet(z) {
    const g = new T.Group(), wood = std({ color: 0xefe6d2, roughness: 0.55 }), red = std({ color: 0xc62f3a, roughness: 0.5 });
    const stumps = [], bails = [];
    for (let i = -1; i <= 1; i++) {
      const s = new T.Group();
      const m = new T.Mesh(new T.CylinderGeometry(0.0175, 0.0175, 0.711, 12), wood);
      m.position.y = 0.711 / 2; m.castShadow = true; s.add(m);
      const band = new T.Mesh(new T.CylinderGeometry(0.0178, 0.0178, 0.11, 12), red);
      band.position.y = 0.52; s.add(band);
      s.position.set(i * 0.0965, 0, z);
      g.add(s); stumps.push(s);
    }
    for (let i = 0; i < 2; i++) {
      const b = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.11, 8), wood);
      b.rotation.z = Math.PI / 2; b.position.set((i - 0.5) * 0.0965, 0.72, z); b.castShadow = true;
      g.add(b); bails.push(b);
    }
    return { group: g, stumps, bails, z, fall: null };
  }

  // ------------------------------------------------------------------ rope, boards, sight screens
  function boundary(scene) {
    const rope = new T.Mesh(new T.TorusGeometry(RB, 0.06, 6, 180), std({ color: 0xf4f0e6, roughness: 0.6 }));
    rope.rotation.x = Math.PI / 2; rope.position.set(0, 0.06, CZ);
    scene.add(rope);
    // LED boards: a ring of glowing panels just past the rope
    const words = ['WILLOWLIGHT', 'MIMIC', 'DUSK SERIES', 'SIX ZONE', 'GRIP & GO', 'FLOODLIT', 'HOWZAT', 'TWILIGHT CUP'];
    const tex = canvasTex(4096, 64, (g, w, h) => {
      const cols = [['#0d1b3d', '#ffb547'], ['#3a0d2e', '#ff6b8b'], ['#062b2b', '#4fe0d0'], ['#1a1030', '#c9a8ff']];
      const n = 16, cw = w / n;
      for (let i = 0; i < n; i++) {
        const [bg, fg] = cols[i % cols.length];
        const grd = g.createLinearGradient(i * cw, 0, i * cw, h); grd.addColorStop(0, bg); grd.addColorStop(1, '#05060c');
        g.fillStyle = grd; g.fillRect(i * cw, 0, cw, h);
        g.fillStyle = fg; g.font = 'italic 800 38px Bahnschrift, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(words[i % words.length], i * cw + cw / 2, h / 2 + 2);
      }
    });
    tex.wrapS = T.RepeatWrapping; tex.repeat.set(3, 1);
    const boards = new T.Mesh(new T.CylinderGeometry(RB + 2.6, RB + 2.6, 0.9, 160, 1, true),
      new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide, toneMapped: false }));
    boards.position.set(0, 0.45, CZ); boards.scale.x = -1;   // read from inside the ring
    scene.add(boards);
    // sight screens behind both ends (dark, for the white ball)
    for (const z of [CZ - RB - 4, CZ + RB + 4]) {
      const ss = new T.Mesh(new T.BoxGeometry(16, 7, 0.4), std({ color: 0x14161d, roughness: 0.9 }));
      ss.position.set(0, 3.5, z); ss.receiveShadow = true;
      scene.add(ss);
    }
    return { boards, tex };
  }

  // ------------------------------------------------------------------ stands
  function stands(scene) {
    const g = new T.Group();
    const seatTex = canvasTex(512, 64, (c, w, h) => {
      c.fillStyle = '#1e2433'; c.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) { c.fillStyle = (x / 8) % 9 === 0 ? '#2b3550' : '#252c3f'; c.fillRect(x + 1, 6, 6, h - 12); }
    }, [40, 1]);
    const R0 = RB + 16, tiers = 3, rows = 7;
    const base = [];   // crowd seats
    for (let t = 0; t < tiers; t++) {
      const r0 = R0 + t * 14, y0 = 1.2 + t * 7.5;
      // each tier: a sloped ring (a cone frustum)
      const cone = new T.Mesh(new T.CylinderGeometry(r0 + 12, r0, 7, 128, 1, true), std({ map: seatTex, side: T.DoubleSide, roughness: 0.9 }));
      cone.position.set(0, y0 + 3.5, CZ); cone.receiveShadow = true;
      g.add(cone);
      // front wall / balcony fascia with a light strip
      const fascia = new T.Mesh(new T.CylinderGeometry(r0 - 0.1, r0 - 0.1, 1.3, 128, 1, true), std({ color: t === 1 ? 0x2a1f3d : 0x161a26, side: T.DoubleSide }));
      fascia.position.set(0, y0 - 0.2, CZ); g.add(fascia);
      const strip = new T.Mesh(new T.CylinderGeometry(r0 - 0.15, r0 - 0.15, 0.12, 128, 1, true), new T.MeshBasicMaterial({ color: t === 1 ? 0xff9c5a : 0x7fd6ff, side: T.DoubleSide, toneMapped: false }));
      strip.position.set(0, y0 + 0.45, CZ); g.add(strip);
      for (let r = 0; r < rows; r++) {
        const rr = r0 + 0.9 + r * (12 / rows), yy = y0 + 0.3 + r * (7 / rows);
        const n = Math.floor(2 * Math.PI * rr / 0.95);
        for (let i = 0; i < n; i++) {
          if (Math.random() < 0.18) continue;      // empty seats
          const a = (i + Math.random() * 0.3) / n * Math.PI * 2;
          const x = Math.sin(a) * rr, z = CZ + Math.cos(a) * rr;
          // gaps for the sight screens and the floodlit pavilion end
          if (Math.abs(x) < 10 && Math.abs(z - CZ) > 70) continue;
          base.push({ x, y: yy, z, ry: Math.atan2(-x, CZ - z), sc: 0.95 + Math.random() * 0.1 });
        }
      }
    }
    scene.add(g);
    return { group: g, base };
  }

  /** Placeholder-free crowd until the character atlas is baked: small coloured figures. */
  function simpleCrowd(scene, base) {
    const n = base.length;
    const body = new T.InstancedMesh(new T.CapsuleGeometry(0.22, 0.45, 2, 6), std({ roughness: 0.8 }), n);
    const head = new T.InstancedMesh(new T.SphereGeometry(0.13, 8, 6), std({ roughness: 0.7 }), n);
    const m4 = new T.Matrix4(), col = new T.Color();
    const shirts = [0xff5d73, 0xffb547, 0xffffff, 0x4fd1c5, 0x6c8cff, 0xffe066, 0x9b7bff, 0x2ecc71, 0xff8c42, 0x1e90ff];
    const skins = [0xf1c8a0, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const b = base[i];
      m4.makeTranslation(b.x, b.y + 0.45, b.z); body.setMatrixAt(i, m4);
      m4.makeTranslation(b.x, b.y + 0.88, b.z); head.setMatrixAt(i, m4);
      body.setColorAt(i, col.setHex(shirts[i % shirts.length]).convertSRGBToLinear());
      head.setColorAt(i, col.setHex(skins[i % skins.length]).convertSRGBToLinear());
      phase[i] = Math.random() * 6.28;
    }
    scene.add(body, head);
    return { bodies: body, heads: head, base, phase, n, t: 0, excite: 0 };
  }

  // ------------------------------------------------------------------ floodlights
  function floodlights(scene) {
    const g = new T.Group(), towers = [];
    const glowTex = canvasTex(128, 128, (c, w, h) => {
      const grd = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,250,235,1)'); grd.addColorStop(0.18, 'rgba(255,236,200,0.75)'); grd.addColorStop(0.5, 'rgba(255,210,150,0.18)'); grd.addColorStop(1, 'rgba(255,200,140,0)');
      c.fillStyle = grd; c.fillRect(0, 0, w, h);
    });
    const steel = std({ color: 0x3a3f4c, metalness: 0.5, roughness: 0.5 });
    const R = RB + 52;
    [-0.62, -0.2, 0.2, 0.62].forEach(k => [1, -1].forEach(side => {
      const a = Math.PI * (side > 0 ? k : 1 + k);
      const x = Math.sin(a) * R, z = CZ + Math.cos(a) * R;
      const t = new T.Group();
      const mast = new T.Mesh(new T.CylinderGeometry(0.5, 1.1, 52, 8), steel); mast.position.y = 26; t.add(mast);
      const head = new T.Group(); head.position.y = 53;
      const frame = new T.Mesh(new T.BoxGeometry(9, 5.5, 0.6), steel); head.add(frame);
      const lampMat = new T.MeshBasicMaterial({ color: 0xfff4e0, toneMapped: false });
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
        const lamp = new T.Mesh(new T.CircleGeometry(0.62, 12), lampMat);
        lamp.position.set(-3.6 + i * 1.8, -1.7 + j * 1.7, 0.32); head.add(lamp);
      }
      const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xfff0d8, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
      glow.scale.set(26, 18, 1); glow.position.z = 1.2; head.add(glow);
      t.add(head);
      t.position.set(x, 0, z);
      t.lookAt(0, 0, CZ);
      head.rotation.x = 0.42;   // the banks tilt down at the field
      g.add(t); towers.push(t);
    }));
    scene.add(g);
    return { group: g, towers };
  }

  // ------------------------------------------------------------------ fireworks (sixes)
  function fireworks(scene) {
    const N = 90, bursts = [];
    const dot = canvasTex(32, 32, (c, w, h) => {
      const g = c.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    for (let b = 0; b < 8; b++) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 3), 3));
      const mat = new T.PointsMaterial({ size: 2.2, map: dot, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
      const pts = new T.Points(geo, mat); pts.frustumCulled = false; pts.visible = false;
      scene.add(pts);
      bursts.push({ pts, vel: new Float32Array(N * 3), t: 0, life: 0, delay: 0 });
    }
    const COLS = [0xffc24d, 0xff6b7e, 0x2fd3c3, 0xffffff, 0xc9a8ff, 0x7fe6ff];
    let next = 0;
    return {
      /** A shell bursting at p (after delay s). */
      burst(p, delay) {
        const B = bursts[next++ % bursts.length], pos = B.pts.geometry.attributes.position.array;
        for (let i = 0; i < N; i++) {
          const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = 14 + Math.random() * 6;
          B.vel[i * 3] = Math.cos(a) * r * sp; B.vel[i * 3 + 1] = u * sp + 4; B.vel[i * 3 + 2] = Math.sin(a) * r * sp;
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        }
        B.pts.geometry.attributes.position.needsUpdate = true;
        B.pts.material.color.setHex(COLS[(Math.random() * COLS.length) | 0]);
        B.t = 0; B.life = 1.8; B.delay = delay || 0; B.pts.visible = false;
      },
      update(dt) {
        for (const B of bursts) {
          if (B.life <= 0) continue;
          if (B.delay > 0) { B.delay -= dt; continue; }
          B.pts.visible = true; B.t += dt;
          const pos = B.pts.geometry.attributes.position.array, k = Math.exp(-dt * 1.6);
          for (let i = 0; i < N; i++) {
            B.vel[i * 3] *= k; B.vel[i * 3 + 1] = B.vel[i * 3 + 1] * k - 6 * dt; B.vel[i * 3 + 2] *= k;
            pos[i * 3] += B.vel[i * 3] * dt; pos[i * 3 + 1] += B.vel[i * 3 + 1] * dt; pos[i * 3 + 2] += B.vel[i * 3 + 2] * dt;
          }
          B.pts.geometry.attributes.position.needsUpdate = true;
          B.pts.material.opacity = Math.max(0, 1 - B.t / B.life);
          if (B.t >= B.life) { B.life = 0; B.pts.visible = false; }
        }
      },
    };
  }

  function buildWorld(scene) {
    scene.background = new T.Color(0x151a33);
    scene.fog = new T.Fog(0x2a2440, 160, 700);
    const hemi = new T.HemisphereLight(0x8f9cff, 0x2a2418, 0.5);
    scene.add(hemi);
    // the floodlights' combined key (casts the players' shadows) and a warm sunset rim
    const key = new T.DirectionalLight(0xfff0dc, 1.3);
    key.position.set(26, 60, 18); key.target.position.set(0, 0, -8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 40; sc.bottom = -40; sc.near = 10; sc.far = 160;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    const fill = new T.DirectionalLight(0xc6d6ff, 0.45); fill.position.set(-40, 50, -30); scene.add(fill);
    const rim = new T.DirectionalLight(0xff8a4a, 0.7); rim.position.set(-60, 8, -90); scene.add(rim);
    sky(scene);
    ground(scene);
    const bd = boundary(scene);
    const st = stands(scene);
    const crowd = simpleCrowd(scene, st.base);
    const fl = floodlights(scene);
    const batEnd = stumpSet(0), bowlEnd = stumpSet(-PH.PITCH.L);
    scene.add(batEnd.group, bowlEnd.group);
    crowd.update = function (dt) { crowd.t += dt; crowd.excite = Math.max(0, crowd.excite - dt * 0.18); if (crowd.impUpdate) crowd.impUpdate(); };
    const fx = fireworks(scene);
    // LED boards: flash through the team colours on a big moment
    const flash = { t: 0 };
    bd.flash = s => { flash.t = s || 2.4; };
    const tick = dt => {
      fx.update(dt);
      const m = bd.boards.material;
      if (flash.t > 0) { flash.t -= dt; const h = (crowd.t * 3) % 1; m.color.setHSL(h, 0.9, 0.62 + 0.25 * Math.sin(crowd.t * 30)); bd.tex.offset.x += dt * 0.8; }
      else m.color.setRGB(1, 1, 1);
    };
    return { lights: { key, hemi, fill, rim }, crowd, stands: st, boards: bd, floods: fl, stumps: { bat: batEnd, bowl: bowlEnd }, fx, tick };
  }

  CK.buildWorld = buildWorld;
})();
