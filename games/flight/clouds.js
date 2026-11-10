/*
 * GYROWING volumetric clouds (High and Ultra): a layer of cumulus raymarched per pixel through a
 * tiling 3D Perlin-Worley noise. Lit tops and dark bases (light marched toward the sun, Beer-Lambert
 * with a powder term and a forward-scattering phase), the sky's colour in the shade, haze with
 * distance, and the time of day from the world's sun. You can fly into them and through them.
 *
 * Drawn as one full-screen pass inside the normal frame: each pixel writes the depth of the cloud
 * it sees (gl_FragDepth), so terrain, buildings and the aircraft in front hide it correctly. The
 * same density function (CLOUD_GLSL) gives the ground its cloud shadows.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tiling 3D noise (64^3, RG8)
  function makeNoise(N) {
    const data = new Uint8Array(N * N * N * 2);
    const rnd = (() => { let s = 1234567; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    // Worley: feature points on a tiling grid, at two frequencies
    function worleyGrid(cells) { const p = []; for (let i = 0; i < cells * cells * cells; i++) p.push([rnd(), rnd(), rnd()]); return p; }
    const W1 = worleyGrid(4), W2 = worleyGrid(8), W3 = worleyGrid(16);
    function worley(x, y, z, cells, P) {
      const fx = x * cells, fy = y * cells, fz = z * cells, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      let d = 9;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const cx = (ix + a + cells) % cells, cy = (iy + b + cells) % cells, cz = (iz + c + cells) % cells;
        const q = P[(cz * cells + cy) * cells + cx];
        const dx = ix + a + q[0] - fx, dy = iy + b + q[1] - fy, dz = iz + c + q[2] - fz;
        d = Math.min(d, dx * dx + dy * dy + dz * dz);
      }
      return 1 - Math.min(1, Math.sqrt(d));
    }
    // tiling value noise for the Perlin-ish part
    const G = 8, gv = new Float32Array(G * G * G).map(() => rnd());
    const smooth = t => t * t * (3 - 2 * t);
    function vnoise(x, y, z, g) {
      const fx = x * g, fy = y * g, fz = z * g, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const tx = smooth(fx - ix), ty = smooth(fy - iy), tz = smooth(fz - iz);
      const v = (a, b, c) => gv[(((iz + c) % g) * G + ((iy + b) % g)) * G + ((ix + a) % g)];
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(v(0, 0, 0), v(1, 0, 0), tx), l(v(0, 1, 0), v(1, 1, 0), tx), ty), l(l(v(0, 0, 1), v(1, 0, 1), tx), l(v(0, 1, 1), v(1, 1, 1), tx), ty), tz);
    }
    let k = 0;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, w = z / N;
      const per = vnoise(u, v, w, 4) * 0.55 + vnoise(u, v, w, 8) * 0.3 + vnoise(u, v, w, 8) * 0.15;
      const wor = worley(u, v, w, 4, W1) * 0.625 + worley(u, v, w, 8, W2) * 0.25 + worley(u, v, w, 16, W3) * 0.125;
      const pw = Math.min(1, Math.max(0, per * 0.5 + wor * 0.7 - 0.15));   // Perlin-Worley: billowy
      data[k++] = Math.round(pw * 255);
      data[k++] = Math.round(worley(u, v, w, 8, W2) * 0.6 * 255 + worley(u, v, w, 16, W3) * 0.4 * 255);   // erosion detail
    }
    const t = new THREE.Data3DTexture(data, N, N, N);
    t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  }

  /** Shared uniforms: the layer (base, top, coverage), wind offset, sun, and the noise. */
  const U = {
    tCloudNoise: { value: null }, uCloudOn: { value: 0 }, uCloudBase: { value: 1500 }, uCloudTop: { value: 2900 },
    uCloudCover: { value: 0.56 }, uCloudWind: { value: new THREE.Vector3() }, uCloudSun: { value: new THREE.Vector3(0, 1, 0) },
  };
  // density at a world point: weather map x Perlin-Worley shape x a cumulus height profile, eroded
  const CLOUD_GLSL = `
uniform highp sampler3D tCloudNoise; uniform float uCloudOn, uCloudBase, uCloudTop, uCloudCover; uniform vec3 uCloudWind, uCloudSun;
float cloudRemap(float v, float a, float b, float c, float d) { return c + (v - a) / max(b - a, 1e-4) * (d - c); }
float cloudShape(vec3 p, out float hFrac) {
  hFrac = clamp((p.y - uCloudBase) / (uCloudTop - uCloudBase), 0.0, 1.0);
  vec3 q = (p + uCloudWind) / 4200.0;
  float weather = texture(tCloudNoise, vec3(q.xz * 0.21, 0.37)).r;
  float cov = clamp(uCloudCover * (0.55 + 0.9 * weather), 0.0, 1.0);
  float base = texture(tCloudNoise, q).r;
  float prof = smoothstep(0.0, 0.08, hFrac) * smoothstep(1.0, 0.45 + 0.3 * weather, hFrac);
  return clamp(cloudRemap(base * prof, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0);
}
float cloudDensity(vec3 p, float lod) {
  float h; float s = cloudShape(p, h);
  if (s <= 0.0) return 0.0;
  if (lod < 0.5) { float det = texture(tCloudNoise, (p + uCloudWind * 1.6) / 900.0).g; s = clamp(cloudRemap(s, det * 0.35 * (1.0 - h * 0.5), 1.0, 0.0, 1.0), 0.0, 1.0); }
  return s;
}
/** 1 in sunlight, darker under a cloud: one look up along the sun at mid-layer. */
float cloudShadow(vec3 p) {
  if (uCloudOn < 0.5 || uCloudSun.y < 0.05) return 1.0;
  float mid = mix(uCloudBase, uCloudTop, 0.3);
  vec3 q = p + uCloudSun * ((mid - p.y) / uCloudSun.y);
  float h; float s = cloudShape(q, h);
  return 1.0 - 0.72 * smoothstep(0.02, 0.35, s);
}`;

  const VS = `varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
  const FS = `precision highp sampler3D;
