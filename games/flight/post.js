/*
 * GYROWING post-processing for the High and Ultra graphics tiers: the frame is rendered as usual
 * (ACES tone mapping, sRGB, the display-space height fog), copied, and finished in a few cheap
 * full-screen passes:
 *
 *   bloom        bright parts (sun, sky near it, lit windows, runway lights) bleed softly
 *   light shafts (Ultra) the bright mask blurred radially from the sun: rays through clouds,
 *                between buildings and over ridges at dawn and dusk
 *   sun glare    a soft glow and faint lens ghosts when the sun is actually visible
 *   grade        a gentle filmic curve, saturation, warm highlights / cool shadows by sun height,
 *                vignette and fine grain
 *
 * Working on the finished display image keeps the atmosphere (which is matched in display space)
 * exact, and costs one copy plus quarter-resolution passes.
 */
(function () {
  'use strict';
  const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const BRIGHT = `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb; c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb; c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThreshold, uThreshold + 0.18, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;
  const BLUR = `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846154).rgb * 0.3162162; c += texture2D(tSrc, vUv - uDir * 1.3846154).rgb * 0.3162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692).rgb * 0.0702703; c += texture2D(tSrc, vUv - uDir * 3.2307692).rgb * 0.0702703;
  gl_FragColor = vec4(c, 1.0);
}`;
  const RAYS = `uniform sampler2D tSrc; uniform vec2 uSun; uniform float uLen; varying vec2 vUv;
