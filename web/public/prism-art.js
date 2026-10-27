/*!
 * prism-art.js — 💎 프리즘 탭 그림. 이미지 파일 없이 SVG 문자열로 그린다(weapon-art.js 와 같은 방식).
 *
 *   PrismArt.chest(i)         상자 3종(루비·사파이어·에메랄드). 닫힌 뚜껑·열린 뚜껑을 둘 다 담아 두고 CSS 로 바꾼다
 *   PrismArt.icon(reward)     보상 아이콘 — 프리즘 결정·금화·마석·부스트·방지권·빈 캡슐
 *   PrismArt.cauldron()       연금술 도가니(마법진·장작불·끓는 물약·김)
 *   PrismArt.machine()        캡슐 뽑기 기계(유리 돔·캡슐·손잡이·배출구)
 *   PrismArt.capsule(tier)    캡슐 하나(위·아래 반쪽이 따로 움직인다). tier 0~5 = 등급색
 *   PrismArt.tierOf(reward)   보상 → 연출 등급 0(꽝)~5(대박)
 *
 * 움직이는 부품에는 클래스가 붙어 있고, 애니메이션은 style.css 의 .pc-* · .pa-* · .pm-* · .cp-* 가 맡는다.
 * 같은 그림을 한 화면에 여러 번 넣으므로 gradient id 는 매번 새로 만든다.
 */
