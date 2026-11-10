/*
 * Emberlane - frame pipeline: the scene renders into a multisampled half-float target (HDR),
 * a small bloom chain picks out what is brighter than white (lane lights, neon, glints), a
 * grade pass adds it back and applies exposure + ACES filmic tone mapping and the display curve
 * (once per pixel), and the final pass does FXAA, a soft vignette and a little grain.
 */
(function () {
  'use strict';
  const T = THREE;

  const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  const PREFILTER = `uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold; uniform float knee; varying vec2 vUv;
    vec3 pick(vec3 c){ float l = max(c.r, max(c.g, c.b)); float s = clamp(l - threshold + knee, 0.0, 2.0 * knee); s = s * s / (4.0 * knee + 1e-4);
      float w = max(s, l - threshold) / max(l, 1e-4); return c * w; }
    void main(){
      vec3 a = texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb, b = texture2D(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb;
      vec3 c = texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb, d = texture2D(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb;
      vec3 m = (pick(a) + pick(b) + pick(c) + pick(d)) * 0.25;
      gl_FragColor = vec4(min(m, vec3(60.0)), 1.0); }`;

  // dual-filter downsample (Marius Bjorge, ARM 2015)
  const DOWN = `uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
    void main(){ vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
      s += texture2D(tSrc, vUv - texel).rgb; s += texture2D(tSrc, vUv + texel).rgb;
      s += texture2D(tSrc, vUv + vec2(texel.x, -texel.y)).rgb; s += texture2D(tSrc, vUv - vec2(texel.x, -texel.y)).rgb;
      gl_FragColor = vec4(s / 8.0, 1.0); }`;
  const UP = `uniform sampler2D tSrc; uniform sampler2D tHigh; uniform vec2 texel; uniform float mixHigh; varying vec2 vUv;
    void main(){ vec3 s = vec3(0.0);
      s += texture2D(tSrc, vUv + vec2(-texel.x * 2.0, 0.0)).rgb; s += texture2D(tSrc, vUv + vec2(-texel.x, texel.y)).rgb * 2.0;
      s += texture2D(tSrc, vUv + vec2(0.0, texel.y * 2.0)).rgb; s += texture2D(tSrc, vUv + vec2(texel.x, texel.y)).rgb * 2.0;
      s += texture2D(tSrc, vUv + vec2(texel.x * 2.0, 0.0)).rgb; s += texture2D(tSrc, vUv + vec2(texel.x, -texel.y)).rgb * 2.0;
      s += texture2D(tSrc, vUv + vec2(0.0, -texel.y * 2.0)).rgb; s += texture2D(tSrc, vUv + vec2(-texel.x, -texel.y)).rgb * 2.0;
      gl_FragColor = vec4(s / 12.0 + texture2D(tHigh, vUv).rgb * mixHigh, 1.0); }`;

  // grade once per pixel (bloom, flash, exposure, ACES, saturation) into an 8-bit target in
  // display gamma with luma in alpha; then FXAA, vignette and grain read that
  const GRADE = `uniform sampler2D tScene; uniform sampler2D tBloom; uniform float bloom; uniform float exposure;
    uniform float flash; uniform vec3 flashColor; uniform float saturation; varying vec2 vUv;
    vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c){ const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
      const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
      c = IN * c; c = RRTAndODTFit(c); c = OUT * c; return clamp(c, 0.0, 1.0); }
    void main(){
      // the strike flash lifts what is already lit and its glow (a flat wash greyed the blacks)
      vec3 c = texture2D(tScene, vUv).rgb * (1.0 + flash * 0.55) + texture2D(tBloom, vUv).rgb * bloom * (1.0 + flash * 2.8) + flashColor * flash * 0.05;
      c = aces(c * exposure / 0.6); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = clamp(mix(vec3(l), c, saturation), 0.0, 1.0);
      c = pow(c, vec3(1.0 / 2.2));
      gl_FragColor = vec4(c, dot(c, vec3(0.299, 0.587, 0.114))); }`;

  const COMPOSITE = `uniform sampler2D tGraded; uniform float vignette; uniform float time; uniform vec2 texel; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      // FXAA (lightweight, on the graded image)
      vec4 M = texture2D(tGraded, vUv);
      float lNW = texture2D(tGraded, vUv + vec2(-1.0, -1.0) * texel).a, lNE = texture2D(tGraded, vUv + vec2(1.0, -1.0) * texel).a;
      float lSW = texture2D(tGraded, vUv + vec2(-1.0, 1.0) * texel).a, lSE = texture2D(tGraded, vUv + vec2(1.0, 1.0) * texel).a, lM = M.a;
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      vec3 c = M.rgb;
      if (lMax - lMin >= 0.04) {
        vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
        float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
        float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
        dir = clamp(dir * rcp, -8.0, 8.0) * texel;
        vec3 a = 0.5 * (texture2D(tGraded, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tGraded, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 b = a * 0.5 + 0.25 * (texture2D(tGraded, vUv - dir * 0.5).rgb + texture2D(tGraded, vUv + dir * 0.5).rgb);
        float lB = dot(b, vec3(0.299, 0.587, 0.114));
        c = (lB < lMin || lB > lMax) ? a : b;
      }
      vec2 d = vUv - 0.5; d.x *= 1.25; c *= pow(1.0 - vignette * smoothstep(0.25, 0.85, length(d)), 1.0 / 2.2);
      c += (hash(vUv * 1000.0) - 0.5) / 255.0 * 1.5;
      gl_FragColor = vec4(c, 1.0); }`;

  function create(renderer, o) {
    o = o || {};
    const quadGeo = new T.BufferGeometry();
    quadGeo.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    quadGeo.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new T.Mesh(quadGeo);
    quad.frustumCulled = false;
    const qScene = new T.Scene(); qScene.add(quad);
    const qCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = (frag, uniforms) => new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    const mPre = mat(PREFILTER, { tSrc: { value: null }, texel: { value: new T.Vector2() }, threshold: { value: 2.4 }, knee: { value: 0.8 } });
    const mDown = mat(DOWN, { tSrc: { value: null }, texel: { value: new T.Vector2() } });
    const mUp = mat(UP, { tSrc: { value: null }, tHigh: { value: null }, texel: { value: new T.Vector2() }, mixHigh: { value: 1 } });
    const mGrade = mat(GRADE, { tScene: { value: null }, tBloom: { value: null }, bloom: { value: 0.55 }, exposure: { value: 1.0 },
      flash: { value: 0 }, flashColor: { value: new T.Color(1, 0.75, 0.45) }, saturation: { value: 1.05 } });
    const mComp = mat(COMPOSITE, { tGraded: { value: null }, vignette: { value: 0.42 }, texel: { value: new T.Vector2() }, time: { value: 0 } });
    // one uniforms object for the game (bloom, exposure, flash, ... live on the grade pass)
    const uniforms = Object.assign({}, mGrade.uniforms, mComp.uniforms);

    const opts = { type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false };
    const LEVELS = 5;
    let sceneRT = null, gradedRT = null, down = [], up = [], w = 0, h = 0;
    const msaa = renderer.capabilities.isWebGL2 ? (o.msaa != null ? +o.msaa : 0) : 0;

    function setSize(W, H) {
      if (W === w && H === h) return;
      w = W; h = H;
      if (sceneRT) sceneRT.dispose();
      sceneRT = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType, samples: msaa, depthBuffer: true });
      if (gradedRT) gradedRT.dispose();
      gradedRT = new T.WebGLRenderTarget(W, H, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false });
      down.forEach(r => r.dispose()); up.forEach(r => r.dispose());
      down = []; up = [];
      let dw = W >> 1, dh = H >> 1;
      for (let i = 0; i < LEVELS; i++) {
        down.push(new T.WebGLRenderTarget(Math.max(1, dw), Math.max(1, dh), opts));
        up.push(new T.WebGLRenderTarget(Math.max(1, dw), Math.max(1, dh), opts));
        dw >>= 1; dh >>= 1;
      }
    }
    function pass(m, target) { quad.material = m; renderer.setRenderTarget(target); renderer.render(qScene, qCam); }

    function render(scene, camera, t) {
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      // bloom
      mPre.uniforms.tSrc.value = sceneRT.texture; mPre.uniforms.texel.value.set(1 / w, 1 / h);
      pass(mPre, down[0]);
      for (let i = 1; i < LEVELS; i++) {
        mDown.uniforms.tSrc.value = down[i - 1].texture;
        mDown.uniforms.texel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
        pass(mDown, down[i]);
      }
      let low = down[LEVELS - 1];
      for (let i = LEVELS - 2; i >= 0; i--) {
        mUp.uniforms.tSrc.value = low.texture; mUp.uniforms.tHigh.value = down[i].texture;
        mUp.uniforms.texel.value.set(0.5 / low.width, 0.5 / low.height);
        pass(mUp, up[i]);
        low = up[i];
      }
      mGrade.uniforms.tScene.value = sceneRT.texture; mGrade.uniforms.tBloom.value = low.texture;
      pass(mGrade, gradedRT);
      mComp.uniforms.texel.value.set(1 / w, 1 / h); mComp.uniforms.tGraded.value = gradedRT.texture; mComp.uniforms.time.value = t % 100;
      pass(mComp, null);
    }
    return { setSize, render, uniforms, pre: mPre.uniforms, sceneTarget: () => sceneRT };
  }

  window.BW = window.BW || {};
  window.BW.Post = { create };
})();
