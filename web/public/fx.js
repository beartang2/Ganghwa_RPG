/*!
 * fx.js — 강화 RPG 시각 효과. React Bits 컴포넌트를 빌드 없는 바닐라 JS 로 옮긴 이식본.
 *
 * 원본: React Bits — https://reactbits.dev · https://github.com/DavidHDev/react-bits (commit e12c221, JS-CSS 변형)
 *   Backgrounds/Particles        → Fx.embers          (화로 불씨 배경)
 *   Animations/ClickSpark        → Fx.clickSpark      (망치질 불꽃)
 *   Animations/StarBorder        → Fx.starBorder      (강화 버튼 테두리 빛)
 *   Animations/ElectricBorder    → Fx.electricBorder  (장인의 기운 100% 때 무기 패널)
 *   TextAnimations/GradientText  → Fx.gradientText    (전설·초월 무기 이름)
 *   TextAnimations/ShinyText     → Fx.shinyText       (로그인 타이틀)
 *   Components/Counter           → Fx.counter         (골드 숫자 굴림)
 *   Backgrounds/PrismaticBurst   → Fx.prismBurst      (💎 프리즘 대박 순간 한 번 터지는 분광 폭발)
 *   Animations/GlareHover        → Fx.glare           (상자·보상 위를 훑는 광택)
 *
 * 이식 원칙: 알고리즘·셰이더·물리 상수는 원본 그대로 두고, React 훅(useRef/useEffect/useState)만
 * 클로저와 일반 객체로 바꿨다. 게임에 쓰지 않는 기능(Particles 연결선·라이트모드, Counter 모션블러,
 * 텍스트 글로우용 복제 노드 등)은 덜어냈다. 모든 효과는 prefers-reduced-motion 을 존중하고,
 * 화면에서 안 보이거나 탭이 숨겨지면 렌더 루프를 멈춘다.
 *
 * ---------------------------------------------------------------------------------------------
 * MIT + Commons Clause License Condition v1.0
 *
 * Copyright (c) 2026 David Haz
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * ## Commons Clause Restriction
 *
 * You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**
 *
 * The same restriction covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab and any tools added later) and the sounds in the sound library. **You may not sell, sublicense, or redistribute the tools or the sounds themselves, or offer the tools or a substantially similar copy of them as a hosted service-whether alone, in a bundle, or as a ported version.**
 *
 * What you make with the tools is yours to use. You can use exported code, images, videos, and audio files in any personal or commercial application, website, or product, including paid ones. **You may not sell or redistribute the exports on their own, either individually or as the product itself, such as a sound, texture, background, or template pack.**
 *
 * ## No Warranty
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * ---------------------------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* ============================== 공통 ============================== */
  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const reducedMotion = () => (window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false);
  const noop = () => {};

  const compileShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.error('[fx]', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  };

  const linkProgram = (gl, vertexSource, fragmentSource) => {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = vertex && fragment ? gl.createProgram() : null;
    if (!vertex || !fragment || !program) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[fx]', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  };

  // CSS 색 문자열 → [r,g,b] (0~255). 캔버스 fillStyle 정규화를 이용(원본들과 같은 방식).
  let colorProbe = null;
  const toRgb255 = color => {
    colorProbe = colorProbe || document.createElement('canvas').getContext('2d');
    if (!colorProbe) return [255, 255, 255];
    colorProbe.fillStyle = '#000000';
    colorProbe.fillStyle = color;
    const value = String(colorProbe.fillStyle);
    if (value.startsWith('#')) {
      const hex = parseInt(value.slice(1, 7), 16);
      return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    }
    const parts = (value.match(/[\d.]+/g) || [255, 255, 255]).map(Number);
    return [parts[0], parts[1], parts[2]];
  };

  /* ===================== Particles → Fx.embers ===================== */
  const P_SHAPES = { circle: 0, square: 1, ring: 2, sparkle: 3 };
  const P_EFFECTS = { parallax: 0, repel: 1, attract: 2 };
  const P_DRIFTS = { none: 0, up: 1, down: 2, forward: 3 };
  const P_MAX_COUNT = 20000;
  const P_MAX_BURSTS = 4;
  const P_DEPTH = 10;
  const P_FOCAL = 1 / Math.tan((7.5 * Math.PI) / 180);
  const P_NEAR = 0.1;
  const P_FAR = 100;
  const P_INTRO_SECONDS = 1.8;
  const P_BURST_SECONDS = 1.5;
  const P_BURST_SPEED = 520;
  const P_BURST_WIDTH = 46;

  const PARTICLE_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aPosition;
layout(location = 2) in vec4 aRandom;
layout(location = 3) in vec3 aColor;
uniform mat3 uRotation;
uniform vec3 uOffset;
uniform float uSpread;
uniform float uTime;
uniform float uCamera;
uniform float uAspect;
uniform vec2 uView;
uniform float uRatio;
uniform float uSize;
uniform float uRandomness;
uniform float uBlur;
uniform float uFocus;
uniform float uGlow;
uniform float uTwinkle;
uniform int uShape;
uniform int uDrift;
uniform float uTravel;
uniform vec4 uPointer;
uniform int uEffect;
uniform float uStrength;
uniform vec4 uBursts[${P_MAX_BURSTS}];
uniform int uBurstCount;
uniform float uReveal;
out vec2 vLocal;
out float vRadius;
out float vBlur;
out float vAlpha;
out float vHalo;
out float vSeed;
out vec3 vColor;

vec3 bob(vec4 r, float t) {
  return vec3(
    sin(t * r.z + 6.28 * r.w) * mix(0.1, 1.5, r.x),
    sin(t * r.y + 6.28 * r.x) * mix(0.1, 1.5, r.w),
    sin(t * r.w + 6.28 * r.y) * mix(0.1, 1.5, r.z)
  );
}

void main() {
  vec3 pos = aPosition * uSpread;
  pos.z *= ${P_DEPTH.toFixed(1)};
  vec3 wobble = bob(aRandom, uTime);
  vec3 world = uRotation * pos + uOffset + wobble;
  float edge = 1.0;
  if (uDrift == 1 || uDrift == 2) {
    float span = uSpread * 2.0 + 3.0;
    float k = mod(aRandom.w * span + uOffset.y + wobble.y + (uDrift == 1 ? uTravel : -uTravel), span);
    world.y = k - span * 0.5;
    edge = smoothstep(0.0, span * 0.12, k) * smoothstep(span, span * 0.88, k);
  } else if (uDrift == 3) {
    float span = uSpread * ${P_DEPTH.toFixed(1)} * 2.0 + 3.0;
    float k = mod(aRandom.y * span + uOffset.z + wobble.z + uTravel, span);
    world.z = k - span * 0.5;
    edge = smoothstep(0.0, span * 0.1, k);
  }
  vec3 view = world - vec3(0.0, 0.0, uCamera);
  float dist = length(view);
  float ahead = -view.z;
  if (ahead < ${P_NEAR.toFixed(2)} || ahead > ${P_FAR.toFixed(1)}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  edge *= smoothstep(1.0, 4.0, ahead);
  vec2 ndc = vec2(view.x * ${P_FOCAL.toFixed(6)} / uAspect, view.y * ${P_FOCAL.toFixed(6)}) / ahead;
  vec2 screen = (ndc * 0.5 + 0.5) * uView;

  vec2 shift = vec2(0.0);
  float flash = 0.0;
  if (uEffect != 0 && uPointer.z > 0.001) {
    vec2 delta = screen - uPointer.xy;
    float reach = length(delta);
    float falloff = exp(-dot(delta, delta) / (uPointer.w * uPointer.w));
    vec2 away = reach > 0.001 ? delta / reach : vec2(0.0);
    shift += (uEffect == 1 ? away * uPointer.w * 0.5 : -delta * 0.6) * falloff * uStrength * uPointer.z;
  }
  for (int i = 0; i < ${P_MAX_BURSTS}; i++) {
    if (i >= uBurstCount) break;
    vec4 burst = uBursts[i];
    vec2 delta = screen - burst.xy;
    float reach = length(delta);
    float wave = exp(-pow((reach - burst.z * ${P_BURST_SPEED.toFixed(1)}) / ${P_BURST_WIDTH.toFixed(1)}, 2.0));
    vec2 away = reach > 0.001 ? delta / reach : vec2(0.0);
    float fade = (1.0 - burst.z) * (1.0 - burst.z) * burst.w;
    shift += away * wave * fade * 56.0 * smoothstep(0.0, 30.0, reach);
    flash += wave * fade;
  }
  screen += shift;

  float diameter = (uRandomness <= 0.0 ? uSize : uSize * (1.0 + uRandomness * (aRandom.x - 0.5)) / dist) * (1.0 + min(flash, 1.0) * 0.6);
  float device = diameter * uRatio;
  float radius = max(diameter, 1.0 / uRatio) * 0.5;
  float coverage = min(1.0, device * device);
  float blur = uBlur * max(uFocus - dist, 0.0) / max(dist, 1.0);
  float halo = uGlow > 0.0 ? radius * 2.5 + 2.0 : 0.0;
  float extent = radius * (uShape == 3 ? 1.6 : 1.0) + blur + halo + 1.5;

  float twinkle = 1.0 - uTwinkle * 0.6 * (0.5 + 0.5 * sin(uTime * (6.0 + aRandom.y * 14.0) + aRandom.w * 40.0));
  float far = smoothstep(${P_FAR.toFixed(1)}, ${(P_FAR * 0.9).toFixed(1)}, ahead);
  float focus = radius / (radius + blur);
  float reveal = clamp(uReveal * 1.6 - aRandom.z * 0.6, 0.0, 1.0);

  vLocal = aCorner * extent;
  vRadius = radius;
  vBlur = blur;
  vHalo = halo;
  vSeed = aRandom.y;
  vAlpha = min(1.0, coverage * twinkle * (1.0 + flash * 1.4)) * far * edge * max(focus, 0.35) * reveal * reveal;
  vColor = aColor;
  gl_Position = vec4((screen + aCorner * extent) / uView * 2.0 - 1.0, 0.0, 1.0);
}`;

  const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform int uShape;
uniform float uGlow;
uniform float uRatio;
uniform float uTime;
uniform float uSoft;
uniform float uShimmer;
uniform float uOpacity;
in vec2 vLocal;
in float vRadius;
in float vBlur;
in float vAlpha;
in float vHalo;
in float vSeed;
in vec3 vColor;
out vec4 outColor;

float ray(vec2 q, float aa) {
  float width = 0.14 * max(0.0, 1.0 - q.x);
  return (1.0 - smoothstep(width - aa, width + aa, q.y)) * step(q.x, 1.0);
}

void main() {
  float soft = vBlur + 0.7 / uRatio + vRadius * uSoft;
  float d = length(vLocal);
  float shape;
  if (uShape == 1) {
    float box = max(abs(vLocal.x), abs(vLocal.y));
    shape = 1.0 - smoothstep(vRadius * 0.86 - soft, vRadius * 0.86 + soft, box);
  } else if (uShape == 2) {
    float edge = max(vRadius * 0.22, 0.6 / uRatio);
    shape = 1.0 - smoothstep(edge - soft, edge + soft, abs(d - vRadius * 0.8));
  } else if (uShape == 3) {
    float reach = vRadius * 1.6;
    vec2 q = abs(vLocal) / max(reach, 0.0001);
    float aa = soft / max(reach, 0.0001);
    shape = max(max(ray(q, aa), ray(q.yx, aa)), 1.0 - smoothstep(vRadius * 0.32 - soft, vRadius * 0.32 + soft, d));
  } else {
    shape = 1.0 - smoothstep(vRadius - soft, vRadius + soft, d);
  }
  float halo = vHalo > 0.0 ? exp(-d / (vHalo * 0.35)) * uGlow * 0.4 : 0.0;
  float alpha = clamp(shape + halo * (1.0 - shape), 0.0, 1.0) * vAlpha * uOpacity * (1.0 - uSoft);
  if (alpha < 0.002) discard;
  vec2 uv = vLocal / max(vRadius * 2.0, 0.0001) + 0.5;
  vec3 color = clamp(vColor + uShimmer * 0.2 * sin(uv.yxx + uTime + vSeed * 6.28), 0.0, 1.0);
  outColor = vec4(color * alpha, alpha);
}`;

  const seeded = seed => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const easeOutCubic = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  function embers(container, options) {
    const o = Object.assign({
      particleCount: 200, particleSpread: 10, speed: 0.1, particleColors: ['#ffffff'],
      moveParticlesOnHover: true, particleHoverFactor: 1, alphaParticles: false, particleBaseSize: 100,
      sizeRandomness: 1, cameraDistance: 20, disableRotation: false, pixelRatio: undefined, shape: 'circle',
      glow: 0.5, twinkle: 0.3, depthOfField: 0, hoverEffect: 'parallax', hoverRadius: 140, clickBurst: true,
      drift: 'none', driftSpeed: 1, variation: 0, intro: true, opacity: 1, paused: false,
    }, options);
    const palette = [].concat(o.particleColors).filter(Boolean).map(String);
    const s = {
      count: clamp(Math.round(o.particleCount), 1, P_MAX_COUNT),
      spread: Math.max(0.1, o.particleSpread),
      speed: o.speed,
      colors: palette.length ? palette : ['#ffffff'],
      mouse: o.moveParticlesOnHover,
      hoverFactor: Math.max(0, o.particleHoverFactor),
      soft: o.alphaParticles,
      size: Math.max(0, o.particleBaseSize),
      randomness: Math.max(0, o.sizeRandomness),
      camera: Math.max(1, o.cameraDistance),
      rotate: !o.disableRotation,
      dpr: o.pixelRatio,
      shape: P_SHAPES[o.shape] ?? 0,
      glow: Math.max(0, o.glow),
      twinkle: clamp(o.twinkle, 0, 1),
      depthOfField: Math.max(0, o.depthOfField),
      hoverEffect: P_EFFECTS[o.hoverEffect] ?? 0,
      hoverRadius: Math.max(20, o.hoverRadius),
      clickBurst: o.clickBurst,
      drift: P_DRIFTS[o.drift] ?? 0,
      driftSpeed: o.driftSpeed,
      variation: Math.max(0, Math.round(o.variation)),
      intro: o.intro,
      opacity: clamp(o.opacity, 0, 1),
      paused: o.paused,
    };

    container.classList.add('fx-embers');
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-embers__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    const dots = gl ? linkProgram(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT) : null;
    if (!gl || !dots) { canvas.remove(); return { burst: noop, destroy: noop }; }   // WebGL2 미지원 → CSS 배경만

    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const positionBuffer = gl.createBuffer();
    const randomBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();
    const dotVao = gl.createVertexArray();
    gl.bindVertexArray(dotVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const attach = (buffer, location, width) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, width, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(location, 1);
    };
    attach(positionBuffer, 1, 3);
    attach(randomBuffer, 2, 4);
    attach(colorBuffer, 3, 3);
    gl.bindVertexArray(null);

    const reduce = reducedMotion();
    const view = { width: 1, height: 1, ratio: 1 };
    const pointer = { x: 0, y: 0, sx: 0, sy: 0, nx: 0, ny: 0, inside: false, active: 0 };
    const state = { clock: 0, spin: 0, travel: 0, offsetX: 0, offsetY: 0, reveal: s.intro && !reduce ? 0 : 1 };
    const bursts = [];
    const packedBursts = new Float32Array(P_MAX_BURSTS * 4);
    const cloud = { key: '', count: 0 };
    let raf = 0;
    let last = 0;
    let visible = true;

    const rebuild = () => {
      const key = `${s.count}|${s.variation}|${s.colors.join(',')}`;
      if (key === cloud.key) return;
      cloud.key = key;
      const next = seeded(s.variation * 7919 + 1);
      const total = s.count;
      const positions = new Float32Array(total * 3);
      const randoms = new Float32Array(total * 4);
      const tints = new Float32Array(total * 3);
      const swatches = s.colors.map(value => toRgb255(value).map(v => v / 255));
      for (let i = 0; i < total; i++) {
        let x, y, z, len;
        do {
          x = next() * 2 - 1;
          y = next() * 2 - 1;
          z = next() * 2 - 1;
          len = x * x + y * y + z * z;
        } while (len > 1 || len === 0);
        const r = Math.cbrt(next());
        positions.set([x * r, y * r, z * r], i * 3);
        randoms.set([next(), next(), next(), next()], i * 4);
        tints.set(swatches[Math.floor(next() * swatches.length)], i * 3);
      }
      cloud.count = total;
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, randomBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, randoms, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, tints, gl.STATIC_DRAW);
    };

    const rotation = () => {
      const elapsed = state.clock * 1000;
      const x = s.rotate ? Math.sin(elapsed * 0.0002) * 0.1 : 0;
      const y = s.rotate ? Math.cos(elapsed * 0.0005) * 0.15 : 0;
      const z = s.rotate ? state.spin : 0;
      const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z);
      return [
        cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz,
        -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz,
        sy * cx, -sx, cy * cx,
      ];
    };

    const render = () => {
      rebuild();
      const matrix = rotation();
      const oz = -(1 - easeOutCubic(state.reveal)) * 70;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      let burstCount = 0;
      for (let i = bursts.length - 1; i >= 0 && burstCount < P_MAX_BURSTS; i--) {
        packedBursts.set([bursts[i].x, bursts[i].y, bursts[i].age / P_BURST_SECONDS, 1], burstCount * 4);
        burstCount++;
      }
      const u = dots.uniforms;
      gl.useProgram(dots.program);
      gl.bindVertexArray(dotVao);
      gl.uniformMatrix3fv(u.uRotation, false, matrix);
      gl.uniform3f(u.uOffset, state.offsetX, state.offsetY, oz);
      gl.uniform1f(u.uSpread, s.spread);
      gl.uniform1f(u.uTime, state.clock);
      gl.uniform1f(u.uCamera, s.camera);
      gl.uniform1f(u.uAspect, view.width / view.height);
      gl.uniform2f(u.uView, view.width, view.height);
      gl.uniform1f(u.uRatio, view.ratio);
      gl.uniform1f(u.uSize, s.size);
      gl.uniform1f(u.uRandomness, s.randomness);
      gl.uniform1f(u.uBlur, s.depthOfField * 14);
      gl.uniform1f(u.uFocus, s.camera + 14);
      gl.uniform1f(u.uGlow, s.glow);
      gl.uniform1f(u.uTwinkle, s.twinkle);
      gl.uniform1i(u.uShape, s.shape);
      gl.uniform1i(u.uDrift, s.drift);
      gl.uniform1f(u.uTravel, state.travel);
      gl.uniform4f(u.uPointer, pointer.sx, pointer.sy, pointer.active, s.hoverRadius);
      gl.uniform1i(u.uEffect, s.hoverEffect);
      gl.uniform1f(u.uStrength, s.hoverFactor);
      gl.uniform4fv(u.uBursts, packedBursts);
      gl.uniform1i(u.uBurstCount, burstCount);
      gl.uniform1f(u.uReveal, state.reveal);
      gl.uniform1f(u.uSoft, s.soft ? 0.2 : 0);
      gl.uniform1f(u.uShimmer, 1);
      gl.uniform1f(u.uOpacity, s.opacity);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cloud.count);
      gl.bindVertexArray(null);
    };

    const frame = now => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = last ? clamp((now - last) / 1000, 0.0005, 0.05) : 1 / 60;
      last = now;
      if (s.paused) { state.reveal = 1; render(); last = 0; return; }
      const motion = reduce ? 0 : 1;
      const pace = dt * s.speed * motion;
      state.clock += pace;
      if (s.rotate) state.spin += pace * 0.6;
      state.travel += dt * s.driftSpeed * motion * (s.drift === 3 ? 6 : 0.9);

      const engaged = s.mouse && pointer.inside && !reduce;
      const follow = 1 - Math.exp(-dt / 0.35);
      const parallax = engaged && s.hoverEffect === 0 ? s.hoverFactor : 0;
      state.offsetX += (-pointer.nx * parallax - state.offsetX) * follow;
      state.offsetY += (-pointer.ny * parallax - state.offsetY) * follow;
      pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt / 0.06));
      pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt / 0.06));
      pointer.active += ((engaged ? 1 : 0) - pointer.active) * (1 - Math.exp(-dt / 0.2));

      for (let i = bursts.length - 1; i >= 0; i--) {
        bursts[i].age += dt;
        if (bursts[i].age >= P_BURST_SECONDS) bursts.splice(i, 1);
      }
      if (!s.intro || reduce) state.reveal = 1;
      else if (state.reveal < 1) state.reveal = Math.min(1, state.reveal + dt / P_INTRO_SECONDS);

      render();
      raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const ratio = Math.min(s.dpr || window.devicePixelRatio || 1, 2);
      view.width = width;
      view.height = height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      view.ratio = canvas.width / width;
      render();
      wake();
    };

    const locate = event => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const wasInside = pointer.inside;
      pointer.inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      pointer.x = x;
      pointer.y = rect.height - y;
      pointer.nx = (x / Math.max(1, rect.width)) * 2 - 1;
      pointer.ny = -((y / Math.max(1, rect.height)) * 2 - 1);
      if (pointer.inside && !wasInside) { pointer.sx = pointer.x; pointer.sy = pointer.y; }
    };
    const pushBurst = (x, y) => {
      bursts.push({ x, y, age: 0 });
      if (bursts.length > P_MAX_BURSTS) bursts.shift();
      wake();
    };
    const onPointerMove = event => { locate(event); if (!s.paused) wake(); };
    const onPointerDown = event => {
      locate(event);
      if (!pointer.inside || !s.clickBurst || s.paused || reduce) return;
      pushBurst(pointer.x, pointer.y);
    };
    const onPointerUp = event => { if (event.pointerType !== 'mouse') pointer.inside = false; };
    const onPointerLeave = () => { pointer.inside = false; };
    const onVisibility = () => { last = 0; wake(); };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const intersection = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) { last = 0; wake(); }
    });
    intersection.observe(container);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    resize();

    return {
      // 화면 좌표(clientX/Y)에서 충격파 — 강화 성공 등 코드에서 직접 터뜨릴 때
      burst(clientX, clientY) {
        if (reduce || s.paused) return;
        const rect = container.getBoundingClientRect();
        pushBurst(clientX - rect.left, rect.height - (clientY - rect.top));
      },
      destroy() {
        cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        intersection.disconnect();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        document.documentElement.removeEventListener('pointerleave', onPointerLeave);
        document.removeEventListener('visibilitychange', onVisibility);
        gl.deleteProgram(dots.program);
        [corners, positionBuffer, randomBuffer, colorBuffer].forEach(buffer => gl.deleteBuffer(buffer));
        gl.deleteVertexArray(dotVao);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        canvas.remove();
      },
    };
  }

  /* ===================== ClickSpark → Fx.clickSpark ===================== */
  const CS_EASINGS = {
    linear: t => t,
    'ease-in': t => t * t,
    'ease-out': t => 1 - Math.pow(1 - t, 3),
    'ease-in-out': t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    spring: t => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
  };
  const CS_SHAPES = ['line', 'streak', 'dot', 'star'];
  const CS_MAX_BURSTS = 32;
  const CS_GRAVITY = 500;
  const CS_REDUCED_MS = 320;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const starPath = (ctx, x, y, radius, rotation) => {
    const pinch = radius * 0.16;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(rotation) * radius, y + Math.sin(rotation) * radius);
    for (let i = 1; i <= 4; i++) {
      const a = rotation + (i * Math.PI) / 2;
      const mid = a - Math.PI / 4;
      ctx.quadraticCurveTo(x + Math.cos(mid) * pinch, y + Math.sin(mid) * pinch, x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    }
    ctx.closePath();
  };

  // 화면 전체를 덮는 고정 레이어 하나에 불꽃을 그린다(모달 위에서도 보이게).
  // bind(selector, overrides) 로 특정 요소를 누를 때만 터지게 하고, burst(x, y, overrides) 로 코드에서 터뜨린다.
  function clickSpark(defaults) {
    const normalize = p => ({
      colors: [].concat(p.sparkColor ?? '#fff').filter(Boolean),
      size: Math.max(0, p.sparkSize ?? 14),
      radius: Math.max(0, p.sparkRadius ?? 30) * Math.max(0, p.extraScale ?? 1),
      count: clamp(Math.round(p.sparkCount ?? 8), 1, 64),
      width: Math.max(0.5, p.sparkWidth ?? 2),
      duration: Math.max(60, p.duration ?? 500),
      ease: CS_EASINGS[p.easing] ?? CS_EASINGS['ease-out'],
      shape: CS_SHAPES.includes(p.shape) ? p.shape : 'line',
      randomness: clamp(p.randomness ?? 0.2, 0, 1),
      gravity: Math.max(0, p.gravity ?? 0),
      spread: clamp(p.spread ?? 360, 0, 360),
      direction: p.direction ?? 0,
      glow: clamp(p.glow ?? 0, 0, 1),
      ring: !!p.ring,
    });
    const base = Object.assign({}, defaults);
    const layer = document.createElement('div');
    layer.className = 'fx-sparks';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);

    const reduced = reducedMotion();
    const bursts = [];
    let raf = 0;
    const drop = (s, seconds) => 0.5 * s.gravity * CS_GRAVITY * seconds * seconds;
    const position = (burst, spark, distance, seconds) => [
      burst.x + Math.cos(spark.angle) * distance,
      burst.y + Math.sin(spark.angle) * distance + drop(burst.settings, seconds),
    ];

    const drawSpark = (ctx, burst, spark, elapsed) => {
      const s = burst.settings;
      const life = reduced ? CS_REDUCED_MS : s.duration * spark.life;
      const p = elapsed / life;
      if (p >= 1) return false;
      const e = reduced ? 0.55 : s.ease(clamp(p, 0, 1));
      const seconds = reduced ? 0 : elapsed / 1000;
      const distance = s.radius * spark.reach * e;
      const width = s.width * spark.scale;
      const fade = reduced ? 1 - p : 1 - smoothstep(s.shape === 'line' ? 0.55 : 0.7, 1, p);
      if (fade <= 0) return true;
      ctx.strokeStyle = spark.color;
      ctx.fillStyle = spark.color;

      if (s.shape === 'line') {
        const length = s.size * spark.scale * (reduced ? 0.5 : Math.pow(1 - p, 1.6));
        const [x1, y1] = position(burst, spark, distance, seconds);
        const [x2, y2] = position(burst, spark, distance + Math.max(0.01, length), seconds);
        ctx.lineCap = 'round';
        if (spark.glow > 0) {
          ctx.globalAlpha = fade * 0.14 * spark.glow;
          ctx.lineWidth = width * 4.5;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
        ctx.globalAlpha = fade;
        ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        return true;
      }
      if (s.shape === 'streak') {
        const lag = reduced ? 0 : Math.min(elapsed, 70 + s.size * 4 * spark.scale);
        const back = reduced ? 0.4 : s.ease(clamp((elapsed - lag) / life, 0, 1));
        const [hx, hy] = position(burst, spark, distance, seconds);
        const [tx, ty] = position(burst, spark, s.radius * spark.reach * back, Math.max(0, seconds - lag / 1000));
        const dx = hx - tx, dy = hy - ty;
        const length = Math.hypot(dx, dy) || 1;
        const nx = (-dy / length) * width * 0.5;
        const ny = (dx / length) * width * 0.5;
        const paint = (spreadWidth, alpha) => {
          const gradient = ctx.createLinearGradient(tx, ty, hx, hy);
          gradient.addColorStop(0, spark.clear);
          gradient.addColorStop(1, spark.color);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(hx + nx * spreadWidth, hy + ny * spreadWidth);
          ctx.lineTo(hx - nx * spreadWidth, hy - ny * spreadWidth);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = spark.color;
          ctx.beginPath();
          ctx.arc(hx, hy, Math.max(0, width * 0.5 * spreadWidth), 0, TAU);
          ctx.fill();
        };
        if (spark.glow > 0) paint(3.2, fade * 0.16 * spark.glow);
        paint(1, fade);
        return true;
      }
      if (s.shape === 'dot') {
        const [x, y] = position(burst, spark, distance, seconds);
        const radius = Math.max(0, width * 1.25 * (1 - 0.5 * e));
        if (spark.glow > 0) {
          ctx.globalAlpha = fade * 0.18 * spark.glow;
          ctx.beginPath(); ctx.arc(x, y, radius * 2.6, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = fade;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
        return true;
      }
      const [x, y] = position(burst, spark, distance, seconds);
      const twinkle = reduced ? 1 - p : Math.pow(Math.sin(Math.PI * clamp(p * 1.1, 0, 1)), 0.7);
      const radius = s.size * 0.6 * spark.scale * twinkle;
      const rotation = spark.angle + spark.spin * p * Math.PI * 0.5;
      if (radius <= 0.05) return true;
      if (spark.glow > 0) {
        ctx.globalAlpha = fade * 0.2 * spark.glow;
        ctx.beginPath(); ctx.arc(x, y, radius * 1.1, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = fade;
      starPath(ctx, x, y, radius, rotation);
      ctx.fill();
      return true;
    };

    const drawRing = (ctx, burst, elapsed) => {
      const s = burst.settings;
      const life = reduced ? CS_REDUCED_MS : s.duration * 0.8;
      const p = elapsed / life;
      if (p >= 1) return false;
      const radius = Math.max(0, 2 + s.radius * 0.6 * (reduced ? 0.6 : CS_EASINGS['ease-out'](p)));
      ctx.globalAlpha = Math.pow(1 - p, 2) * 0.7;
      ctx.strokeStyle = (burst.sparks[0] && burst.sparks[0].color) || s.colors[0];
      ctx.lineWidth = Math.max(0.5, s.width * (1 - p) * 0.9);
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, radius, 0, TAU);
      ctx.stroke();
      return true;
    };

    const remove = burst => {
      burst.canvas.remove();
      const index = bursts.indexOf(burst);
      if (index >= 0) bursts.splice(index, 1);
    };

    const frame = now => {
      raf = 0;
      for (const burst of bursts.slice()) {
        // rAF 시각은 '이번 프레임 시작' 이라 방금 만든 폭발의 start(performance.now)보다 이를 수 있다 → 음수 방지
        const elapsed = Math.max(0, now - burst.start);
        const ctx = burst.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, burst.canvas.width, burst.canvas.height);
        ctx.setTransform(burst.ratio, 0, 0, burst.ratio, -burst.left * burst.ratio, -burst.top * burst.ratio);
        let alive = false;
        if (burst.settings.ring && drawRing(ctx, burst, elapsed)) alive = true;
        for (const spark of burst.sparks) if (drawSpark(ctx, burst, spark, elapsed)) alive = true;
        ctx.globalAlpha = 1;
        if (!alive) remove(burst);
      }
      if (bursts.length) raf = requestAnimationFrame(frame);
    };

    const spawn = (clientX, clientY, overrides) => {
      const s = normalize(Object.assign({}, base, overrides));
      const offset = Math.floor(Math.random() * s.colors.length);
      const full = s.spread >= 359.5;
      const arc = (s.spread * Math.PI) / 180;
      const heading = ((s.direction - 90) * Math.PI) / 180;
      const step = full ? TAU / s.count : s.count > 1 ? arc / (s.count - 1) : 0;
      const sparks = Array.from({ length: s.count }, (_, i) => {
        const angleBase = full ? heading + step * i : s.count > 1 ? heading - arc / 2 + step * i : heading;
        const jitter = (Math.random() - 0.5) * s.randomness;
        return {
          angle: angleBase + jitter * (step || arc || 1) * 0.9,
          reach: 1 + (Math.random() - 0.5) * 0.7 * s.randomness,
          scale: 1 + (Math.random() - 0.5) * 0.8 * s.randomness,
          life: 1 + (Math.random() - 0.5) * 0.5 * s.randomness,
          spin: Math.random() - 0.5,
          color: s.colors[(i + offset) % s.colors.length],
          clear: '',
          glow: 0,
        };
      });
      const longest = s.duration * (1 + 0.25 * s.randomness);
      const fall = drop(s, longest / 1000);
      const reach = s.radius * (1 + 0.35 * s.randomness) * (s.ease === CS_EASINGS.spring ? 1.15 : 1) +
        s.size * (1 + 0.4 * s.randomness) + s.width * (s.glow > 0 ? 6 : 2) + 6;
      const box = {
        left: Math.max(clientX - reach, 0),
        top: Math.max(clientY - reach, 0),
        right: Math.min(clientX + reach, window.innerWidth),
        bottom: Math.min(clientY + reach + fall, window.innerHeight),
      };
      if (box.right - box.left < 1 || box.bottom - box.top < 1) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil((box.right - box.left) * ratio);
      canvas.height = Math.ceil((box.bottom - box.top) * ratio);
      Object.assign(canvas.style, {
        position: 'absolute', left: `${box.left}px`, top: `${box.top}px`,
        width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px`, display: 'block', pointerEvents: 'none',
      });
      layer.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) { canvas.remove(); return; }
      for (const spark of sparks) {
        const [r, g, b] = toRgb255(spark.color);
        spark.clear = `rgba(${r}, ${g}, ${b}, 0)`;
        spark.glow = s.glow * (0.35 + 0.65 * ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255));
      }
      bursts.push({ x: clientX, y: clientY, start: performance.now(), sparks, settings: s, canvas, ctx, ratio, left: box.left, top: box.top });
      while (bursts.length > CS_MAX_BURSTS) remove(bursts[0]);
      if (!raf) raf = requestAnimationFrame(frame);
    };

    // 원본의 입력 규칙: 마우스는 pointerdown 즉시, 터치는 click 때(스크롤과 구분). 키보드(detail 0)는 요소 중앙.
    // immediate 바인딩(연타 대상)은 터치도 pointerdown 즉시 — 손가락 반응이 늦으면 손맛이 없다.
    const bindings = [];
    let lastPress = { time: -1e9, x: 0, y: 0 };
    const match = target => {
      if (!(target instanceof Element)) return null;
      for (const b of bindings) {
        const hit = target.closest(b.selector);
        if (hit && !hit.disabled) return { b, hit };
      }
      return null;
    };
    const extra = (b, hit) => (typeof b.overrides === 'function' ? b.overrides(hit) : b.overrides) || {};
    const onPointerDown = event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const m = match(event.target);
      if (!m) return;
      if (event.pointerType !== 'mouse' && !m.b.immediate) return;
      lastPress = { time: performance.now(), x: event.clientX, y: event.clientY };
      spawn(event.clientX, event.clientY, extra(m.b, m.hit));
    };
    const onClick = event => {
      // 강화 RPG 추가: 아이폰 햅틱용 숨은 스위치(label.hx > input)가 받는 2차 클릭은 무시(불꽃이 중앙에 한 번 더 터지지 않게)
      if (event.target instanceof Element && event.target.matches('.hx > input')) return;
      const m = match(event.target);
      if (!m) return;
      if (event.detail === 0) {
        const rect = m.hit.getBoundingClientRect();
        spawn(rect.left + rect.width / 2, rect.top + rect.height / 2, extra(m.b, m.hit));
        return;
      }
      const recent = performance.now() - lastPress.time < 700 && Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) < 12;
      if (!recent) spawn(event.clientX, event.clientY, extra(m.b, m.hit));
    };
    document.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    document.addEventListener('click', onClick, { capture: true });

    return {
      bind(selector, overrides, opts) { bindings.push({ selector, overrides, immediate: !!(opts && opts.immediate) }); return this; },
      burst(clientX, clientY, overrides) { spawn(clientX, clientY, overrides); },
      burstAt(element, overrides) {
        const rect = element.getBoundingClientRect();
        spawn(rect.left + rect.width / 2, rect.top + rect.height / 2, overrides);
      },
      destroy() {
        cancelAnimationFrame(raf);
        document.removeEventListener('pointerdown', onPointerDown, { capture: true });
        document.removeEventListener('click', onClick, { capture: true });
        bursts.slice().forEach(remove);
        layer.remove();
      },
    };
  }

  /* ===================== StarBorder → Fx.starBorder ===================== */
  const SB_HOVERS = ['lap', 'brighten', 'reveal', 'none'];
  const SB_BLEED = 48;
  const SB_LAP = 0.9;
  const WHITE = [255, 255, 255];
  const wrapMod = (value, total) => ((value % total) + total) % total;
  const sbEase = t => (t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2);
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (rgb, alpha) => `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${clamp(alpha, 0, 1).toFixed(3)})`;

  const sbOutline = (width, height, radius) => {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    const arc = (Math.PI * r) / 2;
    const across = Math.max(0, width - 2 * r);
    const down = Math.max(0, height - 2 * r);
    const segments = [
      { length: across, x: r, y: 0, dx: 1, dy: 0, angle: null },
      { length: arc, x: width - r, y: r, dx: 0, dy: 0, angle: -Math.PI / 2 },
      { length: down, x: width, y: r, dx: 0, dy: 1, angle: null },
      { length: arc, x: width - r, y: height - r, dx: 0, dy: 0, angle: 0 },
      { length: across, x: width - r, y: height, dx: -1, dy: 0, angle: null },
      { length: arc, x: r, y: height - r, dx: 0, dy: 0, angle: Math.PI / 2 },
      { length: down, x: 0, y: height - r, dx: 0, dy: -1, angle: null },
      { length: arc, x: r, y: r, dx: 0, dy: 0, angle: Math.PI },
    ];
    return { r, segments, total: Math.max(1, segments.reduce((sum, seg) => sum + seg.length, 0)) };
  };
  const sbPointAt = (shape, distance, point) => {
    let s = wrapMod(distance, shape.total);
    for (const seg of shape.segments) {
      if (seg.length > 0 && s <= seg.length) {
        if (seg.angle === null) {
          point.x = seg.x + seg.dx * s; point.y = seg.y + seg.dy * s;
          point.nx = seg.dy; point.ny = -seg.dx;
        } else {
          const angle = seg.angle + s / shape.r;
          point.nx = Math.cos(angle); point.ny = Math.sin(angle);
          point.x = seg.x + point.nx * shape.r; point.y = seg.y + point.ny * shape.r;
        }
        return point;
      }
      s -= seg.length;
    }
    return point;
  };
  const sbProject = (shape, px, py) => {
    let best = Infinity, found = 0, offset = 0;
    shape.segments.forEach(seg => {
      if (seg.length > 0) {
        let s = 0, x = 0, y = 0;
        if (seg.angle === null) {
          s = clamp((px - seg.x) * seg.dx + (py - seg.y) * seg.dy, 0, seg.length);
          x = seg.x + seg.dx * s; y = seg.y + seg.dy * s;
        } else {
          let angle = wrapMod(Math.atan2(py - seg.y, px - seg.x) - seg.angle, TAU);
          if (angle > Math.PI / 2) angle = angle > Math.PI * 1.25 ? 0 : Math.PI / 2;
          s = angle * shape.r;
          x = seg.x + Math.cos(seg.angle + angle) * shape.r;
          y = seg.y + Math.sin(seg.angle + angle) * shape.r;
        }
        const distance = (px - x) ** 2 + (py - y) ** 2;
        if (distance < best) { best = distance; found = offset + s; }
      }
      offset += seg.length;
    });
    return found;
  };

  function starBorder(root, options) {
    const read = o => ({
      light: false,
      color: o.color ?? '#ffffff',
      trailColor: o.trailColor ?? o.color ?? '#ffffff',
      duration: Math.max(0.3, o.duration ?? 4),
      thickness: Math.max(0.5, o.thickness ?? 1),
      radius: Math.max(0, o.radius ?? 12),
      trailLength: clamp(o.trailLength ?? 0.3, 0, 1),
      stars: clamp(Math.round(o.stars ?? 1), 1, 6),
      glow: clamp(o.glow ?? 0.6, 0, 1),
      sparkle: !!o.sparkle,
      direction: o.direction === 'counterclockwise' ? -1 : 1,
      hover: SB_HOVERS.includes(o.hover) ? o.hover : 'lap',
      clickPulse: o.clickPulse ?? true,
      // 강화 RPG 추가: 꼬리가 머리 쪽에서 흰색으로 달아오르는 정도(0~1)와 머리 심지·십자 반짝임을 흰색으로 그릴지.
      // 밝은 색 버튼 위에서는 흰 꼬리가 '깨진 선' 처럼 보여서 끌 수 있게 했다(기본값은 원본 그대로).
      whiten: clamp(o.whiten ?? 0.65, 0, 1),
      whiteCore: o.whiteCore ?? true,
      // 강화 RPG 추가: 겹치는 빛(꼬리 글로우+심지)을 더해서(lighter) 그릴지. 더하면 겹친 곳이 흰색으로 포화된다 —
      // 주황 버튼 위에서는 꺼야(source-over) 금빛이 그대로 남는다.
      additive: o.additive ?? true,
    });
    let opts = Object.assign({}, options);
    let settings = read(opts);
    root.classList.add('star-border');
    const applyVars = () => {
      root.style.setProperty('--star-border-radius', `${settings.radius}px`);
      root.style.setProperty('--star-border-thickness', `${settings.thickness}px`);
      if (opts.backgroundColor) root.style.setProperty('--star-border-surface', opts.backgroundColor);
      if (opts.textColor) root.style.setProperty('--star-border-text', opts.textColor);
      if (opts.borderColor) root.style.setProperty('--star-border-track', opts.borderColor);
    };
    applyVars();
    let canvas = root.querySelector(':scope > .star-border__light');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'star-border__light';
      canvas.setAttribute('aria-hidden', 'true');
      root.prepend(canvas);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return { set: noop, destroy: noop };

    const reduce = reducedMotion();
    const point = { x: 0, y: 0, nx: 0, ny: -1 };
    const state = { width: 0, height: 0, dpr: 1, phase: 0, velocity: 0, motion: 0, lap: -1, time: 0, reveal: 0, boost: 0, flash: 0, emit: 0, hovered: false, focused: false, pointerX: 0, pointerY: 0, visible: true };
    const pulses = [];
    const dust = [];
    const colors = { key: '', head: WHITE, tail: WHITE };
    let raf = 0;
    let last = performance.now();
    let alive = true;

    const measure = () => {
      state.width = root.offsetWidth;
      state.height = root.offsetHeight;
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round((state.width + SB_BLEED * 2) * state.dpr));
      canvas.height = Math.max(1, Math.round((state.height + SB_BLEED * 2) * state.dpr));
      wake();
    };
    const local = event => {
      const rect = root.getBoundingClientRect();
      const scaleX = rect.width ? state.width / rect.width : 1;
      const scaleY = rect.height ? state.height / rect.height : 1;
      return [(event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY];
    };
    const shapeFor = s => sbOutline(Math.max(1, state.width - s.thickness), Math.max(1, state.height - s.thickness), s.radius - s.thickness / 2);
    const stroke = (x1, y1, x2, y2, width, style) => {
      ctx.lineWidth = width; ctx.strokeStyle = style;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const drawTrail = (s, shape, head, length, sign, intensity, tip = true) => {
      if (length < 0.5 || intensity <= 0) return;
      const steps = clamp(Math.ceil(length / 2), 2, 90);
      sbPointAt(shape, head, point);
      let px = point.x, py = point.y;
      for (let i = 1; i <= steps; i++) {
        sbPointAt(shape, head - sign * length * (i / steps), point);
        const u = 1 - (i - 0.5) / steps;
        const fade = u * u * intensity;
        let tone = mix3(colors.tail, colors.head, u);
        if (!s.light && s.whiten > 0) tone = mix3(tone, WHITE, u ** 6 * s.whiten);
        ctx.lineCap = tip && i === 1 ? 'round' : 'butt';
        stroke(px, py, point.x, point.y, 2 + 6 * s.glow, rgba(tone, fade * (s.light ? 0.1 : 0.2) * s.glow));
        stroke(px, py, point.x, point.y, s.thickness, rgba(tone, fade));
        px = point.x; py = point.y;
      }
    };
    const drawHead = (s, x, y, intensity, twinkle) => {
      if (intensity <= 0) return;
      const tone = colors.head;
      const reach = (12 + 40 * s.glow) * (s.light ? 0.6 : 1);
      const bloom = ctx.createRadialGradient(x, y, 0, x, y, reach);
      const strength = (s.light ? 0.08 : 0.4) * s.glow * intensity;
      bloom.addColorStop(0, rgba(tone, strength));
      bloom.addColorStop(0.2, rgba(tone, strength * 0.4));
      bloom.addColorStop(0.5, rgba(tone, strength * 0.1));
      bloom.addColorStop(1, rgba(tone, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
      if (!s.sparkle) return;
      const size = (1 + s.thickness * 0.6) * (s.light ? 0.85 : 1);
      const core = ctx.createRadialGradient(x, y, 0, x, y, size * 2.2);
      const hot = !s.light && s.whiteCore;
      core.addColorStop(0, rgba(hot ? WHITE : tone, intensity));
      core.addColorStop(s.light ? 0.3 : 0.4, rgba(hot ? mix3(tone, WHITE, 0.5) : tone, intensity * 0.9));
      core.addColorStop(s.light ? 0.55 : 1, rgba(tone, s.light ? intensity * 0.12 : 0));
      core.addColorStop(1, rgba(tone, 0));
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(x, y, size * 2.2, 0, TAU); ctx.fill();
      const spike = (3 + 4 * s.glow + s.thickness * 1.5) * twinkle;
      const center = hot ? WHITE : tone;
      const horizontal = ctx.createLinearGradient(x - spike, y, x + spike, y);
      horizontal.addColorStop(0, rgba(tone, 0));
      horizontal.addColorStop(0.5, rgba(center, intensity * 0.95));
      horizontal.addColorStop(1, rgba(tone, 0));
      stroke(x - spike, y, x + spike, y, s.light ? 0.75 : 1, horizontal);
      const vertical = ctx.createLinearGradient(x, y - spike, x, y + spike);
      vertical.addColorStop(0, rgba(tone, 0));
      vertical.addColorStop(0.5, rgba(center, intensity * 0.95));
      vertical.addColorStop(1, rgba(tone, 0));
      stroke(x, y - spike, x, y + spike, s.light ? 0.75 : 1, vertical);
    };
    const spawnDust = (x, y, nx, ny, speed) => {
      if (dust.length > 48) return;
      const push = 3 + Math.random() * 10;
      const drift = (Math.random() - 0.5) * 8;
      dust.push({
        x: x + nx * (Math.random() * 3 - 1), y: y + ny * (Math.random() * 3 - 1),
        vx: nx * push - ny * drift - speed * -ny * 0.04, vy: ny * push + nx * drift - speed * nx * 0.04,
        age: 0, life: 0.35 + Math.random() * 0.5, size: 0.45 + Math.random() * 0.7, seed: Math.random() * TAU,
      });
    };
    const draw = (baseSettings, shape) => {
      const s = state.boost > 0.001 ? Object.assign({}, baseSettings, { glow: Math.min(1.5, baseSettings.glow + 0.4 * state.boost) }) : baseSettings;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (state.width < 2 || state.height < 2) return;
      const offset = (SB_BLEED + s.thickness / 2) * state.dpr;
      ctx.setTransform(state.dpr, 0, 0, state.dpr, offset, offset);
      ctx.globalCompositeOperation = s.light || !s.additive ? 'source-over' : 'lighter';
      ctx.lineCap = 'butt';
      const total = shape.total;
      const spacing = total / s.stars;
      const speed = Math.abs(state.motion);
      const sign = state.motion >= 0 ? 1 : -1;
      const span = s.trailLength * s.duration;
      const length = Math.min(speed * span, spacing * 0.92, total * 0.6);
      const intensity = state.reveal * (1 + 0.4 * state.boost + 0.6 * state.flash);
      const ring = state.flash * (s.light ? 0.18 : 0.32) + state.boost * state.reveal * (s.light ? 0.07 : 0.12);
      if (ring > 0.005 && ctx.roundRect) {
        ctx.lineWidth = s.thickness + 2 * s.glow;
        ctx.strokeStyle = rgba(colors.head, ring);
        ctx.beginPath();
        ctx.roundRect(0, 0, Math.max(1, state.width - s.thickness), Math.max(1, state.height - s.thickness), Math.max(0, shape.r));
        ctx.stroke();
      }
      const still = clamp(1 - speed / Math.max(1, (total / s.duration) * 0.6), 0, 1) * Math.min(1, intensity);
      const rest = (10 + 14 * s.glow + s.thickness * 2) * still;
      for (let i = 0; i < s.stars; i++) {
        const head = state.phase + i * spacing;
        drawTrail(s, shape, head, length, sign, Math.min(1, intensity));
        if (still > 0.01) {
          drawTrail(s, shape, head, rest, 1, still, false);
          drawTrail(s, shape, head, rest, -1, still, false);
        }
      }
      pulses.forEach(pulse => {
        const progress = pulse.age / 0.65;
        const fade = (1 - progress) ** 2;
        const travel = (total / 2) * (1 - (1 - Math.min(1, pulse.age / 0.5)) ** 2);
        const tail = Math.min(travel, total * 0.16);
        [1, -1].forEach(way => {
          const front = pulse.origin + way * travel;
          drawTrail(s, shape, front, tail, way, fade);
          sbPointAt(shape, front, point);
          drawHead(s, point.x, point.y, fade * 0.8, 0.8);
        });
      });
      for (let i = 0; i < s.stars; i++) {
        sbPointAt(shape, state.phase + i * spacing, point);
        const twinkle = 0.82 + 0.18 * Math.sin(state.time * 6.1 + i * 2.3) * Math.sin(state.time * 2.7 + i);
        drawHead(s, point.x, point.y, Math.min(1.3, intensity), twinkle);
      }
      dust.forEach(mote => {
        const left = 1 - mote.age / mote.life;
        const shimmer = 0.45 + 0.55 * Math.sin(state.time * 20 + mote.seed);
        const alpha = left * shimmer * state.reveal * (s.light ? 0.35 : 0.9);
        if (alpha <= 0.01) return;
        ctx.fillStyle = rgba(s.light || !s.whiteCore ? colors.head : mix3(colors.tail, WHITE, 0.6), alpha);
        ctx.beginPath(); ctx.arc(mote.x, mote.y, mote.size * (0.6 + 0.4 * left), 0, TAU); ctx.fill();
      });
    };
    const frame = now => {
      raf = 0;
      if (!alive) return;
      const s = settings;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      state.time += dt;
      const key = `${s.color}|${s.trailColor}`;
      if (key !== colors.key) { colors.key = key; colors.head = toRgb255(s.color); colors.tail = toRgb255(s.trailColor); }
      const shape = shapeFor(s);
      const total = shape.total;
      const spacing = total / s.stars;
      const engaged = state.hovered || state.focused;
      const cruise = reduce ? 0 : (s.direction * total) / s.duration;
      const revealTarget = s.hover === 'reveal' && !engaged ? 0 : 1;
      state.reveal += (revealTarget - state.reveal) * (1 - Math.exp(-dt / (revealTarget > state.reveal ? 0.16 : 0.45)));
      const boostTarget = s.hover === 'brighten' && engaged ? 1 : 0;
      state.boost += (boostTarget - state.boost) * (1 - Math.exp(-dt / (boostTarget > state.boost ? 0.18 : 0.5)));
      state.flash *= Math.exp(-dt / 0.22);
      state.velocity += (cruise - state.velocity) * (1 - Math.exp(-dt / 0.45));
      let extraPhase = 0;
      if (state.lap >= 0) {
        const before = sbEase(Math.min(1, state.lap / SB_LAP));
        state.lap += dt;
        extraPhase = (sbEase(Math.min(1, state.lap / SB_LAP)) - before) * total * s.direction;
        if (state.lap >= SB_LAP) state.lap = -1;
      }
      state.motion = state.velocity + extraPhase / dt;
      state.phase = wrapMod(state.phase + state.velocity * dt + extraPhase, total);
      const pace = Math.abs(state.motion) / Math.max(1, Math.abs(total / s.duration));
      if (s.sparkle && !reduce && state.reveal > 0.05) {
        state.emit += dt * (2 + 6 * Math.min(2, pace)) * s.stars;
        while (state.emit > 1) {
          state.emit -= 1;
          sbPointAt(shape, state.phase + Math.floor(Math.random() * s.stars) * spacing, point);
          spawnDust(point.x, point.y, point.nx, point.ny, state.motion);
        }
      }
      for (let i = dust.length - 1; i >= 0; i--) {
        const mote = dust[i];
        mote.age += dt; mote.x += mote.vx * dt; mote.y += mote.vy * dt;
        mote.vx *= Math.exp(-dt * 2.2); mote.vy *= Math.exp(-dt * 2.2);
        if (mote.age >= mote.life) dust.splice(i, 1);
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        pulses[i].age += dt;
        if (pulses[i].age >= 0.65) pulses.splice(i, 1);
      }
      draw(s, shape);
      const settling = Math.abs(revealTarget - state.reveal) > 0.002 || Math.abs(boostTarget - state.boost) > 0.002 || state.flash > 0.01 || pulses.length > 0 || dust.length > 0;
      const moving = Math.abs(state.motion) > 0.05 || cruise !== 0 || state.lap >= 0;
      const showing = state.reveal > 0.002 || revealTarget > 0;
      if (state.visible && !document.hidden && (settling || (moving && showing) || state.hovered)) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (raf || !alive || !state.visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const onEnter = event => {
      [state.pointerX, state.pointerY] = local(event);
      state.hovered = true;
      if (settings.hover === 'reveal' && state.reveal < 0.15) {
        state.phase = sbProject(shapeFor(settings), state.pointerX - settings.thickness / 2, state.pointerY - settings.thickness / 2);
        state.velocity = 0;
      }
      if (settings.hover === 'lap' && state.lap < 0 && !reduce) state.lap = 0;
      wake();
    };
    const onLeave = () => { state.hovered = false; wake(); };
    const pulse = origin => {
      if (!settings.clickPulse) return;
      pulses.push({ origin, age: 0 });
      if (pulses.length > 4) pulses.shift();
      state.flash = 1;
      wake();
    };
    const onDown = event => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const [x, y] = local(event);
      pulse(sbProject(shapeFor(settings), x - settings.thickness / 2, y - settings.thickness / 2));
    };
    const onClick = event => { if (event.detail === 0) pulse(state.phase); };
    const onFocus = () => {
      state.focused = root.matches(':focus-visible');
      if (state.focused && settings.hover === 'lap' && state.lap < 0 && !reduce) state.lap = 0;
      wake();
    };
    const onBlur = () => { state.focused = false; wake(); };
    const onVisibility = () => wake();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    const visibility = new IntersectionObserver(entries => {
      state.visible = entries.some(entry => entry.isIntersecting);
      if (state.visible) wake();
    });
    visibility.observe(root);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('click', onClick);
    root.addEventListener('focus', onFocus);
    root.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    measure();

    return {
      set(patch) { opts = Object.assign(opts, patch); settings = read(opts); applyVars(); wake(); },
      pulse() { pulse(state.phase); },
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        visibility.disconnect();
        root.removeEventListener('pointerenter', onEnter);
        root.removeEventListener('pointerleave', onLeave);
        root.removeEventListener('pointerdown', onDown);
        root.removeEventListener('click', onClick);
        root.removeEventListener('focus', onFocus);
        root.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVisibility);
        canvas.remove();
      },
    };
  }

  /* ===================== ElectricBorder → Fx.electricBorder ===================== */
  const EB_ARCS = 4;
  const EB_PULSES = 3;
  const EB_MARGIN = 64;
  const EB_PIXEL_BUDGET = 3e6;
  const EB_SURGE_SPEED = 560;
  const HALF_PI = Math.PI / 2;

  const EB_VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

  const EB_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uSize;
uniform float uRatio;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRadius;
uniform vec3 uParam;
uniform float uPerimeter;
uniform vec4 uCells;
uniform vec2 uSoft;
uniform float uTime;
uniform float uPower;
uniform float uReveal;
uniform vec3 uHover;
uniform float uHoverRadius;
uniform vec4 uPulses[${EB_PULSES}];
uniform vec3 uCore;
uniform vec3 uGlowColor;
uniform float uIntensity;
uniform float uGlow;
uniform float uThickness;
uniform float uStrands;
uniform float uChaos;
uniform float uSpread;
uniform float uFlicker;
uniform float uInk;
uniform vec4 uArcEnds[${EB_ARCS}];
uniform vec4 uArcShape[${EB_ARCS}];

out vec4 fragColor;

uint scramble(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

vec2 slant(uint x, uint y, uint seed) {
  uint h = scramble(x * 0x8da6b343u + y * 0xd8163841u + seed * 0xcb1ab31fu);
  return vec2(uvec2(h, h >> 8u) & 255u) / 127.5 - 1.0;
}

vec2 ring(vec2 p, float period, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float du = 30.0 * f.x * f.x * (f.x * (f.x - 2.0) + 1.0);
  uint x0 = uint(mod(i.x, period));
  uint x1 = uint(mod(i.x + 1.0, period));
  uint y0 = uint(i.y + 65536.0);
  vec2 ga = slant(x0, y0, seed);
  vec2 gb = slant(x1, y0, seed);
  vec2 gc = slant(x0, y0 + 1u, seed);
  vec2 gd = slant(x1, y0 + 1u, seed);
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  float value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  float gx = ga.x + u.x * (gb.x - ga.x) + u.y * (gc.x - ga.x) + u.x * u.y * (ga.x - gb.x - gc.x + gd.x);
  return vec2(value, gx + du * (vb - va + u.y * k));
}

float wobble(float x, uint seed) {
  return ring(vec2(x, 0.5), 1048576.0, seed).x;
}

vec2 frameAt(vec2 p) {
  vec2 inner = max(uHalf - uRadius, 0.0);
  vec2 q = abs(p) - inner;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float quarter = uPerimeter * 0.25;
  vec2 v = abs(p) - uParam.xy;
  float t;
  if (v.x > 0.0 && v.y > 0.0) t = uParam.x + uParam.z * atan(v.x, v.y);
  else if (v.x > v.y) t = uParam.x + 1.5707963 * uParam.z + uParam.y - abs(p.y);
  else t = abs(p.x);
  t = clamp(t, 0.0, quarter);
  float s = p.x >= 0.0 ? (p.y < 0.0 ? t : 2.0 * quarter - t) : (p.y < 0.0 ? 4.0 * quarter - t : 2.0 * quarter + t);
  return vec2(s, d);
}

vec2 glowShape(float line, float spread, float w) {
  float x = abs(line);
  float y = abs(spread);
  return vec2(exp(-x * x / (w * w * 0.5)) + exp(-y / (w * 2.2)) * 0.6, exp(-y / (w * 4.5)) * 0.5);
}

void addArc(vec2 p, vec4 ends, vec4 info, float t, inout vec3 light, inout float energy, inout float hot) {
  if (info.y < 0.002) return;
  vec2 ab = ends.zw - ends.xy;
  float len = max(length(ab), 1.0);
  vec2 dir = ab / len;
  vec2 rel = p - ends.xy;
  float along = dot(rel, dir);
  float side = dot(rel, vec2(-dir.y, dir.x));
  float margin = abs(info.x) + (0.6 + uChaos) * (2.0 + len * 0.08) + uThickness * 12.0 + 10.0;
  if (along < -margin || along > len + margin || abs(side) > margin) return;
  float u = clamp(along / len, 0.0, 1.0);
  float taper = sin(3.14159265 * u);
  float settle = smoothstep(0.0, 0.15, u) * smoothstep(1.0, 0.85, u);
  float bendSlope = 3.14159265 / len * cos(3.14159265 * u) * settle;
  float beyond = max(-along, 0.0) + max(along - len, 0.0);
  for (int c = 0; c < 2; c++) {
    uint seed = uint(info.z * 131.0) + uint(c) * 29u + 7u;
    float jag = 0.0;
    float jagSlope = 0.0;
    float wave = max(len * 0.3, 14.0);
    float weight = (0.6 + uChaos) * (1.5 + len * 0.05) * (c == 0 ? 1.0 : 1.5);
    for (int o = 0; o < 3; o++) {
      vec2 n = ring(vec2(along / wave + info.z * 3.0, t * (1.4 + float(o) * 1.1)), 1048576.0, seed + uint(o));
      jag += n.x * weight;
      jagSlope += n.y * weight / wave;
      wave *= 0.42;
      weight *= 0.4;
    }
    float offset = (info.x + jag) * taper;
    float offsetSlope = (info.x + jag) * bendSlope + jagSlope * taper * settle;
    float across = (side - offset) / sqrt(1.0 + offsetSlope * offsetSlope);
    float gap = length(vec2(beyond, across));
    float w = uThickness * (c == 0 ? 0.9 : 0.6);
    vec2 g = glowShape(gap, gap, w);
    float k = info.y * (c == 0 ? 1.0 : 0.45);
    light += (uCore * g.x + uGlowColor * g.y * uGlow) * k;
    energy += (g.x + g.y * uGlow) * k;
    hot += exp(-gap * gap / (w * w * 0.16)) * k * (c == 0 ? 1.0 : 0.0);
  }
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / uRatio, uSize.y - gl_FragCoord.y / uRatio);
  vec2 frame = frameAt(p - uCenter);
  float s = frame.x;
  float d = frame.y;
  float t = uTime;
  vec3 light = vec3(0.0);
  float energy = 0.0;
  float hot = 0.0;

  float along = min(s, uPerimeter - s);
  float front = uReveal * (uPerimeter * 0.5 + 80.0);
  float shown = smoothstep(front, front - 70.0, along) * uPower;
  float flare = uReveal < 1.0 ? exp(-pow((along - front + 30.0) / 26.0, 2.0)) * uPower : 0.0;

  vec2 toHover = p - uHover.xy;
  float heat = uHover.z * exp(-dot(toHover, toHover) / (uHoverRadius * uHoverRadius));
  float surge = 0.0;
  for (int i = 0; i < ${EB_PULSES}; i++) {
    vec4 pulse = uPulses[i];
    if (pulse.z <= 0.0) continue;
    float gap = abs(s - pulse.x);
    gap = min(gap, uPerimeter - gap);
    float wave = (gap - pulse.y * ${EB_SURGE_SPEED}.0) / 46.0;
    surge += exp(-wave * wave) * pulse.z * exp(-pulse.y * 1.2);
  }
  heat = min(heat * 0.7 + surge * 0.8 + flare * 0.6, 1.2);
  vec2 inset = min(p, uSize - p);
  float frameFade = smoothstep(0.0, 14.0, min(inset.x, inset.y));

  float edge = abs(d);
  float inward = d < 0.0 ? exp(d / 14.0) : 1.0;
  float bloom = (exp(-edge / 3.0) * 0.1 + exp(-edge / 16.0) * 0.05 * inward) * uGlow * (1.0 + heat * 0.6) * shown;
  light += uGlowColor * bloom;
  energy += bloom;

  float bendAmp = uSpread * 16.0 * (1.0 + heat * 0.35);
  float rippleAmp = uSpread * 6.0 * (1.0 + heat * 0.3);
  float crinkleAmp = uChaos * 4.5 * (1.0 + heat * 0.3);
  float squeeze = min(1.0, 34.0 / max((bendAmp + rippleAmp) * 1.6 + crinkleAmp, 1e-3));
  bendAmp *= squeeze;
  rippleAmp *= squeeze;
  crinkleAmp *= squeeze;
  float reach = (bendAmp * 1.9 + rippleAmp + crinkleAmp * 1.6) * 1.3 + uThickness * 14.0 + 8.0;
  if (edge < reach && shown > 0.0) {
    float fade = smoothstep(reach, reach * 0.55, edge);
    float count = min(uStrands + heat * 1.2, 6.0);
    float slopeScale = 1.0 / uPerimeter;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      if (fi >= ceil(count)) break;
      float present = clamp(count - fi, 0.0, 1.0);
      uint seed = uint(i) * 7u + 3u;
      float lead = i == 0 ? 1.0 : 0.0;
      float range = mix(1.35 + fi * 0.18, 0.7, lead);
      float x = s * slopeScale;
      vec2 a = ring(vec2(x * uCells.x, t * 0.7 + fi * 3.1), uCells.x, seed);
      vec2 b = ring(vec2(x * uCells.y, t * 1.9 + fi * 1.7), uCells.y, seed + 1u);
      vec2 c = ring(vec2(x * uCells.z, t * 4.6 + fi * 0.9), uCells.z, seed + 2u);
      vec2 e = ring(vec2(x * uCells.w, t * 6.8), uCells.w, seed + 3u);
      float offset = (a.x * bendAmp + b.x * rippleAmp) * range + (c.x + e.x * 0.35) * crinkleAmp;
      float slope =
        ((a.y * uCells.x * bendAmp + b.y * uCells.y * rippleAmp) * range +
          (c.y * uCells.z + e.y * 0.35 * uCells.w) * crinkleAmp) *
        slopeScale;
      float drift = lead > 0.5 ? 0.0 : wobble(fi * 7.3, seed + 9u) * 2.5 * uSpread;
      offset += drift;
      float across = (d - offset) / sqrt(1.0 + slope * slope);
      float spread = d - a.x * bendAmp * range - drift;
      float swell = 0.5 + 0.5 * ring(vec2(x * uSoft.y, t * 2.0 + fi * 5.1), uSoft.y, seed + 8u).x;
      float w = uThickness * mix(0.55, 1.0, lead) * (0.5 + swell);
      float vis = mix(0.3 + 0.45 * smoothstep(-0.25, 0.2, ring(vec2(x * uSoft.x, t * 0.5 + fi * 3.7), uSoft.x, seed + 5u).x), 1.0, lead);
      float spark = 1.0 - uFlicker * 0.3 * (0.5 + 0.5 * wobble(t * 13.0 + fi * 2.3, seed + 6u));
      float weight = max(vis, heat * 0.6) * spark * fade * present * (0.7 + 0.6 * swell);
      vec2 g = glowShape(across, spread, w) * weight;
      g.y *= inward;
      float haze = uGlow * (1.0 + heat * 0.5) * (1.0 - uInk * 0.7);
      light += uCore * g.x + uGlowColor * g.y * haze;
      energy += g.x + g.y * haze;
      hot += exp(-across * across / (w * w * 0.16)) * lead * weight;
    }
    light *= shown;
    energy *= shown;
    hot *= shown;
  }

  for (int i = 0; i < ${EB_ARCS}; i++) addArc(p, uArcEnds[i], uArcShape[i], t, light, energy, hot);

  float breath = 1.0 + uFlicker * 0.5 * wobble(t * 4.6 + 7.0, 3u);
  float gain = uIntensity * breath * (1.0 + heat * 0.25) * 1.4;
  light *= frameFade;
  energy *= frameFade;
  hot *= frameFade;
  float alpha = 1.0 - exp(-energy * gain);
  vec3 color = mix(1.0 - exp(-light * gain), alpha * light / max(energy, 1e-4), uInk);
  color = mix(color, vec3(alpha), clamp(hot, 0.0, 1.0) * uInk * 0.85);
  float grain = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  alpha = clamp(alpha + grain, 0.0, 1.0);
  fragColor = vec4(clamp(color + grain, 0.0, alpha), alpha);
}`;

  const ebRoundBox = (x, y, hx, hy, r) => {
    const qx = Math.abs(x) - (hx - r);
    const qy = Math.abs(y) - (hy - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const ebPathOf = (width, height, radius, offset) => {
    const hx = Math.max(1, width / 2 + offset);
    const hy = Math.max(1, height / 2 + offset);
    const r = clamp(radius + offset, 0, Math.min(hx, hy));
    const vr = Math.min(r + 48, Math.min(hx, hy));
    const ax = hx - vr;
    const ay = hy - vr;
    const quarter = ax + ay + HALF_PI * vr;
    return { hx, hy, r, vr, ax, ay, quarter, perimeter: quarter * 4 };
  };
  const ebPointOn = (path, s) => {
    const { hx, hy, r, vr, ax, ay, quarter, perimeter } = path;
    const u = ((s % perimeter) + perimeter) % perimeter;
    const part = Math.min(3, Math.floor(u / quarter));
    const rest = u - part * quarter;
    const localS = part % 2 ? quarter - rest : rest;
    let x, y;
    if (localS <= ax) { x = localS; y = -hy; }
    else if (localS <= ax + HALF_PI * vr) {
      const angle = vr > 0 ? (localS - ax) / vr : 0;
      const dx = Math.sin(angle), dy = -Math.cos(angle);
      let low = 0, high = vr + r + 2;
      for (let step = 0; step < 18; step++) {
        const mid = (low + high) / 2;
        if (ebRoundBox(ax + dx * mid, -ay + dy * mid, hx, hy, r) < 0) low = mid; else high = mid;
      }
      x = ax + dx * low; y = -ay + dy * low;
    } else { x = hx; y = -ay + (localS - ax - HALF_PI * vr); }
    const flipX = part >= 2 ? -1 : 1;
    const flipY = part === 1 || part === 2 ? -1 : 1;
    const px = x * flipX, py = y * flipY;
    const nx = ebRoundBox(px + 0.5, py, hx, hy, r) - ebRoundBox(px - 0.5, py, hx, hy, r);
    const ny = ebRoundBox(px, py + 0.5, hx, hy, r) - ebRoundBox(px, py - 0.5, hx, hy, r);
    const length = Math.hypot(nx, ny) || 1;
    return { x: px, y: py, nx: nx / length, ny: ny / length };
  };
  const ebNearestOn = (path, x, y) => {
    const { ax, ay, vr, quarter } = path;
    const qx = Math.abs(x) - ax, qy = Math.abs(y) - ay;
    let t;
    if (qx > 0 && qy > 0) t = ax + vr * Math.atan2(qx, qy);
    else if (qx > qy) t = ax + HALF_PI * vr + ay - Math.abs(y);
    else t = Math.abs(x);
    t = clamp(t, 0, quarter);
    if (x >= 0) return y < 0 ? t : 2 * quarter - t;
    return y < 0 ? 4 * quarter - t : 2 * quarter + t;
  };

  function electricBorder(container, options) {
    const read = o => {
      const base = toRgb255(o.color ?? '#7df9ff').map(v => v / 255);
      return {
        core: base.map(channel => channel + (1 - channel) * 0.55),
        glowColor: o.glowColor ? toRgb255(o.glowColor).map(v => v / 255) : base,
        speed: Math.max(0, o.speed ?? 1),
        chaos: clamp(o.chaos ?? 0.5, 0, 2),
        spread: clamp(o.spread ?? 0.6, 0, 2),
        thickness: Math.max(0.25, o.thickness ?? 1.5),
        strands: clamp(Math.round(o.strands ?? 3), 1, 6),
        glow: clamp(o.glow ?? 0.6, 0, 3),
        intensity: Math.max(0, o.intensity ?? 0.8),
        arcs: Math.max(0, o.arcs ?? 1),
        flicker: clamp(o.flicker ?? 0.5, 0, 1),
        borderRadius: Math.max(0, o.borderRadius ?? 24),
        offset: o.offset ?? 0,
        active: o.active ?? true,
        intro: o.intro ?? true,
        interactive: o.interactive ?? true,
        cursorRadius: Math.max(1, o.cursorRadius ?? 90),
        pixelBudget: Math.max(1e5, o.pixelBudget ?? EB_PIXEL_BUDGET),   // 이식본 추가 옵션: 모바일에서 해상도 상한을 낮춘다
        light: false,
      };
    };
    let opts = Object.assign({}, options);
    let settings = read(opts);
    container.classList.add('electric-border');
    const canvas = document.createElement('canvas');
    canvas.className = 'electric-border__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.top = `${-EB_MARGIN}px`;
    canvas.style.left = `${-EB_MARGIN}px`;
    container.appendChild(canvas);

    let cleanup = noop;
    let wakeOuter = noop;
    let generation = 0;

    const init = () => {
      const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'default' });
      const program = gl ? linkProgram(gl, EB_VERTEX, EB_FRAGMENT) : null;
      if (!gl || !program) return;

      const reduced = reducedMotion();
      const vao = gl.createVertexArray();
      const arcEnds = new Float32Array(EB_ARCS * 4);
      const arcShape = new Float32Array(EB_ARCS * 4);
      const pulseData = new Float32Array(EB_PULSES * 4);
      const size = { width: 1, height: 1, ratio: 1 };
      const pointer = { x: 0, y: 0, over: false, near: false };
      const hover = { x: 0, y: 0, vx: 0, vy: 0, power: 0 };
      const sparks = [];
      const pulses = [];
      const first = settings;
      let power = first.active && !(first.intro && !reduced && generation === 0) ? 1 : 0;
      let reveal = power;
      let wasActive = first.active;
      let ink = 0;
      let path = ebPathOf(1, 1, 0, 0);
      let time = Math.random() * 100;
      let raf = 0;
      let last = 0;
      let visible = true;
      let pageVisible = document.visibilityState !== 'hidden';
      let lost = false;

      const resize = () => {
        const s = settings;
        const width = Math.max(1, container.offsetWidth);
        const height = Math.max(1, container.offsetHeight);
        const canvasWidth = width + EB_MARGIN * 2;
        const canvasHeight = height + EB_MARGIN * 2;
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(s.pixelBudget / (canvasWidth * canvasHeight)));
        const pixelWidth = Math.max(1, Math.round(canvasWidth * ratio));
        const pixelHeight = Math.max(1, Math.round(canvasHeight * ratio));
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
        canvas.style.width = `${canvasWidth}px`;
        canvas.style.height = `${canvasHeight}px`;
        Object.assign(size, { width, height, ratio: pixelWidth / canvasWidth });
        path = ebPathOf(width, height, s.borderRadius, s.offset);
      };
      const spawnArc = (now, near) => {
        const span = Math.min(path.perimeter * 0.3, 60 + Math.random() * 90);
        const start = near ?? Math.random() * path.perimeter;
        const from = start - span * (0.2 + Math.random() * 0.6);
        const to = from + span;
        const a = ebPointOn(path, from);
        const b = ebPointOn(path, to);
        const mid = ebPointOn(path, (from + to) / 2);
        const dx = b.x - a.x, dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const side = (-dy / length) * mid.nx + (dx / length) * mid.ny;
        const bow = Math.min(EB_MARGIN - 30, length * (0.14 + Math.random() * 0.16) + 5);
        return { ax: a.x, ay: a.y, bx: b.x, by: b.y, bow: side >= 0 ? bow : -bow, seed: 1 + Math.random() * 60, born: now, life: 0.35 + Math.random() * 0.45 };
      };
      const render = (s, heatPower) => {
        const u = program.uniforms;
        const width = size.width + EB_MARGIN * 2;
        const height = size.height + EB_MARGIN * 2;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (power <= 0.001 && !sparks.length) return;
        gl.useProgram(program.program);
        gl.uniform2f(u.uSize, width, height);
        gl.uniform1f(u.uRatio, size.ratio);
        gl.uniform2f(u.uCenter, width / 2, height / 2);
        gl.uniform2f(u.uHalf, path.hx, path.hy);
        gl.uniform1f(u.uRadius, path.r);
        gl.uniform3f(u.uParam, path.ax, path.ay, path.vr);
        gl.uniform1f(u.uPerimeter, path.perimeter);
        gl.uniform4f(u.uCells,
          Math.max(1, Math.round(path.perimeter / 75)), Math.max(2, Math.round(path.perimeter / 25)),
          Math.max(3, Math.round(path.perimeter / 9)), Math.max(4, Math.round(path.perimeter / 4)));
        gl.uniform2f(u.uSoft, Math.max(1, Math.round(path.perimeter / 150)), Math.max(1, Math.round(path.perimeter / 50)));
        gl.uniform1f(u.uTime, time);
        gl.uniform1f(u.uPower, power * power * (3 - 2 * power));
        gl.uniform1f(u.uReveal, reveal);
        gl.uniform3f(u.uHover, hover.x + EB_MARGIN, hover.y + EB_MARGIN, heatPower);
        gl.uniform1f(u.uHoverRadius, s.cursorRadius);
        gl.uniform4fv(u.uPulses, pulseData);
        gl.uniform3fv(u.uCore, s.core);
        gl.uniform3fv(u.uGlowColor, s.glowColor);
        gl.uniform1f(u.uIntensity, s.intensity);
        gl.uniform1f(u.uGlow, s.glow);
        gl.uniform1f(u.uThickness, s.thickness);
        gl.uniform1f(u.uStrands, s.strands);
        gl.uniform1f(u.uChaos, s.chaos);
        gl.uniform1f(u.uSpread, s.spread);
        gl.uniform1f(u.uFlicker, reduced ? 0 : s.flicker);
        gl.uniform1f(u.uInk, ink);
        gl.uniform4fv(u.uArcEnds, arcEnds);
        gl.uniform4fv(u.uArcShape, arcShape);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const frame = now => {
        raf = 0;
        if (lost) return;
        const s = settings;
        const dt = clamp((now - last) / 1000 || 0, 0, 0.05);
        last = Math.max(last, now);
        const motion = reduced ? 0.2 : 1;
        time += dt * s.speed * motion;
        if (s.active && !wasActive) reveal = 0;
        wasActive = s.active;
        power += ((s.active ? 1 : 0) - power) * (1 - Math.exp(-dt / (s.active ? 0.28 : 0.4)));
        if (s.active) reveal = reduced ? 1 : Math.min(1, reveal + dt / 0.9);
        ink += ((s.light ? 1 : 0) - ink) * (1 - Math.exp(-dt / 0.25));
        const engaged = s.interactive && pointer.near && s.active;
        if (engaged && hover.power < 0.01) { hover.x = pointer.x; hover.y = pointer.y; hover.vx = 0; hover.vy = 0; }
        hover.vx += ((pointer.x - hover.x) * 120 - hover.vx * 19) * dt;
        hover.vy += ((pointer.y - hover.y) * 120 - hover.vy * 19) * dt;
        hover.x += hover.vx * dt;
        hover.y += hover.vy * dt;
        hover.power += ((engaged ? 1 : 0) - hover.power) * (1 - Math.exp(-dt / (engaged ? 0.3 : 0.55)));
        for (let i = sparks.length - 1; i >= 0; i--) if (time - sparks[i].born > sparks[i].life) sparks.splice(i, 1);
        if (!reduced && s.active && reveal >= 1 && s.arcs > 0 && sparks.length < EB_ARCS) {
          const chance = dt * s.speed * s.arcs;
          if (Math.random() < chance * 5 * hover.power) sparks.push(spawnArc(time, ebNearestOn(path, hover.x - size.width / 2, hover.y - size.height / 2)));
          else if (Math.random() < chance * (0.6 + path.perimeter / 2400)) sparks.push(spawnArc(time, null));
        }
        const fit = power * power * (3 - 2 * power);
        for (let i = 0; i < EB_ARCS; i++) {
          const o = i * 4;
          const spark = sparks[i];
          if (!spark) { arcShape[o + 1] = 0; continue; }
          const k = clamp((time - spark.born) / spark.life, 0, 1);
          arcEnds[o] = spark.ax + size.width / 2 + EB_MARGIN;
          arcEnds[o + 1] = spark.ay + size.height / 2 + EB_MARGIN;
          arcEnds[o + 2] = spark.bx + size.width / 2 + EB_MARGIN;
          arcEnds[o + 3] = spark.by + size.height / 2 + EB_MARGIN;
          arcShape[o] = spark.bow;
          arcShape[o + 1] = Math.sin(Math.PI * k) * fit;
          arcShape[o + 2] = spark.seed;
        }
        for (let i = pulses.length - 1; i >= 0; i--) if (now - pulses[i].born > 2200) pulses.splice(i, 1);
        for (let i = 0; i < EB_PULSES; i++) {
          const o = i * 4;
          const pulse = pulses[i];
          if (!pulse) { pulseData[o + 2] = 0; continue; }
          pulseData[o] = pulse.s;
          pulseData[o + 1] = (now - pulse.born) / 1000;
          pulseData[o + 2] = 1;
        }
        render(s, hover.power * (s.interactive ? 1 : 0));
        const busy = power > 0.002 || s.active || sparks.length > 0;
        if (busy && visible && pageVisible) raf = requestAnimationFrame(frame);
      };
      const wake = () => {
        if (raf || lost || !visible || !pageVisible) return;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      };
      wakeOuter = () => { resize(); wake(); };
      const locate = event => {
        const rect = container.getBoundingClientRect();
        pointer.x = event.clientX - rect.left;
        pointer.y = event.clientY - rect.top;
        pointer.over = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
        pointer.near = pointer.x >= -EB_MARGIN / 2 && pointer.y >= -EB_MARGIN / 2 && pointer.x <= rect.width + EB_MARGIN / 2 && pointer.y <= rect.height + EB_MARGIN / 2;
      };
      const onPointerMove = event => { locate(event); if (pointer.near) wake(); };
      const onPointerDown = event => {
        locate(event);
        const s = settings;
        if (!pointer.over || !s.interactive || !s.active || reduced) return;
        const along = ebNearestOn(path, pointer.x - size.width / 2, pointer.y - size.height / 2);
        pulses.push({ s: along, born: performance.now() });
        if (pulses.length > EB_PULSES) pulses.shift();
        if (sparks.length < EB_ARCS) sparks.push(spawnArc(time, along));
        wake();
      };
      const onLeave = () => { pointer.over = false; pointer.near = false; };
      const onLost = event => { event.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; };
      const onRestored = () => { cleanup(); generation += 1; init(); wakeOuter(); };
      const onVisibility = () => { pageVisible = document.visibilityState !== 'hidden'; wake(); };
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerdown', onPointerDown, { passive: true });
      document.documentElement.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      const resizeObserver = new ResizeObserver(() => { resize(); wake(); });
      resizeObserver.observe(container);
      const intersection = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); wake(); });
      intersection.observe(container);
      document.addEventListener('visibilitychange', onVisibility);
      resize();
      wake();
      cleanup = () => {
        cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        intersection.disconnect();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerdown', onPointerDown);
        document.documentElement.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('visibilitychange', onVisibility);
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        if (!gl.isContextLost()) { gl.deleteVertexArray(vao); gl.deleteProgram(program.program); }
      };
    };
    init();

    return {
      setActive(active) {
        if (settings.active === !!active) return;
        opts.active = !!active;
        settings = read(opts);
        wakeOuter();
      },
      set(patch) { opts = Object.assign(opts, patch); settings = read(opts); wakeOuter(); },
      destroy() { cleanup(); canvas.remove(); },
    };
  }

  /* ===================== GradientText → Fx.gradientText ===================== */
  // 원본은 children 을 감싸는 span 구조지만, 여기선 대상 요소 자체에 그라디언트를 입힌다
  // → app.js 가 textContent 를 바꿔도 효과가 유지된다. enable(false) 로 끄면 평범한 글자로 돌아간다.
  const GT_VARIANTS = ['linear', 'flow', 'conic'];
  const GT_ANGLES = { horizontal: 90, vertical: 180, diagonal: 135 };

  function gradientText(root, options) {
    const read = o => {
      const colors = o.colors || ['#5227FF', '#FF9FFC', '#B497CF'];
      const palette = colors.length > 1 ? colors : [colors[0] ?? '#ffffff', colors[0] ?? '#ffffff'];
      return {
        colors: palette,
        speed: Math.max(0.2, o.animationSpeed ?? 8),
        variant: GT_VARIANTS.includes(o.variant) ? o.variant : 'linear',
        angle: o.direction ? (GT_ANGLES[o.direction] ?? o.angle ?? 90) : (o.angle ?? 90),
        scale: clamp(o.scale ?? 3, 1, 6),
        yoyo: o.yoyo ?? true,
        pauseOnHover: !!o.pauseOnHover,
        followPointer: !!o.followPointer,
      };
    };
    let opts = Object.assign({}, options);
    let s = read(opts);
    let enabled = opts.enabled ?? true;
    const reduce = reducedMotion();
    const state = { time: 0, inside: false, visible: true, x: 0.5, y: 0.5, px: 0.5, py: 0.5, vx: 0, vy: 0, pull: 0 };
    let raf = 0;
    let last = 0;

    const paint = () => {
      const list = s.colors;
      const cycle = state.time / s.speed;
      let image;
      if (s.variant === 'flow') {
        const blobs = list.map((color, i) => {
          const spin = cycle * TAU;
          const rate = 0.55 + ((i * 0.618) % 1) * 0.5;
          let x = 50 + 44 * Math.sin(spin * rate + i * 2.1);
          let y = 50 + 40 * Math.sin(spin * (rate * 0.83 + 0.21) + i * 1.3);
          if (i === 0) { x += (state.px * 100 - x) * state.pull; y += (state.py * 100 - y) * state.pull; }
          return `radial-gradient(ellipse ${(22 + 12 * s.scale).toFixed(1)}% ${(60 + 30 * s.scale).toFixed(1)}% at ${x.toFixed(2)}% ${y.toFixed(2)}%, ${color} 0%, transparent 100%)`;
        });
        image = `${blobs.join(', ')}, linear-gradient(${s.angle}deg, ${list.join(', ')})`;
      } else if (s.variant === 'conic') {
        const sway = s.yoyo ? Math.sin(cycle * Math.PI) * 50 : cycle * 360;
        const cx = 50 + (state.px * 100 - 50) * state.pull;
        const cy = 260 + (state.py * 100 - 260) * state.pull;
        image = `repeating-conic-gradient(from ${(sway - 30).toFixed(2)}deg at ${cx.toFixed(2)}% ${cy.toFixed(2)}%, ${list.concat(list[0]).map((color, i) => `${color} ${((i / list.length) * 60 * (3 / s.scale)).toFixed(2)}deg`).join(', ')})`;
      } else {
        const loop = list.concat(list[0]);
        const period = 100 * s.scale;
        let offset;
        if (s.yoyo) {
          const swing = cycle % 2;
          const t = swing < 1 ? swing : 2 - swing;
          offset = (0.5 - Math.cos(Math.PI * t) / 2) * (period - 100);
        } else {
          offset = (cycle % 1) * period;
        }
        offset += (state.px - 0.5) * period * 0.5 * state.pull;
        const stops = loop.map((color, i) => `${color} ${((i / (loop.length - 1)) * period - offset).toFixed(2)}%`);
        image = `repeating-linear-gradient(${s.angle}deg, ${stops.join(', ')})`;
      }
      root.style.setProperty('--gt-gradient', image);
    };
    const tick = now => {
      raf = 0;
      if (!enabled) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const paused = reduce || (s.pauseOnHover && state.inside);
      if (!paused) state.time += dt;
      const target = s.followPointer && state.inside ? 1 : 0;
      state.pull += (target - state.pull) * (1 - Math.exp(-dt * 6));
      const stiffness = 160;
      state.vx += ((state.x - state.px) * stiffness - state.vx * 2 * Math.sqrt(stiffness)) * dt;
      state.vy += ((state.y - state.py) * stiffness - state.vy * 2 * Math.sqrt(stiffness)) * dt;
      state.px += state.vx * dt;
      state.py += state.vy * dt;
      paint();
      const settling = Math.abs(state.pull - target) > 0.001 || Math.abs(state.vx) + Math.abs(state.vy) > 0.001;
      if (!state.visible || document.hidden || (paused && !settling)) return;
      raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (raf || !enabled) return; last = performance.now(); raf = requestAnimationFrame(tick); };
    const locate = event => {
      const rect = root.getBoundingClientRect();
      state.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      state.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    };
    const onEnter = event => { locate(event); if (!state.inside) { state.px = state.x; state.py = state.y; } state.inside = true; wake(); };
    const onMove = event => { locate(event); wake(); };
    const onLeave = () => { state.inside = false; wake(); };
    const onVisibility = () => wake();
    const observer = new IntersectionObserver(entries => { state.visible = entries.some(entry => entry.isIntersecting); if (state.visible) wake(); });
    observer.observe(root);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);

    const apply = () => {
      root.classList.toggle('fx-gradient-text', enabled);
      if (enabled) { paint(); wake(); } else { cancelAnimationFrame(raf); raf = 0; root.style.removeProperty('--gt-gradient'); }
    };
    apply();

    return {
      enable(on, patch) {
        if (patch) { opts = Object.assign(opts, patch); s = read(opts); }
        enabled = !!on;
        apply();
      },
      destroy() {
        enabled = false;
        apply();
        observer.disconnect();
        root.removeEventListener('pointerenter', onEnter);
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('visibilitychange', onVisibility);
      },
    };
  }

  /* ===================== ShinyText → Fx.shinyText ===================== */
  const ST_EASINGS = {
    linear: t => t,
    smooth: t => 0.5 - Math.cos(Math.PI * t) / 2,
    snappy: t => (t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2),
  };
  const ST_TRIGGERS = ['loop', 'hover', 'view'];
  const ST_FALLOFF = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const stParse = value => toRgb255(value).concat(1);
  const stBlend = (from, to, amount) => {
    const channel = (a, b) => Math.round(Math.pow(Math.pow(a / 255, 2.2) * (1 - amount) + Math.pow(b / 255, 2.2) * amount, 1 / 2.2) * 255);
    const alpha = from[3] * (1 - amount) + to[3] * amount;
    if (alpha <= 0) return 'rgba(0, 0, 0, 0)';
    const weigh = (a, b) => (a * from[3] * (1 - amount) + b * to[3] * amount) / alpha;
    const r = from[3] === to[3] ? channel(from[0], to[0]) : Math.round(weigh(from[0], to[0]));
    const g = from[3] === to[3] ? channel(from[1], to[1]) : Math.round(weigh(from[1], to[1]));
    const b = from[3] === to[3] ? channel(from[2], to[2]) : Math.round(weigh(from[2], to[2]));
    return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
  };

  function shinyText(root, options) {
    const o = Object.assign({}, options);
    const s = {
      color: o.color ?? '#b5b5b5',
      shineColor: o.shineColor ?? '#ffffff',
      speed: Math.max(0.1, o.speed ?? 2),
      delay: Math.max(0, o.delay ?? 0),
      angle: o.angle ?? 120,
      shineWidth: clamp(o.shineWidth ?? 40, 2, 200),
      softness: clamp(o.softness ?? 0.8, 0, 1),
      bands: clamp(Math.round(o.bands ?? 1), 1, 3),
      sign: o.direction === 'right' ? 1 : -1,
      ease: ST_EASINGS[o.easing] ?? ST_EASINGS.smooth,
      trigger: ST_TRIGGERS.includes(o.trigger) ? o.trigger : 'loop',
      yoyo: !!o.yoyo,
      followPointer: !!o.followPointer,
      pauseOnHover: !!o.pauseOnHover,
    };
    root.classList.add('fx-shiny-text');
    const reduce = reducedMotion();
    const base = stParse(s.color);
    const shine = stParse(s.shineColor);
    const state = { pos: null, vel: 0, phase: 'idle', from: 0, to: 0, start: 0, duration: 1, resume: 0, flip: false, inside: false, target: 0, visible: true, seen: false };
    let raf = 0, timer = 0, last = 0, alive = true;

    const extent = () => s.shineWidth / 2 + (s.bands - 1) * s.shineWidth * 1.3 + 2;
    const entry = () => (s.sign > 0 ? -extent() : 100 + extent());
    const exit = () => (s.sign > 0 ? 100 + extent() : -extent());
    const nearest = () => (state.target < 50 ? -extent() : 100 + extent());
    const gradient = pos => {
      const half = s.shineWidth / 2;
      const core = half * (1 - s.softness);
      const fade = half - core;
      const stops = [];
      for (let band = 0; band < s.bands; band++) {
        const center = pos - s.sign * band * s.shineWidth * 1.3;
        const strength = 1 - band * 0.28;
        for (const side of [-1, 1]) {
          for (const f of ST_FALLOFF) {
            stops.push([center + side * (core + fade * (1 - f)), f * f * (3 - 2 * f) * strength]);
          }
        }
      }
      stops.sort((a, b) => a[0] - b[0]);
      const list = stops.map(([at, amount]) => `${stBlend(base, shine, amount)} ${at.toFixed(2)}%`);
      return `linear-gradient(${s.angle}deg, ${stBlend(base, shine, 0)} 0%, ${list.join(', ')}, ${stBlend(base, shine, 0)} 100%)`;
    };
    const draw = () => {
      root.style.backgroundImage = state.pos === null ? `linear-gradient(${s.color}, ${s.color})` : gradient(state.pos);
    };
    const sweep = (from, to, now) => {
      const span = Math.abs(exit() - entry()) || 1;
      state.phase = 'sweep'; state.from = from; state.to = to; state.start = now;
      state.duration = s.speed * 1000 * Math.max(0.15, Math.abs(to - from) / span);
    };
    const wake = () => {
      if (raf || !alive) return;
      window.clearTimeout(timer);
      timer = 0;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const tick = now => {
      raf = 0;
      if (!alive) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (s.followPointer && state.inside) {
        if (state.pos === null) state.pos = nearest();
        const stiffness = 220;
        state.vel += ((state.target - state.pos) * stiffness - state.vel * 2 * Math.sqrt(stiffness)) * dt;
        state.pos += state.vel * dt;
        state.phase = 'follow';
        draw();
        raf = requestAnimationFrame(tick);
        return;
      }
      if (state.phase === 'follow') { state.vel = 0; sweep(state.pos ?? nearest(), nearest(), now); }
      if (state.phase === 'sweep') {
        if (s.pauseOnHover && state.inside) { state.start += dt * 1000; raf = requestAnimationFrame(tick); return; }
        const t = clamp((now - state.start) / state.duration, 0, 1);
        state.pos = state.from + (state.to - state.from) * s.ease(t);
        draw();
        if (t < 1) { raf = requestAnimationFrame(tick); return; }
        if (s.trigger !== 'loop' || reduce) { state.phase = 'idle'; state.pos = null; draw(); return; }
        state.phase = 'wait';
        state.resume = now + s.delay * 1000;
      }
      if (state.phase === 'wait') {
        if (!state.visible || document.hidden) return;
        if (now < state.resume) { window.clearTimeout(timer); timer = window.setTimeout(wake, state.resume - now); return; }
        if (s.yoyo) { state.flip = !state.flip; sweep(state.flip ? exit() : entry(), state.flip ? entry() : exit(), now); }
        else sweep(entry(), exit(), now);
        raf = requestAnimationFrame(tick);
        return;
      }
      if (state.phase === 'idle' && s.trigger === 'loop' && !reduce && state.visible) {
        state.flip = false;
        sweep(entry(), exit(), now);
        raf = requestAnimationFrame(tick);
      }
    };
    const locate = event => {
      const rect = root.getBoundingClientRect();
      const radians = (s.angle * Math.PI) / 180;
      const dx = Math.sin(radians), dy = -Math.cos(radians);
      const length = Math.abs(rect.width * dx) + Math.abs(rect.height * dy) || 1;
      const along = (event.clientX - rect.left - rect.width / 2) * dx + (event.clientY - rect.top - rect.height / 2) * dy;
      return 50 + (along / length) * 100;
    };
    const onEnter = event => {
      state.inside = true;
      state.target = locate(event);
      if (s.followPointer) { if (state.pos === null) state.pos = nearest(); }
      else if (s.trigger === 'hover' && state.phase === 'idle' && !reduce) sweep(entry(), exit(), performance.now());
      wake();
    };
    const onMove = event => { state.target = locate(event); if (s.followPointer) wake(); };
    const onLeave = () => { state.inside = false; wake(); };
    const onVisibility = () => wake();
    const observer = new IntersectionObserver(entries => {
      state.visible = entries.some(item => item.isIntersecting);
      if (!state.visible) return;
      if (s.trigger === 'view' && !state.seen && !reduce) { state.seen = true; sweep(entry(), exit(), performance.now()); }
      wake();
    });
    observer.observe(root);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    draw();
    wake();

    return {
      // 코드에서 한 번 훑기(예: 화면 진입 순간)
      sweep() { if (reduce) return; sweep(entry(), exit(), performance.now()); wake(); },
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        window.clearTimeout(timer);
        observer.disconnect();
        root.removeEventListener('pointerenter', onEnter);
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('visibilitychange', onVisibility);
        root.classList.remove('fx-shiny-text');
        root.style.backgroundImage = '';
      },
    };
  }

  /* ===================== Counter → Fx.counter ===================== */
  // React 의 slot 리스트 재조정을 key → DOM 노드 Map 으로 대신한다. 자릿수 스프링 물리·stagger·
  // 등장/퇴장 폭 애니메이션은 원본 그대로. 모션블러(SVG filter)는 모바일 비용 때문에 뺐다.
  const C_NUMERIC = new Set(['integer', 'group', 'decimal', 'fraction']);
  const C_DIRECTIONS = ['auto', 'up', 'down', 'shortest'];
  const C_MASK = 'linear-gradient(to bottom, rgba(0, 0, 0, 0) 0, rgba(0, 0, 0, 0.0355) calc(var(--counter-fade, 0em) * 0.1667), rgba(0, 0, 0, 0.2099) calc(var(--counter-fade, 0em) * 0.3333), rgba(0, 0, 0, 0.5) calc(var(--counter-fade, 0em) * 0.5), rgba(0, 0, 0, 0.7901) calc(var(--counter-fade, 0em) * 0.6667), rgba(0, 0, 0, 0.9645) calc(var(--counter-fade, 0em) * 0.8333), #000 var(--counter-fade, 0em), #000 calc(100% - var(--counter-fade, 0em)), rgba(0, 0, 0, 0.9645) calc(100% - var(--counter-fade, 0em) * 0.8333), rgba(0, 0, 0, 0.7901) calc(100% - var(--counter-fade, 0em) * 0.6667), rgba(0, 0, 0, 0.5) calc(100% - var(--counter-fade, 0em) * 0.5), rgba(0, 0, 0, 0.2099) calc(100% - var(--counter-fade, 0em) * 0.3333), rgba(0, 0, 0, 0.0355) calc(100% - var(--counter-fade, 0em) * 0.1667), rgba(0, 0, 0, 0) 100%)';
  const cMod = (value, base) => ((value % base) + base) % base;
  const cWrap = offset => cMod(offset + 5, 10) - 5;
  const cStepBetween = (from, to, direction) => {
    const up = cMod(to - from, 10);
    if (direction === 'up') return up;
    if (direction === 'down') return up === 0 ? 0 : up - 10;
    return up > 5 ? up - 10 : up;
  };
  const cFormatter = (locale, opts) => { try { return new Intl.NumberFormat(locale, opts); } catch (_) { return new Intl.NumberFormat('en-US'); } };
  const cDigitsFor = formatter => {
    const { locale, numberingSystem } = formatter.resolvedOptions();
    const plain = cFormatter(locale, { numberingSystem, useGrouping: false });
    return Array.from({ length: 10 }, (_, d) => plain.format(d));
  };
  const cSlotsFor = (formatter, digits, value) => {
    const parts = formatter.formatToParts(value);
    let first = -1, lastIdx = -1, place = 0;
    parts.forEach((part, index) => {
      if (!C_NUMERIC.has(part.type)) return;
      if (first < 0) first = index;
      lastIdx = index;
      if (part.type === 'integer') place += [...part.value].length;
    });
    let fraction = 0;
    const counts = {};
    const slots = [];
    parts.forEach((part, index) => {
      if (part.type === 'integer' || part.type === 'fraction') {
        [...part.value].forEach(char => {
          const digit = Math.max(0, digits.indexOf(char));
          if (part.type === 'integer') { place -= 1; slots.push({ key: `i${place}`, kind: 'digit', digit, text: '', rank: -2 * place }); }
          else { slots.push({ key: `f${fraction}`, kind: 'digit', digit, text: '', rank: 1 + fraction }); fraction += 1; }
        });
      } else if (part.type === 'group') {
        slots.push({ key: `g${place}`, kind: 'symbol', digit: 0, text: part.value, rank: 1 - 2 * place });
      } else if (part.type === 'decimal') {
        slots.push({ key: 'd', kind: 'symbol', digit: 0, text: part.value, rank: 0.5 });
      } else {
        const before = first < 0 || index < first;
        const name = `${before ? 'p' : 's'}-${part.type}`;
        counts[name] = (counts[name] || 0) + 1;
        slots.push({ key: `${name}-${counts[name]}`, kind: 'symbol', digit: 0, text: part.value, rank: before ? -10000 - (first - index) : 10000 + (index - lastIdx) });
      }
    });
    return slots;
  };

  function counter(root, options) {
    const o = Object.assign({ locale: 'ko-KR', format: {}, direction: 'auto', duration: 0.7, bounce: 0.2, stagger: 0.04, intro: false, fade: 0.3, tabular: true }, options);
    const s = {
      direction: C_DIRECTIONS.includes(o.direction) ? o.direction : 'auto',
      duration: Math.max(0.05, o.duration),
      bounce: clamp(o.bounce, 0, 0.9),
      stagger: Math.max(0, o.stagger),
      tabular: o.tabular,
    };
    const formatter = cFormatter(o.locale, o.format);
    const digits = cDigitsFor(formatter);
    root.classList.add('counter');
    root.style.setProperty('--counter-fade', `${Math.max(0, o.fade)}em`);
    if (s.tabular) root.style.fontVariantNumeric = 'tabular-nums';
    root.textContent = '';
    const sr = document.createElement('span');
    sr.className = 'counter__sr';
    const row = document.createElement('span');
    row.className = 'counter__row';
    row.setAttribute('aria-hidden', 'true');
    const measureRow = document.createElement('span');
    measureRow.className = 'counter__measure';
    measureRow.setAttribute('aria-hidden', 'true');
    digits.forEach(char => { const m = document.createElement('span'); m.textContent = char; measureRow.appendChild(m); });
    root.append(sr, row, measureRow);

    const items = new Map();
    const e = { raf: 0, last: 0, ready: false, value: 0, widths: [] };
    const measure = () => { e.widths = [...measureRow.children].map(child => child.getBoundingClientRect().width); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure).catch(noop);

    const makeEl = (slot, start) => {
      const el = document.createElement('span');
      el.dataset.slot = slot.key;
      if (slot.kind === 'digit') {
        el.className = 'counter__digit';
        const sizer = document.createElement('span');
        sizer.className = 'counter__sizer';
        sizer.textContent = digits[slot.digit];
        const win = document.createElement('span');
        win.className = 'counter__window';
        win.style.maskImage = C_MASK;
        win.style.webkitMaskImage = C_MASK;
        const strip = document.createElement('span');
        strip.className = 'counter__strip';
        const numerals = digits.map((char, n) => {
          const numeral = document.createElement('span');
          numeral.className = 'counter__numeral';
          numeral.textContent = char;
          numeral.style.transform = `translateY(${cWrap(n - start) * 100}%)`;
          strip.appendChild(numeral);
          return numeral;
        });
        win.appendChild(strip);
        el.append(sizer, win);
        return { el, numerals };
      }
      el.className = 'counter__symbol';
      const text = document.createElement('span');
      text.className = 'counter__symbol-text';
      text.textContent = slot.text;
      el.appendChild(text);
      return { el, numerals: null };
    };
    const makeItem = (slot, pos, shown) => {
      const { el, numerals } = makeEl(slot, pos);
      return { kind: slot.kind, rank: slot.rank, pos, vel: 0, target: pos, shown, shownVel: 0, shownTarget: shown, wait: 0, exiting: false, natural: 0, el, numerals };
    };
    const reorder = () => {
      [...items.values()].sort((a, b) => a.rank - b.rank).forEach(item => row.appendChild(item.el));
    };
    const paint = item => {
      const el = item.el;
      const shown = clamp(item.shown, 0, 1);
      const resting = item.pos === item.target && item.vel === 0;
      if (item.kind === 'digit') {
        item.numerals.forEach((numeral, n) => { numeral.style.transform = `translateY(${(cWrap(n - item.pos) * 100).toFixed(3)}%)`; });
        if (shown >= 1 && (s.tabular || resting)) {
          el.style.width = '';
        } else {
          if (!e.widths.length) measure();
          const at = cMod(item.pos, 10);
          const low = Math.floor(at);
          const from = e.widths[low % 10] ?? 0;
          const to = e.widths[(low + 1) % 10] ?? from;
          el.style.width = `${((from + (to - from) * (at - low)) * shown).toFixed(2)}px`;
        }
      } else {
        el.style.width = shown >= 1 ? '' : `${(item.natural * shown).toFixed(2)}px`;
      }
      if (shown >= 1) el.style.removeProperty('--counter-shown');
      else el.style.setProperty('--counter-shown', shown.toFixed(3));
    };
    const frame = now => {
      e.raf = 0;
      const elapsed = clamp((now - e.last) / 1000, 0, 1 / 20);
      e.last = now;
      const reduced = reducedMotion();
      const omega = TAU / s.duration;
      const zeta = 1 - s.bounce;
      const presence = TAU / (s.duration * 0.85);
      const done = [];
      let busy = false;
      items.forEach((item, key) => {
        if (reduced) {
          item.wait = 0; item.pos = item.target; item.vel = 0; item.shown = item.shownTarget; item.shownVel = 0;
        } else {
          let left = elapsed;
          if (item.wait > 0) { const used = Math.min(item.wait, left); item.wait -= used; left -= used; }
          if (left > 0) {
            const steps = Math.ceil(left * 240);
            const dt = left / steps;
            for (let i = 0; i < steps; i++) {
              item.vel += (-omega * omega * (item.pos - item.target) - 2 * zeta * omega * item.vel) * dt;
              item.pos += item.vel * dt;
              item.shownVel += (-presence * presence * (item.shown - item.shownTarget) - 2 * presence * item.shownVel) * dt;
              item.shown += item.shownVel * dt;
            }
          }
        }
        const settled = item.wait <= 0 && Math.abs(item.pos - item.target) < 0.002 && Math.abs(item.vel) < 0.02 &&
          Math.abs(item.shown - item.shownTarget) < 0.002 && Math.abs(item.shownVel) < 0.02;
        if (settled) {
          item.target = cMod(Math.round(item.target), 10);
          item.pos = item.target; item.vel = 0; item.shown = item.shownTarget; item.shownVel = 0;
          if (item.exiting) done.push(key);
        } else busy = true;
        paint(item);
      });
      done.forEach(key => { const item = items.get(key); if (item) item.el.remove(); items.delete(key); });
      if (busy) e.raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (e.raf) return;
      e.last = performance.now();
      e.raf = requestAnimationFrame(frame);
    };

    const set = raw => {
      const amount = typeof raw === 'number' ? (Object.is(raw, -0) ? 0 : raw) : Number(raw) || 0;
      sr.textContent = formatter.format(amount);
      const slots = cSlotsFor(formatter, digits, amount);
      if (!e.ready) {
        slots.forEach(slot => items.set(slot.key, makeItem(slot, slot.kind === 'digit' ? slot.digit : 0, 1)));
        reorder();
        e.ready = true;
        e.value = amount;
        items.forEach(paint);
        if (o.intro && !reducedMotion()) {
          const turn = s.direction === 'down' ? -10 : 10;
          [...items.values()].filter(item => item.kind === 'digit').sort((a, b) => a.rank - b.rank)
            .forEach((item, order) => { item.target += turn; item.wait = order * s.stagger; });
          kick();
        }
        return;
      }
      if (amount === e.value) return;
      const previous = e.value;
      e.value = amount;
      const trend = s.direction !== 'auto' ? s.direction
        : Math.abs(amount) > Math.abs(previous) ? 'up' : Math.abs(amount) < Math.abs(previous) ? 'down' : 'shortest';
      const next = new Set(slots.map(slot => slot.key));
      const moving = [];
      let added = false;
      slots.forEach(slot => {
        let item = items.get(slot.key);
        if (!item) {
          item = makeItem(slot, 0, 0);
          items.set(slot.key, item);
          added = true;
        }
        item.exiting = false;
        item.shownTarget = 1;
        item.rank = slot.rank;
        if (slot.kind !== 'digit') return;
        const step = cStepBetween(cMod(Math.round(item.target), 10), slot.digit, trend);
        if (step !== 0 || item.shown < 1) { item.target += step; moving.push(item); }
      });
      items.forEach((item, key) => {
        if (next.has(key) || item.exiting) return;
        item.exiting = true;
        item.shownTarget = 0;
        if (item.kind !== 'digit') return;
        item.target += cStepBetween(cMod(Math.round(item.target), 10), 0, trend);
        moving.push(item);
      });
      moving.sort((a, b) => b.rank - a.rank).forEach((item, order) => { item.wait = order * s.stagger; });
      items.forEach((item, key) => {
        if (item.kind !== 'symbol' || key[0] !== 'g') return;
        const owner = items.get(`i${key.slice(1)}`);
        if (owner && (owner.shown < 1 || owner.shownTarget < 1)) item.wait = owner.wait;
      });
      if (added) reorder();
      items.forEach(item => {
        if (item.kind === 'symbol' && (item.shown < 1 || item.shownTarget < 1)) {
          item.natural = (item.el.firstElementChild && item.el.firstElementChild.getBoundingClientRect().width) || 0;
        }
        paint(item);
      });
      kick();
    };

    return { set, destroy() { cancelAnimationFrame(e.raf); root.textContent = ''; root.classList.remove('counter'); } };
  }

  /* ================ Backgrounds/PrismaticBurst → Fx.prismBurst ================ */
  // 원본은 화면을 채우는 배경(상시 렌더)이다. 여기서는 💎 프리즘 보상이 터지는 '순간에만' 쓰는 오버레이로 바꿨다:
  //  화면 고정 레이어에 정사각 캔버스 하나를 두고, play(x, y) 때 그 자리로 옮겨 원본의 intro(빛 앞머리가 바깥으로 퍼짐)와
  //  클릭 펄스를 한 번 재생한 뒤 서서히 사라지고 렌더 루프를 멈춘다. WebGL 컨텍스트는 하나만 만들어 계속 재사용한다.
  //  BURST 셰이더·intro·펄스·자동 해상도 조절(governor)은 원본 그대로. 블룸·라이트모드·마우스 반응·hover 회전은 덜어냈다.
  const PB_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
  const PB_BURST = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uResolution;
uniform float uTime;
uniform float uPhase;
uniform float uIntensity;
uniform mat3 uOrient;
uniform int uColorCount;
uniform float uDistort;
uniform vec2 uOffset;
uniform sampler2D uGradient;
uniform float uNoiseAmount;
uniform int uRayCount;
uniform float uZoom;
uniform float uRayWidth;
uniform float uTwist;
uniform float uFlow;
uniform float uCenterFade;
uniform vec4 uPointer;
uniform vec4 uPulses[4];
uniform vec3 uIntro;
uniform float uEncode;
out vec4 outColor;

float hash21(vec2 p) {
  p = floor(p);
  float f = 52.9829189 * fract(dot(p, vec2(0.065, 0.005)));
  return fract(f);
}

mat2 rot30() {
  return mat2(0.8, -0.5, 0.5, 0.8);
}

float layeredNoise(vec2 fragPx) {
  vec2 p = mod(fragPx + vec2(uTime * 30.0, -uTime * 21.0), 1024.0);
  vec2 q = rot30() * p;
  float n = 0.0;
  n += 0.40 * hash21(q);
  n += 0.25 * hash21(q * 2.0 + 17.0);
  n += 0.20 * hash21(q * 4.0 + 47.0);
  n += 0.10 * hash21(q * 8.0 + 113.0);
  n += 0.05 * hash21(q * 16.0 + 191.0);
  return n;
}

float edgeFade(vec2 frag, vec2 res, vec2 offset) {
  vec2 toC = frag - 0.5 * res - offset;
  float r = length(toC) / (0.5 * min(res.x, res.y) * uCenterFade);
  float x = clamp(r, 0.0, 1.0);
  float q = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
  float s = q * 0.5;
  s = pow(s, 1.5);
  float tail = 1.0 - pow(1.0 - s, 2.0);
  s = mix(s, tail, 0.2);
  float dn = (layeredNoise(frag * 0.15) - 0.5) * 0.0015 * s;
  return clamp(s + dn, 0.0, 1.0);
}

vec2 rot2(vec2 v, float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c) * v;
}