(function () {
  'use strict';

  const OUT = '#170f0a';   // 외곽선 — 무기 그림과 같은 진한 테두리
  let uid = 0;
  const nid = p => p + (++uid).toString(36);

  /* ---------- 📦 상자 ---------- */
  const GOLD = { hi: '#fff1c4', m: '#e0aa45', lo: '#7a4f17' };
  const SILVER = { hi: '#ffffff', m: '#b9c4d2', lo: '#55606f' };
  const CHESTS = [
    { name: '루비 상자', wood: '#8a2b22', hi: '#bd4a3a', lo: '#4a1410', inner: '#240907', metal: GOLD, gem: '#ff4d6d', gemHi: '#ffd6de', gemLo: '#8e0f2c', glow: '#ff7a8f' },
    { name: '사파이어 상자', wood: '#1f3d70', hi: '#3c6bb3', lo: '#0f2145', inner: '#081225', metal: SILVER, gem: '#3aa0ff', gemHi: '#e0f1ff', gemLo: '#0b4596', glow: '#7cc8ff' },
    { name: '에메랄드 상자', wood: '#1d5c3b', hi: '#36905f', lo: '#0e3120', inner: '#061a10', metal: GOLD, gem: '#33d17a', gemHi: '#dcffe9', gemLo: '#0a6532', glow: '#6ff2a8' },
  ];
  const LID = 'M15 63 V49 C15 31 31 26 60 26 C89 26 105 31 105 49 V63 Z';
  const LID_OPEN = 'M16 63 L21 23 Q60 13 99 23 L104 63 Z';

  function rivets(xs, ys, m) {
    let s = '';
    for (const x of xs) for (const y of ys) s += `<circle cx="${x}" cy="${y}" r="1.7" fill="${m.hi}" stroke="${OUT}" stroke-width=".8"/>`;
    return s;
  }

  function chest(i) {
    const t = CHESTS[i % CHESTS.length], m = t.metal, id = nid('pc');
    const strap = (x, y0, y1) => `<rect x="${x}" y="${y0}" width="10" height="${y1 - y0}" fill="url(#${id}m)"/><path d="M${x + .8} ${y0} V${y1} M${x + 9.2} ${y0} V${y1}" stroke="${OUT}" stroke-width="1" opacity=".55"/>`;
    return `<svg class="pchest" viewBox="0 6 120 114" aria-hidden="true">
  <defs>
    <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.hi}"/><stop offset=".5" stop-color="${t.wood}"/><stop offset="1" stop-color="${t.lo}"/></linearGradient>
    <linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${m.hi}"/><stop offset=".45" stop-color="${m.m}"/><stop offset="1" stop-color="${m.lo}"/></linearGradient>
    <linearGradient id="${id}in" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.lo}"/><stop offset="1" stop-color="${t.inner}"/></linearGradient>
    <radialGradient id="${id}g"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="${t.glow}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}gem" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${t.gemHi}"/><stop offset=".45" stop-color="${t.gem}"/><stop offset="1" stop-color="${t.gemLo}"/></radialGradient>
    <clipPath id="${id}cl"><path d="${LID}"/></clipPath>
    <clipPath id="${id}co"><path d="${LID_OPEN}"/></clipPath>
    <clipPath id="${id}cb"><rect x="15" y="62" width="90" height="44" rx="5"/></clipPath>
  </defs>
  <ellipse class="pc-shadow" cx="60" cy="110" rx="47" ry="5.5" fill="#000" opacity=".42"/>

  <g class="pc-lid-open">
    <path d="${LID_OPEN}" fill="url(#${id}in)"/>
    <g clip-path="url(#${id}co)">
      <path d="M22 50 Q60 44 98 50 M23 37 Q60 31 97 37" fill="none" stroke="${t.lo}" stroke-width="1.6" opacity=".9"/>
      ${strap(27, 10, 64)}${strap(83, 10, 64)}
      <path d="M16 63 L21 23 Q60 13 99 23 L104 63" fill="none" stroke="url(#${id}m)" stroke-width="7"/>
    </g>
    <path d="${LID_OPEN}" fill="none" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>
  </g>
  <ellipse class="pc-mouth" cx="60" cy="63" rx="44" ry="7" fill="url(#${id}g)"/>

  <g class="pc-body">
    <rect x="15" y="62" width="90" height="44" rx="5" fill="url(#${id}w)"/>
    <g clip-path="url(#${id}cb)">
      <path d="M15 77 H105 M15 92 H105" stroke="${t.lo}" stroke-width="1.6"/>
      <path d="M15 78.6 H105 M15 93.6 H105" stroke="#fff" stroke-width=".8" opacity=".12"/>
      ${strap(27, 62, 106)}${strap(83, 62, 106)}
      <rect x="15" y="99" width="90" height="7" fill="url(#${id}m)"/>
      <path d="M15 99 H105" stroke="${OUT}" stroke-width="1"/>
      <rect x="15" y="62" width="90" height="3" fill="#fff" opacity=".13"/>
      ${rivets([32, 88], [70, 85], m)}
    </g>
    <rect x="15" y="62" width="90" height="44" rx="5" fill="none" stroke="${OUT}" stroke-width="2.5"/>
    <path d="M49 62 H71 V75 Q71 84 60 88 Q49 84 49 75 Z" fill="url(#${id}m)" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>
    <path class="pc-gem" d="M60 65 L67.5 73 L60 84 L52.5 73 Z" fill="url(#${id}gem)" stroke="${OUT}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M52.5 73 H67.5 M56 73 L60 65 L64 73 M56 73 L60 84 L64 73" fill="none" stroke="${t.gemHi}" stroke-width=".7" opacity=".55"/>
    <path d="M57 68.5 L59 66.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>
  </g>

  <rect class="pc-seam" x="17" y="59.5" width="86" height="5" rx="2.5" fill="${t.glow}"/>

  <g class="pc-lid">
    <path d="${LID}" fill="url(#${id}w)"/>
    <g clip-path="url(#${id}cl)">
      <path d="M15 50 C30 41 90 41 105 50 M15 39 C34 31 86 31 105 39" fill="none" stroke="${t.lo}" stroke-width="1.6"/>
      <path d="M16 51.6 C31 42.6 89 42.6 104 51.6" fill="none" stroke="#fff" stroke-width=".8" opacity=".12"/>
      ${strap(27, 20, 64)}${strap(83, 20, 64)}
      <rect x="15" y="56" width="90" height="7" fill="url(#${id}m)"/>
      <path d="M15 56 H105" stroke="${OUT}" stroke-width="1"/>
      <path d="M22 44 C24 35 36 31 52 30" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".22"/>
      ${rivets([32, 88], [40], m)}
    </g>
    <path d="${LID}" fill="none" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="55" y="54" width="10" height="11" rx="2" fill="url(#${id}m)" stroke="${OUT}" stroke-width="1.6"/>
  </g>
</svg>`;
  }

  /* ---------- 보상 아이콘 ---------- */
  // 프리즘 결정: 브릴리언트 컷. 한쪽 면에만 무지개(분광)를 얹어 '프리즘' 느낌을 낸다
  function prismGem(id) {
    return `<defs>
      <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9fdff"/><stop offset=".5" stop-color="#7df9ff"/><stop offset="1" stop-color="#5b8cff"/></linearGradient>
      <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9be7ff"/><stop offset="1" stop-color="#7a5cf0"/></linearGradient>
      <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7ab6"/><stop offset=".33" stop-color="#ffe27a"/><stop offset=".66" stop-color="#7affc1"/><stop offset="1" stop-color="#7ab8ff"/></linearGradient>
    </defs>
    <path d="M20 14 H44 L57 27 L32 57 L7 27 Z" fill="url(#${id}b)"/>
    <path d="M20 14 H44 L50 27 H14 Z" fill="url(#${id}a)"/>
    <path d="M14 27 L32 57 L7 27 Z" fill="#a9f3ff" opacity=".9"/>
    <path d="M50 27 L32 57 L57 27 Z" fill="#6a4fe0" opacity=".85"/>
    <path d="M14 27 H50 L32 57 Z" fill="url(#${id}r)" opacity=".45"/>
    <path d="M20 14 L14 27 M44 14 L50 27 M32 14 L26 27 M32 14 L38 27 M26 27 L32 57 L38 27" fill="none" stroke="#fff" stroke-width="1" opacity=".55"/>
    <path d="M20 14 H44 L57 27 L32 57 L7 27 Z M7 27 H57" fill="none" stroke="${OUT}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M22 18 L28 18" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  function coins(id) {
    const coin = (x, y) => `<ellipse cx="${x}" cy="${y + 3}" rx="14" ry="6" fill="#9a6418" stroke="${OUT}" stroke-width="2"/><ellipse cx="${x}" cy="${y}" rx="14" ry="6" fill="url(#${id}c)" stroke="${OUT}" stroke-width="2"/><ellipse cx="${x}" cy="${y}" rx="8.5" ry="3.4" fill="none" stroke="#9a6418" stroke-width="1.3"/>`;
    return `<defs><linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#f2c14e"/><stop offset="1" stop-color="#c98a1c"/></linearGradient></defs>
      ${coin(24, 46)}${coin(40, 48)}${coin(32, 39)}${coin(32, 31)}
      <circle cx="32" cy="17" r="12" fill="url(#${id}c)" stroke="${OUT}" stroke-width="2.2"/>
      <circle cx="32" cy="17" r="7.5" fill="none" stroke="#9a6418" stroke-width="1.4"/>
      <path d="M32 11.5 L33.6 15.4 L37.6 15.6 L34.5 18.1 L35.5 22 L32 19.8 L28.5 22 L29.5 18.1 L26.4 15.6 L30.4 15.4 Z" fill="#9a6418"/>
      <path d="M25 12 Q27 8.5 31 7.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`;
  }
  function stone(id) {
    return `<defs><radialGradient id="${id}s" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#f3dcff"/><stop offset=".4" stop-color="#b06cf2"/><stop offset="1" stop-color="#3d1673"/></radialGradient></defs>
      <path d="M32 6 L49 18 L54 38 L40 56 L22 55 L10 38 L15 17 Z" fill="url(#${id}s)" stroke="${OUT}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M32 6 L30 26 L15 17 M30 26 L49 18 M30 26 L42 40 L54 38 M42 40 L40 56 M30 26 L22 41 L10 38 M22 41 L22 55 M22 41 L42 40" fill="none" stroke="#f3dcff" stroke-width="1" opacity=".45"/>
      <circle cx="31" cy="33" r="7" fill="#fff" opacity=".18"/>
      <path d="M21 17 L26 13" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>`;
  }
  function clover(id) {
    const leaf = r => `<path transform="rotate(${r} 32 30)" d="M32 30 C22 26 18 14 25 10 C29 8 32 11 32 14 C32 11 35 8 39 10 C46 14 42 26 32 30 Z" fill="url(#${id}g)" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>`;
    return `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b7f59a"/><stop offset="1" stop-color="#2f9a44"/></linearGradient></defs>
      <path d="M32 32 Q34 46 26 56" fill="none" stroke="${OUT}" stroke-width="5" stroke-linecap="round"/><path d="M32 32 Q34 46 26 56" fill="none" stroke="#3aa64c" stroke-width="2.6" stroke-linecap="round"/>
      ${leaf(0)}${leaf(90)}${leaf(180)}${leaf(270)}<circle cx="32" cy="30" r="2.6" fill="#e9ffd6"/>`;
  }
  function shield(id) {
    return `<defs><linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef6ff"/><stop offset=".5" stop-color="#8fb6d8"/><stop offset="1" stop-color="#3f5f86"/></linearGradient></defs>
      <path d="M32 6 L53 13 V30 C53 44 44 53 32 58 C20 53 11 44 11 30 V13 Z" fill="url(#${id}h)" stroke="${OUT}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M32 12 L47 17 V30 C47 40 41 47 32 51 C23 47 17 40 17 30 V17 Z" fill="none" stroke="#fff" stroke-width="1.4" opacity=".5"/>
      <path d="M32 20 V44 M22 30 H42" stroke="#e0aa45" stroke-width="4" stroke-linecap="round"/><path d="M32 20 V44 M22 30 H42" stroke="${OUT}" stroke-width="1" stroke-linecap="round" opacity=".35"/>`;
  }
  function puff() {
    return `<g fill="#6f6a66" stroke="${OUT}" stroke-width="2"><circle cx="22" cy="38" r="10"/><circle cx="42" cy="38" r="10"/><circle cx="32" cy="29" r="12"/></g>
      <g fill="#a39d97"><circle cx="22" cy="37" r="7"/><circle cx="42" cy="37" r="7"/><circle cx="32" cy="28" r="9"/></g>
      <path d="M26 24 Q29 20 33 20" fill="none" stroke="#d9d3cc" stroke-width="2" stroke-linecap="round"/>`;
  }
  // reward = { kind: 'prism'|'gold'|'item'|'none', item?, n }
  function icon(reward, cls) {
    const r = reward || {}, id = nid('pi');
    let body;
    if (r.kind === 'prism') body = prismGem(id);
    else if (r.kind === 'gold') body = coins(id);
    else if (r.kind === 'item' && r.item === 'stone') body = stone(id);
    else if (r.kind === 'item' && r.item === 'boost') body = clover(id);
    else if (r.kind === 'item' && r.item === 'protect') body = shield(id);
    else body = puff();
    return `<svg class="picon${cls ? ' ' + cls : ''}" viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
  }

  // 연출 등급: 0 꽝 · 1 흔함 · 2 괜찮음 · 3 좋음 · 4 대성공 · 5 대박
  function tierOf(r) {
    if (!r || r.kind === 'none') return 0;
    if (r.kind === 'prism') return r.n >= 15 ? 5 : r.n >= 10 ? 4 : r.n >= 5 ? 4 : r.n >= 2 ? 3 : 2;
    if (r.kind === 'gold') return r.n >= 50000 ? 2 : 1;
    if (r.kind === 'item') return r.item === 'protect' ? 2 : 1;
    return 1;
  }

  /* ---------- ⚗️ 도가니 ---------- */
  // 불(.pa-flames)은 도가니 '앞'에 그린다 — 약불은 바닥만 핥고, 강불은 배까지 감싸 오른다(CSS 가 불 세기별로 키운다)
  function cauldron() {
    const id = nid('pa');
    const runes = Array.from({ length: 12 }, (_, k) => {
      const a = k / 12 * Math.PI * 2, x = 110 + Math.cos(a) * 82, y = 164 + Math.sin(a) * 14;
      return `<path d="M${(x - 3).toFixed(1)} ${(y - 2).toFixed(1)} L${x.toFixed(1)} ${(y + 2).toFixed(1)} L${(x + 3).toFixed(1)} ${(y - 2).toFixed(1)}" />`;
    }).join('');
    const flame = (cls, d, fill) => `<path class="${cls}" d="${d}" fill="${fill}"/>`;
    return `<svg class="pcauldron" viewBox="0 0 220 186" aria-hidden="true">
  <defs>
    <radialGradient id="${id}iron" cx=".32" cy=".25" r=".85"><stop offset="0" stop-color="#5b534c"/><stop offset=".45" stop-color="#2a2420"/><stop offset="1" stop-color="#0d0a08"/></radialGradient>
    <linearGradient id="${id}br" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a8"/><stop offset=".5" stop-color="#d4a24c"/><stop offset="1" stop-color="#6e4614"/></linearGradient>
    <radialGradient id="${id}liq" cx=".5" cy=".4" r=".7"><stop offset="0" style="stop-color:var(--liq-hi, #e6fffb)"/><stop offset=".45" style="stop-color:var(--liq, #43e6c8)"/><stop offset="1" style="stop-color:var(--liq-lo, #155e6e)"/></radialGradient>
    <radialGradient id="${id}glow"><stop offset="0" style="stop-color:var(--liq, #43e6c8)" stop-opacity=".5"/><stop offset="1" style="stop-color:var(--liq, #43e6c8)" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}heat" cx=".5" cy="1" r=".9"><stop offset="0" stop-color="#ff8a2a" stop-opacity=".55"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient>
    <clipPath id="${id}lc"><ellipse cx="110" cy="58" rx="60" ry="8.5"/></clipPath>
  </defs>
  <g class="pa-circle" fill="none" style="stroke:var(--liq, #43e6c8)">
    <ellipse cx="110" cy="164" rx="96" ry="18" stroke-width="1.6"/>
    <ellipse cx="110" cy="164" rx="72" ry="12" stroke-width="1" stroke-dasharray="4 5"/>
    <g stroke-width="1.4">${runes}</g>
  </g>
  <ellipse class="pa-aura" cx="110" cy="58" rx="94" ry="40" fill="url(#${id}glow)"/>

  <path d="M66 118 L56 158 M154 118 L164 158 M110 128 V160" stroke="${OUT}" stroke-width="9" stroke-linecap="round"/>
  <path d="M66 118 L56 158 M154 118 L164 158 M110 128 V160" stroke="#3a332d" stroke-width="5" stroke-linecap="round"/>
  <path d="M68 170 L152 156 M68 156 L152 170" stroke="${OUT}" stroke-width="11" stroke-linecap="round"/>
  <path d="M68 170 L152 156 M68 156 L152 170" stroke="#6b4426" stroke-width="7" stroke-linecap="round"/>
  <ellipse class="pa-heat" cx="110" cy="150" rx="70" ry="34" fill="url(#${id}heat)"/>

  <g class="pa-pot">
    <path d="M36 72 a11 11 0 1 1 0 22" fill="none" stroke="${OUT}" stroke-width="7"/><path d="M36 72 a11 11 0 1 1 0 22" fill="none" stroke="url(#${id}br)" stroke-width="3.5"/>
    <path d="M184 72 a11 11 0 1 0 0 22" fill="none" stroke="${OUT}" stroke-width="7"/><path d="M184 72 a11 11 0 1 0 0 22" fill="none" stroke="url(#${id}br)" stroke-width="3.5"/>
    <path d="M42 60 C22 90 34 134 110 136 C186 134 198 90 178 60 Z" fill="url(#${id}iron)" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M39 79 C72 89 148 89 181 79 L182 87 C148 97 72 97 38 87 Z" fill="url(#${id}br)" stroke="${OUT}" stroke-width="2"/>
    <path d="M52 98 C56 116 70 126 88 130" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".12"/>
    <path d="M47 82 C47 74 52 68 60 66" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".18"/>
    <ellipse cx="110" cy="58" rx="73" ry="13.5" fill="url(#${id}br)" stroke="${OUT}" stroke-width="3"/>
    <ellipse class="pa-liquid" cx="110" cy="58" rx="60" ry="8.5" fill="url(#${id}liq)" stroke="${OUT}" stroke-width="2"/>
    <g clip-path="url(#${id}lc)" class="pa-swirl" fill="none" style="stroke:var(--liq-hi, #e6fffb)" stroke-width="1.4" opacity=".6">
      <path d="M70 58 Q90 52 110 58 T150 58"/><path d="M84 62 Q100 57 116 62 T146 61"/>
    </g>
  </g>
  <g class="pa-bubbles" style="fill:var(--liq-hi, #e6fffb);stroke:var(--liq, #43e6c8)" stroke-width="1">
    <circle class="pa-b1" cx="86" cy="56" r="4"/><circle class="pa-b2" cx="118" cy="54" r="5"/><circle class="pa-b3" cx="140" cy="58" r="3.4"/><circle class="pa-b4" cx="102" cy="60" r="3"/>
  </g>
  <g class="pa-steam" fill="none" stroke="#e8e2da" stroke-width="3" stroke-linecap="round" opacity=".35">
    <path class="pa-s1" d="M92 44 C86 36 98 30 92 20"/><path class="pa-s2" d="M124 42 C118 34 130 28 124 16"/>
  </g>
  <g class="pa-flames">
    ${flame('pa-f1', 'M62 166 C56 146 68 136 70 120 C78 132 78 140 86 136 C88 124 92 114 98 104 C104 118 106 128 112 130 C118 124 120 112 126 102 C132 116 132 128 138 132 C144 126 146 122 150 114 C156 132 166 148 158 166 Z', '#e0560f')}
    ${flame('pa-f2', 'M72 166 C68 150 78 142 80 132 C86 140 88 144 92 140 C94 130 98 124 102 116 C106 128 108 136 114 138 C118 130 120 124 124 118 C128 130 130 138 136 140 C140 136 142 132 144 128 C150 142 152 154 148 166 Z', '#ff9a3c')}
    ${flame('pa-f3', 'M86 166 C84 156 90 150 92 142 C96 148 98 150 100 146 C102 140 106 136 108 132 C112 140 114 146 118 148 C120 144 122 142 124 138 C130 148 134 156 132 166 Z', '#ffe7a0')}
  </g>
</svg>`;
  }

  /* ---------- 🧸 캡슐 ---------- */
  // 등급색: 0 회색 · 1 쇳물 주황 · 2 하늘 · 3 보라 · 4 황금 · 5 프리즘(무지개)
  const CAP = [
    { top: '#9a9590', hi: '#e2ddd6', lo: '#5b5651' },
    { top: '#ff7a1a', hi: '#ffd27a', lo: '#a8380a' },
    { top: '#38b6ff', hi: '#c9f0ff', lo: '#135a9e' },
    { top: '#a66cff', hi: '#e8d6ff', lo: '#4b1f9e' },
    { top: '#ffc53d', hi: '#fff4c4', lo: '#a86a00' },
    { top: '#ff7ab6', hi: '#ffffff', lo: '#5b8cff', rainbow: true },
  ];
  function capsule(tier) {
    const c = CAP[Math.max(0, Math.min(5, tier | 0))], id = nid('cp');
    const topFill = c.rainbow ? `url(#${id}rb)` : `url(#${id}t)`;
    return `<svg class="pcapsule t${tier | 0}" viewBox="0 0 48 48" aria-hidden="true">
  <defs>
    <radialGradient id="${id}t" cx=".35" cy=".25" r=".9"><stop offset="0" stop-color="${c.hi}"/><stop offset=".5" stop-color="${c.top}"/><stop offset="1" stop-color="${c.lo}"/></radialGradient>
    <linearGradient id="${id}rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ab6"/><stop offset=".3" stop-color="#ffe27a"/><stop offset=".55" stop-color="#7affc1"/><stop offset=".8" stop-color="#7ab8ff"/><stop offset="1" stop-color="#b27aff"/></linearGradient>
    <radialGradient id="${id}b" cx=".4" cy=".2" r=".9"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#ece4d8"/><stop offset="1" stop-color="#a99c8a"/></radialGradient>
  </defs>
  <g class="cp-bot"><path d="M6 24 A18 18 0 0 0 42 24 Z" fill="url(#${id}b)" stroke="${OUT}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M12 31 Q18 38 26 39" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".7"/></g>
  <g class="cp-top"><path d="M6 24 A18 18 0 0 1 42 24 Z" fill="${topFill}" stroke="${OUT}" stroke-width="2.2" stroke-linejoin="round"/>
    <rect x="5" y="21.5" width="38" height="5" rx="2" fill="${c.lo}" stroke="${OUT}" stroke-width="1.8"/>
    <path d="M12 15 Q16 9 23 8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".85"/></g>
</svg>`;
  }

  function machine() {
    const id = nid('pm');
    const balls = [[46, 108, 0, 1], [68, 118, 40, 2], [92, 120, -30, 1], [114, 110, 80, 3], [36, 90, 25, 2], [57, 98, 70, 3], [80, 100, 15, 0], [103, 96, -60, 2], [124, 92, 10, 1], [48, 76, -40, 4], [70, 80, -20, 1], [94, 78, 50, 3], [116, 74, 20, 1], [82, 60, -10, 2]];
    const ball = ([x, y, r, tier], k) => {
      const c = CAP[tier];
      return `<g class="pm-ball pm-b${k}" style="--bx:${x}px;--by:${y}px"><g transform="translate(${x} ${y}) rotate(${r})">
        <path d="M-11 0 A11 11 0 0 1 11 0 Z" fill="${c.top}" stroke="${OUT}" stroke-width="1.6"/><path d="M-11 0 A11 11 0 0 0 11 0 Z" fill="#efe7da" stroke="${OUT}" stroke-width="1.6"/>
        <path d="M-6 -5 Q-3 -8.5 1 -9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".8"/></g></g>`;
    };
    return `<svg class="pmachine" viewBox="0 0 160 220" aria-hidden="true">
  <defs>
    <radialGradient id="${id}gl" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#eaf6ff" stop-opacity=".22"/><stop offset=".7" stop-color="#9fd2ff" stop-opacity=".06"/><stop offset="1" stop-color="#9fd2ff" stop-opacity=".2"/></radialGradient>
    <linearGradient id="${id}bd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6e1c12"/><stop offset=".35" stop-color="#b8361f"/><stop offset=".7" stop-color="#9b2a18"/><stop offset="1" stop-color="#561208"/></linearGradient>
    <linearGradient id="${id}br" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a8"/><stop offset=".5" stop-color="#d4a24c"/><stop offset="1" stop-color="#6e4614"/></linearGradient>
    <radialGradient id="${id}kn" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff1c4"/><stop offset=".5" stop-color="#d4a24c"/><stop offset="1" stop-color="#6e4614"/></radialGradient>
    <clipPath id="${id}cg"><circle cx="80" cy="82" r="52"/></clipPath>
  </defs>
  <ellipse cx="80" cy="212" rx="62" ry="6" fill="#000" opacity=".4"/>
  <g class="pm-shell">
    <path d="M66 22 Q80 8 94 22 Z" fill="url(#${id}br)" stroke="${OUT}" stroke-width="2"/>
    <path class="pm-topgem" d="M80 4 L86 11 L80 19 L74 11 Z" fill="#7df9ff" stroke="${OUT}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="80" cy="82" r="56" fill="#1a1512" stroke="${OUT}" stroke-width="3"/>
    <g clip-path="url(#${id}cg)" class="pm-balls">${balls.map(ball).join('')}</g>
    <circle cx="80" cy="82" r="56" fill="url(#${id}gl)"/>
    <path d="M38 62 Q48 36 76 30" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".28"/>
    <path d="M118 100 Q114 114 102 122" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".18"/>
    <circle cx="80" cy="82" r="56" fill="none" stroke="#c9d3de" stroke-width="3.5"/>
    <circle cx="80" cy="82" r="56" fill="none" stroke="${OUT}" stroke-width="1" opacity=".6"/>
    <rect x="40" y="132" width="80" height="10" rx="3" fill="url(#${id}br)" stroke="${OUT}" stroke-width="2"/>
    <path d="M22 142 H138 L132 204 H28 Z" fill="url(#${id}bd)" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M26 150 H134" stroke="#ffb27a" stroke-width="1.5" opacity=".35"/>
    <rect x="18" y="200" width="124" height="9" rx="3" fill="url(#${id}br)" stroke="${OUT}" stroke-width="2"/>
    <rect x="108" y="156" width="16" height="22" rx="3" fill="#2b1a10" stroke="url(#${id}br)" stroke-width="2"/>
    <rect x="114" y="160" width="4" height="12" rx="2" fill="#0b0706"/>
    <g class="pm-chute"><rect x="32" y="176" width="34" height="22" rx="5" fill="#0b0706" stroke="url(#${id}br)" stroke-width="2.5"/>
      <path class="pm-flap" d="M34 178 H64 V186 H34 Z" fill="#3a2418" stroke="${OUT}" stroke-width="1.2"/></g>
  </g>
  <g class="pm-crank">
    <circle cx="84" cy="168" r="17" fill="url(#${id}kn)" stroke="${OUT}" stroke-width="2.4"/>
    <circle cx="84" cy="168" r="11" fill="none" stroke="#6e4614" stroke-width="1.4"/>
    <rect x="70" y="164" width="28" height="8" rx="4" fill="#fff1c4" stroke="${OUT}" stroke-width="2"/>
    <circle cx="84" cy="168" r="3" fill="#6e4614"/>
  </g>
</svg>`;
  }

  window.PrismArt = { CHESTS, chest, icon, tierOf, cauldron, capsule, machine };
})();
