/*
 * GYROWING atmosphere: a physical sky (Preetham Rayleigh + Mie scattering, after three.js' Sky
 * example, MIT) with stars and moon at night, and a height fog that replaces three's fog chunk for
 * every material: density thins with altitude (aerial perspective: valleys hazy, peaks crisp, distant
 * hills fade to the sky) and the haze glows toward the sun. The sky also feeds a PMREM environment
 * map so painted metal and glass reflect it.
 *
 * Fog colours are computed in JS from the same scattering model, tone-mapped and encoded exactly as
 * the renderer does (three applies fog after the output encoding), so the far terrain meets the sky
 * horizon without a seam.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------------------------------------------------------------- shared fog uniforms
  // Typed arrays are shared by reference when three clones ShaderLib uniforms into a material,
  // so one write per frame reaches every program.
  const shared = {
    fogSunView: { value: new Float32Array([0, 1, 0]) },
    fogSunColor: { value: new Float32Array([0, 0, 0]) },
    fogUpView: { value: new Float32Array([0, 1, 0]) },
    fogParams: { value: new Float32Array([0, 0, 0, 0]) },   // camera height, scale height, -, -
  };
  for (const k in THREE.ShaderLib) { const u = THREE.ShaderLib[k].uniforms; if (u && u.fogColor) Object.assign(u, shared); }

  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogView;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogView = mvPosition.xyz;\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogView;
	uniform vec3 fogSunView, fogSunColor, fogUpView;
	uniform vec4 fogParams;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
	float fDist = length( vFogView );
	vec3 fDir = vFogView / max( fDist, 1e-3 );
	float fogFactor;
	#ifdef FOG_EXP2
		if ( fogParams.y > 0.0 ) {
			// exponential height fog, integrated along the view ray
			float fk = dot( fDir, fogUpView ) * fDist / fogParams.y;
			float fInt = abs( fk ) > 1e-3 ? ( 1.0 - exp( - fk ) ) / fk : 1.0 - 0.5 * fk;
			fogFactor = 1.0 - exp( - fogDensity * exp( - max( fogParams.x, 0.0 ) / fogParams.y ) * fDist * fInt );
		} else {
			fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		}
	#else
		fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 fCol = fogColor + fogSunColor * pow( max( dot( fDir, fogSunView ), 0.0 ), 6.0 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fCol, clamp( fogFactor, 0.0, 1.0 ) );
#endif`;

  // ---------------------------------------------------------------- scattering model (JS twin of the shader)
  const P = { turbidity: 3.2, rayleigh: 2.2, mie: 0.004, g: 0.8, gain: 0.4 };
  const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const MIE = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  function skyLinear(d, s) {
    const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(clamp(s.y, -1, 1))) / 1.5)));
    const sunfade = 1 - clamp(1 - Math.exp(s.y / 450000), 0, 1);
    const rc = P.rayleigh - (1 - sunfade);
    const c = 0.2 * P.turbidity * 10e-18;
    const za = Math.acos(Math.max(0, d.y));
    const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - za * 180 / Math.PI, -1.253));
    const cosT = d.x * s.x + d.y * s.y + d.z * s.z;
    const rPh = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
    const g2 = P.g * P.g, mPh = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * P.g * cosT + g2, 1.5));
    const mk = clamp(Math.pow(1 - s.y, 5), 0, 1), add = [0, 0.0003, 0.00075], out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const bR = TR[i] * rc, bM = 0.434 * c * MIE[i] * P.mie;
      const Fex = Math.exp(-(bR * 8.4e3 * inv + bM * 1.25e3 * inv));
      const ratio = (bR * rPh + bM * mPh) / (bR + bM);
      let Lin = Math.pow(Math.max(0, sunE * ratio * (1 - Fex)), 1.5);
      Lin *= (1 - mk) + mk * Math.pow(Math.max(0, sunE * ratio * Fex), 0.5);
      const tex = (Lin + 0.1 * Fex) * 0.04 + add[i];
      out[i] = Math.pow(tex, 1 / (1.2 + 1.2 * sunfade)) * P.gain;
    }
    return out;
  }
  /** Linear HDR -> what the renderer writes (ACES filmic at `exposure`, then sRGB). */
  function display(c, exposure) {
    const e = exposure / 0.6, r = c[0] * e, g = c[1] * e, b = c[2] * e;
    const i = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.07600 * r + 0.90834 * g + 0.01566 * b, 0.02840 * r + 0.13383 * g + 0.83777 * b];
    const f = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
    const t = i.map(f);
    const o = [1.60475 * t[0] - 0.53108 * t[1] - 0.07367 * t[2], -0.10208 * t[0] + 1.10813 * t[1] - 0.00605 * t[2], -0.00327 * t[0] - 0.07276 * t[1] + 1.07602 * t[2]];
    return o.map(v => { v = clamp(v, 0, 1); return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; });
  }

  // ---------------------------------------------------------------- sky dome
  const SKY_VS = `
uniform vec3 sunPosition; uniform float rayleigh, turbidity, mieCoefficient;
varying vec3 vWorldDir, vSunDirection, vBetaR, vBetaM; varying float vSunfade, vSunE;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
void main() {
  vWorldDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
  vSunDirection = normalize( sunPosition );
  float zc = clamp( vSunDirection.y, -1.0, 1.0 );
  vSunE = 1000.0 * max( 0.0, 1.0 - exp( -( ( 1.6110731556870734 - acos( zc ) ) / 1.5 ) ) );
  vSunfade = 1.0 - clamp( 1.0 - exp( ( vSunDirection.y / 450000.0 ) ), 0.0, 1.0 );
  vBetaR = totalRayleigh * ( rayleigh - ( 1.0 - vSunfade ) );
  vBetaM = 0.434 * ( 0.2 * turbidity ) * 10E-18 * MieConst * mieCoefficient;
}`;
  const SKY_FS = `
uniform float mieDirectionalG, uGain, uNight;
uniform vec3 uMoonDir, uFogCol, uFogSun;
varying vec3 vWorldDir, vSunDirection, vBetaR, vBetaM; varying float vSunfade, vSunE;
const float pi = 3.141592653589793;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 direction = normalize( vWorldDir );
  float zenithAngle = acos( max( 0.0, direction.y ) );
  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
  vec3 Fex = exp( -( vBetaR * 8.4E3 * inverse + vBetaM * 1.25E3 * inverse ) );
  float cosTheta = dot( direction, vSunDirection );
  float rPhase = 0.05968310365946075 * ( 1.0 + pow( cosTheta * 0.5 + 0.5, 2.0 ) );
  float g2 = mieDirectionalG * mieDirectionalG;
  float mPhase = 0.07957747154594767 * ( ( 1.0 - g2 ) / pow( 1.0 - 2.0 * mieDirectionalG * cosTheta + g2, 1.5 ) );
  vec3 ratio = ( vBetaR * rPhase + vBetaM * mPhase ) / ( vBetaR + vBetaM );
  vec3 Lin = pow( max( vSunE * ratio * ( 1.0 - Fex ), 0.0 ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( max( vSunE * ratio * Fex, 0.0 ), vec3( 0.5 ) ), clamp( pow( 1.0 - vSunDirection.y, 5.0 ), 0.0, 1.0 ) );
  vec3 L0 = vec3( 0.1 ) * Fex;
  float sundisk = smoothstep( 0.99990, 0.99994, cosTheta );
  L0 += ( vSunE * 1900.0 * Fex ) * sundisk;
  vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );
  vec3 col = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) ) * uGain;
  // night: deep blue, stars, moon
  if ( uNight > 0.01 ) {
    col += vec3( 0.004, 0.007, 0.016 ) * uNight;
    vec3 sp = floor( direction * 380.0 );
    float s = hash12( sp.xy + sp.z * 17.31 );
    float star = step( 0.9975, s ) * ( 0.4 + 0.6 * hash12( sp.zy + 3.1 ) );
    col += vec3( 0.9, 0.95, 1.0 ) * star * uNight * smoothstep( 0.02, 0.25, direction.y ) * 1.2;
    float md = max( dot( direction, uMoonDir ), 0.0 );
    col += vec3( 0.85, 0.9, 1.0 ) * smoothstep( 0.99985, 0.99992, md ) * 2.5 * uNight + vec3( 0.03, 0.04, 0.07 ) * pow( md, 30.0 ) * uNight;
  }
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <encodings_fragment>
  // the horizon meets the far terrain haze exactly (fog is applied in display space)
  vec3 fogC = uFogCol + uFogSun * pow( max( cosTheta, 0.0 ), 6.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, smoothstep( 0.06, -0.01, direction.y ) );
}`;

  function createSky() {
    const u = {
      sunPosition: { value: new THREE.Vector3(0, 1, 0) }, rayleigh: { value: P.rayleigh }, turbidity: { value: P.turbidity },
      mieCoefficient: { value: P.mie }, mieDirectionalG: { value: P.g }, uGain: { value: P.gain }, uNight: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(0.3, 0.6, 0.5).normalize() }, uFogCol: { value: new THREE.Color() }, uFogSun: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), mat);
    mesh.renderOrder = -10; mesh.frustumCulled = false;
    return { mesh, mat, u };
  }

  // ---------------------------------------------------------------- environment map
  let pmrem = null, envRT = null, envScene = null, envSky = null;
  function updateEnvironment(renderer, scene, sky) {
    try {
      if (!pmrem) {
        pmrem = new THREE.PMREMGenerator(renderer);
        envScene = new THREE.Scene();
        envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), sky.mat);
        envScene.add(envSky);
        // the lower hemisphere reflects the land, not more sky
        const ground = new THREE.Mesh(new THREE.CircleGeometry(95, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        ground.position.y = -6; envScene.add(ground); envScene.userData.ground = ground;
      }
      envScene.userData.ground.material.color.copy(sky.groundTint || new THREE.Color(0.05, 0.06, 0.04));
      const old = envRT;
      envRT = pmrem.fromScene(envScene, 0, 1, 500);
      scene.environment = envRT.texture;
      if (old) old.dispose();
    } catch (e) { console.warn('[gyrowing] environment map unavailable', e); }
  }

  /** Recompute fog/sky colours for a sun direction. Returns display-space fog colours. */
  function setSun(sky, sunDir, night, moonDir, exposure, scene) {
    sky.u.sunPosition.value.copy(sunDir);
    sky.u.uNight.value = night;
    if (moonDir) sky.u.uMoonDir.value.copy(moonDir);
    // haze colour: the horizon 90 deg from the sun; the glow: toward the sun
    const s = { x: sunDir.x, y: sunDir.y, z: sunDir.z };
    const hl = Math.hypot(s.x, s.z) || 1;
    const away = { x: -s.z / hl * 0.998, y: 0.05, z: s.x / hl * 0.998 };
    const toward = { x: s.x / hl * 0.995, y: 0.05, z: s.z / hl * 0.995 };
    const nightCol = [0.006 * night, 0.010 * night, 0.022 * night];
    const la = skyLinear(away, s).map((v, i) => v + nightCol[i]), lt = skyLinear(toward, s).map((v, i) => v + nightCol[i]);
    const da = display(la, exposure), dt = display(lt, exposure);
    const fog = scene.fog;
    fog.color.setRGB(da[0], da[1], da[2]);
    shared.fogSunColor.value.set([Math.max(0, dt[0] - da[0]), Math.max(0, dt[1] - da[1]), Math.max(0, dt[2] - da[2])]);
    sky.u.uFogCol.value.copy(fog.color);
    sky.u.uFogSun.value.setRGB(shared.fogSunColor.value[0], shared.fogSunColor.value[1], shared.fogSunColor.value[2]);
    // linear sky colours for the water reflection and the clouds
    const zen = skyLinear({ x: 0, y: 1, z: 0 }, s), hor = la;
    return { zen: new THREE.Color(zen[0] + nightCol[0], zen[1] + nightCol[1], zen[2] + nightCol[2]), hor: new THREE.Color(hor[0], hor[1], hor[2]), toward: new THREE.Color(lt[0], lt[1], lt[2]) };
  }

  const tmpV = new THREE.Vector3();
  /** Per frame: sun and up directions into view space, camera height. */
  function update(camera, sunDir, density, scaleHeight, base) {
    camera.updateMatrixWorld();
    const m = camera.matrixWorldInverse;
    tmpV.copy(sunDir).transformDirection(m); shared.fogSunView.value.set([tmpV.x, tmpV.y, tmpV.z]);
    tmpV.set(0, 1, 0).transformDirection(m); shared.fogUpView.value.set([tmpV.x, tmpV.y, tmpV.z]);
    shared.fogParams.value[0] = camera.position.y - (base || 0); shared.fogParams.value[1] = scaleHeight;
  }

  window.Atmos = { shared, createSky, setSun, update, updateEnvironment, skyLinear, display, P };
})();
