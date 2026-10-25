/*!
 * weapon-art.js — 무기 그림 생성기. 이미지 파일 없이 SVG 부품을 겹쳐 그린다.
 *
 *   직업 형태 4종(검·활·방패·지팡이) × 속성 9종 × 등급 5단계 = 180가지
 *   WeaponArt.svg({ cls: 'warrior', element: 'fire', grade: 'legend' }) → '<svg …>' 문자열
 *
 * 레이어 순서(뒤 → 앞):
 *   오라(등급) → 형태 본체(직업, 금속색=등급) → 속성 처리(본체 안: 불꽃 달군 날·서리·균열…) →
 *   속성 문양(본체 둘레: 불꽃 혀·고드름·번개…) → 떠다니는 입자(등급이 높을수록 많고 움직임)
 * 같은 입력이면 항상 같은 그림(조합 문자열로 시드 고정). 애니메이션은 style.css 의 .wa-* 클래스.
 */
(function () {
  'use strict';

  const W = 160, H = 220, CX = 80;
  const OUT = '#170f0a';            // 외곽선 — 아이콘처럼 또렷하게 읽히도록 진한 테두리
  const TIERS = { common: 0, rare: 1, epic: 2, legend: 3, transcend: 4 };

  // 등급 = 금속. 낮을수록 무쇠, 높을수록 귀금속·결정
  const METALS = [
    { hi: '#eef1f5', mid: '#aab3be', lo: '#5f6873', trim: '#8a6a3c', trimHi: '#d3a865', trimLo: '#4e3a1e' },   // 일반: 무쇠 + 청동
    { hi: '#f3f8ff', mid: '#a6c0de', lo: '#4f6a8a', trim: '#9aa6b5', trimHi: '#eef3f9', trimLo: '#56606e' },   // 희귀: 푸른 강철 + 은
    { hi: '#eef0f7', mid: '#98a1b8', lo: '#383f54', trim: '#8b6fc4', trimHi: '#e6d9ff', trimLo: '#3f2c6e' },   // 에픽: 흑강 + 자수정 장식
    { hi: '#fff7de', mid: '#efc46a', lo: '#9a6418', trim: '#e0aa45', trimHi: '#fff1bd', trimLo: '#7a4a10' },   // 전설: 황금
    { hi: '#ffffff', mid: '#dfd2ff', lo: '#7d62c7', trim: '#f0c56a', trimHi: '#fffbe6', trimLo: '#8a5c1c' },   // 초월: 결정 + 금
  ];
  // 속성 = 빛깔. main 은 본색, light 는 빛나는 부분, dark 는 그늘·바탕
  const ELEMENTS = {
    fire: { main: '#ff6a2b', light: '#ffd27a', dark: '#9e220c', name: '불' },
    water: { main: '#3a9cff', light: '#bde6ff', dark: '#13448a', name: '물' },
    earth: { main: '#c08a4a', light: '#f3d59c', dark: '#5e3c1c', name: '대지' },
    wind: { main: '#4fd69a', light: '#d6ffea', dark: '#17775a', name: '바람' },
    thunder: { main: '#ffd23d', light: '#fff8c8', dark: '#a87800', name: '번개' },
    ice: { main: '#86dcff', light: '#f0fcff', dark: '#2f86ad', name: '얼음' },
    light: { main: '#ffe68a', light: '#ffffff', dark: '#c79400', name: '빛' },
    dark: { main: '#9b63dc', light: '#e3c8ff', dark: '#2c1450', name: '어둠' },
    poison: { main: '#94dc35', light: '#e7ffb8', dark: '#3f6a0c', name: '독' },
  };
  const WOOD = { hi: '#c99260', mid: '#8a5a30', lo: '#4f2f16' };
  const LEATHER = { mid: '#5b3a22', lo: '#33200f', hi: '#7f5534' };

  /* ---------- 유틸 ---------- */
  const f = n => (Math.round(n * 10) / 10).toString();
  const pt = p => f(p[0]) + ' ' + f(p[1]);
  const poly = pts => 'M' + pts.map(pt).join(' L') + ' Z';
  const line = pts => 'M' + pts.map(pt).join(' L');
  let uid = 0;

  const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = seed => { let a = hashStr(seed); return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const toHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return toHex([0, 1, 2].map(i => x[i] + (y[i] - x[i]) * t)); };

  // 2차/3차 베지어 위 점들
  const quad = (p0, c, p1, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]; });
  const cubic = (p0, c1, c2, p1, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p1[k]); });
  // 중심선 + 폭 배열 → 두께가 변하는 띠(활대·깃털·연기 등)
  const ribbon = (pts, widths) => {
    const L = [], R = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
      const w = (typeof widths === 'function' ? widths(i / (pts.length - 1)) : widths[i]) / 2;
      L.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
      R.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
    }
    return poly(L.concat(R.reverse()));
  };
  const mirrorX = pts => pts.map(p => [2 * CX - p[0], p[1]]);
  const rot = (p, c, deg) => { const r = deg * Math.PI / 180, s = Math.sin(r), k = Math.cos(r); const x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * k - y * s, c[1] + x * s + y * k]; };

  /* ---------- 부품 그리기 ---------- */
  const shape = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" stroke="${OUT}" stroke-width="2" stroke-linejoin="round" ${extra}/>`;
  const fillOnly = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
  const strokeOnly = (d, color, w, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;

  // 속성 문장(紋章) — 보석·방패 한가운데에 쓰는 기호. 원점 중심, 크기 s
  const EMBLEM = {
    fire: s => `M0 ${f(s * .55)} C${f(-s * .5)} ${f(s * .45)} ${f(-s * .52)} ${f(-s * .05)} ${f(-s * .18)} ${f(-s * .3)} C${f(-s * .2)} ${f(-s * .05)} ${f(-s * .05)} ${f(-s * .02)} ${f(-s * .02)} ${f(-s * .12)} C${f(s * .02)} ${f(-s * .38)} ${f(s * .1)} ${f(-s * .5)} ${f(s * .05)} ${f(-s * .62)} C${f(s * .42)} ${f(-s * .35)} ${f(s * .55)} ${f(s * .05)} ${f(s * .4)} ${f(s * .32)} C${f(s * .3)} ${f(s * .5)} ${f(s * .15)} ${f(s * .56)} 0 ${f(s * .55)} Z`,
    water: s => `M0 ${f(-s * .6)} C${f(s * .2)} ${f(-s * .3)} ${f(s * .45)} ${f(-s * .05)} ${f(s * .45)} ${f(s * .18)} A${f(s * .45)} ${f(s * .45)} 0 1 1 ${f(-s * .45)} ${f(s * .18)} C${f(-s * .45)} ${f(-s * .05)} ${f(-s * .2)} ${f(-s * .3)} 0 ${f(-s * .6)} Z`,
    earth: s => poly([[-s * .55, s * .45], [-s * .3, -s * .1], [-s * .12, s * .08], [s * .1, -s * .55], [s * .55, s * .45]]),
    wind: s => `M${f(-s * .55)} ${f(-s * .18)} H${f(s * .18)} A${f(s * .2)} ${f(s * .2)} 0 1 0 ${f(-s * .02)} ${f(-s * .5)} M${f(-s * .55)} ${f(s * .08)} H${f(s * .35)} A${f(s * .2)} ${f(s * .2)} 0 1 1 ${f(s * .15)} ${f(s * .45)} M${f(-s * .4)} ${f(s * .32)} H${f(-s * .05)}`,
    thunder: s => poly([[s * .1, -s * .62], [-s * .36, s * .06], [-s * .04, s * .06], [-s * .16, s * .62], [s * .36, -s * .1], [s * .04, -s * .1]]),
    ice: s => { let d = ''; for (let i = 0; i < 3; i++) { const a = i * 60; const p1 = rot([0, -s * .58], [0, 0], a), p2 = rot([0, s * .58], [0, 0], a); d += 'M' + pt(p1) + ' L' + pt(p2); [-1, 1].forEach(e => { [p1, p2].forEach(q => { const m = [q[0] * .55, q[1] * .55]; const b = rot([q[0] * .8, q[1] * .8], m, e * 50); d += ' M' + pt(m) + ' L' + pt(b); }); }); } return d; },
    light: s => { let d = `M${f(s * .26)} 0 A${f(s * .26)} ${f(s * .26)} 0 1 1 ${f(-s * .26)} 0 A${f(s * .26)} ${f(s * .26)} 0 1 1 ${f(s * .26)} 0 Z`; for (let i = 0; i < 8; i++) { const a = i * 45, w = i % 2 ? .08 : .11, r = i % 2 ? .52 : .64; d += ' ' + poly([rot([-s * w, -s * .34], [0, 0], a), rot([0, -s * r], [0, 0], a), rot([s * w, -s * .34], [0, 0], a)]); } return d; },
    dark: s => `M${f(s * .18)} ${f(-s * .56)} A${f(s * .58)} ${f(s * .58)} 0 1 0 ${f(s * .5)} ${f(s * .32)} A${f(s * .44)} ${f(s * .44)} 0 1 1 ${f(s * .18)} ${f(-s * .56)} Z`,
    poison: s => `M0 ${f(-s * .5)} C${f(s * .14)} ${f(-s * .26)} ${f(s * .34)} ${f(-s * .04)} ${f(s * .34)} ${f(s * .14)} A${f(s * .34)} ${f(s * .34)} 0 1 1 ${f(-s * .34)} ${f(s * .14)} C${f(-s * .34)} ${f(-s * .04)} ${f(-s * .14)} ${f(-s * .26)} 0 ${f(-s * .5)} Z M${f(s * .42)} ${f(-s * .5)} m-${f(s * .12)} 0 a${f(s * .12)} ${f(s * .12)} 0 1 0 ${f(s * .24)} 0 a${f(s * .12)} ${f(s * .12)} 0 1 0 -${f(s * .24)} 0 M${f(-s * .5)} ${f(-s * .2)} m-${f(s * .08)} 0 a${f(s * .08)} ${f(s * .08)} 0 1 0 ${f(s * .16)} 0 a${f(s * .08)} ${f(s * .08)} 0 1 0 -${f(s * .16)} 0`,
  };
  const STROKE_EMBLEMS = new Set(['wind', 'ice']);
  const emblem = (c, key, x, y, s, color, extra = '') => STROKE_EMBLEMS.has(key)
    ? `<path d="${EMBLEM[key](s)}" transform="translate(${f(x)} ${f(y)})" fill="none" stroke="${color}" stroke-width="${f(Math.max(1.6, s * .12))}" stroke-linecap="round" ${extra}/>`
    : `<path d="${EMBLEM[key](s)}" transform="translate(${f(x)} ${f(y)})" fill="${color}" ${extra}/>`;

  // 다면 보석(속성색). 마름모 몸통 + 윗면 + 반짝임
  const gem = (c, x, y, r, extra = '') => {
    const g = `${c.id}-gem`;
    return `<g ${extra}>${shape(poly([[x, y - r], [x + r * .85, y], [x, y + r], [x - r * .85, y]]), `url(#${g})`)}` +
      fillOnly(poly([[x, y - r], [x + r * .85, y], [x, y - r * .2], [x - r * .85, y]]), c.el.light, 'opacity=".55"') +
      fillOnly(poly([[x - r * .35, y - r * .5], [x - r * .1, y - r * .62], [x - r * .2, y - r * .2]]), '#fff', 'opacity=".9"') + '</g>';
  };
  // 깃털(날개 한 장) — 밑동에서 끝으로 가늘어지는 띠 + 가운데 깃대
  const feather = (c, from, to, bend, w0, fill) => {
    const mid = [(from[0] + to[0]) / 2 + bend[0], (from[1] + to[1]) / 2 + bend[1]];
    const pts = quad(from, mid, to, 10);
    return shape(ribbon(pts, t => w0 * (1 - t * .85) + 1), fill) + strokeOnly(line(pts.slice(1, 8)), c.m.trimHi, 1, 'opacity=".7"');
  };
  // 날개 한쪽(깃털 n장 부채꼴). side=-1 왼쪽, 1 오른쪽
  const wing = (c, root, side, n, len, fill) => {
    let s = '';
    for (let i = n - 1; i >= 0; i--) {
      const a = (-35 - i * 17) * Math.PI / 180;
      const L = len * (1 - i * .12);
      const to = [root[0] + side * Math.cos(a) * L, root[1] + Math.sin(a) * L];
      s += feather(c, root, to, [side * 4, 6 + i * 2], 10 - i, fill);
    }
    return s;
  };
  // 불꽃 혀(속 불꽃 포함). 밑점 x,y 에서 angle(도) 방향으로 높이 h
  const flame = (c, x, y, h, w, angle, cls = '') => {
    const d = (k, hh, ww) => `M0 0 C${f(-ww)} ${f(-hh * .3)} ${f(-ww * .45)} ${f(-hh * .7)} ${f(ww * .15)} ${f(-hh)} C${f(ww * .1)} ${f(-hh * .65)} ${f(ww * .9)} ${f(-hh * .45)} ${f(ww)} ${f(-hh * .15)} C${f(ww * .9)} ${f(hh * .05)} ${f(ww * .4)} ${f(hh * .12)} 0 0 Z`;
    return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)})"><g class="${cls}">` +
      fillOnly(d(0, h, w), c.el.main, `stroke="${c.el.dark}" stroke-width="1.2"`) + fillOnly(d(0, h * .62, w * .55), c.el.light) + '</g></g>';
  };
  const droplet = (x, y, r, fill, extra = '') => `<path d="M${f(x)} ${f(y - r * 1.7)} C${f(x + r * .6)} ${f(y - r * .8)} ${f(x + r)} ${f(y - r * .3)} ${f(x + r)} ${f(y + .1 * r)} A${f(r)} ${f(r)} 0 1 1 ${f(x - r)} ${f(y + .1 * r)} C${f(x - r)} ${f(y - r * .3)} ${f(x - r * .6)} ${f(y - r * .8)} ${f(x)} ${f(y - r * 1.7)} Z" fill="${fill}" ${extra}/>`;
  const sparkle = (x, y, r, fill, extra = '') => `<path d="M${f(x)} ${f(y - r)} Q${f(x + r * .18)} ${f(y - r * .18)} ${f(x + r)} ${f(y)} Q${f(x + r * .18)} ${f(y + r * .18)} ${f(x)} ${f(y + r)} Q${f(x - r * .18)} ${f(y + r * .18)} ${f(x - r)} ${f(y)} Q${f(x - r * .18)} ${f(y - r * .18)} ${f(x)} ${f(y - r)} Z" fill="${fill}" ${extra}/>`;
  const bolt = (x, y, len, angle, rnd) => {
    const pts = [[0, 0]];
    const n = 4;
    for (let i = 1; i <= n; i++) pts.push([(rnd() - .5) * len * .35, -len * i / n]);
    return pts.map(p => rot([x + p[0], y + p[1]], [x, y], angle));
  };

  /* ---------- 공통 defs ---------- */
  function defs(c) {
    const { id, m, el } = c;
    c.defs.push(
      `<linearGradient id="${id}-mL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.hi}"/><stop offset="1" stop-color="${mix(m.hi, m.mid, .6)}"/></linearGradient>`,
      `<linearGradient id="${id}-mR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.mid}"/><stop offset="1" stop-color="${m.lo}"/></linearGradient>`,
      `<linearGradient id="${id}-trim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.trimHi}"/><stop offset=".45" stop-color="${m.trim}"/><stop offset="1" stop-color="${m.trimLo}"/></linearGradient>`,
      `<linearGradient id="${id}-trimH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${m.trimLo}"/><stop offset=".35" stop-color="${m.trimHi}"/><stop offset=".7" stop-color="${m.trim}"/><stop offset="1" stop-color="${m.trimLo}"/></linearGradient>`,
      `<radialGradient id="${id}-gem" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="${el.light}"/><stop offset=".45" stop-color="${el.main}"/><stop offset="1" stop-color="${el.dark}"/></radialGradient>`,
      `<radialGradient id="${id}-orb" cx=".36" cy=".32" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".25" stop-color="${el.light}"/><stop offset=".65" stop-color="${el.main}"/><stop offset="1" stop-color="${el.dark}"/></radialGradient>`,
      `<radialGradient id="${id}-aura" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${el.main}" stop-opacity=".9"/><stop offset=".55" stop-color="${el.main}" stop-opacity=".25"/><stop offset="1" stop-color="${el.main}" stop-opacity="0"/></radialGradient>`,
      `<linearGradient id="${id}-wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${WOOD.lo}"/><stop offset=".35" stop-color="${WOOD.hi}"/><stop offset="1" stop-color="${WOOD.lo}"/></linearGradient>`,
      `<linearGradient id="${id}-leather" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${LEATHER.lo}"/><stop offset=".4" stop-color="${LEATHER.hi}"/><stop offset="1" stop-color="${LEATHER.lo}"/></linearGradient>`,
      `<filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    );
  }

  /* ---------- 오라 (등급) ---------- */
  function aura(c, cx, cy) {
    const { t, id, el } = c;
    if (t >= 1) {
      const r = [0, 44, 54, 64, 74][t];
      const op = [0, .16, .24, .34, .46][t];
      c.under.push(`<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${f(r * 1.25)}" fill="url(#${id}-aura)" opacity="${op}"/>`);
    }
    if (t >= 4) {
      c.under.push(`<g class="wa-spin" style="transform-origin:${cx}px ${cy}px">` +
        `<circle cx="${cx}" cy="${cy}" r="64" fill="none" stroke="${el.light}" stroke-width="1.4" stroke-dasharray="2 7" opacity=".7"/>` +
        `<circle cx="${cx}" cy="${cy}" r="56" fill="none" stroke="${c.m.trim}" stroke-width="1" stroke-dasharray="12 5 2 5" opacity=".55"/></g>`);
    }
  }

  /* ---------- 직업별 형태 ---------- */
  // 검(근거리 딜러): 등급이 오를수록 날이 넓어지고 → 잎날 → 어깨 넓은 대검 → 떠 있는 결정 끝
  function sword(c) {
    const { t, id, m, el } = c;
    const tipY = 12, guardY = 146;
    const w = [11, 12.5, 14, 15, 15.5][t];
    let right;
    let topCenter = [CX, tipY];
    if (t === 0) right = [[CX + w, tipY + 22], [CX + w, guardY - 2]];
    else if (t === 1) right = [[CX + w, tipY + 22], [CX + w, guardY - 18], [CX + w * .78, guardY - 12], [CX + w * .78, guardY - 2]];
    else if (t === 2) right = [[CX + w * 1.18, tipY + 40], [CX + w * .86, guardY - 40], [CX + w, guardY - 16], [CX + w * .76, guardY - 2]];
    else if (t === 3) right = [[CX + w * .95, tipY + 22], [CX + w * 1.02, guardY - 46], [CX + w * 1.42, guardY - 16], [CX + w * .84, guardY - 2]];
    else { topCenter = [CX, tipY + 44]; right = [[CX + w * .6, tipY + 36], [CX + w * 1.15, tipY + 62], [CX + w * .95, guardY - 40], [CX + w * 1.38, guardY - 14], [CX + w * .82, guardY - 2]]; }
    const left = mirrorX(right);
    const outline = [topCenter, ...right, ...left.slice().reverse()];
    const bladeD = poly(outline);
    const bottomY = guardY - 2;
    c.defs.push(`<clipPath id="${id}-blade"><path d="${bladeD}"/></clipPath>`);

    // 날 (면 두 개 + 가운데 능선)
    c.body.push(shape(bladeD, m.mid));
    c.body.push(fillOnly(poly([topCenter, ...left, [CX, bottomY]]), `url(#${id}-mL)`, `clip-path="url(#${id}-blade)"`));
    c.body.push(fillOnly(poly([topCenter, ...right, [CX, bottomY]]), `url(#${id}-mR)`, `clip-path="url(#${id}-blade)"`));
    // 초월: 떨어져 떠 있는 결정 칼끝
    if (t === 4) {
      const tip = [[CX, tipY - 4], [CX + w * .62, tipY + 22], [CX, tipY + 36], [CX - w * .62, tipY + 22]];
      c.body.push(`<g class="wa-bob">${shape(poly(tip), `url(#${id}-mR)`)}${fillOnly(poly([tip[0], tip[3], tip[2]]), `url(#${id}-mL)`)}${strokeOnly(line([tip[0], tip[2]]), '#fff', 1, 'opacity=".8"')}</g>`);
    }
    blade(c, { bladeD, topCenter, bottomY, w, tipY, guardY, right, left });

    // 손잡이 가드
    const gy = guardY;
    if (t === 0) c.body.push(shape(`M${CX - 26} ${gy} h52 a5 5 0 0 1 0 10 h-52 a5 5 0 0 1 0 -10 Z`, `url(#${id}-trim)`));
    else if (t === 1) {
      [-1, 1].forEach(s => c.body.push(shape(ribbon(quad([CX + s * 12, gy + 5], [CX + s * 38, gy + 1], [CX + s * 33, gy + 20], 10), q => 10 - q * 4), `url(#${id}-trim)`)));
      c.body.push(shape(`M${CX - 16} ${gy} h32 v11 h-32 Z`, `url(#${id}-trim)`));
      [-1, 1].forEach(s => c.body.push(shape(`M${f(CX + s * 33 - 4)} ${gy + 21} a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0`, m.trimHi)));
    } else {
      if (t >= 3) {   // 날개 가드
        [-1, 1].forEach(s => c.back.push(wing(c, [CX + s * 8, gy + 4], s, t === 4 ? 4 : 3, t === 4 ? 46 : 38, `url(#${id}-trim)`)));
      }
      if (t === 4) c.back.push(`<circle cx="${CX}" cy="${gy - 4}" r="30" fill="none" stroke="url(#${id}-trimH)" stroke-width="4"/><circle cx="${CX}" cy="${gy - 4}" r="30" fill="none" stroke="${OUT}" stroke-width="1" opacity=".6"/>`);
      [-1, 1].forEach(s => c.body.push(shape(ribbon(quad([CX + s * 10, gy + 5], [CX + s * 38, gy + 12], [CX + s * 38, gy - 11], 12), q => 11 - q * 6), `url(#${id}-trim)`)));
      c.body.push(shape(poly([[CX, gy - 12], [CX + 16, gy + 4], [CX, gy + 20], [CX - 16, gy + 4]]), `url(#${id}-trim)`));
      c.body.push(gem(c, CX, gy + 4, t >= 3 ? 8.5 : 7));
    }
    // 손잡이(가죽 감개)
    const gripTop = gy + (t >= 2 ? 18 : 10), gripBot = gy + 48;
    c.defs.push(`<clipPath id="${id}-grip"><rect x="${CX - 6.5}" y="${gripTop}" width="13" height="${gripBot - gripTop}"/></clipPath>`);
    c.body.push(shape(`M${CX - 6.5} ${gripTop} h13 v${gripBot - gripTop} h-13 Z`, `url(#${id}-leather)`));
    let wraps = '';
    for (let y = gripTop - 3; y < gripBot; y += 6) wraps += `M${CX - 8} ${y} L${CX + 8} ${y + 6} `;
    c.body.push(`<path d="${wraps}" stroke="${t >= 3 ? m.trim : LEATHER.lo}" stroke-width="${t >= 3 ? 1.6 : 2.2}" clip-path="url(#${id}-grip)"/>`);
    // 폼멜
    const py = gripBot + 8;
    if (t <= 1) {
      c.body.push(shape(`M${CX - 9} ${py} a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0`, `url(#${id}-trim)`));
      c.body.push(`<circle cx="${CX}" cy="${py}" r="3.6" fill="${el.main}" stroke="${OUT}" stroke-width="1.2"/>`);   // 일반도 속성색 돌 하나는 박혀 있다
    } else {
      c.body.push(shape(poly([[CX, py - 10], [CX + 11, py], [CX, py + 13], [CX - 11, py]]), `url(#${id}-trim)`));
      c.body.push(gem(c, CX, py + 1, 6.5, t === 4 ? 'class="wa-bob"' : ''));
    }
    // 속성 문양을 붙일 자리: 날 가장자리
    const yA = (t === 4 ? tipY + 50 : tipY + 26), yB = guardY - 14;
    for (let i = 0; i < 9; i++) {
      const y = yA + (yB - yA) * (i / 8);
      const half = w * (t === 2 ? 1.05 : t >= 3 ? 1.1 : 1) + 1;
      c.anchors.push({ x: CX + half, y, nx: 1, ny: -.25 }, { x: CX - half, y, nx: -1, ny: -.25 });
    }
    c.paired = true;
    c.tip = [CX, t === 4 ? tipY - 4 : tipY];
    c.core = [CX, (tipY + guardY) / 2];
  }

  // 날 안쪽: 홈(풀러) · 룬 · 속성 처리 · 능선/가장자리 광택
  function blade(c, g) {
    const { t, id, el, m } = c;
    const clip = `clip-path="url(#${id}-blade)"`;
    if (t >= 1) {
      const top = g.topCenter[1] + (t === 4 ? 10 : 34);
      c.body.push(`<rect x="${CX - 2.4}" y="${f(top)}" width="4.8" height="${f(g.bottomY - 8 - top)}" rx="2.4" fill="${m.lo}" opacity=".55" ${clip}/>`);
      if (t >= 2) {   // 룬: 홈 안에서 속성색으로 빛난다
        const n = t * 2 + 1;
        let d = '';
        for (let i = 0; i < n; i++) {
          const y = top + 6 + (g.bottomY - 20 - top) * (i / (n - 1 || 1));
          const k = (i * 7 + t) % 4;
          d += k === 0 ? `M${CX} ${f(y - 2.6)} V${f(y + 2.6)} M${CX - 1.4} ${f(y - 1)} L${CX + 1.4} ${f(y + 1)} `
            : k === 1 ? `M${CX - 1.4} ${f(y - 2.4)} L${CX + 1.4} ${f(y)} L${CX - 1.4} ${f(y + 2.4)} `
            : k === 2 ? `M${CX} ${f(y - 2.6)} L${CX + 1.5} ${f(y)} L${CX} ${f(y + 2.6)} L${CX - 1.5} ${f(y)} Z `
            : `M${CX - 1.5} ${f(y - 2)} H${CX + 1.5} M${CX} ${f(y - 2)} V${f(y + 2.4)} `;
        }
        c.body.push(strokeOnly(d, el.light, 1.1, `filter="url(#${id}-glow)"`));
      }
    }
    // 속성 처리(날 안쪽) — 희귀부터 은은하게, 에픽부터 확실하게
    if (t >= 1) c.body.push(strokeOnly(g.bladeD, el.main, t >= 2 ? 3.4 : 2.4, `opacity="${t >= 2 ? .75 : .45}" ${clip}`));
    if (t >= 2) c.body.push(`<g ${clip}>${bladeTreatment(c, g)}</g>`);
    // 능선 + 왼쪽 가장자리 광택
    c.body.push(strokeOnly(line([g.topCenter, [CX, g.bottomY]]), '#ffffff', 1, 'opacity=".55"'));
    c.body.push(strokeOnly(line([g.topCenter, ...g.left.slice(0, -1)]), '#ffffff', 1.2, `opacity=".75" ${clip}`));
    c.body.push(`<path d="${g.bladeD}" fill="none" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>`);
  }

  function bladeTreatment(c, g) {
    const { t, el, rnd } = c;
    const top = g.topCenter[1], bot = g.bottomY, h = bot - top;
    const span = (a, b) => top + h * a + (b - a) * h * rnd();
    switch (c.element) {
      case 'fire': {   // 밑동부터 달아오른 날 + 쇳물 결
        c.defs.push(`<linearGradient id="${c.id}-heat" x1="0" y1="0" x2="0" y2="1"><stop offset=".25" stop-color="${el.main}" stop-opacity="0"/><stop offset=".7" stop-color="${el.main}" stop-opacity=".55"/><stop offset="1" stop-color="${el.light}" stop-opacity=".7"/></linearGradient>`);
        let s = `<rect x="${CX - 30}" y="${f(top)}" width="60" height="${f(h)}" fill="url(#${c.id}-heat)"/>`;
        for (let i = 0; i < t + 1; i++) { const y = span(.3, .9); s += strokeOnly(`M${CX - 14} ${f(y)} Q${f(CX - 4)} ${f(y - 6)} ${CX + 2} ${f(y - 2)} T${CX + 16} ${f(y - 6)}`, el.light, 1, 'opacity=".7"'); }
        return s;
      }
      case 'water': {
        let s = '';
        for (let i = 0; i < t + 2; i++) { const y = top + 20 + i * (h - 30) / (t + 1); s += strokeOnly(`M${CX - 16} ${f(y)} q4 -4 8 0 t8 0 t8 0 t8 0`, el.light, 1.1, 'opacity=".65"'); }
        return s + `<rect x="${CX - 30}" y="${f(top)}" width="60" height="${f(h)}" fill="${el.main}" opacity=".18"/>`;
      }
      case 'earth': {
        let s = `<rect x="${CX - 30}" y="${f(top)}" width="60" height="${f(h)}" fill="${el.dark}" opacity=".18"/>`;
        for (let i = 0; i < t + 1; i++) { const y = span(.15, .85), x = CX + (rnd() - .5) * 10; s += strokeOnly(line([[x, y], [x + 4, y + 5], [x + 1, y + 10], [x + 5, y + 15]]), el.light, 1.2, `opacity=".85" filter="url(#${c.id}-glow)"`); }
        return s;
      }
      case 'wind': {
        let s = '';
        for (let i = 0; i < t + 2; i++) { const y = span(.05, .9); s += strokeOnly(`M${CX - 16} ${f(y + 8)} L${CX + 16} ${f(y - 4)}`, el.light, 1.3, 'opacity=".55"'); }
        return s + `<rect x="${CX - 30}" y="${f(top)}" width="60" height="${f(h)}" fill="${el.main}" opacity=".14"/>`;
      }
      case 'thunder': {
        const pts = []; const n = 7;
        for (let i = 0; i <= n; i++) pts.push([CX + (i % 2 ? 4 : -4) * (i === 0 || i === n ? 0 : 1), top + 10 + (h - 18) * i / n]);
        return strokeOnly(line(pts), el.light, 2, `filter="url(#${c.id}-glow)"`) + `<rect x="${CX - 30}" y="${f(top)}" width="60" height="${f(h)}" fill="${el.main}" opacity=".16"/>`;
      }
      case 'ice': {   // 가장자리부터 서리가 낀다
        let s = '';
        [g.right, g.left].forEach((edge, k) => {
          edge.forEach((p, i) => {
            if (i === edge.length - 1) return;
            const q = edge[i + 1];
            for (let j = 0; j < 3; j++) {
              const u = (j + .5) / 3, x = p[0] + (q[0] - p[0]) * u, y = p[1] + (q[1] - p[1]) * u;
              const dir = k === 0 ? -1 : 1;
              s += fillOnly(poly([[x, y - 3], [x + dir * (4 + rnd() * 5), y], [x, y + 3]]), '#ffffff', 'opacity=".75"');
            }
          });
        });
        return s + `<rect x="${CX - 30}" y="${f(top)}" width="60" height="${f(h)}" fill="${el.main}" opacity=".22"/>`;
      }
      case 'light':
        return `<rect x="${CX - 3}" y="${f(top)}" width="6" height="${f(h)}" fill="#ffffff" opacity=".8" filter="url(#${c.id}-glow)"/><rect x="${CX - 30}" y="${f(top)}" width="60" height="${f(h)}" fill="${el.main}" opacity=".22"/>`;
      case 'dark': {   // 흑요석처럼 어두워진 날 + 빛나는 균열
        let s = `<rect x="${CX - 30}" y="${f(top)}" width="60" height="${f(h)}" fill="${el.dark}" opacity=".55"/>`;
        for (let i = 0; i < t + 1; i++) { const y = span(.1, .8), x = CX + (rnd() - .5) * 8; s += strokeOnly(line([[x, y], [x - 3, y + 6], [x + 2, y + 11], [x - 2, y + 18]]), el.light, 1.2, `filter="url(#${c.id}-glow)"`); }
        return s;
      }
      case 'poison': {
        let s = `<rect x="${CX - 30}" y="${f(top)}" width="60" height="${f(h)}" fill="${el.main}" opacity=".2"/>`;
        for (let i = 0; i < t + 1; i++) { const x = CX + (rnd() - .5) * 14, y = top + 30 + rnd() * h * .3; s += fillOnly(`M${f(x - 2)} ${f(y)} h4 v${f(10 + rnd() * 16)} a2 2 0 0 1 -4 0 Z`, el.main, `stroke="${el.dark}" stroke-width=".8" opacity=".9"`); }
        return s;
      }
    }
    return '';
  }

  // 활(원거리 딜러): 나무 활 → 금속 끝 → 휘어진 끝(리커브) → 금빛 날개 활 → 결정 활
  function bow(c) {
    const { t, id, m, el } = c;
    const gx = CX - 14, gy = 110, sx = CX + 22;
    const limbFill = t <= 1 ? `url(#${id}-wood)` : t === 2 ? `url(#${id}-mR)` : t === 3 ? `url(#${id}-trimH)` : `url(#${id}-mL)`;
    const upper = cubic([gx, gy - 16], [gx - 6, 64], [CX + 2, 28], [sx, 14], 18);
    const lower = upper.map(p => [p[0], 2 * gy - p[1]]);
    // 시위
    c.body.push(strokeOnly(line([[sx, 16], [sx, 204]]), t >= 3 ? el.light : '#efe3c8', t >= 3 ? 1.6 : 1.2, t >= 3 ? `filter="url(#${id}-glow)"` : ''));
    [upper, lower].forEach(limb => {
      c.body.push(shape(ribbon(limb, q => 16 - q * 9.5), limbFill));
      if (t >= 2) c.body.push(strokeOnly(line(limb.slice(2, 16)), t >= 3 ? m.trimHi : el.main, 1.4, `opacity="${t >= 3 ? .8 : .7}"`));
    });
    // 활 끝 장식
    [[sx, 16, -1], [sx, 204, 1]].forEach(([x, y, s]) => {
      if (t === 1) c.body.push(shape(`M${x - 4} ${y} a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0`, `url(#${id}-trim)`));
      if (t >= 2) c.body.push(shape(ribbon(quad([x, y], [x + 10, y + s * 2], [x + 8, y - s * 10], 8), q => 5 - q * 3), `url(#${id}-trim)`));
      if (t >= 3) c.back.push(wing(c, [x - 2, y], 1, t === 4 ? 3 : 2, 26, `url(#${id}-trim)`).replace(/<path/g, `<path transform="${s > 0 ? `translate(0 ${2 * y}) scale(1 -1)` : ''}"`));
      if (t === 4) c.front.push(`<g class="wa-bob">${shape(poly([[x + 12, y - 8], [x + 17, y], [x + 12, y + 8], [x + 7, y]]), `url(#${id}-mL)`)}</g>`);
    });
    // 화살(가로) — 속성색 촉
    const ay = gy;
    c.body.push(shape(`M20 ${ay - 2.4} H${sx + 6} v4.8 H20 Z`, `url(#${id}-wood)`));
    const fl = t >= 2 ? el.light : '#e9dfcf';
    [-1, 1].forEach(s => c.body.push(shape(poly([[sx - 8, ay], [sx + 10, ay + s * 12], [sx + 18, ay + s * 12], [sx + 6, ay]]), fl)));
    c.body.push(shape(poly([[4, ay], [26, ay - 10], [22, ay], [26, ay + 10]]), t >= 1 ? `url(#${id}-gem)` : m.mid));
    c.body.push(fillOnly(poly([[7, ay], [24, ay - 6], [21, ay]]), '#fff', `opacity="${t >= 1 ? .7 : .45}"`));
    // 손잡이
    c.body.push(shape(`M${gx - 9} ${gy - 18} h18 v36 h-18 Z`, `url(#${id}-leather)`));
    let wraps = '';
    for (let y = gy - 18; y < gy + 18; y += 6) wraps += `M${gx - 9} ${y} L${gx + 9} ${y + 5} `;
    c.body.push(strokeOnly(wraps, t >= 3 ? m.trim : LEATHER.lo, 1.6, 'opacity=".9"'));
    c.body.push(gem(c, gx, gy, [4.5, 5.5, 7, 8.5, 9][t]));
    // 속성 문양 자리: 활대를 따라
    [upper, lower].forEach(limb => [4, 7, 10, 13, 16].forEach(i => { const p = limb[i]; c.anchors.push({ x: p[0] - 4, y: p[1], nx: -1, ny: p[1] < gy ? -.4 : .4 }); }));
    c.anchors.push({ x: 14, y: ay, nx: -1, ny: 0 });
    c.tip = [12, ay];
    c.core = [CX - 6, gy];
  }

  // 방패(탱커): 나무 방패 → 강철+리벳 → 문장 빛남 → 금테+날개 → 결정 테+후광
  function shield(c) {
    const { t, id, m, el } = c;
    const outer = 'M30 40 Q80 26 130 40 L130 104 Q128 160 80 202 Q32 160 30 104 Z';
    const inner = 'M40 48 Q80 37 120 48 L120 104 Q118 152 80 189 Q42 152 40 104 Z';
    c.defs.push(`<clipPath id="${id}-field"><path d="${inner}"/></clipPath>`,
 `<linearGradient id="${id}-fieldG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t === 0 ? WOOD.mid : mix(el.dark, el.main, t >= 3 ? .45 : .25)}"/><stop offset="1" stop-color="${t === 0 ? WOOD.lo : mix(el.dark, '#000000', .25)}"/></linearGradient>`);
    if (t === 4) c.back.push(`<circle cx="80" cy="112" r="76" fill="none" stroke="url(#${id}-trimH)" stroke-width="3"/>`);
    if (t >= 3) [-1, 1].forEach(s => c.back.push(wing(c, [80 + s * 46, 50], s, t === 4 ? 4 : 3, t === 4 ? 46 : 38, `url(#${id}-trim)`)));
    c.body.push(shape(outer, t === 4 ? `url(#${id}-mL)` : t >= 1 ? `url(#${id}-trim)` : `url(#${id}-mR)`));
    c.body.push(shape(inner, `url(#${id}-fieldG)`));
    if (t === 0) {   // 나무 판자 결
      c.body.push(`<g clip-path="url(#${id}-field)">${[56, 72, 88, 104].map(x => strokeOnly(`M${x} 40 V200`, WOOD.lo, 1.6, 'opacity=".7"')).join('')}</g>`);
    }
    // 광택 사선
    c.body.push(fillOnly('M40 48 L72 40 L44 120 L40 110 Z', '#ffffff', `opacity="${t ? .12 : .07}" clip-path="url(#${id}-field)"`));
    if (t >= 2) c.body.push(strokeOnly(inner, m.trimHi, 1.2, 'opacity=".55" transform="translate(80 110) scale(.9) translate(-80 -110)"'));
    // 문장
    const s = [26, 32, 38, 42, 44][t];
    const col = t === 0 ? mix(WOOD.lo, '#000000', .3) : el.light;
    if (t >= 2) c.body.push(emblem(c, c.element, 80, 108, s * 1.08, el.main, 'opacity=".6" filter="url(#' + id + '-glow)"'));
    c.body.push(emblem(c, c.element, 80, 108, s, col, t === 0 ? 'opacity=".75"' : STROKE_EMBLEMS.has(c.element) ? '' : `stroke="${OUT}" stroke-width="1.2"`));
    // 리벳
    if (t >= 1) [[36, 46], [124, 46], [33, 86], [127, 86], [44, 142], [116, 142], [80, 34]].forEach(([x, y]) => c.body.push(`<circle cx="${x}" cy="${y}" r="2.6" fill="${m.trimHi}" stroke="${OUT}" stroke-width="1"/>`));
    if (t >= 3) c.body.push(gem(c, 80, 34, 7));
    if (t === 4) [[24, 70], [136, 70], [80, 214]].forEach(([x, y]) => c.front.push(`<g class="wa-bob">${shape(poly([[x, y - 7], [x + 5, y], [x, y + 7], [x - 5, y]]), `url(#${id}-mL)`)}</g>`));
    // 속성 문양 자리: 테두리 둘레
    [[32, 60, -1, -.3], [31, 90, -1, 0], [36, 128, -1, .3], [52, 164, -.7, .6], [128, 60, 1, -.3], [129, 90, 1, 0], [124, 128, 1, .3], [108, 164, .7, .6], [80, 30, 0, -1]]
      .forEach(([x, y, nx, ny]) => c.anchors.push({ x, y, nx, ny }));
    c.tip = [80, 30];
    c.core = [80, 108];
  }

  // 지팡이(힐러): 나무 지팡이 → 금속 갈퀴 → 초승달 머리 → 날개 → 궤도 고리
  function staff(c) {
    const { t, id, m, el } = c;
    const ox = CX, oy = 54, r = [15, 16, 18, 19, 20][t];
    // 자루
    const shaft = quad([CX, 78], [CX + 3, 145], [CX, 210], 12);
    c.body.push(shape(ribbon(shaft, q => 12 - q * 3), t >= 3 ? `url(#${id}-trimH)` : `url(#${id}-wood)`));
    if (t <= 2) c.body.push(strokeOnly(line(shaft.slice(1, 11).map(p => [p[0] - 2, p[1]])), WOOD.hi, 1, 'opacity=".5"'));
    [124, 166].forEach(y => { if (t >= 1) c.body.push(shape(`M${CX - 7.5} ${y} h15 v9 h-15 Z`, t >= 3 ? `url(#${id}-leather)` : `url(#${id}-trim)`)); });
    c.body.push(shape(`M${CX - 6.5} 204 h13 l-3 12 h-7 Z`, `url(#${id}-trim)`));
    if (t >= 2) {   // 머리 아래 매듭 + 한쪽으로 늘어진 술(대칭으로 두면 다리처럼 보인다)
      c.body.push(shape(ribbon(cubic([CX + 5, 90], [CX + 22, 94], [CX + 12, 112], [CX + 26, 128], 12), q => 7 - q * 4.5), el.main));
      c.body.push(shape(ribbon(cubic([CX + 4, 92], [CX + 14, 102], [CX + 6, 116], [CX + 14, 134], 12), q => 5 - q * 3.5), el.dark));
      c.body.push(shape(`M${CX - 8} 86 h16 v8 h-16 Z`, `url(#${id}-trim)`));
      c.body.push(gem(c, CX, 90, 4.5));
    }
    // 머리
    if (t >= 3) [-1, 1].forEach(s => c.back.push(wing(c, [ox + s * 10, oy + 12], s, t === 4 ? 4 : 3, t === 4 ? 44 : 36, `url(#${id}-trim)`)));
    if (t >= 2) {   // 초승달 머리가 보주를 감싼다
      const R = r + 9;
      c.body.push(shape(`M${f(ox - R)} ${f(oy)} A${f(R)} ${f(R)} 0 1 0 ${f(ox + R)} ${f(oy)} L${f(ox + R - 5)} ${f(oy - 6)} A${f(R - 4)} ${f(R - 4)} 0 1 1 ${f(ox - R + 5)} ${f(oy - 6)} Z`, `url(#${id}-trim)`));
    } else if (t === 1) {
      [-1, 1].forEach(s => c.body.push(shape(ribbon(quad([ox + s * 4, oy + r + 8], [ox + s * (r + 10), oy + 4], [ox + s * (r - 2), oy - r - 2], 10), q => 5 - q * 3), `url(#${id}-trim)`)));
    }
    c.body.push(shape(`M${ox - 10} ${oy + r - 3} h20 l-4 ${t >= 1 ? 14 : 18} h-12 Z`, t === 0 ? `url(#${id}-wood)` : `url(#${id}-trim)`));
    if (t === 0) [-1, 1].forEach(s => c.front.push(shape(ribbon(quad([ox + s * 6, oy + r], [ox + s * (r + 7), oy + 2], [ox + s * (r - 5), oy - r + 3], 8), q => 6 - q * 4), `url(#${id}-wood)`)));   // 나뭇가지가 보주를 움켜쥔다
    // 보주
    if (t >= 2) c.body.push(`<circle cx="${ox}" cy="${oy}" r="${r + 5}" fill="${el.main}" opacity=".35" filter="url(#${id}-glow)"/>`);
    c.body.push(shape(`M${ox - r} ${oy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`, `url(#${id}-orb)`));
    if (t >= 1) c.body.push(emblem(c, c.element, ox, oy + 1, r * 1.1, el.dark, 'opacity=".35"'));
    c.body.push(`<ellipse cx="${f(ox - r * .35)}" cy="${f(oy - r * .4)}" rx="${f(r * .32)}" ry="${f(r * .2)}" fill="#fff" opacity=".85" transform="rotate(-30 ${f(ox - r * .35)} ${f(oy - r * .4)})"/>`);
    if (t === 4) {   // 궤도 고리
      c.front.push(`<g class="wa-spin" style="transform-origin:${ox}px ${oy}px"><ellipse cx="${ox}" cy="${oy}" rx="${r + 16}" ry="${f((r + 16) * .32)}" fill="none" stroke="${el.light}" stroke-width="1.6" opacity=".85" transform="rotate(-18 ${ox} ${oy})"/>${sparkle(ox + r + 16, oy - 6, 3.5, '#fff')}</g>`);
      c.back.push(`<circle cx="${ox}" cy="${oy}" r="${r + 22}" fill="none" stroke="url(#${id}-trimH)" stroke-width="2"/>`);
    }
    // 속성 문양 자리: 보주 둘레 + 자루 위쪽
    for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i - 3.5) * .55; c.anchors.push({ x: ox + Math.cos(a) * (r + 12), y: oy + Math.sin(a) * (r + 12), nx: Math.cos(a), ny: Math.sin(a) }); }
    c.anchors.push({ x: CX + 7, y: 96, nx: 1, ny: 0 }, { x: CX - 7, y: 100, nx: -1, ny: 0 });
    c.tip = [ox, oy - r];
    c.core = [ox, oy];
  }

  const SHAPES = { warrior: sword, archer: bow, tanker: shield, healer: staff };

  /* ---------- 속성 문양 (본체 둘레) ---------- */
  function motif(c) {
    const { t, el, rnd, anchors, id } = c;
    const count = [0, 2, 4, 6, 9][t];
    if (!count || !anchors.length) return;
    // 고르게 퍼지도록 간격을 두고 고른다. 좌우 짝 자리(검 날)는 양쪽을 번갈아 써서 한쪽에 몰리지 않게
    const picks = [];
    if (c.paired) {
      const rows = anchors.length / 2;
      for (let i = 0; i < count; i++) picks.push(anchors[Math.min(rows - 1, Math.floor((i + .3 + rnd() * .4) * rows / count)) * 2 + (i % 2)]);
    } else {
      const step = anchors.length / count;
      for (let i = 0; i < count; i++) picks.push(anchors[Math.floor((i + rnd() * .6) * step) % anchors.length]);
    }
    const live = t >= 3;   // 전설부터 움직인다
    const out = [];
    picks.forEach((a, i) => {
      const ang = Math.atan2(a.ny, a.nx) * 180 / Math.PI;
      const sz = 1.25 + t * .2;
      const delay = `style="--d:${f(-rnd() * 2)}s"`;
      switch (c.element) {
        case 'fire': out.push(flame(c, a.x, a.y, (9 + rnd() * 6) * sz, (4 + rnd() * 2) * sz, ang + 90 - 20 * Math.sign(a.nx || 1), live ? 'wa-flick' : '')); break;
        case 'water': out.push(droplet(a.x + a.nx * 5, a.y + a.ny * 5, 2.4 * sz, el.light, `stroke="${el.dark}" stroke-width=".8" ${live ? `class="wa-float" ${delay}` : ''}`)); break;
        case 'earth': { const x = a.x + a.nx * 8, y = a.y + a.ny * 8, r = 4.2 * sz; out.push(`<g ${live ? `class="wa-bob" ${delay}` : ''}>${shape(poly([[x - r, y], [x - r * .4, y - r], [x + r * .8, y - r * .6], [x + r, y + r * .4], [x - r * .2, y + r]]), el.main)}${fillOnly(poly([[x - r * .4, y - r], [x + r * .8, y - r * .6], [x, y - r * .1]]), el.light, 'opacity=".8"')}</g>`); break; }
        case 'wind': { const x = a.x + a.nx * 3, y = a.y + a.ny * 3, s = Math.sign(a.nx || 1), L = (12 + rnd() * 6) * sz; out.push(fillOnly(ribbon(cubic([x, y + L * .5], [x + s * L * .9, y + L * .3], [x + s * L * .8, y - L * .6], [x + s * L * .1, y - L * .5], 12), q => 3.6 * Math.sin(Math.PI * Math.min(1, q * 1.15)) + .3), el.light, `opacity=".9" stroke="${el.dark}" stroke-width=".6" ${live ? `class="wa-float" ${delay}` : ''}`)); break; }
        case 'thunder': { const pts = bolt(a.x, a.y, (12 + rnd() * 8) * sz, ang + 90, rnd); out.push(strokeOnly(line(pts), el.light, 2.2, `filter="url(#${id}-glow)" ${live ? `class="wa-zap" ${delay}` : ''}`)); break; }
        case 'ice': { const L = (8 + rnd() * 6) * sz, x2 = a.x + a.nx * L, y2 = a.y + a.ny * L - 2; const nx = -a.ny * 2.6, ny = a.nx * 2.6; out.push(shape(poly([[a.x + nx, a.y + ny], [x2, y2], [a.x - nx, a.y - ny]]), el.main) + strokeOnly(line([[a.x, a.y], [x2, y2]]), '#fff', 1, 'opacity=".9"')); break; }
        case 'light': out.push(sparkle(a.x + a.nx * 6, a.y + a.ny * 6, 3.4 * sz, '#ffffff', `${live ? `class="wa-twinkle" ${delay}` : ''} filter="url(#${id}-glow)"`)); break;
        case 'dark': { const x = a.x, y = a.y, s = Math.sign(a.nx || 1); out.push(fillOnly(ribbon(cubic([x, y], [x + s * 8, y - 6], [x - s * 2, y - 14], [x + s * 6, y - 22], 10), q => 5 * (1 - q) + .5), el.main, `opacity=".75" ${live ? `class="wa-float" ${delay}` : ''}`)); break; }
        case 'poison': out.push(droplet(a.x + a.nx * 3, a.y + 6, 2.2 * sz, el.main, `stroke="${el.dark}" stroke-width=".8" ${live ? `class="wa-drip" ${delay}` : ''}`)); break;
      }
    });
    // 빛: 뒤로 퍼지는 광선 / 번개: 큰 줄기 / 물: 감도는 물줄기
    if (t >= 2 && c.element === 'light') {
      let d = '';
      for (let i = 0; i < 12; i++) { const a = i * 30 * Math.PI / 180, r0 = 26, r1 = 58 + t * 6; d += poly([[c.core[0] + Math.cos(a - .05) * r0, c.core[1] + Math.sin(a - .05) * r0], [c.core[0] + Math.cos(a) * r1, c.core[1] + Math.sin(a) * r1], [c.core[0] + Math.cos(a + .05) * r0, c.core[1] + Math.sin(a + .05) * r0]]) + ' '; }
      c.under.push(fillOnly(d, el.main, `opacity="${.12 + t * .05}" ${live ? `class="wa-spin" style="transform-origin:${f(c.core[0])}px ${f(c.core[1])}px"` : ''}`));
    }
    if (t >= 3 && (c.element === 'water' || c.element === 'wind')) {
      const [x, y] = c.core;
      c.back.push(strokeOnly(`M${x - 34} ${y + 40} C${x - 50} ${y - 10} ${x + 46} ${y - 4} ${x + 30} ${y - 54}`, el.light, 2.2, 'opacity=".55"'));
      c.back.push(strokeOnly(`M${x + 30} ${y + 52} C${x + 52} ${y + 10} ${x - 44} ${y + 2} ${x - 28} ${y - 40}`, el.main, 1.6, 'opacity=".5"'));
    }
    c.front.push(out.join(''));
  }

  /* ---------- 떠다니는 입자 (에픽부터) ---------- */
  function particles(c) {
    const { t, el, rnd } = c;
    const n = [0, 0, 4, 7, 11][t];
    let s = '';
    for (let i = 0; i < n; i++) {
      const x = 18 + rnd() * (W - 36), y = 20 + rnd() * (H - 40);
      const d = `style="--d:${f(-rnd() * 3)}s"`;
      const cls = t >= 3 ? `class="wa-twinkle" ${d}` : 'opacity=".7"';
      if (c.element === 'light' || c.element === 'thunder' || t === 4) s += sparkle(x, y, 2 + rnd() * 2, i % 2 ? '#fff' : el.light, cls);
      else s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1 + rnd() * 1.4)}" fill="${i % 2 ? el.light : el.main}" ${cls}/>`;
    }
    c.front.push(s);
  }

  /* ---------- 진입점 ---------- */
  function svg(opts) {
    const o = opts || {};
    const t = TIERS[o.grade] ?? 0;
    const element = ELEMENTS[o.element] ? o.element : 'fire';
    const cls = SHAPES[o.cls] ? o.cls : 'warrior';
    const c = {
      t, element, el: ELEMENTS[element], m: METALS[t], id: 'wa' + (++uid),
      rnd: rng(cls + '|' + element + '|' + t), defs: [], under: [], back: [], body: [], front: [], anchors: [], core: [CX, H / 2], tip: [CX, 12],
    };
    defs(c);
    SHAPES[cls](c);
    aura(c, f(c.core[0]), f(c.core[1]));
    motif(c);
    particles(c);
    const label = (o.label || '') || `${ELEMENTS[element].name} 속성 무기`;
    return `<svg class="wa wa-t${t}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label.replace(/"/g, '&quot;')}">` +
      `<defs>${c.defs.join('')}</defs>${c.under.join('')}${c.back.join('')}${c.body.join('')}${c.front.join('')}</svg>`;
  }

  window.WeaponArt = { svg, ELEMENTS: Object.keys(ELEMENTS), GRADES: Object.keys(TIERS), CLASSES: Object.keys(SHAPES) };
})();
