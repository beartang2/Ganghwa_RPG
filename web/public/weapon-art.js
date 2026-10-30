/*!
 * weapon-art.js — 무기 그림 생성기. 이미지 파일 없이 SVG 부품을 겹쳐 그린다.
 *
 *   직업 형태 4종(검·활·방패·지팡이) × 속성 9종 × 등급 6단계(+💎 프리즘 = 초월한 ★ 무기) = 216가지
 *   WeaponArt.svg({ cls: 'warrior', element: 'fire', grade: 'legend' }) → '<svg …>' 문자열
 *
 * 레이어 순서(뒤 → 앞):
 *   오라(등급) → 형태 본체(직업, 금속색=등급) → 속성 재질(본체 표면: 용암 균열·물결·판석·결정면·성운…, 나무는 풍화) →
 *   속성 문양(본체 둘레: 불꽃 혀·고드름·번개…) → 떠다니는 입자(등급이 높을수록 많고 움직임)
 * 속성은 기호(아이콘)가 아니라 표면 재질과 둘레 현상으로만 표현한다.
 * 같은 입력이면 항상 같은 그림(조합 문자열로 시드 고정). 애니메이션은 style.css 의 .wa-* 클래스.
 */
(function () {
  'use strict';

  const W = 160, H = 220, CX = 80, TAU = Math.PI * 2;
  const OUT = '#170f0a';            // 외곽선 — 아이콘처럼 또렷하게 읽히도록 진한 테두리
  const TIERS = { common: 0, rare: 1, epic: 2, legend: 3, transcend: 4, prism: 5 };

  // 등급 = 금속. 낮을수록 무쇠, 높을수록 귀금속·결정
  const METALS = [
    { hi: '#eef1f5', mid: '#aab3be', lo: '#5f6873', trim: '#8a6a3c', trimHi: '#d3a865', trimLo: '#4e3a1e' },   // 일반: 무쇠 + 청동
    { hi: '#f3f8ff', mid: '#a6c0de', lo: '#4f6a8a', trim: '#9aa6b5', trimHi: '#eef3f9', trimLo: '#56606e' },   // 희귀: 푸른 강철 + 은
    { hi: '#eef0f7', mid: '#98a1b8', lo: '#383f54', trim: '#8b6fc4', trimHi: '#e6d9ff', trimLo: '#3f2c6e' },   // 에픽: 흑강 + 자수정 장식
    { hi: '#fff7de', mid: '#efc46a', lo: '#9a6418', trim: '#e0aa45', trimHi: '#fff1bd', trimLo: '#7a4a10' },   // 전설: 황금
    { hi: '#ffffff', mid: '#dfd2ff', lo: '#7d62c7', trim: '#f0c56a', trimHi: '#fffbe6', trimLo: '#8a5c1c' },   // 초월: 결정 + 금
    { hi: '#ffffff', mid: '#d6f4ff', lo: '#7d8ee0', trim: '#cbbcff', trimHi: '#ffffff', trimLo: '#6656c4' },   // 💎 프리즘: 무지갯빛 결정 + 백금
  ];
  const RAINBOW = ['#ff9ad5', '#ffd27a', '#fff3a8', '#b8ffd9', '#9fe8ff', '#c9b8ff'];
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

  /* ---------- 속성 재질(텍스처) ----------
   * 아이콘 없이 '표면'만으로 속성을 읽히게 한다. 같은 속성이면 방패 바탕·검 날·활대·보주가 같은 재질 언어를 쓴다.
   *   불 = 식은 쇳물 + 빛나는 균열 · 물 = 물결 빛 + 파문 · 대지 = 판석/화강암 + 이끼 · 바람 = 소용돌이 결 + 잎
   *   번개 = 먹구름빛 + 갈라지는 번개 · 얼음 = 깎인 결정면 + 서리꽃 · 빛 = 퍼지는 광휘
   *   어둠 = 별 박힌 성운 + 새는 균열 · 독 = 거품 + 부식 + 흘러내리는 진액
   * 나무 부분(일반 방패·낮은 등급 활·지팡이 자루)은 재질 대신 그 속성다운 '풍화'를 입는다:
   *   그을림 · 물먹음 · 진흙 · 바람 긁힘 · 벼락 자국 · 서리 · 볕에 바램 · 썩음 · 독 곰팡이
   * surface(c, [x0, y0, x1, y1], { kind, wood, k, path, along }) — 호출하는 쪽에서 영역 clip-path 를 씌운다.
   *   kind: 'field'(방패 바탕) | 'blade'(검 날) | 'limb'(활대) | 'orb'(보주) | 'shaft'(자루)
   *   k: 세기 0~1(낮은 등급일수록 은은하게) · path: 영역 외곽(가장자리 서리용)
   *   along: 가는 부품(활대·자루)의 중심선 점들 — 얼룩·잎·거품을 실제로 보이는 자리에만 떨어뜨린다 */
  const between = (rnd, a, b) => a + (b - a) * rnd();
  const walk = (rnd, x, y, ang, n, step, wobble) => {
    const p = [[x, y]];
    for (let i = 0; i < n; i++) { ang += (rnd() - .5) * wobble; x += Math.cos(ang) * step; y += Math.sin(ang) * step; p.push([x, y]); }
    return p;
  };
  const glowLine = (c, pts, core, glow, w) =>
    strokeOnly(line(pts), glow, w * 2.8, `opacity=".6" filter="url(#${c.id}-glow)"`) + strokeOnly(line(pts), core, w);
  const wavy = (x0, x1, y, amp, wl, ph) => { const p = []; for (let x = x0; x <= x1 + .1; x += 2) p.push([x, y + Math.sin(x / wl * TAU + ph) * amp]); return p; };
  const def = (c, body) => { const id = `${c.id}-s${++c.sid}`; c.defs.push(body.replace(/@ID/g, id)); return id; };
  const circ = (x, y, r, fill, extra = '') => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}" ${extra}/>`;
  const rect = (B, fill, extra = '') => `<rect x="${f(B.x0 - 2)}" y="${f(B.y0 - 2)}" width="${f(B.w + 4)}" height="${f(B.h + 4)}" fill="${fill}" ${extra}/>`;
  const vgrad = (c, stops) => def(c, `<linearGradient id="@ID" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, col, op]) => `<stop offset="${o}" stop-color="${col}" stop-opacity="${op}"/>`).join('')}</linearGradient>`);
  const leaf = (x, y, s, ang, fill, vein) => `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(ang)})"><path d="M${f(-s)} 0 Q0 ${f(-s * .62)} ${f(s)} 0 Q0 ${f(s * .62)} ${f(-s)} 0 Z" fill="${fill}" stroke="${vein}" stroke-width=".8"/><path d="M${f(-s * .8)} 0 L${f(s * .8)} 0" stroke="${vein}" stroke-width=".6"/></g>`;
  const pebble = (x, y, r, fill, extra = '') => shape(poly([[x - r, y], [x - r * .3, y - r], [x + r, y - r * .4], [x + r * .7, y + r * .8], [x - r * .5, y + r]]), fill, 'stroke-width="1.1" ' + extra);
  const SCALE = { field: 1, orb: .7, blade: .55, limb: .5, shaft: .5 };

  const TEX = {
    fire(c, B, o) {
      const { el, rnd } = c, sc = SCALE[o.kind], z = Math.max(.6, sc);
      if (o.wood) {   // 그을린 나무: 불 닿은 쪽이 숯처럼 검고, 탄 결 사이로 불씨가 살아 있다
        const ends = o.kind === 'limb';   // 활대는 양 끝이 탄다
        const g = vgrad(c, ends
          ? [[0, '#120602', .97], [.24, '#2a1206', 0], [.76, '#2a1206', 0], [1, '#120602', .97]]
          : [[.28, '#2a1206', 0], [.7, '#1a0a04', .82], [1, '#0d0502', .97]]);
        let s = rect(B, `url(#${g})`, `opacity="${f(.65 + .35 * o.k)}"`);
        const n = 3 + Math.round(o.k * 3);
        for (let i = 0; i < n; i++) {
          const [x, y] = ends ? B.spot(i % 2 ? .02 : .82, i % 2 ? .18 : .98) : B.spot(.62, .98);
          s += glowLine(c, walk(rnd, x, y, -Math.PI / 2 + (rnd() - .5) * 1.4, 3, 5 * z, 1.5), el.light, el.main, .8);
        }
        for (let i = 0; i < 4; i++) { const [x, y] = ends ? B.spot(i % 2 ? 0 : .85, i % 2 ? .15 : 1) : B.spot(.55, 1); s += circ(x, y, 1.3 * z, el.light, `filter="url(#${c.id}-glow)"`); }
        return s;
      }
      // 식은 쇳물 표면 + 빛나는 균열망 + 아래에서 올라오는 열기
      const heat = vgrad(c, [[.15, el.main, 0], [.72, el.main, .5], [1, el.light, .8]]);
      let s = o.kind === 'field' || o.kind === 'orb' ? rect(B, '#1a0703', `opacity="${f(.5 * o.k)}"`) : '';
      s += rect(B, `url(#${heat})`, `opacity="${f(.45 + .55 * o.k)}"`);
      const n = { field: 5, blade: 2, limb: 3, orb: 3, shaft: 2 }[o.kind] + Math.round(o.k * (o.kind === 'field' ? 4 : 2));
      const step = Math.max(3, Math.min(B.w, B.h) * (o.kind === 'field' ? .1 : .18));
      const vertical = o.kind === 'blade' || o.kind === 'limb' || o.kind === 'shaft';
      for (let i = 0; i < n; i++) {
        const [x, y] = B.spot(.12, 1);
        const pts = walk(rnd, x, y, vertical ? -Math.PI / 2 + (rnd() - .5) : rnd() * TAU, 5 + Math.round(rnd() * 4), step, 1.4);
        s += glowLine(c, pts, el.light, el.main, o.kind === 'field' ? 1.3 : .9);
        if (rnd() < .6) { const j = 1 + Math.floor(rnd() * (pts.length - 2)); s += glowLine(c, walk(rnd, pts[j][0], pts[j][1], rnd() * TAU, 3, step * .8, 1.2), el.light, el.main, .7); }
      }
      return s;
    },

    water(c, B, o) {
      const { el, rnd } = c, sc = SCALE[o.kind], z = Math.max(.65, sc);
      if (o.wood) {   // 물먹은 나무: 아래쪽이 짙게 젖고, 물이 흘러내린 자국 + 맺힌 물방울
        let s = o.kind === 'limb' ? rect(B, '#0b2233', `opacity="${f(.3 + .15 * o.k)}"`)
          : (o.kind === 'field' ? rect(B, `url(#${vgrad(c, [[.3, '#0b2233', 0], [.48, '#0b2233', .55], [1, '#061826', .8]])})`)
          : rect(B, `url(#${vgrad(c, [[.3, '#16324a', 0], [.5, '#16324a', .32], [1, '#0e2638', .48]])})`));
        if (o.kind !== 'limb') s += strokeOnly(line(wavy(B.x0 - 2, B.x1 + 2, B.y0 + B.h * .44, 2 * z, 12 * z, rnd() * TAU)), el.light, 1.3, 'opacity=".7"');
        for (let i = 0; i < 3; i++) { const [x, y] = B.spot(0, .4), L = B.h * between(rnd, .15, .3), w = 3.2 * z; s += `<rect x="${f(x - w / 2)}" y="${f(y)}" width="${f(w)}" height="${f(L)}" rx="${f(w / 2)}" fill="#0c1f2c" opacity=".45"/>`; }
        for (let i = 0; i < 2 + Math.round(o.k * 3); i++) { const [x, y] = B.spot(.1, .95); s += droplet(x, y, 2.6 * z, el.light, `stroke="${el.dark}" stroke-width=".7"`); }
        return s;
      }
      // 물결 빛(코스틱) + 동심원 파문 + 윗면 광택
      const gloss = vgrad(c, [[0, '#ffffff', .38], [.45, '#ffffff', 0]]);
      let s = rect(B, el.main, `opacity="${f(.28 * o.k)}"`) + rect(B, `url(#${gloss})`);
      const rows = { field: 7, blade: 6, limb: 7, orb: 4, shaft: 3 }[o.kind];
      for (let i = 0; i < rows; i++) {
        const y = B.y0 + B.h * (i + .5) / rows + between(rnd, -2, 2);
        s += strokeOnly(line(wavy(B.x0 - 4, B.x1 + 4, y, between(rnd, 1.2, 2.6) * z, between(rnd, 8, 15) * z, rnd() * TAU)), el.light, o.kind === 'field' ? 1.3 : .9, `opacity="${f(.32 + .35 * o.k)}"`);
      }
      if (o.kind === 'field' || o.kind === 'orb') {
        for (let j = 0; j < (o.kind === 'field' ? 2 : 1); j++) {
          const x = between(rnd, B.x0 + B.w * .25, B.x1 - B.w * .25), y = between(rnd, B.y0 + B.h * .3, B.y1 - B.h * .3);
          [6, 12, 19].forEach((r, i) => { s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r * sc)}" ry="${f(r * .45 * sc)}" fill="none" stroke="${el.light}" stroke-width="1.1" opacity="${f((.6 - i * .16) * o.k)}"/>`; });
        }
      }
      for (let i = 0; i < (o.kind === 'field' ? 4 : 2); i++) { const [x, y] = B.spot(0, 1); s += circ(x, y, between(rnd, 1, 2.2) * z, 'none', `stroke="${el.light}" stroke-width=".9" opacity=".75"`); }
      return s;
    },

    earth(c, B, o) {
      const { el, rnd } = c, sc = SCALE[o.kind], z = Math.max(.6, sc);
      const stone = mix(el.main, '#8a8172', .5);
      if (o.wood) {   // 흙 묻은 나무: 아래쪽에 말라붙은 진흙 + 튄 자국 + 박힌 자갈
        let s = '';
        const lo = o.kind === 'limb' ? .7 : .45;
        if (o.kind !== 'limb') {
          const y = B.y1 - B.h * .26, top = wavy(B.x0 - 3, B.x1 + 3, y, 2.4 * z, 9 * z, rnd() * TAU);
          s += fillOnly(line(top) + ` L${f(B.x1 + 3)} ${f(B.y1 + 3)} L${f(B.x0 - 3)} ${f(B.y1 + 3)} Z`, '#3e2814', 'opacity=".92"');
          s += strokeOnly(line(top), '#7a5a34', 1.2, 'opacity=".8"');
        }
        for (let i = 0; i < 9 + Math.round(o.k * 8); i++) { const [x, y] = B.spot(lo, 1); s += circ(x, y, between(rnd, 1, 3.4) * z, '#3a2614', `opacity="${f(between(rnd, .55, .9))}"`); }
        for (let i = 0; i < 2 + Math.round(o.k * 2); i++) { const [x, y] = B.spot(lo + .15, .97); s += pebble(x, y, 3.6 * z, '#8b7b6a'); }
        return s;
      }
      if (o.kind === 'field') {   // 방패 바탕: 고르지 않은 판석 + 이음매 + 이끼. 전설부터 이음매 사이로 호박빛 맥이 흐른다
        let s = '', seams = '';
        for (let y = B.y0 - 10, row = 0; y < B.y1 + 10; row++) {
          const h = between(rnd, 16, 26);
          let x = B.x0 - between(rnd, 6, 20);
          while (x < B.x1 + 6) {
            const w = between(rnd, 18, 32), j = () => between(rnd, -3.5, 3.5);
            const p = [[x + j(), y + j()], [x + w + j(), y + j()], [x + w + j(), y + h + j()], [x + j(), y + h + j()]];
            s += fillOnly(poly(p), mix(stone, el.dark, between(rnd, .05, .65)), `opacity="${f(.5 + .45 * o.k)}"`);
            s += strokeOnly(line([p[3], p[0], p[1]]), el.light, 1, 'opacity=".35"');
            for (let q = 0; q < 3; q++) s += circ(between(rnd, p[0][0] + 3, p[1][0] - 3), between(rnd, p[0][1] + 3, p[3][1] - 3), between(rnd, .5, 1.1), q % 2 ? '#1e140a' : '#efe2c8', 'opacity=".45"');
            seams += poly(p) + ' ';
            x += w;
          }
          y += h;
        }
        s += `<path d="${seams}" fill="none" stroke="#1e1208" stroke-width="2" stroke-linejoin="round" opacity=".85"/>`;
        for (let i = 0; i < 4; i++) { const x = between(rnd, B.x0, B.x1), y = between(rnd, B.y0 + B.h * .3, B.y1); for (let q = 0; q < 5; q++) s += circ(x + between(rnd, -4, 4), y + between(rnd, -2.5, 2.5), between(rnd, 1.1, 2.4), q % 2 ? '#7d9a3c' : '#56752a', 'opacity=".9"'); }
        if (c.t >= 3) for (let i = 0; i < 3; i++) { const [x, y] = B.spot(.1, .9); s += glowLine(c, walk(rnd, x, y, rnd() * TAU, 6, 7, 1.3), el.light, '#ff9a2e', 1); }
        return s;
      }
      if (o.kind === 'orb') {   // 보주: 쪼개진 정동(晶洞) — 거친 돌 껍질 안쪽에 결정이 안으로 자란다
        let s = rect(B, stone, `opacity="${f(.6 + .35 * o.k)}"`);
        for (let i = 0; i < 26; i++) { const [x, y] = B.spot(0, 1); s += circ(x, y, between(rnd, .45, 1), rnd() < .5 ? '#2a1c10' : '#f2e6cc', 'opacity=".55"'); }
        // 동굴(빈 속)은 찌그러진 다각형, 결정은 가장자리에서 안쪽 아무 데로나 자라 크기·방향이 제각각 → 단면이 바퀴처럼 보이지 않는다
        const R = B.w * .34, cx = B.cx + between(rnd, -1.5, 1.5), cy = B.cy + between(rnd, 0, 2.5), N = 11;
        const rim = Array.from({ length: N }, (_, i) => { const a = i / N * TAU + rnd() * .35, r = R * between(rnd, .72, 1.08); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * .9]; });
        s += fillOnly(poly(rim.map(([x, y]) => [cx + (x - cx) * 1.16, cy + (y - cy) * 1.16])), mix(stone, '#ffffff', .3)) + fillOnly(poly(rim), '#22150a');
        const QUARTZ = ['#f6f2ea', '#ddd5c6', '#c3b8a4', '#ffffff'];
        rim.forEach((p, i) => {
          const q = rim[(i + 1) % N], d = between(rnd, .2, .6), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
          const tip = [mx + (cx - mx) * d + between(rnd, -1.5, 1.5), my + (cy - my) * d + between(rnd, -1.5, 1.5)];
          s += fillOnly(poly([p, tip, q]), QUARTZ[Math.floor(rnd() * 4)], `stroke="#5a4a36" stroke-width=".45" opacity="${f(.8 + .15 * o.k)}"`);
        });
        if (c.t >= 2) s += circ(cx, cy, R * .3, '#ffb347', `opacity=".85" filter="url(#${c.id}-glow)"`);   // 에픽부터 속에서 호박빛이 샌다
        return s;
      }
      // 검 날·활대·자루: 화강암 결(점박이) + 갈라진 금. 전설부터 금 사이로 호박빛
      let s = rect(B, stone, `opacity="${f(.4 + .45 * o.k)}"`);
      const n = Math.min(110, Math.round(B.w * B.h / 22));
      for (let i = 0; i < n; i++) { const [x, y] = B.spot(0, 1); const k = rnd(); s += circ(x, y, between(rnd, .45, 1.2), k < .4 ? '#2a1c10' : k < .7 ? '#f2e6cc' : el.dark, `opacity="${f(.4 + .4 * o.k)}"`); }
      const cracks = { blade: 3, limb: 3, shaft: 2 }[o.kind];
      for (let i = 0; i < cracks; i++) {
        const [x, y] = B.spot(.05, .95), pts = walk(rnd, x, y, Math.PI / 2 + (rnd() - .5), 4, 5 * z, 1.4);
        s += c.t >= 3 ? glowLine(c, pts, el.light, '#ff9a2e', .8) : strokeOnly(line(pts), '#24170b', 1.1, 'opacity=".85"');
      }
      return s;
    },

    wind(c, B, o) {
      const { el, rnd } = c, sc = SCALE[o.kind], z = Math.max(.6, sc);
      if (o.wood) {   // 바람에 바랜 나무: 색이 빠지고 사선 긁힘이 겹겹이 + 걸린 나뭇잎
        let s = rect(B, '#f4e6c8', `opacity="${f(.14 + .14 * o.k)}"`);
        for (let g = 0; g < 3 + Math.round(o.k); g++) {
          const [x, y] = B.spot(.05, .95), L = between(rnd, 10, 18) * z;
          for (let q = 0; q < 3; q++) {
            const ox = x + q * 2.6 * z, oy = y + q * 1.2 * z;
            s += strokeOnly(line([[ox, oy], [ox + L, oy - L * .55]]), '#3a2410', 1, 'opacity=".45" transform="translate(.8 .8)"') + strokeOnly(line([[ox, oy], [ox + L, oy - L * .55]]), '#f6ead2', .9, 'opacity=".75"');
          }
        }
        for (let i = 0; i < 2; i++) { const [x, y] = B.spot(.1, .9); s += leaf(x, y, 6.5 * z, between(rnd, 0, 360), el.main, el.dark); }
        return s;
      }
      // 소용돌이치는 바람결 + 날리는 잎
      let s = rect(B, el.light, `opacity="${f(.12 * o.k)}"`);
      const n = { field: 4, blade: 4, limb: 3, orb: 3, shaft: 2 }[o.kind];
      for (let i = 0; i < n; i++) {
        const long = o.kind === 'blade' || o.kind === 'limb';
        const R = long ? B.w * between(rnd, .7, 1.1) : Math.min(B.w, B.h) * between(rnd, .25, .5);
        const cx = long ? B.cx + (i % 2 ? R * .6 : -R * .6) : B.cx + between(rnd, -B.w * .15, B.w * .15);
        const cy = between(rnd, B.y0 + B.h * .15, B.y1 - B.h * .15);
        const a0 = rnd() * TAU, span = between(rnd, 2.2, 3.6);
        const pts = Array.from({ length: 16 }, (_, q) => { const a = a0 + span * q / 15, r = R * (1 - .45 * q / 15); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * (long ? 1.6 : .8)]; });
        s += fillOnly(ribbon(pts, q => (o.kind === 'field' ? 4.4 : 2.6) * Math.sin(Math.PI * q) + .2), el.light, `opacity="${f(.4 + .35 * o.k)}"`);
      }
      for (let i = 0; i < (o.kind === 'field' ? 3 : o.kind === 'orb' ? 1 : 2); i++) { const [x, y] = B.spot(.05, .95); s += leaf(x, y, 5.5 * Math.max(.55, sc), between(rnd, 0, 360), el.main, el.dark); }
      return s;
    },

    thunder(c, B, o) {
      const { el, rnd } = c, sc = SCALE[o.kind], z = Math.max(.6, sc);
      const jag = (x, y, ang, len, n) => {
        const p = [[x, y]];
        for (let i = 1; i <= n; i++) { const d = len * i / n, off = i < n ? between(rnd, -1, 1) * len * .13 : 0; p.push([x + Math.cos(ang) * d - Math.sin(ang) * off, y + Math.sin(ang) * d + Math.cos(ang) * off]); }
        return p;
      };
      if (o.wood) {   // 벼락 맞은 나무: 지그재그로 깊게 탄 자국 + 잔불티
        let s = '';
        const burns = o.along ? [0, 1, 2].map(() => { const [x, y] = B.spot(.05, .9); return jag(x, y, Math.PI / 2 + (rnd() - .5) * .6, 22, 4); })
          : [jag(between(rnd, B.x0 + B.w * .3, B.x1 - B.w * .3), B.y0 - 2, Math.PI / 2, B.h + 4, 9)];
        burns.forEach(pts => {
          s += strokeOnly(line(pts), '#120a05', 6 * z, 'opacity=".85"') + strokeOnly(line(pts), '#3a1c08', 2.6 * z, 'opacity=".9"') + strokeOnly(line(pts), el.main, .9, 'opacity=".95"');
          for (let i = 0; i < 3; i++) { const p = pts[1 + Math.floor(rnd() * (pts.length - 2))]; s += circ(p[0] + between(rnd, -5, 5) * z, p[1] + between(rnd, -4, 4), 1.1, el.light, `filter="url(#${c.id}-glow)"`); }
        });
        return s;
      }
      // 먹구름빛 바탕 + 갈라지며 뻗는 번개 (보주는 플라스마처럼 가운데서 사방으로)
      const deep = o.kind === 'field' || o.kind === 'orb';
      let s = rect(B, '#17143a', `opacity="${f(deep ? .7 + .2 * o.k : .28 * o.k)}"`);
      if (deep) for (let i = 0; i < 5; i++) { const x = between(rnd, B.x0, B.x1), y = between(rnd, B.y0, B.y0 + B.h * .45), r = between(rnd, 9, 16) * sc; s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r * 1.5)}" ry="${f(r)}" fill="#4a4590" opacity=".35"/>`; }
      const bolts = { field: 2, blade: 1, limb: 2, orb: 0, shaft: 1 }[o.kind];
      for (let i = 0; i < bolts; i++) {
        const [x] = o.kind === 'blade' ? [B.cx] : B.spot(0, .1);
        const main = jag(o.kind === 'field' ? between(rnd, B.x0 + B.w * .25, B.x1 - B.w * .25) : x, B.y0, Math.PI / 2 + between(rnd, -.2, .2), B.h, 8);
        s += glowLine(c, main, '#ffffff', el.main, o.kind === 'field' ? 1.5 : 1);
        for (let b = 0; b < 2 + Math.round(o.k * 2); b++) { const p = main[1 + Math.floor(rnd() * (main.length - 2))]; s += glowLine(c, jag(p[0], p[1], Math.PI / 2 + (rnd() < .5 ? -1 : 1) * between(rnd, .5, 1.1), B.h * between(rnd, .12, .28), 3), el.light, el.main, .75); }
      }
      if (o.kind === 'orb') {
        for (let i = 0; i < 5; i++) s += glowLine(c, jag(B.cx, B.cy, i / 5 * TAU + rnd(), B.w * .5, 4), '#ffffff', el.main, .8);
        s += circ(B.cx, B.cy, B.w * .12, '#ffffff', `filter="url(#${c.id}-glow)"`);
      }
      return s;
    },

    ice(c, B, o) {
      const { el, rnd } = c, sc = SCALE[o.kind], z = Math.max(.6, sc);
      if (o.wood) {   // 서리 낀 나무: 가장자리와 윗면이 하얗게 얼고, 서리꽃이 번진다
        let s = o.kind === 'limb' ? rect(B, '#e6f7ff', `opacity="${f(.18 + .12 * o.k)}"`)
          : rect(B, `url(#${vgrad(c, [[0, '#f2fbff', .7], [.38, '#e6f7ff', 0]])})`);
        if (o.path) s += strokeOnly(o.path, '#e6f7ff', 12 * Math.max(.5, sc), 'opacity=".5"') + strokeOnly(o.path, '#ffffff', 4 * Math.max(.5, sc), 'opacity=".85"');
        for (let i = 0; i < 3; i++) {
          const [x, y] = B.spot(.05, .7), L = 9 * z, a = rnd() * TAU;
          let d = '';
          for (let q = 0; q < 6; q++) { const b = a + q * TAU / 6; d += `M${f(x)} ${f(y)} l${f(Math.cos(b) * L)} ${f(Math.sin(b) * L)} `; }
          s += strokeOnly(d, '#ffffff', .9, 'opacity=".85"');
        }
        for (let i = 0; i < 10; i++) { const [x, y] = B.spot(0, 1); s += circ(x, y, between(rnd, .7, 1.6) * z, '#ffffff', 'opacity=".8"'); }
        return s;
      }
      // 깎인 얼음 결정면 + 가장자리 서리꽃 + 반짝임
      const cell = { field: 16, blade: 9, limb: 8, orb: 9, shaft: 8 }[o.kind];
      const nx = Math.ceil(B.w / cell) + 1, ny = Math.ceil(B.h / cell) + 1;
      const P = [];
      for (let j = 0; j <= ny; j++) { P.push([]); for (let i = 0; i <= nx; i++) P[j].push([B.x0 + i * cell + between(rnd, -cell * .3, cell * .3), B.y0 + j * cell + between(rnd, -cell * .3, cell * .3)]); }
      let s = rect(B, o.kind === 'blade' || o.kind === 'limb' ? el.main : el.light, `opacity="${f((o.kind === 'blade' || o.kind === 'limb' ? .3 : .2) * o.k)}"`);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = P[j][i], b = P[j][i + 1], d = P[j + 1][i], e = P[j + 1][i + 1];
        s += fillOnly(poly([a, b, e]), '#ffffff', `opacity="${f(between(rnd, .03, .32) * o.k)}"`);
        s += fillOnly(poly([a, e, d]), el.dark, `opacity="${f(between(rnd, .03, .2) * o.k)}"`);
      }
      if (o.path) s += strokeOnly(o.path, '#ffffff', 6 * z, `opacity="${f(.45 * o.k)}"`);
      const ferns = { field: 6, blade: 4, limb: 4, orb: 2, shaft: 2 }[o.kind];
      for (let i = 0; i < ferns; i++) {
        const left = i % 2 === 0, dir = left ? 1 : -1;
        const x = left ? B.x0 + 2 : B.x1 - 2, y = between(rnd, B.y0 + 6, B.y1 - 6);
        const L = Math.min(B.w * .45, 18 * sc + 4);
        let d = `M${f(x)} ${f(y)} l${f(dir * L)} ${f(-L * .3)}`;
        for (let q = 1; q < 4; q++) { const px = x + dir * L * q / 4, py = y - L * .3 * q / 4; d += ` M${f(px)} ${f(py)} l${f(dir * L * .25)} ${f(-L * .3)} M${f(px)} ${f(py)} l${f(dir * L * .25)} ${f(L * .2)}`; }
        s += strokeOnly(d, '#ffffff', .9, 'opacity=".8"');
      }
      for (let i = 0; i < (o.kind === 'field' ? 3 : 1); i++) { const [x, y] = B.spot(.05, .95); s += sparkle(x, y, 3.6 * z, '#ffffff', 'opacity=".95"'); }
      return s;
    },

    light(c, B, o) {
      const { el, rnd } = c, z = Math.max(.6, SCALE[o.kind]);
      if (o.wood) {   // 볕에 바랜 나무 + 판자 틈새로 새어 나오는 빛
        let s = rect(B, '#fff6e0', `opacity="${f(.22 + .14 * o.k)}"`);
        const sun = def(c, `<radialGradient id="@ID" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset="1" stop-color="${el.main}" stop-opacity="0"/></radialGradient>`);
        if (o.kind === 'field') s += rect(B, `url(#${sun})`);
        if (o.along) for (let i = 0; i < 3; i++) { const [x, y] = B.spot(.05, .9); s += glowLine(c, [[x, y], [x + between(rnd, -2, 2), y + 14 * z]], '#ffffff', el.main, 1.2); }
        else [.3, .62].forEach(u => { const x = B.x0 + B.w * u + between(rnd, -3, 3); s += glowLine(c, [[x, B.y0 - 2], [x + between(rnd, -3, 3), B.y1 + 2]], '#ffffff', el.main, 1.3); });
        return s;
      }
      // 한가운데서 퍼지는 광휘 — 기호가 아니라 빛 그 자체
      const core = def(c, `<radialGradient id="@ID" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset=".35" stop-color="${el.light}" stop-opacity=".55"/><stop offset="1" stop-color="${el.main}" stop-opacity="0"/></radialGradient>`);
      const blade = o.kind === 'blade' || o.kind === 'limb';
      const cx = B.cx, cy = o.kind === 'blade' ? B.y0 + B.h * .7 : B.cy;
      const R = Math.hypot(B.w, B.h), n = o.kind === 'field' ? 16 : 10;
      let s = rect(B, el.main, `opacity="${f(blade ? .2 + .12 * o.k : .24 * o.k)}"`), d = '';
      for (let i = 0; i < n; i++) { const a = i / n * TAU + .1; d += poly([[cx, cy], [cx + Math.cos(a - .07) * R, cy + Math.sin(a - .07) * R], [cx + Math.cos(a + .07) * R, cy + Math.sin(a + .07) * R]]) + ' '; }
      s += fillOnly(d, '#ffffff', `opacity="${f((blade ? .08 : .16) + .14 * o.k)}"`);
      const rr = blade ? B.w * .4 : Math.min(B.w, B.h) * .55;
      s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rr)}" ry="${f(rr * (blade ? 2.2 : 1))}" fill="url(#${core})" opacity="${f((blade ? .35 : .6) + .4 * o.k)}"/>`;
      if (o.kind === 'blade') s += `<rect x="${f(B.cx - 1.8)}" y="${f(B.y0)}" width="3.6" height="${f(B.h)}" fill="#ffffff" opacity="${f(.45 + .4 * o.k)}" filter="url(#${c.id}-glow)"/>`;
      return s;
    },

    dark(c, B, o) {
      const { el, rnd } = c, sc = SCALE[o.kind], z = Math.max(.6, sc);
      if (o.wood) {   // 썩어 검게 물든 나무 + 보랏빛으로 번지는 실핏줄
        let s = '';
        for (let i = 0; i < 5 + Math.round(o.k * 3); i++) { const [x, y] = B.spot(0, 1), r = between(rnd, 7, 15) * z; s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(r * 1.4)}" fill="#160a20" opacity="${f(between(rnd, .45, .7))}"/>`; }
        for (let i = 0; i < 2 + Math.round(o.k * 2); i++) { const [x, y] = B.spot(.05, .95); s += glowLine(c, walk(rnd, x, y, rnd() * TAU, 5, 6 * z, 1.2), el.light, el.main, .7); }
        return s;
      }
      // 별이 박힌 공허: 성운 + 먼지 별 + 빛이 새는 균열
      const neb = def(c, `<radialGradient id="@ID" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="${el.main}" stop-opacity=".75"/><stop offset=".45" stop-color="${el.dark}" stop-opacity=".8"/><stop offset="1" stop-color="#06020c" stop-opacity=".94"/></radialGradient>`);
      let s = rect(B, `url(#${neb})`, `opacity="${f(.55 + .45 * o.k)}"`);
      for (let i = 0; i < (o.kind === 'field' ? 3 : 2); i++) {
        const cx = between(rnd, B.x0, B.x1), cy = between(rnd, B.y0, B.y1), R = Math.min(B.w, B.h) * between(rnd, .2, .45);
        s += strokeOnly(`M${f(cx - R)} ${f(cy)} A${f(R)} ${f(R * .6)} 0 0 1 ${f(cx + R)} ${f(cy)}`, el.light, o.kind === 'field' ? 2.2 : 1.2, 'opacity=".25"');
      }
      const stars = { field: 18, blade: 9, limb: 9, orb: 9, shaft: 4 }[o.kind];
      for (let i = 0; i < stars; i++) { const [x, y] = B.spot(0, 1); s += circ(x, y, between(rnd, .4, 1.3) * Math.max(.7, sc), '#ffffff', `opacity="${f(between(rnd, .45, 1))}"`); }
      if (c.t >= 2) for (let i = 0; i < (o.kind === 'field' ? 2 : 1); i++) { const [x, y] = B.spot(.05, .95); s += glowLine(c, walk(rnd, x, y, rnd() * TAU, 6, 7 * z, 1.3), el.light, el.main, .9); }
      return s;
    },

    poison(c, B, o) {
      const { el, rnd } = c, sc = SCALE[o.kind], z = Math.max(.6, sc);
      const dripAt = (x, w, L) => fillOnly(`M${f(x - w)} ${f(B.y0 - 3)} V${f(B.y0 + L)} A${f(w)} ${f(w)} 0 0 0 ${f(x + w)} ${f(B.y0 + L)} V${f(B.y0 - 3)} Z`, el.main, `stroke="${el.dark}" stroke-width=".7"`) +
        strokeOnly(`M${f(x - w * .4)} ${f(B.y0)} V${f(B.y0 + L * .85)}`, el.light, .9, 'opacity=".8"');
      if (o.wood) {   // 독이 스민 나무: 아래부터 썩어 들어가는 녹빛 + 곰팡이 + 흘러내린 진액
        let s = o.kind === 'limb' ? '' : rect(B, `url(#${vgrad(c, [[.4, '#2f4a0c', 0], [1, '#2f4a0c', .65]])})`);
        for (let i = 0; i < 4 + Math.round(o.k * 3); i++) { const [x, y] = B.spot(.15, 1); for (let q = 0; q < 6; q++) s += circ(x + between(rnd, -5, 5) * z, y + between(rnd, -4, 4) * z, between(rnd, 1.4, 3.4) * z, q % 2 ? '#8db534' : '#4f7418', 'opacity=".85"'); }
        for (let i = 0; i < 2; i++) { const [x, y] = B.spot(.3, .9), r = 1.8 * z; s += circ(x, y, r, el.main, `stroke="${el.light}" stroke-width=".7" opacity=".8"`) + circ(x - r * .35, y - r * .35, r * .3, '#ffffff', 'opacity=".8"'); }
        if (o.kind === 'field') s += dripAt(between(rnd, B.x0 + 14, B.cx - 6), 2.6, B.h * .26) + dripAt(between(rnd, B.cx + 6, B.x1 - 14), 2, B.h * .16);
        return s;
      }
      // 부글거리는 독: 거품 + 부식 구멍 + 위에서 흘러내리는 진액
      let s = rect(B, el.dark, `opacity="${f(.28 * o.k)}"`);
      for (let i = 0; i < 4; i++) { const [x, y] = B.spot(0, 1); s += circ(x, y, between(rnd, 1.5, 3.5) * z, '#16240a', 'opacity=".5"'); }
      const bubbles = { field: 10, blade: 6, limb: 6, orb: 6, shaft: 3 }[o.kind];
      for (let i = 0; i < bubbles; i++) { const [x, y] = B.spot(0, 1), r = between(rnd, 1.6, 5) * Math.max(.55, sc); s += circ(x, y, r, el.main, `opacity=".65" stroke="${el.light}" stroke-width=".9"`) + circ(x - r * .35, y - r * .35, r * .28, '#ffffff', 'opacity=".85"'); }
      const drips = { field: 4, blade: 2, limb: 0, orb: 2, shaft: 0 }[o.kind];
      for (let i = 0; i < drips; i++) s += dripAt(between(rnd, B.x0 + B.w * .2, B.x1 - B.w * .2), between(rnd, 1.8, 3.4) * z * 1.2, between(rnd, .14, .32) * B.h);
      return s;
    },
  };

  function surface(c, box, o) {
    const B = { x0: box[0], y0: box[1], x1: box[2], y1: box[3] };
    B.w = B.x1 - B.x0; B.h = B.y1 - B.y0; B.cx = (B.x0 + B.x1) / 2; B.cy = (B.y0 + B.y1) / 2;
    o = Object.assign({ kind: 'field', wood: false, k: 1, path: '', along: null }, o);
    // 세로 비율 [lo, hi] 안에서 점 하나. 가는 부품은 중심선 위(±폭)에서만 고른다
    B.spot = (lo = 0, hi = 1) => {
      if (o.along) {
        const pool = o.along.pts.filter(p => (p[1] - B.y0) / B.h >= lo && (p[1] - B.y0) / B.h <= hi);
        const p = (pool.length ? pool : o.along.pts)[Math.floor(c.rnd() * (pool.length || o.along.pts.length))];
        return [p[0] + (c.rnd() - .5) * o.along.w, p[1] + (c.rnd() - .5) * o.along.w];
      }
      return [B.x0 + c.rnd() * B.w, B.y0 + B.h * (lo + (hi - lo) * c.rnd())];
    };
    return TEX[c.element](c, B, o);
  }

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

  // 날 안쪽: 속성 재질 · 홈(풀러) · 룬 · 능선/가장자리 광택
  function blade(c, g) {
    const { t, id, el, m } = c;
    const clip = `clip-path="url(#${id}-blade)"`;
    // 일반 등급부터 날 표면 자체가 속성을 띤다(낮은 등급은 은은하게 → 높을수록 진하게)
    const top0 = Math.min(g.topCenter[1], ...g.right.map(p => p[1]));
    c.body.push(`<g ${clip}>${surface(c, [CX - g.w * 1.5, top0, CX + g.w * 1.5, g.bottomY], { kind: 'blade', k: [.5, .68, .85, 1, 1][t], path: g.bladeD })}</g>`);
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
    // 날 가장자리에 속성색이 번진다 — 희귀부터
    if (t >= 1) c.body.push(strokeOnly(g.bladeD, el.main, t >= 2 ? 3.4 : 2.4, `opacity="${t >= 2 ? .75 : .45}" ${clip}`));
    // 능선 + 왼쪽 가장자리 광택
    c.body.push(strokeOnly(line([g.topCenter, [CX, g.bottomY]]), '#ffffff', 1, 'opacity=".55"'));
    c.body.push(strokeOnly(line([g.topCenter, ...g.left.slice(0, -1)]), '#ffffff', 1.2, `opacity=".75" ${clip}`));
    c.body.push(`<path d="${g.bladeD}" fill="none" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>`);
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
    // 활대: 두 갈래를 한 clip 으로 묶어(합집합) 속성 재질을 입힌다. 나무 활은 풍화, 금속·결정 활은 재질
    const limbD = [upper, lower].map(limb => ribbon(limb, q => 16 - q * 9.5));
    c.defs.push(`<clipPath id="${id}-limbs">${limbD.map(d => `<path d="${d}"/>`).join('')}</clipPath>`);
    limbD.forEach(d => c.body.push(shape(d, limbFill)));
    c.body.push(`<g clip-path="url(#${id}-limbs)">${surface(c, [gx - 18, 8, sx + 6, 212], { kind: 'limb', wood: t <= 1, k: [.7, .82, .9, 1, 1][t], path: limbD.join(' '), along: { pts: upper.concat(lower), w: 8 } })}</g>`);
    limbD.forEach(d => c.body.push(`<path d="${d}" fill="none" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>`));
    [upper, lower].forEach(limb => {
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
    c.front.push(arrowFx(c, 4, ay));
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

  // 화살촉에 실린 속성 — 시위를 떠난 화살이 무엇을 품었는지 촉 둘레의 현상으로 보여준다(희귀부터)
  function arrowFx(c, x, y) {
    const { t, el, rnd, id } = c;
    if (t < 1) return '';
    const sz = .8 + t * .15, live = t >= 3;
    const anim = k => live ? `class="${k}" style="--d:${f(-rnd() * 2)}s"` : '';
    let s = '';
    switch (c.element) {
      case 'fire':   // 촉 뒤로 끌리는 불꽃
        s += flame(c, x + 18, y - 2, 15 * sz, 5.5 * sz, 62, live ? 'wa-flick' : '') + flame(c, x + 20, y + 3, 10 * sz, 4 * sz, 104, live ? 'wa-flick' : '');
        break;
      case 'water':   // 촉에서 뒤로 길게 끌리는 물줄기 + 흩어지는 물방울
        s += fillOnly(ribbon(cubic([x + 16, y - 2], [x + 30, y - 12], [x + 44, y + 8], [x + 64, y - 4], 16), q => 6 * (1 - q) + .6), el.light, `opacity=".85" stroke="${el.dark}" stroke-width=".7" ${anim('wa-float')}`);
        [[x + 30, y + 9, 2.2], [x + 46, y - 10, 1.8], [x + 58, y + 7, 1.4]].forEach(([px, py, r]) => { s += droplet(px, py, r * sz, el.light, `stroke="${el.dark}" stroke-width=".6"`); });
        break;
      case 'earth':   // 촉에서 부서져 떨어지는 돌가루
        [[x + 12, y + 11, 3.4], [x + 22, y + 15, 2.6], [x + 6, y + 18, 2]].forEach(([px, py, r]) => { r *= sz; s += `<g ${anim('wa-bob')}>${shape(poly([[px - r, py], [px - r * .3, py - r], [px + r, py - r * .4], [px + r * .7, py + r * .8], [px - r * .5, py + r]]), el.main, 'stroke-width="1.2"')}</g>`; });
        s += `<ellipse cx="${f(x + 16)}" cy="${f(y)}" rx="${f(14 * sz)}" ry="${f(5 * sz)}" fill="${el.light}" opacity=".25"/>`;
        break;
      case 'wind':   // 화살 위아래로 갈라져 뒤로 말려드는 바람결
        [-1, 1].forEach(sd => {
          s += fillOnly(ribbon(cubic([x + 12, y + sd * 3], [x + 30, y + sd * 9], [x + 52, y + sd * 6], [x + 60, y - sd * 3], 14), q => 3.4 * Math.sin(Math.PI * Math.min(1, q * 1.1)) + .3), el.light, `opacity=".9" stroke="${el.dark}" stroke-width=".5" ${anim('wa-float')}`);
          s += fillOnly(ribbon(quad([x + 26, y + sd * 14], [x + 44, y + sd * 18], [x + 58, y + sd * 12], 10), q => 2.2 * Math.sin(Math.PI * q) + .2), el.light, 'opacity=".6"');
        });
        break;
      case 'thunder': {   // 촉에서 튀는 전기
        for (let i = 0; i < 3; i++) {
          const a = (-150 + i * 60 + (rnd() - .5) * 20) * Math.PI / 180, L = (10 + rnd() * 6) * sz;
          const pts = [[x + 6, y], [x + 6 + Math.cos(a) * L * .4 + 2, y + Math.sin(a) * L * .4 - 2], [x + 6 + Math.cos(a) * L * .7 - 2, y + Math.sin(a) * L * .7 + 2], [x + 6 + Math.cos(a) * L, y + Math.sin(a) * L]];
          s += `<g ${anim('wa-zap')}>${glowLine(c, pts, '#ffffff', el.main, 1)}</g>`;
        }
        break;
      }
      case 'ice':   // 촉을 덮은 서리 결정
        [[8, -4, -115, 8], [17, -7, -80, 10], [8, 4, 115, 8], [17, 7, 80, 10]].forEach(([dx, dy, deg, L]) => {
          const a = deg * Math.PI / 180, bx = x + dx, by = y + dy, nx = -Math.sin(a) * 2, ny = Math.cos(a) * 2;
          s += shape(poly([[bx + nx, by + ny], [bx + Math.cos(a) * L * sz, by + Math.sin(a) * L * sz], [bx - nx, by - ny]]), el.main, 'stroke-width="1.2"');
        });
        s += sparkle(x + 2, y - 7, 3.4 * sz, '#ffffff', `filter="url(#${id}-glow)" ${anim('wa-twinkle')}`);
        break;
      case 'light':   // 촉 끝의 섬광
        s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(7 * sz)}" fill="${el.light}" opacity=".55" filter="url(#${id}-glow)"/>`;
        s += sparkle(x, y, 9 * sz, '#ffffff', `filter="url(#${id}-glow)" ${anim('wa-twinkle')}`);
        break;
      case 'dark':   // 촉 뒤로 흩어지는 그림자 연기
        [-1, 1].forEach(sd => { s += fillOnly(ribbon(cubic([x + 14, y + sd * 3], [x + 26, y + sd * 12], [x + 38, y - sd * 2], [x + 52, y + sd * 10], 12), q => 5.5 * (1 - q) + .4), el.main, `opacity=".7" ${anim('wa-float')}`); });
        break;
      case 'poison':   // 촉에서 떨어지는 독
        s += fillOnly(`M${f(x + 12)} ${f(y + 4)} q2 6 0 9 a2.2 2.2 0 1 0 4 -1 q-1 -4 2 -8 Z`, el.main, `stroke="${el.dark}" stroke-width=".8"`);
        s += droplet(x + 14, y + 20, 2.2 * sz, el.main, `stroke="${el.dark}" stroke-width=".8" ${anim('wa-drip')}`);
        break;
    }
    return s;
  }

  // 방패(탱커): 나무 방패 → 강철+리벳 → 속성 재질 바탕 → 금테+날개 → 결정 테+후광
  //   한가운데 기호(문장)는 두지 않는다. 바탕 표면의 재질과 테두리 현상만으로 속성을 읽히게 한다
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
    // 바탕: 일반은 나무 판자에 속성다운 풍화(그을림·서리·이끼…), 희귀부터는 바탕 자체가 속성 재질
    let field = '';
    if (t === 0) field += [56, 72, 88, 104].map(x => strokeOnly(`M${x} 40 V200`, WOOD.lo, 1.6, 'opacity=".7"')).join('');
    field += surface(c, [40, 37, 120, 189], { kind: 'field', wood: t === 0, k: [.62, .74, .87, 1, 1][t], path: inner });
    // 테두리 아래로 파고든 그늘(바탕이 한 단 들어가 보이게) + 광택 사선
    field += strokeOnly(inner, '#000000', 8, 'opacity=".38"');
    field += fillOnly('M40 48 L72 40 L44 120 L40 110 Z', '#ffffff', `opacity="${t ? .1 : .07}"`);
    c.body.push(`<g clip-path="url(#${id}-field)">${field}</g>`);
    c.body.push(`<path d="${inner}" fill="none" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>`);
    if (t >= 2) c.body.push(strokeOnly(inner, m.trimHi, 1, 'opacity=".4" transform="translate(80 110) scale(.92) translate(-80 -110)"'));
    // 리벳
    if (t >= 1) [[36, 46], [124, 46], [33, 86], [127, 86], [44, 142], [116, 142], [80, 34]].forEach(([x, y]) => c.body.push(`<circle cx="${x}" cy="${y}" r="2.6" fill="${m.trimHi}" stroke="${OUT}" stroke-width="1"/>`));
    if (t >= 3) c.body.push(gem(c, 80, 34, 7));
    if (t === 4) [[24, 70], [136, 70], [80, 214]].forEach(([x, y]) => c.front.push(`<g class="wa-bob">${shape(poly([[x, y - 7], [x + 5, y], [x, y + 7], [x - 5, y]]), `url(#${id}-mL)`)}</g>`));
    // 속성 문양 자리: 테두리 둘레 — 위 테(불길이 피어오를 곳)와 아래 테(고드름·독이 매달릴 곳)까지 고르게
    [[56, 34, -.2, -1], [32, 60, -1, -.3], [31, 90, -1, 0], [36, 128, -1, .3], [49, 166, -.7, .6], [59, 180, -.6, .8], [80, 201, 0, 1],
      [101, 180, .6, .8], [111, 166, .7, .6], [124, 128, 1, .3], [129, 90, 1, 0], [128, 60, 1, -.3], [104, 34, .2, -1], [80, 30, 0, -1]]
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
    const shaftD = ribbon(shaft, q => 12 - q * 3);
    c.body.push(shape(shaftD, t >= 3 ? `url(#${id}-trimH)` : `url(#${id}-wood)`));
    if (t <= 2) {   // 나무 자루: 결 + 속성다운 풍화
      c.defs.push(`<clipPath id="${id}-shaft"><path d="${shaftD}"/></clipPath>`);
      c.body.push(strokeOnly(line(shaft.slice(1, 11).map(p => [p[0] - 2, p[1]])), WOOD.hi, 1, 'opacity=".5"'));
      c.body.push(`<g clip-path="url(#${id}-shaft)">${surface(c, [CX - 8, 78, CX + 10, 212], { kind: 'shaft', wood: true, k: [.6, .75, .9][t], path: shaftD, along: { pts: quad([CX, 78], [CX + 3, 145], [CX, 210], 40), w: 9 } })}</g>`);
      c.body.push(`<path d="${shaftD}" fill="none" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>`);
    }
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
    // 보주 속: 기호 대신 속성 그 자체가 갇혀 있다(용암 균열·물결·판석·소용돌이·플라스마·결정면·광휘·성운·거품)
    const orbD = `M${ox - r} ${oy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`;
    c.defs.push(`<clipPath id="${id}-orbC"><circle cx="${ox}" cy="${oy}" r="${r}"/></clipPath>`);
    c.body.push(shape(orbD, `url(#${id}-orb)`));
    c.body.push(`<g clip-path="url(#${id}-orbC)">${surface(c, [ox - r, oy - r, ox + r, oy + r], { kind: 'orb', k: [.62, .76, .9, 1, 1][t], path: orbD })}` +
      `<circle cx="${ox}" cy="${oy}" r="${r}" fill="none" stroke="#000000" stroke-width="5" opacity=".28"/></g>`);   // 가장자리 그늘 → 구체감
    c.body.push(`<path d="${orbD}" fill="none" stroke="${OUT}" stroke-width="2"/>`);
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
  const RISE = new Set(['fire', 'dark']), HANG = new Set(['ice', 'poison', 'water']);
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
      // 불·어둠은 위로 피어오르고, 얼음·독·물은 아래로 매달린다 → 그쪽 자리를 먼저 쓰고 모자라면 나머지에서 채운다
      const pref = RISE.has(c.element) ? a => a.ny <= .1 : HANG.has(c.element) ? a => a.ny >= .2 : () => true;
      const pool = anchors.filter(pref);
      const list = pool.length >= count ? pool : pool.concat(anchors.filter(a => !pref(a)).slice(0, count - pool.length));
      const step = list.length / count;
      for (let i = 0; i < count; i++) picks.push(list[Math.floor((i + rnd() * .6) * step) % list.length]);
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
        case 'ice': {
          if (a.ny > .2) {   // 아래쪽 테두리: 고드름이 수직으로 매달린다
            const L = (9 + rnd() * 8) * sz, w = 2.2 * sz;
            out.push(shape(poly([[a.x - w, a.y - 1], [a.x + w, a.y - 1], [a.x + (rnd() - .5) * 2, a.y + L]]), el.main, 'stroke-width="1"') + strokeOnly(line([[a.x - w * .35, a.y], [a.x, a.y + L * .8]]), '#fff', 1, 'opacity=".9"'));
            break;
          }
          // 옆·위 테두리: 결정 세 갈래가 바깥으로 자란다(가운데 길게, 양옆 짧게)
          const L = (8 + rnd() * 6) * sz, base = Math.atan2(a.ny, a.nx);
          // 밑동을 접선 방향으로 조금씩 벌려 화살표처럼 한 점에 모이지 않게 한다
          [[-.45, .62, 2.6, -3.5], [.4, .55, 2.4, 3.5], [0, 1, 3.2, 0]].forEach(([da, k, w, off]) => {
            const an = base + da, bx = a.x - Math.sin(base) * off, by = a.y + Math.cos(base) * off;
            const tip = [bx + Math.cos(an) * L * k, by + Math.sin(an) * L * k], px = -Math.sin(an) * w, py = Math.cos(an) * w;
            out.push(fillOnly(poly([[bx + px, by + py], tip, [bx - px, by - py]]), k === 1 ? el.main : el.light, `stroke="${el.dark}" stroke-width=".8" stroke-linejoin="round" opacity=".92"`) + (k === 1 ? strokeOnly(line([[bx, by], tip]), '#fff', .9, 'opacity=".9"') : ''));
          });
          break; }
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

  /* ---------- 💎 프리즘(초월한 ★ 무기) ----------
   * 모양은 초월 등급 그대로 쓰고(가장 화려한 실루엣), 그 위에
   *  ① 무지개 고리 3겹(서로 다른 속도로 돈다) ② 무기 표면을 훑고 지나가는 홀로그램 광택(몸체 모양으로 가린다)
   *  ③ 무지갯빛 반짝이 를 얹는다. 속성 색 오라는 그대로 둬서 '어떤 속성의 프리즘인지' 는 보인다. */
  function prismLayers(c) {
    const { id, rnd } = c, [cx, cy] = [f(c.core[0]), f(c.core[1])];
    c.under.push(`<g class="wa-spin" style="transform-origin:${cx}px ${cy}px">` +
      RAINBOW.map((col, i) => `<circle cx="${cx}" cy="${cy}" r="72" fill="none" stroke="${col}" stroke-width="2.2" stroke-dasharray="18 ${f(18 * (RAINBOW.length - 1))}" stroke-dashoffset="${f(-18 * i)}" opacity=".75"/>`).join('') + '</g>' +
      `<g class="wa-spin-r" style="transform-origin:${cx}px ${cy}px"><circle cx="${cx}" cy="${cy}" r="80" fill="none" stroke="#ffffff" stroke-width="1" stroke-dasharray="1 9" opacity=".7"/></g>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="70" ry="88" fill="url(#${id}-holoGlow)" class="wa-hue"/>`);
    c.defs.push(
      `<radialGradient id="${id}-holoGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset=".5" stop-color="#9fe8ff" stop-opacity=".18"/><stop offset="1" stop-color="#ff9ad5" stop-opacity="0"/></radialGradient>`,
      `<linearGradient id="${id}-holo" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="#ffffff" stop-opacity="0"/>` + RAINBOW.map((col, i) => `<stop offset="${f((.3 + i * .07) * 100) / 100}" stop-color="${col}" stop-opacity=".9"/>`).join('') +
        `<stop offset=".78" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`,
      // 몸체 그림을 밝기 마스크로 — 밝은 금속면에만 광택이 지나간다(검은 외곽선은 가려짐)
      `<mask id="${id}-holoM" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><g>${c.body.join('')}</g></mask>`);
    c.front.push(`<g mask="url(#${id}-holoM)" style="mix-blend-mode:screen"><rect class="wa-holo" x="${-W}" y="0" width="${W * 2}" height="${H}" fill="url(#${id}-holo)" opacity=".85"/></g>`);
    let sp = '';
    for (let i = 0; i < 9; i++) {
      const x = 14 + rnd() * (W - 28), y = 14 + rnd() * (H - 28);
      sp += sparkle(x, y, 2.4 + rnd() * 2.6, RAINBOW[i % RAINBOW.length], `class="wa-twinkle" style="--d:${f(-rnd() * 3)}s"`);
    }
    c.front.push(sp);
  }

  /* ---------- 진입점 ---------- */
  function svg(opts) {
    const o = opts || {};
    const tier = TIERS[o.grade] ?? 0, prism = tier === 5;
    const t = Math.min(tier, 4);   // 모양·장식은 초월(4)까지 — 프리즘은 그 위에 무지갯빛을 더 얹는다
    const element = ELEMENTS[o.element] ? o.element : 'fire';
    const cls = SHAPES[o.cls] ? o.cls : 'warrior';
    const c = {
      t, prism, element, el: ELEMENTS[element], m: METALS[tier], id: 'wa' + (++uid),
      rnd: rng(cls + '|' + element + '|' + tier), sid: 0, defs: [], under: [], back: [], body: [], front: [], anchors: [], core: [CX, H / 2], tip: [CX, 12],
    };
    defs(c);
    SHAPES[cls](c);
    aura(c, f(c.core[0]), f(c.core[1]));
    motif(c);
    particles(c);
    if (prism) prismLayers(c);
    const label = (o.label || '') || `${ELEMENTS[element].name} 속성 무기`;
    return `<svg class="wa wa-t${tier}${prism ? ' wa-prism' : ''}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label.replace(/"/g, '&quot;')}">` +
      `<defs>${c.defs.join('')}</defs>${c.under.join('')}${c.back.join('')}${c.body.join('')}${c.front.join('')}</svg>`;
  }

  window.WeaponArt = { svg, ELEMENTS: Object.keys(ELEMENTS), GRADES: Object.keys(TIERS), CLASSES: Object.keys(SHAPES) };
})();