${CLOUD_GLSL}
uniform mat4 uInvProj, uCamWorld, uViewProj; uniform vec3 uCamPos, uSunCol, uZen, uHor, uFog; uniform float uSteps, uFogDens, uFrame;
varying vec2 vNdc;
// a fixed per-pixel jitter: a moving one shimmers without a temporal filter
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void main() {
  if (uCloudOn < 0.5) discard;
  vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0); v /= v.w;
  vec3 dir = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  // where the ray is inside the layer
  float t0, t1;
  if (abs(dir.y) < 1e-4) { if (uCamPos.y < uCloudBase || uCamPos.y > uCloudTop) discard; t0 = 0.0; t1 = 30000.0; }
  else {
    float ta = (uCloudBase - uCamPos.y) / dir.y, tb = (uCloudTop - uCamPos.y) / dir.y;
    t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb);
  }
  t1 = min(t1, t0 + 14000.0);
  if (t1 <= t0 || t0 > 42000.0) discard;
  float n = uSteps, dt = (t1 - t0) / n, t = t0 + dt * hash(gl_FragCoord.xy);
  float cosT = dot(dir, uCloudSun), phase = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3);
  vec3 col = vec3(0.0); float T = 1.0, firstT = -1.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= n || T < 0.03) break;
    vec3 p = uCamPos + dir * t;
    float d = cloudDensity(p, t > 6000.0 ? 1.0 : 0.0);
    if (d > 0.002) {
      if (firstT < 0.0) firstT = t;
      // light: a few steps toward the sun
      float od = 0.0;
      for (int j = 1; j <= 4; j++) od += cloudDensity(p + uCloudSun * (90.0 * float(j * j)), 1.0) * 90.0 * float(2 * j - 1);
      float sigma = 0.028;
      float lightT = exp(-od * sigma * 0.45);
      float powder = 1.0 - exp(-d * 6.0);
      float h = clamp((p.y - uCloudBase) / (uCloudTop - uCloudBase), 0.0, 1.0);
      // the sky's light, fading to almost nothing after dusk (no glowing blue clouds at night)
      float day = 0.06 + 0.94 * smoothstep(-0.12, 0.2, uCloudSun.y);
      vec3 amb = mix(uHor * 0.6, uZen * 0.95, h) * (0.4 + 0.6 * h) * day;
      vec3 S = uSunCol * lightT * (0.55 + phase * 12.0) * mix(0.5, 1.0, powder) * (0.2 + 0.8 * day) + amb;
      float a = 1.0 - exp(-d * sigma * dt);
      col += T * a * S; T *= 1.0 - a;
    }
    t += dt;
  }
  float alpha = 1.0 - T;
  if (alpha < 0.01) discard;
  float dist = firstT < 0.0 ? t0 : firstT;
  alpha *= 1.0 - smoothstep(26000.0, 40000.0, dist);
  // tone mapped and encoded exactly like the rest of the frame, then hazed in display space like
  // the height fog
  gl_FragColor = vec4(col / max(1.0 - T, 1e-3), alpha);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
  float f = 1.0 - exp(-pow(uFogDens * dist * 0.85, 1.25));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFog, clamp(f, 0.0, 1.0));
  // the cloud's own depth, so anything nearer hides it
  vec4 cp = uViewProj * vec4(uCamPos + dir * max(dist, 1.0), 1.0);
  gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 0.99999);
}`;

  function Clouds(scene) {
    this.u = Object.assign({
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() }, uSteps: { value: 40 }, uFogDens: { value: 0.0001 }, uFrame: { value: 0 },
    }, U);
    this.mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true, fog: false, toneMapped: true });
    this.mat.extensions = { fragDepth: true };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.visible = false;
    scene.add(this.mesh);
    this.level = 0; this.wind = new THREE.Vector3(); this.scene = scene;
  }
  /** level 0 off (billboards), 2 High, 3 Ultra. */
  Clouds.prototype.setLevel = function (level) {
    this.level = level;
    if (level >= 2 && !U.tCloudNoise.value) U.tCloudNoise.value = makeNoise(64);
    U.uCloudOn.value = level >= 2 ? 1 : 0;
    this.mesh.visible = level >= 2;
    this.u.uSteps.value = level >= 3 ? 56 : 32;
  };
  /** Per frame: camera, sun and sky colours from the world, the layer's height, wind drift. */
  Clouds.prototype.update = function (camera, world, base, dt, renderer) {
    if (this.level < 2) return;
    camera.updateMatrixWorld();
    this.u.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.u.uCamWorld.value.copy(camera.matrixWorld);
    this.u.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.u.uCamPos.value.copy(camera.position);
    const sd = world.sunDir || new THREE.Vector3(0, 1, 0);
    U.uCloudSun.value.copy(sd).normalize();
    const k = world.skyCols;
    if (k) { this.u.uZen.value.copy(k.zen); this.u.uHor.value.copy(k.hor); }
    this.u.uSunCol.value.copy(world.sun.color).multiplyScalar(world.sun.intensity * 0.85);
    this.u.uFog.value.copy(this.scene.fog.color); this.u.uFogDens.value = this.scene.fog.density;
    U.uCloudBase.value = base + 1450; U.uCloudTop.value = base + 2750;
    this.wind.x += dt * 6; this.wind.z += dt * 2.5;
    U.uCloudWind.value.copy(this.wind);
    this.u.uFrame.value = (this.u.uFrame.value + 1) % 64;
  };

  /** Which optional shader paths the ground compiles in (Performance compiles neither). */
  const flags = { clouds: false, shadow: false };
  const STUB = 'float cloudShadow(vec3 p) { return 1.0; }';
  const groundGLSL = () => flags.clouds ? CLOUD_GLSL : STUB;
  const key = () => (flags.clouds ? 'c' : '') + (flags.shadow ? 's' : '');

  window.Clouds = { create: scene => new Clouds(scene), U, CLOUD_GLSL, makeNoise, flags, groundGLSL, key };
})();