float bendAngle(vec3 q, float t) {
  return 0.8 * sin(q.x * 0.55 + t * 0.6) + 0.7 * sin(q.y * 0.50 - t * 0.5) + 0.6 * sin(q.z * 0.60 + t * 0.7);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float t = uPhase;
  float jitterAmp = 0.1 * clamp(uNoiseAmount, 0.0, 1.0);
  vec2 centered = 2.0 * (frag - uOffset) - uResolution;
  vec3 dir = normalize(vec3(centered, uResolution.y * max(uZoom, 1e-3)));
  float marchT = 0.0;
  vec3 col = vec3(0.0);
  float n = layeredNoise(frag);
  float amp = clamp(uDistort, 0.0, 50.0) * 0.15;
  float edge = 0.5 - 0.35 * (uRayWidth - 1.0);
  mat2 twist = mat2(1.0);
  if (uTwist != 0.0) {
    float a = uTwist * length(centered) / uResolution.y;
    float c = cos(a);
    float s = sin(a);
    twist = mat2(c, s, -s, c);
  }

  for (int i = 0; i < 44; ++i) {
    vec3 P = marchT * dir;
    P.z -= 2.0;
    float rad = length(P);
    vec3 Pl = P * (10.0 / max(rad, 1e-6));
    if (uTwist != 0.0) Pl.xy = twist * Pl.xy;
    Pl = uOrient * Pl;

    float stepLen = min(rad - 0.3, n * jitterAmp) + 0.1;

    vec3 Pb = Pl;
    if (amp > 0.0) {
      float grow = smoothstep(0.35, 3.0, marchT);
      float a1 = amp * grow * bendAngle(Pl * 0.6, t);
      float a2 = 0.5 * amp * grow * bendAngle(Pl.zyx * 0.5 + 3.1, t * 0.9);
      Pb.xz = rot2(Pb.xz, a1);
      Pb.xy = rot2(Pb.xy, a2);
    }

    float rayPattern = smoothstep(
      edge,
      edge + 0.2,
      sin(Pb.x + cos(Pb.y) * cos(Pb.z)) * sin(Pb.z + sin(Pb.y) * cos(Pb.x + t))
    );

    if (uRayCount > 0) {
      float ang = atan(Pb.y, Pb.x);
      float comb = 0.5 + 0.5 * cos(float(uRayCount) * ang);
      comb = pow(comb, 3.0);
      rayPattern *= smoothstep(0.15, 0.95, comb);
    }

    float depth = marchT - uFlow;
    vec3 spectral;
    if (uColorCount > 0) {
      float saw = fract(depth * 0.25);
      float tRay = saw * saw * (3.0 - 2.0 * saw);
      spectral = 2.0 * texture(uGradient, vec2(clamp(tRay, 0.0, 1.0), 0.5)).rgb;
    } else {
      spectral = 1.0 + cos(depth * 3.0 + vec3(0.0, 1.0, 2.0));
    }

    col += (0.05 / (0.4 + stepLen)) * smoothstep(5.0, 0.0, rad) * spectral * rayPattern;
    marchT += stepLen;
  }

  col *= edgeFade(frag, uResolution, uOffset);
  col *= uIntensity;

  float unit = 0.5 * min(uResolution.x, uResolution.y);
  float radius = length(frag - 0.5 * uResolution - uOffset) / unit;
  float lift = 1.0;
  for (int k = 0; k < 4; k++) {
    vec4 pulse = uPulses[k];
    if (pulse.y <= 0.0) continue;
    float d = (radius - pulse.x) / pulse.z;
    lift += pulse.y * exp(-d * d) + pulse.w;
  }
  if (uPointer.z > 0.0) {
    vec2 m = (frag - uPointer.xy) / unit;
    lift += uPointer.z * exp(-dot(m, m) / max(uPointer.w * uPointer.w, 1e-4));
  }
  if (uIntro.z > 0.0) {
    vec2 toC = frag - 0.5 * uResolution - uOffset;
    float ang = atan(toC.y, toC.x);
    float streak = 0.5 + 0.22 * sin(ang * 5.0 + 1.3) + 0.16 * sin(ang * 13.0 + 4.1) + 0.12 * sin(ang * 29.0 + 2.2);
    float front = uIntro.x * (0.7 + 0.3 * streak);
    float d = (radius - front) / 0.2;
    lift += uIntro.y * exp(-d * d);
    lift *= smoothstep(front, front - 0.5, radius);
  }

  outColor = vec4(col * lift * uEncode, 1.0);
}`;
  // 원본 COMPOSITE 에서 블룸·라이트모드를 덜어낸 판(바이큐빅 업스케일·가장자리 페이드는 그대로)
  const PB_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uSceneSize;
uniform vec2 uView;
uniform float uExact;
uniform float uDecode;
uniform float uFade;
out vec4 outColor;

vec3 tap(vec2 uv) {
  return textureLod(uScene, uv, 0.0).rgb;
}

vec3 bicubic(vec2 uv) {
  vec2 position = uv * uSceneSize;
  vec2 center = floor(position - 0.5) + 0.5;
  vec2 f = position - center;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (center - 1.0) / uSceneSize;
  vec2 t3 = (center + 2.0) / uSceneSize;
  vec2 t12 = (center + w2 / w12) / uSceneSize;
  vec3 result = tap(vec2(t0.x, t0.y)) * w0.x * w0.y;
  result += tap(vec2(t12.x, t0.y)) * w12.x * w0.y;
  result += tap(vec2(t3.x, t0.y)) * w3.x * w0.y;
  result += tap(vec2(t0.x, t12.y)) * w0.x * w12.y;
  result += tap(vec2(t12.x, t12.y)) * w12.x * w12.y;
  result += tap(vec2(t3.x, t12.y)) * w3.x * w12.y;
  result += tap(vec2(t0.x, t3.y)) * w0.x * w3.y;
  result += tap(vec2(t12.x, t3.y)) * w12.x * w3.y;
  result += tap(vec2(t3.x, t3.y)) * w3.x * w3.y;
  return max(result, 0.0);
}

float smootherstep01(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec3 col = uExact > 0.5 ? texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb : bicubic(uv);
  col = clamp(col * uDecode, 0.0, 1.0);
  float mask = 1.0;
  float edge = uFade * 0.5;
  if (edge > 0.0) {
    mask *= smootherstep01(uv.x / edge) * smootherstep01((1.0 - uv.x) / edge);
    mask *= smootherstep01(uv.y / edge) * smootherstep01((1.0 - uv.y) / edge);
  }
  col *= mask;
  outColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;
  const PB_MIN_SCALE = 0.2;
  const PB_PULSE_LIFE = 1.5;
  const pbRot = {
    x: a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; },
    y: a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; },
    z: a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  };
  const pbMultiply = (a, b) => {
    const out = new Float32Array(9);
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        out[col * 3 + row] = a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2];
      }
    }
    return out;
  };

  function prismBurst(defaults) {
    const base = Object.assign({
      colors: [], intensity: 2, speed: 0.5, distort: 0, rayCount: 0, rayWidth: 1, zoom: 1, twist: 0, flow: 0,
      centerFade: 1, grain: 0.8, fade: 0.6, quality: 0.5, size: 340, introSeconds: 1.2, hold: 0.35, out: 0.55,
    }, defaults);
    const off = { play: noop, destroy: noop };
    if (reducedMotion()) return off;
    const layer = document.createElement('div');
    layer.className = 'fx-prism';
    layer.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-prism__canvas';
    layer.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) return off;
    const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    const burstProgram = linkProgram(gl, PB_VERTEX, PB_BURST);
    const compositeProgram = linkProgram(gl, PB_VERTEX, PB_COMPOSITE);
    if (!burstProgram || !compositeProgram) return off;
    document.body.appendChild(layer);

    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const p of [burstProgram, compositeProgram]) {
      const loc = gl.getAttribLocation(p.program, 'aPosition');
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    }
    const format = floatTargets ? gl.RGBA16F : gl.RGBA8;
    const encode = floatTargets ? 1 : 0.25;
    const scene = { texture: null, framebuffer: gl.createFramebuffer(), width: 0, height: 0 };
    const allocate = (target, width, height) => {
      if (target.texture && target.width === width && target.height === height) return;
      if (target.texture) gl.deleteTexture(target.texture);
      target.texture = gl.createTexture();
      target.width = width;
      target.height = height;
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
    };
    const gradient = gl.createTexture();
    let gradientKey = null;
    const uploadGradient = list => {
      const key = list.join('|');
      if (key === gradientKey) return;
      gradientKey = key;
      const count = Math.max(1, list.length);
      const data = new Uint8Array(count * 4).fill(255);
      list.forEach((value, index) => data.set(toRgb255(value), index * 4));
      gl.bindTexture(gl.TEXTURE_2D, gradient);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, count, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };

    let s = Object.assign({}, base);
    const state = { time: 0, phase: 0, flow: 0, kick: 0, intro: 1, governor: 1, slow: 0, quick: 0, age: 0, live: false };
    const pulses = [];
    const pulseData = new Float32Array(16);
    let raf = 0, last = 0, hideTimer = 0;

    const render = () => {
      const width = canvas.width, height = canvas.height;
      const scale = Math.max(PB_MIN_SCALE, clamp(s.quality, PB_MIN_SCALE, 1) * state.governor);
      const sceneWidth = Math.max(1, Math.round(width * scale));
      const sceneHeight = Math.max(1, Math.round(height * scale));
      const exact = sceneWidth === width && sceneHeight === height;
      gl.bindVertexArray(vao);
      allocate(scene, sceneWidth, sceneHeight);
      uploadGradient(s.colors);
      const t = state.phase;
      const orient = pbMultiply(pbMultiply(pbRot.z(t * 0.17), pbRot.y(t * 0.21)), pbRot.x(t * 0.31));   // 원본 rotate3d
      pulseData.fill(0);
      pulses.forEach((pulse, index) => {
        const life = pulse.age / PB_PULSE_LIFE;
        pulseData.set([pulse.age * 1.7, 1.6 * Math.pow(1 - life, 1.6), 0.2 + pulse.age * 0.16, 0.35 * Math.exp(-pulse.age * 7)], index * 4);
      });
      const unit = 0.5 * Math.min(sceneWidth, sceneHeight);
      const reach = Math.hypot(sceneWidth * 0.5, sceneHeight * 0.5) / Math.max(unit, 1);
      const rise = 1 - Math.pow(1 - state.intro, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.framebuffer);
      gl.viewport(0, 0, sceneWidth, sceneHeight);
      gl.useProgram(burstProgram.program);
      const b = burstProgram.uniforms;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, gradient);
      gl.uniform1i(b.uGradient, 0);
      gl.uniform2f(b.uResolution, sceneWidth, sceneHeight);
      gl.uniform1f(b.uTime, state.time);
      gl.uniform1f(b.uPhase, t);
      gl.uniform1f(b.uIntensity, s.intensity);
      gl.uniformMatrix3fv(b.uOrient, false, orient);
      gl.uniform1i(b.uColorCount, s.colors.length);
      gl.uniform1f(b.uDistort, s.distort);
      gl.uniform2f(b.uOffset, 0, 0);
      gl.uniform1f(b.uNoiseAmount, clamp(s.grain, 0.3, 1));
      gl.uniform1i(b.uRayCount, Math.max(0, Math.floor(s.rayCount)));
      gl.uniform1f(b.uZoom, Math.max(0.05, s.zoom));
      gl.uniform1f(b.uRayWidth, clamp(s.rayWidth, 0.2, 2.5));
      gl.uniform1f(b.uTwist, s.twist);
      gl.uniform1f(b.uFlow, state.flow);
      gl.uniform1f(b.uCenterFade, clamp(s.centerFade, 0.5, 3) * Math.max(1, s.zoom));
      gl.uniform4f(b.uPointer, 0, 0, 0, 0.45);
      gl.uniform4fv(b.uPulses, pulseData);
      gl.uniform3f(b.uIntro, (rise * (reach + 0.6)) / 0.7, 1.6 * (1 - state.intro), state.intro < 1 ? 1 : 0);
      gl.uniform1f(b.uEncode, encode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(compositeProgram.program);
      const c = compositeProgram.uniforms;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.texture);
      gl.uniform1i(c.uScene, 0);
      gl.uniform2f(c.uSceneSize, sceneWidth, sceneHeight);
      gl.uniform2f(c.uView, width, height);
      gl.uniform1f(c.uExact, exact ? 1 : 0);
      gl.uniform1f(c.uDecode, 1 / encode);
      gl.uniform1f(c.uFade, clamp(s.fade, 0, 1));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, null);
    };
    const tune = interval => {   // 원본 governor: 프레임이 밀리면 내부 해상도를 낮춘다
      if (interval > 1 / 40) { state.slow += 1; state.quick = 0; }
      else if (interval < 1 / 55) { state.quick += 1; state.slow = 0; }
      if (state.slow > 20) { state.governor = Math.max(0.5, state.governor * 0.85); state.slow = 0; }
      else if (state.quick > 180 && state.governor < 1) { state.governor = Math.min(1, state.governor * 1.1); state.quick = 0; }
    };
    const frame = now => {
      raf = 0;
      if (!state.live || document.hidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      if (last) tune((now - last) / 1000);
      last = now;
      state.age += dt;
      if (state.intro < 1) state.intro = Math.min(1, state.intro + dt / Math.max(0.2, s.introSeconds));
      const rush = 3 * Math.pow(1 - state.intro, 2);
      state.time += dt;
      state.phase += dt * s.speed * (1 + rush) + state.kick * dt;
      state.flow += dt * s.flow * 1.2;
      state.kick *= Math.exp(-dt * 3.5);
      if (state.kick < 1e-3) state.kick = 0;
      for (let i = pulses.length - 1; i >= 0; i--) {
        pulses[i].age += dt;
        if (pulses[i].age > PB_PULSE_LIFE) pulses.splice(i, 1);
      }
      render();
      if (state.age < s.introSeconds + s.hold + s.out + 0.1) raf = requestAnimationFrame(frame);
      else stop();
    };
    const stop = () => {
      state.live = false;
      cancelAnimationFrame(raf); raf = 0; last = 0;
      layer.classList.remove('on', 'out');
    };
    return {
      // (x, y) = 화면 좌표(중심). overrides 로 색·크기·세기 등을 이번 한 번만 바꾼다.
      play(x, y, overrides) {
        s = Object.assign({}, base, overrides);
        const size = Math.max(40, s.size);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(size * ratio);
        canvas.height = Math.round(size * ratio);
        Object.assign(layer.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` });
        Object.assign(state, { time: 0, phase: Math.random() * 10, flow: 0, kick: 2.4, intro: 0, age: 0, live: true });
        pulses.length = 0;
        pulses.push({ age: 0 });
        clearTimeout(hideTimer);
        layer.style.setProperty('--pb-out', `${s.out}s`);
        layer.classList.remove('out');
        layer.classList.add('on');
        hideTimer = setTimeout(() => layer.classList.add('out'), (s.introSeconds + s.hold) * 1000);
        if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
      },
      // 셰이더 컴파일·첫 그리기를 미리 해 둔다(첫 대박 순간에 멈칫하지 않게). 화면엔 아무것도 안 보인다
      warm() {
        if (state.live) return;
        canvas.width = 8; canvas.height = 8;
        state.intro = 1;
        try { render(); } catch (e) { /* 무시 */ }
      },
      destroy() {
        stop();
        clearTimeout(hideTimer);
        if (scene.texture) gl.deleteTexture(scene.texture);
        gl.deleteFramebuffer(scene.framebuffer);
        gl.deleteTexture(gradient);
        gl.deleteProgram(burstProgram.program);
        gl.deleteProgram(compositeProgram.program);
        gl.deleteBuffer(buffer);
        gl.deleteVertexArray(vao);
        if (!gl.isContextLost()) { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
        layer.remove();
      },
    };
  }

  /* ===================== Animations/GlareHover → Fx.glare ===================== */
  // 요소 위를 비스듬히 훑고 지나가는 광택 띠. mode: 'hover'(올리면 훑음) · 'loop'(interval 초마다 저절로) · 'click' · 'manual'(sweep() 으로만).
  // 원본의 광택 프로필(streak·twin·sheen)·가장자리 반짝임(rim)·이징은 그대로. 'follow'(포인터 추적) 모드는 덜어냈다.
  const smootherstep = t => t * t * t * (t * (t * 6 - 15) + 10);
  const ghBump = (t, center, half) => {
    const distance = Math.abs(t - center);
    return distance >= half ? 0 : smootherstep(1 - distance / half);
  };
  const GH_PROFILES = {
    streak: (t, softness) => ghBump(t, 0.5, 0.06 + 0.16 * softness) + 0.32 * ghBump(t, 0.5, 0.5),
    twin: (t, softness) => ghBump(t, 0.36, 0.08 + 0.18 * softness) + 0.85 * ghBump(t, 0.7, 0.03 + 0.06 * softness) + 0.26 * ghBump(t, 0.5, 0.5),
    sheen: (t, softness) => 0.55 * ghBump(t, 0.5, 0.25 + 0.25 * softness) + 0.3 * ghBump(t, 0.5, 0.5),
  };
  const ghGradient = (color, opacity, variant, softness) => {
    const profile = GH_PROFILES[variant] || GH_PROFILES.streak;
    const stops = Array.from({ length: 33 }, (_, index) => {
      const t = index / 32;
      const alpha = Math.round(Math.min(1, profile(t, softness) * opacity) * 1000) / 10;
      return `color-mix(in srgb, ${color} ${alpha}%, transparent) ${(t * 100).toFixed(1)}%`;
    });
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  };
  const ghEase = t => (1 - Math.cos(Math.PI * t)) / 2;

  function glare(root, options) {
    const o = Object.assign({ glareColor: '#ffffff', glareOpacity: 0.5, glareAngle: -45, glareSize: 30, softness: 0.6, variant: 'streak',
      blendMode: 'screen', rimGlint: true, mode: 'hover', transitionDuration: 650, interval: 3, delay: 0, playOnce: false }, options);
    root.classList.add('glare-hover');
    root.style.setProperty('--gh-glare', ghGradient(o.glareColor, o.glareOpacity, o.variant, o.softness));
    root.style.setProperty('--gh-rim', ghGradient(o.glareColor, Math.min(1, o.glareOpacity * 1.8), o.variant, o.softness));
    root.style.setProperty('--gh-blend', o.blendMode);
    const glareEl = document.createElement('span');
    glareEl.className = 'glare-hover__glare';
    glareEl.setAttribute('aria-hidden', 'true');
    const band = document.createElement('span');
    band.className = 'glare-hover__band';
    glareEl.appendChild(band);
    let rim = null;
    if (o.rimGlint) {
      const rimWrap = document.createElement('span');
      rimWrap.className = 'glare-hover__rim';
      rim = document.createElement('span');
      rim.className = 'glare-hover__band glare-hover__band--rim';
      rimWrap.appendChild(rim);
      glareEl.appendChild(rimWrap);
    }
    root.appendChild(glareEl);

    const reduced = reducedMotion();
    const geometry = { band: 0, reach: 0, ux: 0, uy: -1, angle: 0 };
    const state = { pos: -1e4, sweep: null, visible: true };
    let raf = 0, timer = 0;
    const bands = () => [band, rim].filter(Boolean);
    const write = () => {
      const transform = `translate(-50%, -50%) rotate(${geometry.angle - 90}deg) translateX(${state.pos.toFixed(2)}px)`;
      for (const el of bands()) el.style.transform = transform;
      glareEl.style.opacity = '1';
    };
    const measure = () => {
      const width = root.clientWidth, height = root.clientHeight;
      const radians = (o.glareAngle * Math.PI) / 180;
      const ux = Math.sin(radians), uy = -Math.cos(radians);
      const diagonal = Math.hypot(width, height);
      const size = Math.max(8, (diagonal * o.glareSize) / 100);
      const reach = (Math.abs(width * ux) + Math.abs(height * uy)) / 2 + size / 2 + 2;
      Object.assign(geometry, { band: size, reach, ux, uy, angle: o.glareAngle });
      for (const el of bands()) { el.style.width = `${size}px`; el.style.height = `${diagonal + size}px`; }
      if (!state.sweep) state.pos = state.pos > 0 ? reach : -reach;
      write();
    };
    const frame = now => {
      let moving = false;
      if (state.sweep) {
        const sweep = state.sweep;
        const t = Math.min(1, (now - sweep.start) / sweep.duration);
        state.pos = sweep.from + (sweep.to - sweep.from) * ghEase(t);
        if (t < 1) moving = true;
        else state.sweep = null;
      }
      write();
      raf = moving ? requestAnimationFrame(frame) : 0;
    };
    const sweep = sign => {
      if (reduced || !geometry.reach) return;
      const end = sign * geometry.reach;
      const from = state.sweep || Math.abs(state.pos) < geometry.reach ? state.pos : -end;
      if (from === end) return;
      const share = Math.abs(end - from) / (2 * geometry.reach);
      state.sweep = { from, to: end, start: performance.now(), duration: Math.max(120, o.transitionDuration * share) };
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const along = event => {
      const rect = root.getBoundingClientRect();
      return (event.clientX - (rect.left + rect.width / 2)) * geometry.ux + (event.clientY - (rect.top + rect.height / 2)) * geometry.uy;
    };
    const onEnter = event => { if (o.mode === 'hover' && event.pointerType === 'mouse') sweep(along(event) > 0 ? -1 : 1); };
    const onLeave = event => { if (o.mode === 'hover' && event.pointerType === 'mouse' && !o.playOnce) sweep(along(event) > 0 ? 1 : -1); };
    const onDown = event => { if (o.mode === 'click') sweep(along(event) > 0 ? -1 : 1); };
    const schedule = first => {
      clearTimeout(timer);
      if (o.mode !== 'loop' || reduced) return;
      timer = setTimeout(() => {
        if (state.visible && !document.hidden) sweep(1);
        state.pos = -geometry.reach;   // 다음 바퀴도 같은 방향(왼→오)으로
        schedule(false);
      }, (first ? o.delay : 0) * 1000 + Math.max(0.5, o.interval) * 1000);
    };
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointerdown', onDown);
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    const visibilityObserver = new IntersectionObserver(([entry]) => { state.visible = entry.isIntersecting; }, { threshold: 0.4 });
    visibilityObserver.observe(root);
    measure();
    schedule(true);
    return {
      sweep() { state.pos = -geometry.reach; state.sweep = null; sweep(1); },
      destroy() {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
        resizeObserver.disconnect();
        visibilityObserver.disconnect();
        root.removeEventListener('pointerenter', onEnter);
        root.removeEventListener('pointerleave', onLeave);
        root.removeEventListener('pointerdown', onDown);
        glareEl.remove();
        root.classList.remove('glare-hover');
      },
    };
  }

  window.Fx = { embers, clickSpark, starBorder, electricBorder, gradientText, shinyText, counter, prismBurst, glare, reducedMotion };
})();