void main() {
  vec2 d = (uSun - vUv) * uLen / 24.0;
  vec2 p = vUv; vec3 acc = vec3(0.0); float w = 1.0;
  for (int i = 0; i < 24; i++) { acc += texture2D(tSrc, p).rgb * w; w *= 0.93; p += d; }
  gl_FragColor = vec4(acc / 9.0, 1.0);
}`;
  const COMP = `uniform sampler2D tScene, tBloom, tRays; uniform vec2 uSun, uAspect; uniform float uBloom, uRays, uSunVis, uGlare, uWarm, uVig, uGrain, uTime, uSat, uContrast;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 b = texture2D(tBloom, vUv).rgb * uBloom;
  vec3 r = texture2D(tRays, vUv).rgb * uRays * uSunVis;
  c = 1.0 - (1.0 - c) * (1.0 - b) * (1.0 - r);   // screen blend: glows never clip to flat white
  // sun glare: a soft halo and two faint ghosts toward the centre, only while the sun is seen
  if (uSunVis > 0.01) {
    vec2 q = (vUv - uSun) * uAspect;
    float halo = exp(-length(q) * 13.0) * 0.16 + exp(-length(q) * 40.0) * 0.22;
    vec2 g1 = (vUv - mix(uSun, vec2(0.5), 1.35)) * uAspect, g2 = (vUv - mix(uSun, vec2(0.5), 1.8)) * uAspect;
    float ghosts = smoothstep(0.05, 0.0, length(g1)) * 0.05 + smoothstep(0.09, 0.0, length(g2)) * 0.035;
    c += (vec3(1.0, 0.86, 0.66) * halo + vec3(0.6, 0.8, 1.0) * ghosts) * uSunVis * uGlare;
  }
  // grade: filmic contrast around mid grey, saturation, split toning by sun height
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
  vec3 warm = vec3(1.04, 1.0, 0.94), cool = vec3(0.96, 0.99, 1.05);
  c *= mix(cool, warm, smoothstep(0.25, 0.85, l) * uWarm + (1.0 - uWarm) * 0.5);
  // vignette and grain
  vec2 v = (vUv - 0.5) * uAspect;
  c *= 1.0 - uVig * smoothstep(0.35, 1.05, length(v) * 1.25);
  c += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  function Post(renderer) {
    this.r = renderer;
    this.level = 0;   // 0 off, 1 grade only, 2 high (bloom, glare), 3 ultra (+ light shafts)
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false; this.scene.add(this.quad);
    const M = (fs, u) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false, toneMapped: false });
    this.mBright = M(BRIGHT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.72 } });
    this.mBlur = M(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mRays = M(RAYS, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uLen: { value: 0.9 } });
    this.mComp = M(COMP, { tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: new THREE.Vector2(1, 1) },
      uBloom: { value: 0.55 }, uRays: { value: 0.0 }, uSunVis: { value: 0 }, uGlare: { value: 1 }, uWarm: { value: 0.5 }, uVig: { value: 0.28 }, uGrain: { value: 0.018 }, uTime: { value: 0 },
      uSat: { value: 1.08 }, uContrast: { value: 1.06 } });
    this.size = new THREE.Vector2(); this.tex = null; this.rt = []; this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
    this.sunVis = 0; this.v0 = new THREE.Vector2(0, 0); this.tmp = new THREE.Vector3();
    this.lumBuf = new Uint8Array(4);
  }
  Post.prototype.alloc = function () {
    const w = this.size.x, h = this.size.y;
    if (this.tex) this.tex.dispose(); this.rt.forEach(t => t.dispose());
    this.tex = new THREE.FramebufferTexture(w, h, THREE.RGBAFormat);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    const q = () => new THREE.WebGLRenderTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), { depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType });
    this.rt = [q(), q(), q()];
  };
  Post.prototype.pass = function (mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); };

  /** Render the frame (with post-processing when the tier asks for it). sunDir: world unit vector. */
  Post.prototype.render = function (scene, camera, sunDir, opts) {
    const r = this.r;
    r.render(scene, camera);
    if (!this.level) return;
    r.getDrawingBufferSize(this.size);
    if (!this.tex || this.tex.image.width !== this.size.x || this.tex.image.height !== this.size.y) this.alloc();
    r.copyFramebufferToTexture(this.v0, this.tex);
    const [A, B, C] = this.rt, U = this.mComp.uniforms;
    const autoClear = r.autoClear;
    // where the sun is on screen, and whether it is in view at all
    let onScreen = false;
    if (sunDir && sunDir.y > -0.05) {
      this.tmp.copy(camera.position).addScaledVector(sunDir, 10000).project(camera);
      onScreen = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.3 && Math.abs(this.tmp.y) < 1.3;
      U.uSun.value.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5);
    }
    if (this.level >= 2) {
      this.mBright.uniforms.tSrc.value = this.tex; this.mBright.uniforms.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
      this.mBright.uniforms.uThreshold.value = opts && opts.night ? 0.78 : 0.84;
      this.pass(this.mBright, A);
      // two blur rounds, the second wider: a broad soft glow with a tighter core
      for (const k of [1, 2.2]) {
        this.mBlur.uniforms.tSrc.value = A; this.mBlur.uniforms.uDir.value.set(k / A.width, 0); this.pass(this.mBlur, B);
        this.mBlur.uniforms.tSrc.value = B; this.mBlur.uniforms.uDir.value.set(0, k / A.height); this.pass(this.mBlur, A);
      }
      U.tBloom.value = A.texture;
      if (this.level >= 3 && onScreen) {
        this.mBright.uniforms.uThreshold.value = 0.9; this.pass(this.mBright, C);
        this.mRays.uniforms.tSrc.value = C.texture; this.mRays.uniforms.uSun.value.copy(U.uSun.value); this.pass(this.mRays, B);
        U.tRays.value = B.texture;
      } else U.tRays.value = this.black;
      // the sun counts as seen if the frame is near white where it should be (clouds and hills hide it)
      // (read back five times a second: a readback stalls the pipeline, the glare eases anyway)
      let vis = this.visRaw || 0;
      this.frame = (this.frame || 0) + 1;
      if (!onScreen) vis = 0;
      else if (this.frame % 12 === 0 && this.tmp.x > -1 && this.tmp.x < 1 && this.tmp.y > -1 && this.tmp.y < 1) {
        r.setRenderTarget(null);
        const px = Math.round((this.tmp.x * 0.5 + 0.5) * (this.size.x - 1)), py = Math.round((this.tmp.y * 0.5 + 0.5) * (this.size.y - 1));
        try { r.getContext().readPixels(px, py, 1, 1, r.getContext().RGBA, r.getContext().UNSIGNED_BYTE, this.lumBuf); vis = this.lumBuf[0] > 235 && this.lumBuf[1] > 225 ? 1 : 0; } catch (e) { vis = 0; }
      }
      this.visRaw = vis;
      this.sunVis += (vis - this.sunVis) * 0.08;
    } else { U.tBloom.value = this.black; U.tRays.value = this.black; this.sunVis = 0; }
    U.tScene.value = this.tex;
    U.uBloom.value = this.level >= 2 ? (opts && opts.night ? 0.42 : 0.32) : 0;
    U.uRays.value = this.level >= 3 ? 0.4 : 0;
    U.uSunVis.value = this.sunVis;
    U.uGlare.value = this.level >= 2 ? 1 : 0;
    U.uWarm.value = opts ? opts.warm : 0.5;
    U.uAspect.value.set(this.size.x / this.size.y, 1);
    U.uTime.value = (U.uTime.value + 0.618) % 100;
    U.uGrain.value = this.level >= 2 ? 0.016 : 0.01;
    U.uContrast.value = this.level >= 2 ? 1.1 : 1.04; U.uSat.value = this.level >= 2 ? 1.12 : 1.05;
    r.autoClear = false;
    this.pass(this.mComp, null);
    r.autoClear = autoClear;
  };

  window.Post = Post;
})();
