'use strict';
/* ---------- 상태 ---------- */
let token = localStorage.getItem('token') || null;
let me = null;
let currentTab = 'rank';

/* 업데이트 패치노트 — 업데이트할 때마다 version 을 올리고 notes 를 갱신하면
   유저에게 '버전당 1회' 안내창이 뜬다. (닫기 버튼은 아래 PATCH_DELAY 초 후 활성화) */
const PATCH = {
  version: '6',
  title: '🌌 초월 던전 · 💎 프리즘 업데이트',
  notes: [
    '🌌 <b>초월 던전</b> — ★1 무기가 있으면 레이드 탭에서 입장! 혼자 연타로 층을 올라요. 매주 월요일 초기화되고 <b>층마다 보스 속성이 매주 바뀌어요</b>(지난주 기록 −5층까지 자동 소탕)',
    '🔁 <b>속성 상성</b> — 💧물→🔥불→❄️얼음→🌪️바람→☠️독→⛰️대지→⚡번개→💧물 순서로 앞이 뒤를 이기고, ✨빛⇄🌑어둠은 서로 강해요. 이기면 피해 <b>×2</b>, 지면 <b>×0.5</b>',
    '🗡️ <b>깊은 층일수록 무기가 더 필요해요</b> — 16층부터 2자루·31층부터 3자루·46층부터 4자루. 전투 중에 보스 속성이 바뀌면 <b>약점 무기로 바꿔 끼며</b> 싸워요',
    '✨ <b>속성 스킬</b> — ★1 이상 무기는 직업 스킬과 별도로 무기 속성의 스킬을 1회 써요(🔥화염 폭발 · ❄️빙결 · ☠️맹독 등)',
    '🔁 <b>속성 재련권</b> — 직업 변경권 자리를 대신해요. 🟣에픽(+25) 이상 무기의 속성을 다시 뽑고, 대신 강화 수치의 10%가 깎여요. 갖고 있던 직업 변경권은 자동으로 재련권이 됐어요',
    '🏆 <b>던전 보상</b> — 층 돌파마다 💠파편(5·10층마다 🌟정수), 처음 넘는 층은 💎프리즘 3개. 10·30·50층 칭호와 <b>주간 최고층 랭킹</b>도 있어요',
    '🗡️ <b>장비 칸</b> — 무기를 여러 자루 가질 수 있어요(직업당 한 자루). 무기를 <b>+99</b>까지 키울 때마다 칸을 하나씩 열 수 있고, 화로 위 장비 칸에서 바꿔 들면 직업도 같이 바뀌어요. 새 무기는 <b>+0·★0</b>부터 따로 키워요',
    '💎 <b>프리즘</b> 재화 추가 — 💎 프리즘 탭에서 📦<b>상자</b>(열쇠로 3개 중 하나) · ⚗️<b>연금술</b>(마석+골드) · 🧸<b>캡슐</b>(골드만 있으면 무제한)으로 모아요. 확률표는 탭에서 그대로 볼 수 있어요',
    '🗝️ 사냥하면 <b>상자 열쇠</b>와 🔮<b>마석</b>이 나와요 — 무한 사냥에서도 낮은 확률로 나와요',
    '🛒 <b>프리즘 상점</b> — 장비 칸 +1(💎70 → 140 → 210) · 🫧 <span class="nick-prism">프리즘 염색약</span>(상점 전용 오로라색) · 🔨 장인의 망치 · 🎁 초월 꾸러미',
    '🕯️ <b>호구</b> 탭 이름이 <b>추모</b>로 바뀌었어요 — 오늘 무기를 떠나보낸 분들을 기려요',
    '🌈 <b>초월 시스템</b> — +99 는 더 이상 끝이 아니에요. 초월하면 무기가 +0 으로 돌아가는 대신 <b>영구 ★</b>을 얻어요 (골드 획득·레이드 공격력·🔨장인의 기운 영구 상승)',
    '💠 <b>초월 재료</b> — ★을 올리려면 재료가 필요해요. <b>초월의 파편</b>은 🗡️사냥에서 확률로, <b>초월의 정수</b>는 🐲레이드 성공 시 확정으로 나와요',
    '⚠️ <b>초월하면 🛡️파괴방지권이 통하지 않습니다</b> — ★1부터는 파괴를 그대로 맞아요. 초월 전에 신중히!',
    '🎒 <b>가방(인벤토리) 추가</b> — 방지권·부스트권·염색약·초월 재료·열쇠·마석이 전부 가방으로 들어가요. <b>10칸</b>으로 시작해요',
    '🎒 <b>가방 확장</b> — 상점 <b>가방 확장 패키지</b>(500,000G · 계정당 1회) +4칸, 배틀패스 프리미엄 <b>Lv.15</b> 보상 +4칸 = 최대 <b>18칸</b>',
    '🛒 <b>상점 변경</b> — 염색약은 이제 사면 가방에 들어가고, <b>가방에서 "사용하기"</b> 를 눌러야 발동해요',
    '📊 <b>랭킹 개편</b> — 가진 무기 중 가장 좋은 무기의 ★ 개수가 먼저, 그다음 강화 수치로 순위를 매겨요',
    '⚔️ <b>강화 확률 조정</b> — 초월 전 강화는 살짝 쉬워졌고, 초월 회차(★1+)는 더 어려워졌어요',
    '🐲 <b>레이드 전면 개편</b> — 보스마다 <b>무기 레벨·초월 ★ 입장 조건</b>이 생겼고, <b>초월 전용 보스 2종</b>(🌋초월의 거인 · 🌌공허의 군주)이 추가됐어요',
    '🎯 <b>레이드 난이도 상향</b> — 이제 제대로 연타해야 잡혀요. 대신 <b>실패하면 횟수가 깎이지 않아요</b> (성공했을 때만 차감)',
    '👥 <b>인원 비례 난이도</b> — 파티 인원이 늘면 보스 체력·화력도 같이 올라가고 보상도 커져요',
    '🛡️ <b>방지권 상점 하루 3개 제한</b> — 나머지는 🗡️사냥 드랍으로 얻으세요 (드랍률 대폭 상향)',
    '🎒 <b>한 칸당 999개</b> — 999개를 넘기면 다음 칸을 하나 더 씁니다. 칸이 모자라는 건 재료가 쌓여서가 아니라 <b>아이템 종류</b>가 늘 때예요',
    '💥 <b>파괴 완화</b> — 파괴 시 등급 바닥까지 떨어지던 걸 <b>최대 −15레벨</b>로 묶었어요. 고레벨에서 며칠치가 한 번에 날아가지 않아요',
    '📉 <b>고레벨 파괴율 하향</b> — 상단 1.6% → 0.7%. 대신 초월 승급 재료가 크게 늘어 <b>재료가 주 관문</b>이 됐어요',
    '💠 <b>초월 재료 상향</b> — ★1 파편 200·정수 20 / ★5 파편 1,000·정수 100. 사냥과 레이드를 꾸준히 돌아야 ★이 올라가요',
  ],
};
const PATCH_DELAY = 3;   // 닫기 버튼 활성화까지 대기(초) — 실수로 닫지 않고 읽게
let patchTimer = null;

const el = id => document.getElementById(id);

/* ---------- 시각 효과 (fx.js — React Bits 컴포넌트 이식) ----------
 * fx.js 가 없거나(로드 실패) WebGL2 를 못 쓰는 기기면 해당 효과만 빠지고 게임은 그대로 동작한다. */
const FX = (() => {
  const F = window.Fx;
  if (!F) return null;
  const fx = {};
  const tryFx = (name, make) => { try { fx[name] = make(); } catch (e) { console.warn('[fx]', name, e); } };
  const small = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
  // 화로 불씨: 아래에서 위로 떠오르고, 화면을 누르면 충격파로 흩어진다
  tryFx('embers', () => F.embers(el('embers'), {
    particleCount: small ? 120 : 220, particleSpread: 10, speed: 0.08,
    particleColors: ['#ff7a1a', '#ff9a3c', '#ffd27a', '#ff5a1a'],
    particleBaseSize: 120, sizeRandomness: 1.3, glow: 1, twinkle: 0.65,
    drift: 'up', driftSpeed: 0.55, disableRotation: true,
    hoverEffect: 'repel', hoverRadius: 110, particleHoverFactor: 0.8, opacity: 0.85,
  }));
  // 망치질 불꽃: 위로 튀었다가 중력으로 떨어지는 줄불꽃
  tryFx('sparks', () => F.clickSpark({
    sparkColor: ['#ffd27a', '#ff9a3c', '#fff4d6'], sparkSize: 9, sparkRadius: 34, sparkCount: 9,
    sparkWidth: 2, duration: 460, shape: 'streak', randomness: 0.6, gravity: 0.55, glow: 0.8,
  })
    .bind('#enhanceBtn', { sparkCount: 12, sparkRadius: 52, spread: 200 })
    .bind('#huntMon', { sparkColor: ['#fff4d6', '#ff9a3c', '#ef4f45'], sparkCount: 7, sparkRadius: 30, duration: 360 }, { immediate: true })
    .bind('.rock', { sparkColor: ['#ffd27a', '#c9b8a6', '#ffffff'], sparkCount: 8, sparkRadius: 30, gravity: 1.1, duration: 420 }, { immediate: true })
    .bind('.raid-mon', { sparkColor: ['#fff4d6', '#ff9a3c', '#ffd27a'], sparkCount: 7, sparkRadius: 32, duration: 360 }, { immediate: true })
    .bind('.btn.action', { sparkCount: 6, sparkRadius: 22, shape: 'line', gravity: 0, duration: 360, glow: 0.4 }));
  // 강화 버튼: 달군 쇠판 테두리를 도는 빛
  tryFx('star', () => F.starBorder(el('enhanceBtn'), {
    color: '#fff1c1', trailColor: '#ff9a3c', duration: 3.2, thickness: 1.5, radius: 14,
    trailLength: 0.35, glow: 0.9, sparkle: true, borderColor: 'rgba(255,214,150,.35)',
  }));
  // 장인의 기운 100%(다음 강화 확정) 일 때만 화로 테두리에 전류가 흐른다
  tryFx('electric', () => F.electricBorder(document.querySelector('.weapon-panel'), {
    color: '#ffd27a', glowColor: '#ff8a2a', borderRadius: 18, thickness: 1.6, strands: 3,
    chaos: 0.55, spread: 0.5, glow: 0.8, intensity: 0.9, arcs: 1.2, active: false,
    pixelBudget: small ? 6e5 : 3e6,   // 휴대폰은 셰이더 픽셀 수를 줄여 발열·배터리 부담을 낮춘다
  }));
  // 전설·초월 무기 이름은 등급색 그라디언트가 흐른다(그 아래 등급은 평범한 글자)
  tryFx('grade', () => F.gradientText(el('weaponName'), { enabled: false, animationSpeed: 6, scale: 2.5 }));
  tryFx('title', () => F.shinyText(el('loginTitle'), { color: '#e8b264', shineColor: '#fff6df', speed: 2.4, delay: 2.6, angle: 115, shineWidth: 34 }));
  tryFx('gold', () => F.counter(el('hGold'), { locale: 'ko-KR', duration: 0.6, bounce: 0.18, stagger: 0.035, fade: 0.25 }));
  return fx;
})();
const GRADE_FLOW = {
  legend: ['#fff1c1', '#ffb347', '#f7971e', '#ffd27a'],
  transcend: ['#ffd27a', '#ff5d6c', '#c471ed', '#7df9ff'],
};
let lastEnhDisabled = null;

/* 상단바 골드 — 1억 이상은 '9876.5억'처럼 줄여 보여준다(좁은 휴대폰에서 상단바가 화면 밖으로 밀리지 않게).
 * 정확한 값은 칩에 마우스를 올리면(title) 보이고, 상점·프로필·부자 랭킹에는 그대로 나온다.
 * 숫자 굴러가는 Counter 는 포맷이 생성 시점에 고정이라, 1억을 넘나들 때만 새 포맷으로 다시 만든다. */
const GOLD_COMPACT_AT = 1e8;
const GOLD_COMPACT_FMT = { notation: 'compact', maximumFractionDigits: 1 };
let goldCompact = false;
function setTopGold(g) {
  const compact = g >= GOLD_COMPACT_AT;
  if (compact !== goldCompact && FX && FX.gold && window.Fx) {
    try {
      FX.gold.destroy();
      FX.gold = window.Fx.counter(el('hGold'), { locale: 'ko-KR', duration: 0.6, bounce: 0.18, stagger: 0.035, fade: 0.25, format: compact ? GOLD_COMPACT_FMT : {} });
    } catch (e) { FX.gold = null; }
  }
  goldCompact = compact;
  el('hGold').parentElement.title = g.toLocaleString() + 'G';
  if (FX && FX.gold) FX.gold.set(g);
  else el('hGold').textContent = compact ? new Intl.NumberFormat('ko-KR', GOLD_COMPACT_FMT).format(g) : g.toLocaleString();
}

/* ---------- API ---------- */
async function api(pathName, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (token) opt.headers['x-token'] = token;
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api/' + pathName, opt); }
  catch (e) { return { ok: false, error: '네트워크 오류: ' + (e && e.message || e) }; }
  const text = await res.text();
  // 응답이 JSON 이 아니면(서버 크래시·타임아웃 등) throw 대신 보이는 에러로 돌려준다
  try { return JSON.parse(text); }
  catch (e) { return { ok: false, error: '서버 오류 (' + res.status + ')' + (text ? ': ' + text.slice(0, 120) : '') }; }
}
/* me 갱신은 항상 이걸로. 서버가 붙인 ts 가 현재 me 보다 오래됐으면 무시한다.
 * → 도착 순서가 뒤바뀌거나 낡은 폴링이 최신 액션 결과를 덮어써 숫자가 깜빡이던 문제 해결. */
function applyMe(m) {
  if (!m) return false;
  if (me && typeof m.ts === 'number' && typeof me.ts === 'number' && m.ts < me.ts) return false;
  me = m;
  return true;
}
async function pollMe() {
  const r = await api('me');
  if (r && r.ok && applyMe(r.me)) { render(); checkInvites(); return true; }
  return false;
}

/* ---------- 무기 SVG (직업별 모양 + 등급별 장식 업그레이드) ---------- */
const GRADE_TIERS = { common: 0, rare: 1, epic: 2, legend: 3, transcend: 4 };
// 서버가 내려준 등급 key 로 판정한다(경계가 maxLevel 비율이라 레벨로 재계산하면 어긋난다)
function gradeTier(gradeKey) { return GRADE_TIERS[gradeKey] || 0; }
function sparkle(x, y, c) { return `<path d="M${x} ${y - 3.2} L${x + 1.8} ${y} L${x} ${y + 3.2} L${x - 1.8} ${y} Z" fill="${c}"/>`; }
function weaponSVG(cls, gradeKey, color) {
  const tier = gradeTier(gradeKey);
  const glow = 3 + tier * 6;
  const defs = `<defs><linearGradient id="bl" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${color}"/>
  </linearGradient></defs>`;

  // 등급별 장식: 오라(초월) → 날개(전설) → 룬(에픽) → 보석(희귀)
  let back = '', front = '';
  if (tier >= 4) back += `<circle cx="40" cy="55" r="46" fill="none" stroke="${color}" stroke-width="1.5" opacity=".4"/>
    <circle cx="40" cy="55" r="40" fill="${color}" opacity=".06"/>`;
  if (tier >= 3) back += `<path d="M27 74 Q6 66 12 84 Q22 82 27 80 Z" fill="${color}" opacity=".7"/>
    <path d="M53 74 Q74 66 68 84 Q58 82 53 80 Z" fill="${color}" opacity=".7"/>`;
  if (tier >= 2) front += sparkle(40, 30, '#fff') + sparkle(40, 46, '#fff');
  if (tier >= 1) front += `<circle cx="40" cy="90" r="4" fill="#fff"/><circle cx="40" cy="90" r="2.4" fill="${color}"/>`;
  if (tier >= 4) front += sparkle(14, 22, color) + sparkle(66, 26, color) + sparkle(16, 86, color) + sparkle(64, 90, color);

  let inner;
  if (cls === 'archer') {
    inner = `<path d="M56 8 Q18 55 56 102" fill="none" stroke="${color}" stroke-width="5"/>
      <line x1="56" y1="8" x2="56" y2="102" stroke="#c9a24a" stroke-width="2"/>
      <line x1="26" y1="55" x2="64" y2="55" stroke="url(#bl)" stroke-width="4"/>
      <polygon points="64,55 56,50 56,60" fill="${color}"/>`;
  } else if (cls === 'healer') {
    inner = `<rect x="37" y="26" width="6" height="80" rx="3" fill="#7a5a2c"/>
      <circle cx="40" cy="20" r="13" fill="url(#bl)" stroke="${color}" stroke-width="2"/>
      <circle cx="40" cy="20" r="5" fill="#fff" opacity=".7"/>`;
  } else if (cls === 'tanker') {
    // 방패(히터 실드) — 가운데 십자 + 중앙 보스
    inner = `<path d="M40 8 L66 17 L66 54 Q66 88 40 104 Q14 88 14 54 L14 17 Z" fill="url(#bl)" stroke="${color}" stroke-width="2"/>
      <path d="M40 8 L40 104 Q14 88 14 54 L14 17 Z" fill="#fff" opacity=".14"/>
      <line x1="40" y1="13" x2="40" y2="99" stroke="${color}" stroke-width="1.6" opacity=".55"/>
      <line x1="16" y1="44" x2="64" y2="44" stroke="${color}" stroke-width="1.6" opacity=".55"/>
      <circle cx="40" cy="44" r="8" fill="#c9a24a" stroke="${color}" stroke-width="1.2"/>
      <circle cx="40" cy="44" r="3.2" fill="#fff" opacity=".8"/>`;
  } else {
    inner = `<polygon points="40,4 48,20 48,66 40,78 32,66 32,20" fill="url(#bl)" stroke="${color}" stroke-width="1"/>
      <polygon points="40,4 40,78 32,66 32,20" fill="#fff" opacity=".18"/>
      <rect x="20" y="76" width="40" height="7" rx="3" fill="#c9a24a"/>
      <rect x="36" y="83" width="8" height="20" rx="3" fill="#7a5a2c"/><circle cx="40" cy="105" r="5" fill="#c9a24a"/>`;
  }
  return `<svg viewBox="0 0 80 110" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 0 ${glow}px ${color})">${defs}${back}${inner}${front}</svg>`;
}

/* ---------- 화면 전환 ---------- */
function show(which) {
  ['login', 'classSelect', 'game'].forEach(s => { el(s).hidden = (s !== which); });
}
// 안내창은 한 번 닫으면 다시 안 뜬다(기기에 영구 저장). ❔ 버튼으로 다시 열 수 있음.
// 신규 유저는 가이드를 보여주고(패치노트는 건너뜀), 기존 유저는 새 버전이면 패치노트를 띄운다.
function maybeShowGuide() {
  if (!localStorage.getItem('guideSeen')) { el('guide').hidden = false; localStorage.setItem('patchSeen', PATCH.version); return true; }
  return false;
}
function patchUnread() { return localStorage.getItem('patchSeen') !== PATCH.version; }
function updateNoticeBadge() { const u = patchUnread(); const a = el('menuDot'), b = el('noticeDot'); if (a) a.hidden = !u; if (b) b.hidden = !u; }
// withDelay=true(업데이트 자동 팝업): 닫기 버튼 PATCH_DELAY초 후 활성화. false(메뉴에서 다시 보기): 즉시 닫기 가능.
function openPatch(withDelay) {
  el('patchTitle').innerHTML = PATCH.title;
  el('patchNotes').innerHTML = PATCH.notes.map(n => '<li>' + n + '</li>').join('');
  el('patchModal').hidden = false;
  const btn = el('patchClose');
  clearInterval(patchTimer); patchTimer = null;
  if (withDelay) {
    let s = PATCH_DELAY;
    btn.disabled = true; btn.textContent = s + '초 후 닫기';
    patchTimer = setInterval(() => {
      s--;
      if (s > 0) { btn.textContent = s + '초 후 닫기'; }
      else { clearInterval(patchTimer); patchTimer = null; btn.disabled = false; btn.textContent = '확인'; }
    }, 1000);
  } else { btn.disabled = false; btn.textContent = '확인'; }
}
function maybeShowPatch() { if (patchUnread()) openPatch(true); }
function closePatch() {
  if (el('patchClose').disabled) return;   // 아직 활성화 전엔 무시
  clearInterval(patchTimer); patchTimer = null;
  localStorage.setItem('patchSeen', PATCH.version);
  el('patchModal').hidden = true;
  updateNoticeBadge();
}
function enterGame() { show('game'); seedInvites(); seedTitles(); render(); withLoad(loadTab); const shownGuide = maybeShowGuide(); if (!shownGuide) maybeShowPatch(); openEvents(); initRealtime(); }

/* 파티 레이드 초대 알림 — 어느 탭에 있어도 새 초대가 오면 토스트로 띄운다.
 * 폴링(api('me'))으로 me.invites 가 갱신될 때마다 새로 생긴 초대를 감지. */
let seenInvites = new Set();
function seedInvites() { seenInvites = new Set(((me && me.invites) || []).map(iv => iv.partyId)); }
function checkInvites() {
  if (!me || !me.invites) return;
  me.invites.forEach(iv => {
    if (!seenInvites.has(iv.partyId)) {
      toast('📨 ' + iv.leaderNick + ' 님이 파티 레이드에 초대했어요! 🐉 레이드 탭에서 수락하세요', 'info');
      vibe([10, 30, 12]); sfx('coin');
    }
  });
  seenInvites = new Set(me.invites.map(iv => iv.partyId));
}

/* 칭호 획득 알림 — me.titles 에 새 칭호가 생기면 토스트. render() 에서 매번 확인(중복은 seen 으로 방지). */
let seenTitles = new Set();
function seedTitles() { seenTitles = new Set(((me && me.titles) || []).map(t => t.id)); }
function checkTitles() {
  if (!me || !me.titles) return;
  me.titles.forEach(t => {
    if (!seenTitles.has(t.id)) {
      seenTitles.add(t.id);
      toast('🏆 새 칭호 획득!  「' + t.title + '」', 'ok');
      vibe([15, 45, 25]); sfx('guaranteed');
    }
  });
}

/* ---------- Supabase Realtime (선택) — logs INSERT 구독 → 즉시 갱신 ----------
 * 환경변수(SUPABASE_URL/ANON_KEY)가 있고 supabase-js 가 로드됐을 때만.
 * 실패하면 조용히 폴링(setInterval)에 맡긴다. */
let sb = null, sbChannel = null, realtimeOn = false;
async function initRealtime() {
  if (sb || realtimeOn || !window.supabase) return;
  try {
    const cfg = await api('config');
    if (!cfg || !cfg.realtime || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return; // 폴백: 폴링
    // 실수로 REST 엔드포인트(.../rest/v1/)를 넣어도 베이스 URL 로 정규화
    const base = String(cfg.supabaseUrl).replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
    sb = window.supabase.createClient(base, cfg.supabaseAnonKey, { auth: { persistSession: false } });
    sbChannel = sb.channel('rt:logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs' }, () => onRefresh())
      .subscribe((status) => { if (status === 'SUBSCRIBED') realtimeOn = true; });
  } catch (e) { /* 폴백: 폴링 */ }
}
function closeRealtime() {
  try { if (sbChannel) sb.removeChannel(sbChannel); } catch (e) { /* noop */ }
  sbChannel = null; realtimeOn = false;
}

/* ---------- 실시간 이벤트 (SSE) ---------- */
let es = null, refreshT = null;
function onRefresh() {
  if (!me || el('game').hidden || currentTab === 'raid') return; // 레이드 탭은 자체 루프가 담당
  clearTimeout(refreshT);
  refreshT = setTimeout(async () => {
    try { await pollMe(); } catch (e) { /* 무시 */ }
    // 채굴장(mine)은 돌 깨기 연타 중 리렌더되면 진행이 끊겨 제외 — 곡괭이질마다 자체 갱신
    if (['rank', 'goldrank', 'hogu', 'log', 'fight', 'shop'].includes(currentTab)) loadTab();
  }, 250);
}
// SSE(상시서버)와 폴링(서버리스) 겸용:
//   상시서버(server.js)에선 SSE 가 열려 실시간 갱신. 서버리스(Vercel)엔 /api/events 가
//   없어 EventSource 가 열리지 못하는데, 그 경우 재시도 폭주 대신 SSE 를 끄고 폴링에 맡긴다.
//   (한 번이라도 열린 뒤의 에러는 일시 끊김 → 브라우저 자동 재연결에 맡김)
let sseOpened = false, sseFails = 0, sseDisabled = false;
function openEvents() {
  closeEvents();
  if (!token || sseDisabled) return;
  es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.onopen = () => { sseOpened = true; sseFails = 0; };
  es.addEventListener('refresh', onRefresh);
  es.addEventListener('notify', e => { try { const d = JSON.parse(e.data); if (d.msg) toast(d.msg, 'info'); } catch (_) { } onRefresh(); });
  es.onerror = () => {
    if (sseOpened) return;              // 열린 적 있으면 일시적 → 자동 재연결
    if (++sseFails >= 2) { sseDisabled = true; closeEvents(); }  // 서버리스로 판단 → 폴링만
  };
}
function closeEvents() { if (es) { es.onerror = null; es.close(); es = null; } }

/* ---------- 직업 선택 ---------- */
async function showClassSelect() {
  show('classSelect');
  const { classes } = await withLoad(() => api('classes'));
  el('classGrid').innerHTML = Object.values(classes).map(c =>
    `<div class="class-card" data-class="${c.id}">
      <div class="cemoji">${c.emoji}</div>
      <div class="cname">${esc(c.name)}</div>
      <div class="cdesc">${esc(c.desc)}</div>
      <div class="cweapon">무기: ${esc(c.weapon)}</div>
    </div>`).join('');
  el('classGrid').querySelectorAll('.class-card').forEach(card => {
    card.onclick = async () => {
      const r = await withLoad(() => api('setclass', 'POST', { class: card.dataset.class }));
      if (!r.ok) return toast(r.error, 'bad');
      applyMe(r.me); enterGame();
      toast('모험을 시작합니다! "출석"·"채굴"·"사냥"으로 골드를 모으세요 🎉', 'info');
    };
  });
}

/* ---------- 무기 그림 ----------
 * 기본: weapon-art.js 생성기(직업 × 속성 × 등급 180종, 이미지 파일 불필요) — 모든 유저가 같은 화풍.
 * USE_WEAPON_PNG = true 로 켜면 예전처럼 /weapons/{class}_{element}_{grade}.png → {element}_{grade}.png 를
 * 먼저 찾는다(일부만 있으면 화풍이 섞이니, 한 직업의 45장을 다 채웠을 때 켜는 걸 권장). */
const USE_WEAPON_PNG = false;
function weaponArtHTML(m) {
  if (window.WeaponArt) return window.WeaponArt.svg({ cls: m.class, element: m.element, grade: m.grade && m.grade.key, label: m.weapon });
  return weaponSVG(m.class, m.grade && m.grade.key, m.grade.color);
}
let lastWeaponKey = '';
function setWeaponArt(m) {
  const key = m.class + '|' + m.element + '|' + m.grade.key;
  if (key === lastWeaponKey) return; // 같은 조합이면 다시 그리지 않음(애니메이션 끊김·404 반복 방지)
  lastWeaponKey = key;
  const art = el('weaponArt');
  if (!USE_WEAPON_PNG) { art.innerHTML = weaponArtHTML(m); return; }
  const candidates = [
    '/weapons/' + m.class + '_' + m.element + '_' + m.grade.key + '.png',
    '/weapons/' + m.element + '_' + m.grade.key + '.png',
  ];
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) { art.innerHTML = weaponArtHTML(m); return; }
    const url = candidates[i++];
    const img = new Image();
    img.onload = () => { img.className = 'weapon-img'; img.style.filter = 'drop-shadow(0 0 10px ' + m.grade.color + ')'; art.innerHTML = ''; art.appendChild(img); };
    img.onerror = tryNext;
    img.src = url;
  };
  tryNext();
}

// 낮은 확률도 보이게 (0% 대신 0.15% 등)
function fmtPct(p) {
  const v = p * 100;
  if (v >= 10) return Math.round(v) + '%';
  if (v >= 1) return v.toFixed(1) + '%';
  if (v >= 0.1) return v.toFixed(2) + '%';
  if (v > 0) return v.toFixed(3) + '%';
  return '0%';
}

/* ---------- 렌더 ---------- */
function render() {
  if (!me) return;
  el('hNick').innerHTML = '<span class="me-cls">' + (me.classEmoji || '') + ' </span>' + nickSpan(me.nick, me.nickColor) + titleTag(me.equippedTitle) + ' <span class="edit-hint">✏️</span>';
  setTopGold(me.gold);
  el('hPrism').textContent = (me.prism || 0).toLocaleString();
  renderArmory();
  updateMissionBadge();
  updateNoticeBadge();

  setWeaponArt(me);
  // 등급 이모지는 따로 감싼다 — 이름에 그라디언트(background-clip:text)를 입히면 컬러 이모지가 색을 잃기 때문
  const wEmoji = me.grade && me.grade.emoji;
  el('weaponName').innerHTML = wEmoji && me.weapon.includes(wEmoji)
    ? me.weapon.split(wEmoji).map(esc).join('<span class="wn-emoji">' + wEmoji + '</span>')
    : esc(me.weapon);
  const panel = document.querySelector('.weapon-panel');
  panel.style.setProperty('--heat', me.grade.color);
  if (FX && FX.grade) {
    const flow = GRADE_FLOW[me.grade.key];
    FX.grade.enable(!!flow, flow ? { colors: flow } : null);
  }
  el('weaponElem').textContent = (me.elementEmoji || '') + ' ' + (me.elementName || '') + '속성' + (me.elemSkill ? ' · 스킬 「' + me.elemSkill.name + '」' : '');
  el('weaponElem').title = me.elemSkill ? '속성 스킬(초월 던전): ' + me.elemSkill.desc : '';
  el('weaponElem').style.color = me.elementColor || 'var(--muted)';
  el('oddsS').textContent = fmtPct(me.odds.success);
  el('oddsD').textContent = fmtPct(me.odds.destroy);
  const pity = Math.round((me.pity || 0) * 100);
  const guaranteed = pity >= 100;
  el('pityPct').textContent = guaranteed ? '100% · 다음 강화 확정' : pity + '%';
  panel.classList.toggle('guaranteed', guaranteed);
  if (FX && FX.electric) FX.electric.setActive(guaranteed);
  el('pityBar').style.width = pity + '%';
  el('nextCost').textContent = me.nextCost == null ? '🌈 만렙 달성!' : '다음 강화 비용 ' + me.nextCost.toLocaleString() + 'G';
  el('enhLabel').textContent = '⚒️ 강화' + (me.enhanceBoost > 0 ? ' 🍀' + me.enhanceBoost : '');
  el('enhCost').textContent = me.nextCost == null ? '만렙' : me.nextCost.toLocaleString() + 'G';
  const enhDisabled = me.nextCost == null || me.gold < me.nextCost;
  el('enhanceBtn').disabled = enhDisabled;
  el('enhanceBtn').title = enhDisabled && me.nextCost != null ? '골드가 ' + (me.nextCost - me.gold).toLocaleString() + 'G 부족해요' : '';
  if (FX && FX.star && enhDisabled !== lastEnhDisabled) {   // 못 누를 땐 빛을 식힌다
    FX.star.set(enhDisabled ? { color: '#6b5d50', trailColor: '#4a3c30', sparkle: false, glow: 0.2 }
      : { color: '#fff1c1', trailColor: '#ff9a3c', sparkle: true, glow: 0.9 });
  }
  lastEnhDisabled = enhDisabled;
  renderAscend();
  el('invCount').textContent = me.inv.used + '/' + me.inv.slots;
  el('invCount').classList.toggle('full', !!me.inv.full);

  el('huntLeft').textContent = me.huntsLeft > 0 ? '(' + me.huntsLeft + '/' + me.dailyHunts + ')' : '♾️';
  el('huntBtn').disabled = false;   // 무한 사냥: 항상 가능(소진 후엔 보상 축소)
  el('mineAmt').textContent = me.mine > 0 ? '(+' + me.mine.toLocaleString() + ')' : '';
  el('mineBtn').disabled = false;   // 채굴 모달 열기 — 항상 가능(누적 없어도 돌 깨기)

  el('sAscend').textContent = me.ascend > 0 ? '★' + me.ascend : '-';
  el('sBest').textContent = '+' + me.best;
  el('sBreaks').textContent = me.breaks + '회';
  el('sRecord').textContent = me.wins + '승 ' + me.losses + '패';
  el('sRank').textContent = me.rank.rank ? me.rank.rank + '/' + me.rank.total + '위' : '-';
  checkTitles();   // 새 칭호 획득 시 알림
}

/* ---------- 초월 ----------
 * +99 에서만 노출. 재료(사냥 파편 · 레이드 정수)가 다 차야 버튼이 열린다. */
function renderAscend() {
  const wrap = el('ascendWrap');
  wrap.hidden = !me.atMax;
  if (!me.atMax) return;
  const n = me.ascendNext;
  el('ascendMats').innerHTML = n.mats.map(m =>
    `<span class="amat ${m.have >= m.need ? 'done' : ''}">${m.emoji} <b>${m.have}</b>/${m.need}<small>${m.from}</small></span>`).join('');
  const btn = el('ascendBtn');
  btn.textContent = '🌈 초월 ★' + n.to;
  btn.disabled = !me.canAscend;
}
async function doAscend() {
  if (!me.canAscend) return toast('재료가 부족해요. 🗡️사냥으로 파편, 🐲레이드로 정수를 모으세요.', 'bad');
  if (!confirm('🌈 초월 ★' + me.ascendNext.to + '\n\n무기가 +0 으로 돌아가고 재료를 소모합니다.\n골드·아이템·칭호는 그대로예요.\n\n⚠️ 초월하면 🛡️파괴방지권이 영구히 통하지 않습니다.\n\n진행할까요?')) return;
  const r = await api('ascend', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); render();
  lastWeaponKey = '';   // 등급·속성이 통째로 바뀌므로 무기 아트를 강제로 다시 그린다
  setWeaponArt(me);
  toast(r.msg, 'ok'); weaponResult('success'); vibe([20, 50, 30, 50, 60]); sfx('guaranteed'); sfx('pang');
  if (['rank', 'log'].includes(currentTab)) loadTab();
}

/* ---------- 장비 칸 (무기 여러 자루) ----------
 * 화로 위 한 줄: 가진 무기(장착 중은 놋쇠 테두리) · 빈 칸(➕ 새 무기) · 잠긴 칸(🔒 → 💎 프리즘 상점).
 * 무기를 바꿔 들면 직업도 그 무기를 따라 바뀐다(무기마다 강화·★·속성·장인의 기운이 따로). */
let lastArmoryHtml = '';
let classesCache = null;
function renderArmory() {
  const w = me.weapons; if (!w) return;
  let html = '<span class="arm-label">🗡️ 장비 <small>' + w.list.length + '/' + w.slots + '</small></span>';
  for (const it of w.list) {
    html += `<button class="arm-slot${it.equipped ? ' on' : ''}" data-arm="${it.cls}" style="--gc:${it.grade.color}"
      title="${esc(it.name)}${it.equipped ? ' (장착 중)' : ' — 눌러서 바꿔 들기'}"><span class="arm-ic">${it.classEmoji}</span><span class="arm-lv">${it.ascend ? '★' + it.ascend + ' ' : ''}+${it.level}</span></button>`;
  }
  for (let i = w.list.length; i < w.slots; i++) html += '<button class="arm-slot new" data-arm-new title="빈 장비 칸 — 새 무기 만들기"><span class="arm-ic">➕</span><span class="arm-lv">새 무기</span></button>';
  // 잠긴 칸은 하나로 묶어서(🔒 ×n) — 좁은 화면에서도 장비 줄이 한 줄에 들어가게.
  // 다음 칸을 지금 살 수 있으면(+99 무기 조건 충족) 놋쇠빛으로 깨워서 상점으로 안내한다.
  if (w.max > w.slots) {
    const ns = w.nextSlot, ready = !!(ns && ns.ok);
    html += `<button class="arm-slot locked${ready ? ' ready' : ''}" data-arm-lock title="${ready ? '💎 프리즘 상점에서 장비 칸 열기' : '🔒 ' + esc(ns ? ns.msg : '')}"><span class="arm-ic">${ready ? '💎' : '🔒'}</span><span class="arm-lv">×${w.max - w.slots}</span></button>`;
  }
  if (html !== lastArmoryHtml) { el('armory').innerHTML = html; lastArmoryHtml = html; }
}
async function doEquipWeapon(cls) {
  const r = await api('weapon-equip', 'POST', { class: cls });
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); lastWeaponKey = ''; render();
  toast(r.msg, 'ok'); sfx('pang');
  if (['rank', 'raid'].includes(currentTab)) loadTab();
}
// 🔒 칸·꽉 찬 ➕ 를 눌렀을 때 — 조건 미달이면 무엇이 필요한지 바로 알려주고, 살 수 있으면 상점으로
function armLockedClick() {
  const ns = me.weapons && me.weapons.nextSlot;
  if (ns && !ns.ok) return toast('🔒 다음 장비 칸은 무기를 +' + me.maxLevel + '까지 키워야 열려요 (' + ns.msg + ')', 'info');
  goPrismShop();
}
async function openWeaponNew() {
  if (!me.weapons.canNew) return armLockedClick();
  if (!classesCache) { const r = await withLoad(() => api('classes')); if (!r.ok) return; classesCache = r.classes; }
  el('wpnGrid').innerHTML = me.weapons.missing.map(k => {
    const c = classesCache[k];
    return `<div class="class-card" data-newcls="${c.id}"><div class="cemoji">${c.emoji}</div><div class="cname">${esc(c.name)}</div>
      <div class="cdesc">${esc(c.desc)}</div><div class="cweapon">무기: ${esc(c.weapon)}</div></div>`;
  }).join('');
  el('wpnModal').hidden = false;
}
async function doNewWeapon(cls) {
  const r = await api('weapon-new', 'POST', { class: cls });
  if (!r.ok) return toast(r.error, 'bad');
  el('wpnModal').hidden = true;
  applyMe(r.me); lastWeaponKey = ''; render();
  toast(r.msg, 'ok'); weaponResult('success');
  if (['rank', 'raid'].includes(currentTab)) loadTab();
}
function goPrismShop() {
  prismSub = 'shop';
  const t = document.querySelector('.tab[data-tab="prism"]'); if (t) t.click();
  el('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- 💎 프리즘 탭 — 📦 상자 · ⚗️ 연금술 · 🧸 캡슐 · 💎 상점 ----------
 * 확률표는 서버가 굴리는 표를 그대로 받아서 보여준다(확률 공개). */
let prismSub = 'box', prismData = null, boxReveal = null, alchLast = null, capLast = null;
const CHESTS = [
  { name: '루비 상자',     body: '#6e2620', body2: '#8f3a2c', trim: '#e0aa45', gem: '#ff5d6c' },
  { name: '사파이어 상자', body: '#1f3a63', body2: '#2c5288', trim: '#d6dee8', gem: '#4facfe' },
  { name: '에메랄드 상자', body: '#1f4f34', body2: '#2c6b47', trim: '#d4a24c', gem: '#49d17a' },
];
function chestSVG(c, open) {
  return `<svg class="chest-svg${open ? ' open' : ''}" viewBox="0 0 84 76" aria-hidden="true">
    <ellipse cx="42" cy="70" rx="32" ry="5" fill="#000" opacity=".35"/>
    <g class="chest-glow"><circle cx="42" cy="30" r="22" fill="${c.gem}" opacity=".45"/></g>
    <rect x="9" y="32" width="66" height="34" rx="3" fill="${c.body}" stroke="#170f0a" stroke-width="2"/>
    <rect x="9" y="32" width="66" height="10" fill="${c.body2}"/>
    <path d="M9 47 H75 M9 57 H75" stroke="#170f0a" stroke-width="1" opacity=".35"/>
    <rect x="9" y="32" width="66" height="5" fill="${c.trim}"/>
    <rect x="35" y="32" width="14" height="34" fill="${c.trim}" stroke="#170f0a" stroke-width="1"/>
    <g class="chest-lid">
      <path d="M9 32 Q9 9 42 9 Q75 9 75 32 Z" fill="${c.body2}" stroke="#170f0a" stroke-width="2"/>
      <path d="M12 30 Q13 13 42 12" fill="none" stroke="#fff" stroke-width="2" opacity=".18"/>
      <path d="M9 32 Q9 9 42 9 Q75 9 75 32" fill="none" stroke="${c.trim}" stroke-width="3"/>
      <rect x="35" y="10" width="14" height="22" fill="${c.trim}" stroke="#170f0a" stroke-width="1"/>
    </g>
    <circle cx="42" cy="45" r="5.5" fill="${c.gem}" stroke="#170f0a" stroke-width="1.5"/>
    <circle cx="40.5" cy="43.5" r="1.6" fill="#fff" opacity=".8"/>
  </svg>`;
}
function capsuleMachineSVG() {
  const balls = [['#ff5d6c', 34, 40], ['#4facfe', 50, 36], ['#ffd93d', 42, 50], ['#49d17a', 58, 50], ['#a770ef', 28, 54], ['#ff9f45', 46, 26], ['#7df9ff', 62, 30]];
  return `<svg class="cap-svg" viewBox="0 0 92 120" aria-hidden="true">
    <circle cx="46" cy="42" r="34" fill="rgba(200,230,255,.08)" stroke="#d6dee8" stroke-width="2.5"/>
    ${balls.map(([c, x, y]) => `<g><circle cx="${x}" cy="${y}" r="7.5" fill="${c}" stroke="#170f0a" stroke-width="1.3"/><path d="M${x - 7.5} ${y} H${x + 7.5}" stroke="#fff" stroke-width="1.2" opacity=".7"/></g>`).join('')}
    <path d="M22 26 Q30 14 44 12" fill="none" stroke="#fff" stroke-width="3" opacity=".3" stroke-linecap="round"/>
    <path d="M14 74 H78 L72 112 H20 Z" fill="#b8420c" stroke="#170f0a" stroke-width="2"/>
    <path d="M14 74 H78 V80 H14 Z" fill="#e0aa45" stroke="#170f0a" stroke-width="1.5"/>
    <circle cx="46" cy="94" r="9" fill="#2b231d" stroke="#e0aa45" stroke-width="2.5"/>
    <path d="M40 94 H52" stroke="#e0aa45" stroke-width="3" stroke-linecap="round"/>
    <rect x="58" y="100" width="12" height="8" rx="2" fill="#100d0b"/>
  </svg>`;
}
const pct = p => { const v = p * 100; return (v >= 1 ? (Math.round(v * 10) / 10) : (Math.round(v * 100) / 100)) + '%'; };
function oddsTable(title, table) {
  return `<details class="odds-table"><summary>📊 ${title}</summary><table>${table.map(e => `<tr><td>${esc(e.text)}</td><td>${pct(e.p)}</td></tr>`).join('')}</table></details>`;
}
function syncPrismFromMe() {
  if (!prismData || !me) return;
  const cnt = id => { const it = me.inv.items.find(i => i.id === id); return it ? it.count : 0; };
  prismData.prism = me.prism || 0; prismData.gold = me.gold; prismData.keys = cnt('boxkey'); prismData.stones = cnt('stone');
}
function paintPrism() {
  const d = prismData; if (!d || currentTab !== 'prism') return;
  const subs = [['box', '📦', '상자'], ['alch', '⚗️', '연금술'], ['cap', '🧸', '캡슐'], ['shop', '💎', '상점']];
  let h = `<div class="prism-head"><span class="prism-bal">💎 <b>${d.prism.toLocaleString()}</b></span>
    <span class="prism-mats"><span title="상자 열쇠">🗝️ ${d.keys}</span><span title="마석">🔮 ${d.stones}</span><span title="골드">💰 ${d.gold.toLocaleString()}</span></span></div>`;
  h += `<div class="psub-tabs">${subs.map(([k, e, l]) => `<button class="psub${prismSub === k ? ' active' : ''}" data-psub="${k}"><span>${e}</span>${l}</button>`).join('')}</div>`;
  h += prismSub === 'box' ? boxHTML(d) : prismSub === 'alch' ? alchHTML(d) : prismSub === 'cap' ? capHTML(d) : pshopHTML(d);
  el('panel').innerHTML = h;
}
function boxHTML(d) {
  const rv = boxReveal;
  let h = `<p class="hint" style="margin:0 0 10px">🗝️ 열쇠 1개로 상자 3개 중 <b>하나</b>를 골라 열어요. 열고 나면 나머지 둘에 뭐가 들어 있었는지도 보여 줘요.</p>`;
  h += '<div class="chests">' + CHESTS.map((c, i) => {
    const mine = rv && rv.pick === i;
    return `<button class="chest${rv ? (mine ? ' opened' : ' missed') : ''}" ${rv ? 'data-noop' : `data-pick="${i}"`} ${!rv && d.keys < 1 ? 'disabled' : ''}>
      ${chestSVG(c, !!rv)}<span class="chest-name">${c.name}</span>${rv ? `<span class="chest-reward">${mine ? '' : '놓친 보상 · '}${esc(rv.boxes[i])}</span>` : ''}</button>`;
  }).join('') + '</div>';
  if (rv) h += `<div class="prism-result ok">🎉 ${esc(rv.got.text)} 획득!</div>
    <button class="btn primary big" data-box-again ${d.keys < 1 ? 'disabled' : ''}>🗝️ 다시 열기 <small>(남은 열쇠 ${d.keys})</small></button>`;
  else if (d.keys < 1) h += '<div class="prism-result">🗝️ 열쇠가 없어요 — 🗡️ 사냥에서 가끔 나와요(무한 사냥에서도 낮은 확률로)</div>';
  return h + oddsTable('상자 하나에 들어 있을 확률', d.info.box.table);
}
function alchHTML(d) {
  let h = '<p class="hint" style="margin:0 0 10px">🔮 마석과 💰 골드를 도가니에 함께 넣고 돌려요. 불이 셀수록 <b>마석</b> 하나당 기대값은 높고, <b>골드</b> 하나당 기대값은 낮아요.</p>';
  h += '<div class="alch-list">' + d.info.alchemy.map(a => {
    const can = d.stones >= a.stone && d.gold >= a.gold;
    return `<div class="alch-card t-${a.id}"><div class="alch-top"><span class="alch-fire">${a.emoji}</span><b>${a.name}</b>
        <span class="alch-cost"><span class="${d.stones >= a.stone ? '' : 'short'}">🔮 ${a.stone}</span> + <span class="${d.gold >= a.gold ? '' : 'short'}">💰 ${a.gold.toLocaleString()}G</span></span></div>
      <div class="alch-odds">${a.table.map(e => `<span>${e.text.replace('💎 프리즘 ', '💎')} <b>${pct(e.p)}</b></span>`).join('')}</div>
      <button class="btn primary sm" data-alch="${a.id}" ${can ? '' : 'disabled'}>⚗️ 돌리기</button></div>`;
  }).join('') + '</div>';
  if (alchLast) h += `<div class="prism-result ${alchLast.prism > 0 ? 'ok' : ''}">${esc(alchLast.msg)}</div>`;
  return h;
}
function capHTML(d) {
  const price = d.info.capsule.price, n10 = d.info.capsule.batchMax;
  let h = `<div class="cap-machine">${capsuleMachineSVG()}<div class="cap-side">
      <div class="cap-price">한 번 <b>${price.toLocaleString()}G</b><br><small>골드만 있으면 몇 번이든</small></div>
      <button class="btn primary" data-cap="1" ${d.gold < price ? 'disabled' : ''}>🧸 1회</button>
      <button class="btn primary" data-cap="${n10}" ${d.gold < price ? 'disabled' : ''}>🧸 ${n10}회 <small>${(price * n10).toLocaleString()}G</small></button></div></div>`;
  if (capLast) {
    h += '<div class="cap-results">' + capLast.results.map(r => `<span class="cap-ball k-${r.kind}${r.kind === 'prism' && r.n >= 10 ? ' big' : ''}">${esc(r.text)}</span>`).join('') + '</div>';
    h += `<div class="prism-result ${capLast.prism > 0 ? 'ok' : ''}">${esc(capLast.msg)}</div>`;
  }
  return h + oddsTable('캡슐 하나의 확률', d.info.capsule.table);
}
function pshopHTML(d) {
  return '<p class="hint" style="margin:0 0 10px">💎 프리즘으로만 살 수 있는 물건이에요.</p>' + d.shop.map(it =>
    `<div class="raid-boss"><span class="bemoji">${it.emoji}</span>
      <div class="binfo"><div class="bname">${it.nickPreview ? `<span class="nick-${it.nickPreview}">${esc(it.name)}</span>` : esc(it.name)} ${it.soldOut ? '<span class="shop-lim off">최대</span>' : `<small class="pprice">💎 ${it.price}</small>`}</div>
        ${it.locked ? `<div class="plock">🔒 ${esc(it.lockMsg)} 필요</div>` : ''}<div class="bstat">${esc(it.desc)}</div></div>
      <button class="btn sm primary" data-pbuy="${it.id}" ${it.soldOut || it.locked || d.prism < it.price ? 'disabled' : ''}>구매</button></div>`).join('');
}
async function doOpenBox(i) {
  const r = await api('box-open', 'POST', { pick: i });
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); render(); syncPrismFromMe();
  boxReveal = { pick: r.pick, boxes: r.boxes, got: r.got };
  paintPrism();
  const big = r.got.kind === 'prism' && r.got.n >= 5;
  sfx(big ? 'guaranteed' : 'pang'); vibe(big ? [20, 40, 60] : 15);
}
async function doAlchemy(tier) {
  const r = await api('alchemy', 'POST', { tier });
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); render(); syncPrismFromMe();
  alchLast = { prism: r.prism, msg: r.msg };
  paintPrism();
  sfx(r.prism > 0 ? 'pang' : 'fail'); vibe(r.prism > 0 ? 20 : [10, 30, 10]);
}
async function doCapsule(times) {
  const r = await api('capsule', 'POST', { times });
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); render(); syncPrismFromMe();
  capLast = { results: r.results, prism: r.prism, msg: r.msg };
  paintPrism();
  sfx(r.prism >= 10 ? 'guaranteed' : 'pang'); vibe(15);
}
async function doPrismBuy(item) {
  const r = await api('prism-buy', 'POST', { item });
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); render();
  toast(r.msg + (item === 'prismdye' || item === 'hammer' ? ' 🎒가방에서 사용하세요.' : ''), 'ok');
  const v = await api('prism'); if (v.ok) { prismData = v; paintPrism(); }   // 장비 칸 가격이 바뀌므로 새로 받는다
}

/* ---------- 인벤토리 ----------
 * 슬롯 1칸 = 아이템 me.inv.stackMax(999)개(같은 종류는 그만큼마다 한 칸씩 더 먹는다). 꽉 차면 드랍이 버려진다.
 * 칸수는 서버(me.inv.slots)가 계산해서 내려준다 — 클라는 하드코딩하지 않는다. */
let invSel = null;
function openInv() { el('invModal').hidden = false; renderInv(); }
function closeInv() { el('invModal').hidden = true; invSel = null; }
function renderInv() {
  if (!me) return;
  const inv = me.inv;
  el('invGold').textContent = me.gold.toLocaleString();
  el('invSlotInfo').textContent = inv.used + '/' + inv.slots + '칸' + (inv.full ? ' · 꽉 참!' : '');
  el('invSlotInfo').className = 'inv-slotinfo' + (inv.full ? ' full' : '');
  const cells = inv.cells.map(c =>
    `<button class="inv-cell ${invSel === c.id ? 'sel' : ''}" data-item="${c.id}">
       <span class="ic-emoji">${c.emoji}</span><span class="ic-count">${c.count}</span></button>`);
  for (let i = inv.cells.length; i < inv.slots; i++) cells.push('<span class="inv-cell empty"></span>');
  el('invGrid').innerHTML = cells.join('');
  const sel = inv.items.find(i => i.id === invSel);
  el('invDetail').innerHTML = sel
    ? `<div class="ivd-name">${sel.emoji} ${esc(sel.name)} <b>×${sel.count}</b>
         ${sel.count > inv.stackMax ? `<small>(${Math.ceil(sel.count / inv.stackMax)}칸)</small>` : ''}</div>
       <div class="ivd-desc">${esc(sel.desc)}</div>
       ${sel.kind === 'use' ? `<button class="btn primary sm" id="invUseBtn">사용하기</button>`
         : `<p class="hint" style="margin:6px 0 0">${sel.kind === 'mat' ? '초월 승급 재료예요.' : '조건이 되면 자동으로 쓰여요.'}</p>`}`
    : '<p class="hint" style="margin:0">아이템을 눌러 자세히 보기 · 한 칸에 ' + inv.stackMax + '개까지 쌓여요</p>';
  // 칸은 상점 1회 패키지 + 배틀패스 프리미엄 보상으로만 열린다(골드 반복 확장 없음)
  const hint = el('invSlotHint');
  hint.innerHTML = inv.atMaxSlots ? '가방이 최대 ' + inv.max + '칸까지 열렸어요.'
    : [!inv.packBought ? '🛒 상점 <b>가방 확장 패키지</b> +' + inv.packSlots + '칸 (' + inv.packPrice.toLocaleString() + 'G · 1회)' : null,
       '🎟️ 배틀패스 프리미엄 <b>Lv.' + inv.bpLevel + '</b> 보상 +' + inv.bpSlots + '칸'].filter(Boolean).join('<br>');
  el('invGrid').querySelectorAll('[data-item]').forEach(b => {
    b.onclick = () => { invSel = invSel === b.dataset.item ? null : b.dataset.item; renderInv(); };
  });
  const ub = el('invUseBtn');
  if (ub) ub.onclick = () => act(() => doUseItem(sel.id), ub);
}
async function doUseItem(itemId) {
  if (itemId === 'eltkt') {
    if (me.level < me.rerollMin) return toast('🔁 재련은 🟣에픽(+' + me.rerollMin + ') 이상 무기만 할 수 있어요. (지금 +' + me.level + ')', 'bad');
    if (!confirm('🔁 속성 재련권을 쓸까요?\n장착한 무기: ' + me.weapon + '\n강화 +' + me.level + ' → +' + (me.level - me.rerollCost) + ' (−' + me.rerollCost + ')\n속성은 무작위로 바뀌어요 (지금 ' + me.elementEmoji + ' ' + me.elementName + ' 제외)')) return;
  }
  const r = await api('use-item', 'POST', { item: itemId });
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me);
  if (r.needReselect) { closeInv(); render(); return showClassSelect(); }
  render(); renderInv();
  toast(r.msg, 'ok');
}


/* ---------- 토스트 ---------- */
let toastTimer = null;
function toast(msg, kind) {
  const t = el('toast');
  t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

/* ---------- 햅틱(진동) ----------
 * 안드로이드 등 Vibration API 지원 기기에서만 울림. iOS Safari 는 미지원 → 조용히 무시.
 * (iOS 17.4+ <input switch> 편법도 시도해봤으나 실기기에서 동작 안 해 제거) */
function vibe(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* noop */ } }

/* ---------- 효과음 (Web Audio, 파일 없이 합성) ----------
 * iOS 주의: 무음 스위치가 켜져 있으면 Web Audio 도 막힌다(하드웨어 제약).
 * 오디오는 사용자 제스처 후에만 시작 가능 → 첫 터치에서 컨텍스트 unlock. */
let audioCtx = null;
let soundOn = localStorage.getItem('soundOff') !== '1';
function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { audioCtx = null; }
  return audioCtx;
}
// 톤 1개: 주파수·길이·파형·볼륨, freqTo 주면 스윕
function tone(freq, dur, type, vol, freqTo, delay) {
  const ctx = audioCtx; if (!ctx) return;
  const t0 = ctx.currentTime + (delay || 0);
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
}
function sfx(name) {
  if (!soundOn || !ensureAudio()) return;
  switch (name) {
    case 'click':   tone(300, 0.035, 'square', 0.06); break;                 // 버튼 누름
    case 'mine':    tone(150, 0.05, 'square', 0.10, 80); break;              // 곡괭이질
    case 'break':   tone(210, 0.12, 'triangle', 0.16, 90); break;           // 돌 파괴
    case 'jackpot': [523, 659, 880].forEach((f, i) => tone(f, 0.13, 'triangle', 0.16, null, i * 0.06)); break;
    case 'hit':     tone(170, 0.06, 'square', 0.12, 95); break;             // 타격
    case 'kill':    tone(300, 0.13, 'triangle', 0.17, 150); break;          // 처치
    case 'crit':    tone(540, 0.16, 'sawtooth', 0.2, 200); tone(820, 0.12, 'square', 0.14, null, 0.05); break;
    case 'success': tone(620, 0.14, 'triangle', 0.18, 940); break;          // 강화 성공(상승)
    case 'guaranteed': [523, 784, 1046].forEach((f, i) => tone(f, 0.14, 'triangle', 0.18, null, i * 0.07)); break;
    case 'destroy': tone(200, 0.4, 'sawtooth', 0.24, 45); break;            // 파괴(하강 붕괴)
    case 'protect': tone(520, 0.1, 'sine', 0.18); tone(720, 0.1, 'sine', 0.16, null, 0.08); break;
    case 'fail':    tone(150, 0.06, 'sine', 0.08); break;
    case 'coin':    tone(900, 0.08, 'square', 0.12, 1250); break;
    case 'charge':  tone(180, 0.42, 'sawtooth', 0.11, 900); tone(360, 0.42, 'sine', 0.06, 1400); break; // 슈우웅(상승)
    case 'pang':    tone(880, 0.1, 'triangle', 0.22, 1500); tone(1320, 0.12, 'square', 0.14, null, 0.03); tone(660, 0.18, 'triangle', 0.12, null, 0.05); break; // 팡!
    case 'clink':   [1400, 1000, 1700, 800].forEach((f, i) => tone(f, 0.07, 'square', 0.12, f * 0.7, i * 0.045)); break; // 쨍그랑
  }
}
// 첫 사용자 제스처에서 오디오 unlock (iOS 자동재생 정책)
document.addEventListener('pointerdown', () => ensureAudio(), { once: true, capture: true });

/* ---------- 확대(핀치 줌) 차단 ----------
 * 안드로이드: viewport user-scalable=no. iOS Safari 는 그걸 무시하므로 제스처 이벤트를 막는다.
 * 한 손가락 스크롤/탭은 그대로 두고, 두 손가락(핀치)만 차단. */
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });

/* ---------- 전역 로딩 표시 ----------
 * 사용자 동작(액션·탭전환·프로필·직업선택 등)이 서버 응답을 기다리는 동안 상단에
 * 진행바 + "로딩 중…" 표시. 아주 짧은 요청은 깜빡임 방지를 위해 살짝 지연 후 표시. */
let loadCount = 0, loadShowTimer = null;
function ensureLoadingEl() {
  let g = document.getElementById('globalLoading');
  if (!g) {
    g = document.createElement('div');
    g.id = 'globalLoading';
    g.innerHTML = '<div class="gl-bar"></div><div class="gl-pill"><span class="spinner"></span> 로딩 중…</div>';
    document.body.appendChild(g);
  }
  return g;
}
function loadStart() {
  loadCount++;
  if (loadCount === 1 && !loadShowTimer) {
    loadShowTimer = setTimeout(() => { ensureLoadingEl(); document.body.classList.add('loading-on'); loadShowTimer = null; }, 160);
  }
}
function loadEnd() {
  loadCount = Math.max(0, loadCount - 1);
  if (loadCount === 0) {
    if (loadShowTimer) { clearTimeout(loadShowTimer); loadShowTimer = null; }
    document.body.classList.remove('loading-on');
  }
}
async function withLoad(fn) { loadStart(); try { return await fn(); } finally { loadEnd(); } }
// 강화 버튼 누른 순간: 무기 충전(슈우웅) — 서버 응답 대기 동안 loop
function chargeWeapon() {
  const art = el('weaponArt');
  art.classList.remove('pop', 'crack', 'shake'); void art.offsetWidth;
  art.classList.add('charging');
  sfx('charge'); vibe(4);
}
// 강화 결과: 성공=팡(pop)·실패/파괴=쨍그랑(crack) + 파티클
function weaponResult(kind) {   // 'success' | 'protect' | 'fail' | 'destroy'
  const art = el('weaponArt'), panel = document.querySelector('.weapon-panel');
  art.classList.remove('charging', 'pop', 'crack', 'shake');
  panel.classList.remove('ok', 'bad');
  void art.offsetWidth; void panel.offsetWidth;
  const good = kind === 'success' || kind === 'protect';
  art.classList.add(good ? 'pop' : 'crack');
  panel.classList.add(good ? 'ok' : 'bad');
  if (FX && FX.sparks) return forgeBurst(kind);
  if (kind === 'success') spawnEnhParticles(['✨', '💫', '⭐', '🌟'], 9);
  else if (kind === 'protect') spawnEnhParticles(['🛡️', '✨'], 6);
  else if (kind === 'destroy') spawnEnhParticles(['💥', '🔥', '💢'], 9);
  else spawnEnhParticles(['💢', '💨'], 4);
}
// 결과별 불꽃: 성공=금빛 별 + 고리 · 방지=담금질 물빛 · 파괴=쇳물이 사방으로 · 실패=식은 쇳가루
const FORGE_BURSTS = {
  success: { sparkColor: ['#fff6df', '#ffd27a', '#ff9a3c'], sparkCount: 18, sparkRadius: 96, sparkSize: 12, shape: 'star', ring: true, gravity: 0.25, duration: 720, glow: 1 },
  protect: { sparkColor: ['#e6f3fb', '#7fb4d6', '#ffffff'], sparkCount: 14, sparkRadius: 70, sparkWidth: 2.5, shape: 'dot', ring: true, gravity: 0.2, duration: 600, glow: 0.8 },
  destroy: { sparkColor: ['#ef4f45', '#ff7a1a', '#ffd27a'], sparkCount: 24, sparkRadius: 118, sparkSize: 14, shape: 'streak', gravity: 1.3, duration: 820, glow: 1 },
  fail: { sparkColor: ['#8a7a6b', '#c9b8a6'], sparkCount: 7, sparkRadius: 36, shape: 'line', gravity: 0.9, duration: 380, glow: 0 },
};
function forgeBurst(kind) {
  const rc = el('weaponArt').getBoundingClientRect();
  const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
  FX.sparks.burst(cx, cy, FORGE_BURSTS[kind] || FORGE_BURSTS.fail);
  if ((kind === 'success' || kind === 'destroy') && FX.embers) FX.embers.burst(cx, cy);
}
function spawnEnhParticles(emojis, count) {
  const art = el('weaponArt'); if (!art) return;
  const rc = art.getBoundingClientRect();
  const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'enh-particle';
    s.textContent = emojis[i % emojis.length];
    s.style.left = cx + 'px'; s.style.top = cy + 'px';
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 60 + Math.random() * 50;
    s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    s.style.setProperty('--dy', (Math.sin(ang) * dist - 20) + 'px');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 700);
  }
}

/* ---------- 액션 ---------- */
async function doEnhance() {
  chargeWeapon();   // 슈우웅 — 응답 대기 동안 충전 연출
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const r = await api('enhance', 'POST');
  if (!r.ok) { el('weaponArt').classList.remove('charging'); return toast(r.error, 'bad'); }
  // 서버가 빨라도 충전 연출이 최소 300ms 는 보이도록(슈우웅→팡 리듬 유지)
  const wait = 300 - ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  if (wait > 0) await new Promise(res => setTimeout(res, wait));
  applyMe(r.me); render();
  if (r.result === 'success') { toast(r.msg, 'ok'); weaponResult('success'); vibe(r.guaranteed ? [18, 40, 30] : 16); sfx(r.guaranteed ? 'guaranteed' : 'success'); sfx('pang'); }
  else if (r.result === 'destroy') { toast(r.msg, 'bad'); weaponResult('destroy'); vibe([30, 50, 30, 50, 40]); sfx('destroy'); sfx('clink'); }
  else if (r.result === 'protected') { toast(r.msg, 'info'); weaponResult('protect'); vibe([20, 35, 20]); sfx('protect'); sfx('pang'); }
  else { toast(r.msg, ''); weaponResult('fail'); vibe(8); sfx('clink'); }   // 실패 = 쨍그랑
  if (['rank', 'log', 'hogu'].includes(currentTab)) loadTab();
}
/* ---------- 사냥터: 몬스터 연타 처치 ----------
 * 채굴 돌과 같은 원칙: 몬스터 1마리 = 서버콜(hunt) 1회. 탭은 연출이고,
 * 스폰 때 서버가 결과를 정한 뒤(보상은 서버에 즉시 반영) 마지막 타격에 실제 치명타를 리빌한다. */
const HUNT_TAP_MS = 70;              // 사냥 연타 최소 간격(매크로는 서버 속도제한이 막음)
const HUNT_SPAWN_DELAY = 650;        // 처치 후 다음 몬스터 스폰까지 대기(연출 감상용)
let huntOpen = false, huntSession = 0, huntKills = 0;
let huntCur = null, huntSpawning = false, huntLastTap = 0;
function openHunt() {
  if (!me) return;
  huntOpen = true;
  el('huntModal').hidden = false;
  updateHuntHud();
  if (huntCur && !huntCur.dead) {
    restoreHuntMonster();   // 진행 중이던 몬스터 복원 — 껐다 켜도 리롤 불가(죽여야 다음 몬스터)
  } else {
    huntSession = 0; huntKills = 0; huntCur = null;
    el('huntFb').textContent = '';
    spawnHuntMonster();
  }
}
// 모달을 닫아도 huntCur 는 유지(다시 열면 같은 몬스터). 죽여야만 새 몬스터가 나온다.
function closeHunt() { huntOpen = false; el('huntModal').hidden = true; }
function restoreHuntMonster() {
  const c = huntCur; if (!c) return;
  const m = c.r.monster;
  const monEl = el('huntMon');
  monEl.className = 'hunt-mon t' + (m.tier || 0);
  monEl.querySelector('.hunt-emoji').textContent = m.emoji;
  el('huntName').innerHTML = m.emoji + ' [' + esc(m.name) + '] <small>' + esc(m.rarity) + '</small>';
  el('huntHpFill').style.width = Math.max(0, 100 - c.taps / c.need * 100) + '%';
  el('huntFb').textContent = c.r.overtime ? '♾️ 무한 사냥 (보상↓)' : '연타해서 처치!';
}
function updateHuntHud() {
  if (!me) return;
  const overtime = me.huntsLeft <= 0;
  el('huntCount').textContent = overtime ? '♾️ 무한 사냥' : ('오늘 ' + (me.dailyHunts - me.huntsLeft) + '/' + me.dailyHunts);
  el('huntSession').innerHTML = '처치 <b>' + huntKills + '</b> · 획득 💰 <b>+' + huntSession.toLocaleString() + 'G</b>';
}
async function spawnHuntMonster() {
  if (!huntOpen || huntSpawning) return;
  huntSpawning = true;
  // 이전 몬스터는 죽은(사라진) 상태 그대로 유지한 채 다음 몬스터를 받아온다.
  // (여기서 'dead' 를 미리 지우면 응답 대기 동안 방금 잡은 몬스터가 되살아나 보임)
  const r = await withLoad(() => api('hunt', 'POST'));   // 서버가 몬스터·보상·치명타 결정(보상은 서버에 즉시 반영)
  huntSpawning = false;
  if (!huntOpen) return;                  // 그새 닫힘
  if (!r.ok) { el('huntFb').textContent = r.error + ' — 잠시 후 다시'; huntCur = null;
    setTimeout(() => { if (huntOpen && !huntCur) spawnHuntMonster(); }, 1200); return; }
  const m = r.monster;
  const need = Math.min(7, 4 + (m.tier || 0));   // 강한(희귀) 몬스터일수록 더 여러 번
  huntCur = { r, taps: 0, need, dmgPerTap: Math.max(1, Math.ceil((m.hp || 10) / need)) };
  const monEl = el('huntMon');
  monEl.className = 'hunt-mon t' + (m.tier || 0);   // 'dead' 제거 + 새 등급 = 새 몬스터로 즉시 교체
  monEl.querySelector('.hunt-emoji').textContent = m.emoji;
  el('huntName').innerHTML = m.emoji + ' [' + esc(m.name) + '] <small>' + esc(m.rarity) + '</small>';
  el('huntHpFill').style.width = '100%';
  el('huntFb').textContent = r.overtime ? '♾️ 무한 사냥 (보상↓)' : '연타해서 처치!';
}
function tapMonster(e) {
  if (e) e.preventDefault();
  if (!huntOpen || !huntCur || huntCur.dead) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (now - huntLastTap < HUNT_TAP_MS) return;
  huntLastTap = now;
  const c = huntCur; c.taps++;
  const last = c.taps >= c.need;
  const isCrit = last && c.r.crit;                 // 실제 치명타는 마지막 타격에 표시
  vibe(isCrit ? [12, 28, 22] : last ? 18 : 7);     // 타격 햅틱(처치·치명타는 강하게)
  sfx(isCrit ? 'crit' : last ? 'kill' : 'hit');
  const monEl = el('huntMon');
  if (monEl) { monEl.classList.remove('hit'); void monEl.offsetWidth; monEl.classList.add('hit'); }
  spawnHuntDmg(isCrit ? c.dmgPerTap * 2 : c.dmgPerTap, isCrit);
  el('huntHpFill').style.width = Math.max(0, 100 - c.taps / c.need * 100) + '%';
  if (last) killMonster();
}
function killMonster() {
  const c = huntCur; if (!c || c.dead) return;
  c.dead = true;
  const r = c.r;
  const monEl = el('huntMon'); if (monEl) monEl.classList.add('dead');
  applyMe(r.me); huntSession += r.gold; huntKills++; render();  // 서버 반영분을 이제 화면에 리빌
  let msg = '💰 +' + r.gold.toLocaleString() + 'G' + (r.crit ? ' 💥치명타!' : '');
  if (r.drop) msg += r.drop.type === 'potion' ? '  ' + r.drop.text : '  🎁' + r.drop.text;
  if (r.mat) msg += '  ' + r.mat.text;
  if (r.loot) for (const l of r.loot) msg += '  ' + l.text;   // 🗝️ 상자 열쇠 · 🔮 마석
  spawnHuntReward(msg, r.crit);
  updateHuntHud();
  setTimeout(() => { if (huntOpen) spawnHuntMonster(); }, HUNT_SPAWN_DELAY);
}
// 떠오르는 데미지 숫자 (fixed — 모달 위에 표시)
function spawnHuntDmg(n, crit) {
  const mon = el('huntMon'); if (!mon) return;
  const rc = mon.getBoundingClientRect();
  const t = document.createElement('div');
  t.className = 'hunt-dmg' + (crit ? ' crit' : '');
  t.textContent = (crit ? '💥' : '') + '-' + n.toLocaleString();
  t.style.left = (rc.left + rc.width * (0.3 + Math.random() * 0.4)) + 'px';
  t.style.top = (rc.top + rc.height * 0.3) + 'px';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 650);
}
function spawnHuntReward(text, crit) {
  const mon = el('huntMon'); if (!mon) return;
  const rc = mon.getBoundingClientRect();
  const t = document.createElement('div');
  t.className = 'hunt-reward' + (crit ? ' crit' : '');
  t.textContent = text;
  t.style.left = (rc.left + rc.width / 2) + 'px';
  t.style.top = (rc.top + rc.height * 0.15) + 'px';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1000);
}
/* ---------- 채굴장(모달): 돌 깨기(능동) + 자동채굴 누적 수령 ----------
 * 돌을 연타(최소 0.1초 간격)해서 깨면 곡괭이질 1회(mine-swing) 발동.
 * 돌 하나 = 서버 요청 1회로 묶어 연타해도 속도제한(초당 3)에 안 걸리게 한다. */
let mineSession = 0, lastMineFb, mineOpen = false;
const MINE_TAP_MS = 100;   // 최소 연타 간격(0.1초) — 이보다 빠른 탭은 무시
const ROCK_TAPS = 5;       // 돌 하나 깨는 데 필요한 타격 수
let rockHits = 0, rockBusy = false, lastTapTs = 0;
function openMine() {
  if (!me) return;
  mineOpen = true; mineSession = 0; lastMineFb = null; rockHits = 0; rockBusy = false;
  el('mineModal').hidden = false;
  renderMinePanel();
}
function closeMine() { mineOpen = false; el('mineModal').hidden = true; }
// 자동채굴 누적 골드 수령
async function doMineCollect() {
  const r = await withLoad(() => api('mine', 'POST'));
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); mineSession += r.amount; render(); vibe(12); sfx('coin');
  renderMinePanel({ text: '🕳️ 자동채굴 수령 +' + r.amount.toLocaleString() + 'G', kind: 'ok' });
}
function renderMinePanel(fb) {
  if (!mineOpen || !me) return;
  if (fb !== undefined) lastMineFb = fb;
  const f = lastMineFb;
  const stPct = Math.round(me.stamina / me.staminaMax * 100);
  const xpPct = Math.round(me.mineXp / me.mineXpNext * 100);
  const tired = me.stamina < 8;
  el('mineBody').innerHTML =
    `<div class="mine-top">
       <span class="mine-lv">⛏️ 채굴 <b>Lv.${me.mineLevel}</b></span>
       <span class="mine-xptxt">${me.mineXp}/${me.mineXpNext} XP</span>
     </div>
     <div class="mine-bar xp"><div class="mine-fill xp" style="width:${xpPct}%"></div></div>
     <div class="mine-stamlabel">💪 기력 <span>${me.stamina}/${me.staminaMax}</span></div>
     <div class="mine-bar stam"><div class="mine-fill stam${tired ? ' low' : ''}" style="width:${stPct}%"></div></div>
     <div class="rock-stage">
       <div id="rock" class="rock${tired ? ' tired' : ''}" data-rock role="button" aria-label="돌 깨기">
         <span class="rock-emoji">🪨</span>
       </div>
     </div>
     <div class="rock-crackbar"><div id="rockCrackFill" class="rock-crackfill"></div></div>
     <div class="rock-hint">${tired ? '💤 지친 곡괭이질(보상↓) — 시간당 기력 회복' : '🪨 돌을 연타해서 깨세요!'}</div>
     <div class="mine-fb ${f ? f.kind : ''}">${f ? f.text : (tired
        ? '기력이 바닥이라 지친 곡괭이질만 돼요.'
        : '돌을 깨면 골드·숙련도 획득.<br>기력이 있으면 💥노다지·💎원석 찬스!')}</div>
     <div class="mine-auto">
       <span>🕳️ 자동채굴 누적 <b>+${(me.mine || 0).toLocaleString()}G</b></span>
       <button class="btn sm primary" id="mineCollectBtn" ${(me.mine || 0) <= 0 ? 'disabled' : ''}>수령</button>
     </div>
     <div class="mine-session">이번 세션 획득 💰 <b>+${mineSession.toLocaleString()}G</b></div>`;
  const rock = document.getElementById('rock');
  if (rock) rock.addEventListener('pointerdown', tapRock);
  const cb = document.getElementById('mineCollectBtn');
  if (cb) cb.onclick = doMineCollect;
  updateRockVisual();
}
function updateRockVisual() {
  const rock = document.getElementById('rock');
  if (rock) rock.style.setProperty('--dmg', (rockHits / ROCK_TAPS).toFixed(3));
  const fill = document.getElementById('rockCrackFill');
  if (fill) fill.style.width = Math.min(100, rockHits / ROCK_TAPS * 100) + '%';
}
function tapRock(e) {
  if (e) e.preventDefault();
  if (!mineOpen) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (rockBusy || now - lastTapTs < MINE_TAP_MS) return;  // 처리 중이거나 0.1초 이내 연타 → 무시
  lastTapTs = now;
  rockHits++;
  vibe(7); sfx('mine');    // 곡괭이질 피드백
  const rock = document.getElementById('rock');
  if (rock) { rock.classList.remove('hit'); void rock.offsetWidth; rock.classList.add('hit'); }
  updateRockVisual();
  if (rockHits >= ROCK_TAPS) {           // 돌 완파 → 곡괭이질 1회 발동
    rockBusy = true;
    if (rock) rock.classList.add('breaking');
    breakRock();
  }
}
async function breakRock() {
  const r = await withLoad(() => api('mine-swing', 'POST'));
  if (!r.ok) {
    rockHits = 0; rockBusy = false; updateRockVisual();
    const rock = document.getElementById('rock'); if (rock) rock.classList.remove('breaking');
    return toast(r.error, 'bad');
  }
  applyMe(r.me); mineSession += r.gold; render();
  vibe(r.jackpot || r.gem ? [14, 30, 20] : 16);   // 돌 파괴 햅틱(노다지·원석은 강하게)
  sfx(r.jackpot || r.gem ? 'jackpot' : 'break');
  spawnRockReward(r);
  setTimeout(() => {
    rockHits = 0; rockBusy = false;
    renderMinePanel({ text: r.msg, kind: r.jackpot ? 'ok' : r.gem ? 'info' : r.tired ? 'tired' : '' });
    if (r.leveledTo) toast('🎉 채굴 레벨 ' + r.leveledTo + ' 달성! 채굴 수익 증가', 'ok');
    else if (r.gem && r.gem.type === 'protect') toast(r.gem.text, 'info');
    else if (r.gem && r.gem.type === 'full') toast(r.gem.text, 'bad');
  }, 240);
}
// 보상 텍스트·파편은 body 에 fixed 로 띄운다(패널이 곧 리렌더돼도 애니메이션 유지)
function spawnRockReward(r) {
  const rock = document.getElementById('rock');
  const rc = rock ? rock.getBoundingClientRect() : null;
  const cx = rc ? rc.left + rc.width / 2 : window.innerWidth / 2;
  const cy = rc ? rc.top + rc.height / 2 : window.innerHeight / 2;
  const t = document.createElement('div');
  t.className = 'rock-reward' + (r.jackpot ? ' big' : '');
  t.style.left = cx + 'px'; t.style.top = cy + 'px';
  t.textContent = (r.jackpot ? '💥 ' : '') + '+' + r.gold.toLocaleString() + 'G' + (r.gem ? ' 💎' : '');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 950);
  for (let i = 0; i < 5; i++) {   // 파편 튀기기
    const s = document.createElement('div');
    s.className = 'rock-shard';
    s.textContent = '🪨';
    s.style.left = cx + 'px'; s.style.top = cy + 'px';
    const ang = (Math.PI * 2 * i) / 5 + i * 0.3;
    s.style.setProperty('--dx', Math.cos(ang) * 60 + 'px');
    s.style.setProperty('--dy', (Math.sin(ang) * 60 - 20) + 'px');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 550);
  }
}
async function doAttend() {
  const r = await api('attend', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); render(); toast('📅 ' + r.msg, 'ok');
}
async function doBuy(item) {
  const r = await api('shop-buy', 'POST', { item });
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); render();
  // 염색약·직업변경권은 구매 즉시 발동하지 않는다 — 가방에서 '사용하기'
  const useHint = item === 'dye' ? ' 🎒가방에서 사용하세요.' : '';
  toast((r.msg || '구매 완료') + useHint, 'ok');
  if (currentTab === 'shop') loadTab();
}
async function doFight(target) {
  const r = await api('fight', 'POST', { target });
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); render();
  let msg = (r.iWon ? '🏆 승리! ' : '😢 패배... ') + r.winner + ' 승 (💰' + r.steal + ' 이동)';
  if (r.broke) msg += ' · 💢' + r.broke.who + ' 무기 +' + r.broke.from + '→+' + r.broke.to;
  toast(msg, r.iWon ? 'ok' : 'bad');
  loadTab();
}

/* ---------- 파티 / 레이드 (폴링 기반 실시간 관전) ---------- */
let raidTimer = null, curRaid = null, cacheParties = [], cachePlayers = [], BOSS_CACHE = [], BOSS_HPSCALE = 0.7;
let lastFetch = 0, dismissedRaidTs = null, lastPartyHtml = '';

async function doPartyCreate() { const r = await api('party-create', 'POST'); if (!r.ok) return toast(r.error, 'bad'); applyMe(r.me); await refreshRaidData(); paintRaid(); }
async function doPartyLeave() { const r = await api('party-leave', 'POST'); if (!r.ok) return toast(r.error, 'bad'); applyMe(r.me); if (curRaid) dismissedRaidTs = curRaid.startTs; await refreshRaidData(); paintRaid(); }
async function doPartyJoin(id) { const r = await api('party-join', 'POST', { id }); if (!r.ok) return toast(r.error, 'bad'); applyMe(r.me); await refreshRaidData(); paintRaid(); }
async function doInvite(nick) { const r = await api('party-invite', 'POST', { nick }); toast(r.ok ? ('📨 ' + r.msg) : r.error, r.ok ? 'info' : 'bad'); await refreshRaidData(); paintRaid(); }
async function doAccept(id) { const r = await api('party-accept', 'POST', { id }); if (!r.ok) return toast(r.error, 'bad'); applyMe(r.me); await refreshRaidData(); paintRaid(); }
async function doReject(id) { await api('party-reject', 'POST', { id }); await refreshRaidData(); paintRaid(); }
async function doRaid(boss) {
  const r = await api('raid', 'POST', { boss });
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); curRaid = r.raid; dismissedRaidTs = null; raidBuiltFor = null; raidFinishing = false; raidLocalHits = 0;
  paintRaid();
}
function closeRaid() { if (curRaid) dismissedRaidTs = curRaid.startTs; lastPartyHtml = ''; raidBuiltFor = null; paintRaid(); }

/* ---------- 인터랙티브 레이드 전투(연타) ---------- */
const RAID_TAP_MS = 70;      // 보스 연타 최소 간격
const RAID_FLUSH_MS = 700;   // 누적 타수 서버 제출 주기
let raidLocalHits = 0, raidLastTap = 0, raidFlushT = null, raidBuiltFor = null, raidFinishing = false, raidLastPoll = 0;
const SKILL_LABEL = { warrior: '⚔️ 강타', archer: '🏹 난사', tanker: '🛡️ 철벽', healer: '✨ 치유의 물결' };

// 배틀 스켈레톤을 레이드당 1회만 만든다(연타 반응성 유지). 이후엔 값만 갱신.
function renderBattle(raid) {
  const panel = el('panel');
  const active = raid.status === 'active';
  panel.innerHTML =
    `<div class="raid-battle">
       <div class="raid-timerrow"><span class="raid-boss-name">${raid.boss.emoji} ${esc(raid.boss.name)}</span>
         <span class="raid-timer">⏱ <b id="rTimer">--</b></span></div>
       <div class="raid-stage"><div id="rBoss" class="raid-mon${active ? '' : ' dead'}" role="button" aria-label="보스 공격"><span class="rmon-emoji">${raid.boss.emoji}</span></div></div>
       <div class="rbar-label">보스 HP <span id="rBossTxt"></span></div>
       <div class="rbar"><div id="rBossHp" class="rbar-fill boss"></div></div>
       <div class="rbar-label">파티 HP <span id="rPartyTxt"></span> <small id="rDr"></small></div>
       <div class="rbar"><div id="rPartyHp" class="rbar-fill party"></div></div>
       <div id="rParts" class="raid-parts"></div>
       <button id="rSkillBtn" class="btn primary sm raid-skillbtn"></button>
       <div id="rEvents" class="raid-events"></div>
       <div id="rResult" class="raid-resultwrap"></div>
     </div>`;
  const boss = el('rBoss');
  if (boss) boss.addEventListener('pointerdown', tapRaidBoss);
  const sk = document.getElementById('rSkillBtn');
  if (sk) sk.onclick = doRaidSkill;
  raidBuiltFor = raid.startTs;
  updateBattleUI();
}
function myRaidPart() { return curRaid && curRaid.participants.find(p => p.nick === (me && me.nick)); }
function updateBattleUI() {
  if (!curRaid) return;
  const raid = curRaid, active = raid.status === 'active';
  const remain = Math.max(0, raid.startTs + raid.duration - Date.now());
  const tEl = document.getElementById('rTimer'); if (tEl) tEl.textContent = active ? (remain / 1000).toFixed(1) + 's' : '종료';
  const bh = document.getElementById('rBossHp'), bt = document.getElementById('rBossTxt');
  if (bh) bh.style.width = Math.max(0, raid.bossHP / raid.bossMax * 100) + '%';
  if (bt) bt.textContent = raid.bossHP.toLocaleString() + ' / ' + raid.bossMax.toLocaleString();
  const ph = document.getElementById('rPartyHp'), pt = document.getElementById('rPartyTxt'), dr = document.getElementById('rDr');
  if (ph) { ph.style.width = raid.partyHP + '%'; ph.classList.toggle('low', raid.partyHP <= 30); }
  if (pt) pt.textContent = raid.partyHP + '%';
  if (dr) dr.textContent = raid.dr ? '🛡️피해감소 ' + raid.dr + '%' : '';
  const parts = document.getElementById('rParts');
  if (parts) parts.innerHTML = raid.participants.map(p =>
    `<span class="raid-part${p.nick === (me && me.nick) ? ' me' : ''}">${p.classEmoji}${esc(p.nick)} <b>${p.contrib.toLocaleString()}</b>${p.skillUsed ? ' ✨' : ''}</span>`).join('');
  const ev = document.getElementById('rEvents');
  if (ev) ev.innerHTML = (raid.events || []).slice(-5).map(e => `<div class="raid-ev">${esc(e.text)}</div>`).join('');
  // 스킬 버튼
  const mine = myRaidPart(), sk = document.getElementById('rSkillBtn');
  if (sk) {
    if (!mine) { sk.style.display = 'none'; }
    else {
      sk.style.display = '';
      sk.textContent = SKILL_LABEL[mine.class] || '스킬';
      sk.disabled = !active || mine.skillUsed;
    }
  }
  const boss = document.getElementById('rBoss');
  if (boss && !active) boss.classList.add('dead');
  // 결과
  if (!active) {
    const res = document.getElementById('rResult');
    if (res && !res.dataset.done) {
      res.dataset.done = '1';
      const parts2 = raid.participants.slice().sort((a, b) => b.contrib - a.contrib);
      res.innerHTML = `<div class="raid-result ${raid.win ? 'win' : 'lose'}"><b>${raid.win ? '🏆 레이드 성공!' : '☠️ 레이드 실패...'}</b>` +
        (raid.win && raid.rewards && raid.rewards.length ? '<br>' + raid.rewards.map(rw => esc(rw.nick) + ' 💰+' + rw.gold.toLocaleString() + (rw.drop ? ' ' + rw.drop : '') + (rw.essence ? ' 🌟+' + rw.essence : rw.invFull ? ' 🎒꽉참' : '')).join('<br>') : '') +
        `<div class="raid-mvp">기여: ${parts2.map(p => esc(p.nick) + ' ' + p.contrib.toLocaleString()).join(' · ')}</div>` +
        `</div><button class="btn ghost sm" id="closeRaidBtn" style="margin-top:8px">닫기</button>`;
      sfx(raid.win ? 'jackpot' : 'destroy'); vibe(raid.win ? [15, 40, 25] : [40, 60, 40]);
      pollMe();   // 보상 반영(상단바 골드) — 낡은 폴링 가드 포함
    }
  }
}
function tapRaidBoss(e) {
  if (e) e.preventDefault();
  if (!curRaid || curRaid.status !== 'active') return;
  if (curRaid.startTs + curRaid.duration <= Date.now()) return;   // 타임아웃
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (now - raidLastTap < RAID_TAP_MS) return;
  raidLastTap = now; raidLocalHits++;
  vibe(6); sfx('hit');
  const boss = document.getElementById('rBoss');
  if (boss) { boss.classList.remove('hit'); void boss.offsetWidth; boss.classList.add('hit'); }
  spawnRaidSpark();
  if (!raidFlushT) raidFlushT = setTimeout(flushRaidHits, RAID_FLUSH_MS);
}
async function flushRaidHits() {
  raidFlushT = null;
  const hits = raidLocalHits; raidLocalHits = 0;
  if (hits <= 0 || !curRaid || curRaid.status !== 'active') return;
  const r = await api('raid-hit', 'POST', { hits });
  if (r && r.ok && r.raid) { curRaid = r.raid; if (r.me) applyMe(r.me); if (raidBuiltFor === curRaid.startTs) updateBattleUI(); }
}
async function doRaidSkill() {
  if (!curRaid || curRaid.status !== 'active') return;
  const r = await api('raid-skill', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  if (r.raid) { curRaid = r.raid; if (r.me) applyMe(r.me); updateBattleUI(); }
  if (r.skillText) { toast(r.skillText, 'info'); sfx(r.skillKind === 'dmg' ? 'crit' : r.skillKind === 'heal' ? 'success' : 'protect'); vibe([15, 30, 20]); }
}
async function raidPoll() {
  raidLastPoll = Date.now();
  try { const r = await api('party-raid'); if (r && r.ok) { curRaid = r.raid; if (curRaid && raidBuiltFor === curRaid.startTs) updateBattleUI(); } } catch (e) { /* 무시 */ }
}
async function maybeFinishRaid() {
  if (raidFinishing || !curRaid) return;
  const ended = curRaid.status === 'done' || curRaid.projectedEnded || curRaid.startTs + curRaid.duration <= Date.now();
  if (curRaid.status === 'active' && ended) {
    raidFinishing = true;
    if (raidLocalHits > 0) { if (raidFlushT) { clearTimeout(raidFlushT); raidFlushT = null; } await flushRaidHits(); }
    const r = await api('raid-finish', 'POST');
    if (r && r.ok && r.raid) { curRaid = r.raid; if (r.me) applyMe(r.me); }
    raidFinishing = false;
    updateBattleUI();
  }
}
function spawnRaidSpark() {
  const boss = document.getElementById('rBoss'); if (!boss) return;
  const rc = boss.getBoundingClientRect();
  const s = document.createElement('div');
  s.className = 'raid-spark';
  s.textContent = '⚔️';
  s.style.left = (rc.left + rc.width * (0.3 + Math.random() * 0.4)) + 'px';
  s.style.top = (rc.top + rc.height * 0.35) + 'px';
  document.body.appendChild(s);
  setTimeout(() => s.remove(), 420);
}

async function refreshRaidData() {
  lastFetch = Date.now();
  try {
    if (!BOSS_CACHE.length) { const br = await api('bosses'); BOSS_CACHE = br.bosses || []; BOSS_HPSCALE = br.partyHpScale || 0.7; }
    const [meR, raidR, partiesR, playersR] = await Promise.all([api('me'), api('party-raid'), api('parties'), api('players')]);
    if (meR.ok && applyMe(meR.me)) { render(); seedInvites(); } // ts 가드 + 초대 seen 처리
    curRaid = raidR.raid; cacheParties = partiesR.list || []; cachePlayers = playersR.list || [];
  } catch (e) { /* 네트워크 순간 오류 무시 */ }
}
function startRaidLoop() {
  stopRaidLoop();
  lastPartyHtml = ''; raidBuiltFor = null; lastDunHtml = ''; dunBuiltFor = null;
  if (raidSub === 'dun') loadDungeon().then(paintRaid);
  refreshRaidData().then(paintRaid);
  raidTimer = setInterval(raidLoopTick, 300);
}
function stopRaidLoop() {
  if (raidTimer) { clearInterval(raidTimer); raidTimer = null; }
  if (raidFlushT) { clearTimeout(raidFlushT); raidFlushT = null; }
  if (dunFlushT) { clearTimeout(dunFlushT); dunFlushT = null; if (dunLocalHits) flushDunHits(); }   // 탭을 떠나도 친 만큼은 보낸다
}
async function raidLoopTick() {
  if (currentTab !== 'raid') return;
  const inBattle = curRaid && curRaid.status && curRaid.startTs !== dismissedRaidTs;
  // 초월 던전 화면 — 파티 레이드가 실제로 진행 중이 아니면 던전 루프가 맡는다
  if (raidSub === 'dun' && !(inBattle && curRaid.status === 'active')) return dunLoopTick();
  if (inBattle && curRaid.status === 'active') {
    if (raidBuiltFor !== curRaid.startTs) renderBattle(curRaid);
    if (Date.now() - raidLastPoll > 850) await raidPoll();
    updateBattleUI();
    maybeFinishRaid();
  } else if (inBattle && curRaid.status === 'done') {
    if (raidBuiltFor !== curRaid.startTs) renderBattle(curRaid);
    updateBattleUI();
  } else {
    if (Date.now() - lastFetch > 1600) await refreshRaidData();
    paintRaid();
  }
}
function paintRaid() {
  if (currentTab !== 'raid') return;
  const inBattle = curRaid && curRaid.status && curRaid.startTs !== dismissedRaidTs;
  if (inBattle && (raidSub !== 'dun' || curRaid.status === 'active')) renderBattle(curRaid);
  else if (raidSub === 'dun') { if (dunF) { if (dunBuiltFor !== dunF.startTs) renderDunBattle(); else updateDunUI(); } else paintDungeon(); }
  else paintParty(el('panel'));
}
function paintParty(panel) {
  let html = raidSubBar();
  if (me.invites && me.invites.length) {
    html += `<div style="margin-bottom:6px"><b>📨 받은 파티 초대</b></div>` +
      me.invites.map(iv => `<div class="party-member"><b class="pm-nick">${esc(iv.leaderNick)}</b> <small>파티 ${iv.count}/${iv.max}</small>
        <span style="margin-left:auto;display:flex;gap:6px"><button class="btn sm primary" data-accept="${iv.partyId}">수락</button>
        <button class="btn sm ghost" data-reject="${iv.partyId}">거절</button></span></div>`).join('') + `<div style="height:12px"></div>`;
  }
  if (me.party) {
    const pt = cacheParties.find(x => x.id === me.party.id);
    const amLeader = pt && pt.leaderNick === me.nick;
    html += `<div style="margin-bottom:8px"><b>내 파티</b> <small>(${pt ? pt.count : 1}/${pt ? pt.max : 5}명)</small></div>`;
    if (pt) html += pt.members.map(m =>
      `<div class="party-member">${m.classEmoji} <b class="pm-nick">${esc(m.nick)}</b> <small>+${m.level}</small>
        ${m.isLeader ? '<span class="leader">👑파티장</span>' : ''}
        <span style="margin-left:auto" class="w">레이드 ${m.raidsLeft}회</span></div>`).join('');
    html += `<button class="btn ghost sm" id="leavePartyBtn" style="margin:10px 0">파티 나가기</button>`;
    if (amLeader) {
      const invitable = cachePlayers.filter(n => n !== me.nick && !(pt && pt.members.some(m => m.nick === n)));
      html += `<div style="margin:6px 0"><b>동료 초대</b></div>` +
        (invitable.length ? invitable.map(n => `<div class="party-member"><b class="pm-nick">${esc(n)}</b><button class="btn sm primary" data-invite="${esc(n)}" style="margin-left:auto">초대</button></div>`).join('') : emptyMsg('초대할 유저가 없어요'));
      const n = pt ? pt.count : 1;
      html += `<div style="margin:12px 0 6px"><b>보스 선택</b> <small>(남은 레이드 ${me.raidsLeft}/${me.dailyRaids} · 성공해야 차감)</small></div>`;
      html += `<p class="hint" style="margin:0 0 8px">실패하면 보상은 없지만 <b>횟수도 깎이지 않아요</b>. 보스 체력·화력은 <b>참여 인원(${n}명)</b>에 맞춰 올라갑니다.</p>`;
      html += BOSS_CACHE.map(b => {
        // 입장 조건은 파티 전원이 만족해야 하지만, 목록에서는 내 기준으로 잠금을 보여준다
        const why = me.level < b.reqLevel ? '무기 +' + b.reqLevel + ' 필요'
          : me.ascend < b.reqAscend ? '초월 ★' + b.reqAscend + ' 필요' : null;
        const sc = 1 + (n - 1) * BOSS_HPSCALE;   // 서버 raidScale 과 같은 식(표시용)
        return `<div class="raid-boss ${why ? 'locked' : ''}"><span class="bemoji">${b.emoji}</span>
          <div class="binfo"><div class="bname">${esc(b.name)} <small class="btier t-${esc(b.tier)}">${esc(b.tier)}</small>${why ? ` <span class="block">🔒 ${why}</span>` : ''}</div>
            <div class="bstat">HP ${Math.round(b.hp * sc).toLocaleString()} · 보상 💰${Math.round(b.reward * sc).toLocaleString()} · 🌟${b.essence}</div></div>
          <button class="btn sm primary" data-raid="${b.id}" ${why ? 'disabled' : ''}>도전</button></div>`;
      }).join('');
    } else html += `<p class="hint">파티장이 레이드를 시작할 수 있어요. 시작하면 여기서 다같이 보스를 연타해요!</p>`;
  } else {
    html += `<p class="hint" style="margin:0 0 8px">🎯 <b>혼자서도 도전 가능!</b> 파티를 만들면 바로 보스를 고를 수 있어요. 동료를 초대하면 함께(탱커·힐러 조합) 더 강한 보스도 노려봐요.</p>`;
    html += `<button class="btn primary sm" id="createPartyBtn" style="margin-bottom:10px">➕ 파티 만들기 (혼자도 OK)</button>`;
    html += `<div style="margin:6px 0"><b>파티 목록</b></div>`;
    html += cacheParties.length ? cacheParties.map(pt =>
      `<div class="party-member">👑 <b class="pm-nick">${esc(pt.leaderNick)}</b> <small>${pt.count}/${pt.max}명</small>
        <button class="btn sm primary" data-join="${pt.id}" style="margin-left:auto" ${pt.count >= pt.max ? 'disabled' : ''}>참가</button></div>`).join('')
      : emptyMsg('열린 파티가 없어요. 직접 만들어보세요!');
  }
  if (html !== lastPartyHtml) { panel.innerHTML = html; lastPartyHtml = html; }
}

/* ---------- 🌌 초월 던전 (레이드 탭의 두 번째 화면) ----------
 * 로비: 다음 층(보스 속성·약점·최소 무기 수)·내 무기 상성·상성표·주간 랭킹.
 * 전투: 혼자 15~30초 연타. 단계마다 보스 속성이 바뀌면 약점 무기로 바꿔 끼고, 무기마다 직업·속성 스킬 1회.
 * 서버가 보스 공격 시각을 내려주므로 HP 는 폴링 없이 여기서 예측하고, 연타는 700ms 마다 묶어서 보낸다. */
let raidSub = (() => { try { return localStorage.getItem('raidSub') === 'dun' ? 'dun' : 'party'; } catch (_) { return 'party'; } })();
let dunData = null, dunF = null, dunBuiltFor = null, dunLocalHits = 0, dunLastTap = 0, dunFlushT = null;
let dunFinishing = false, dunClockOff = 0, dunLastLoad = 0, dunLastSync = 0, lastDunHtml = '', dunRecvAt = 0;
// 상성 — 서버 game.js 의 ELEMENT_CYCLE 과 같은 순서(앞이 뒤를 이김) + 빛⇄어둠
const DUN_CYCLE = ['water', 'fire', 'ice', 'wind', 'poison', 'earth', 'thunder'];
const DUN_EL = { fire: ['🔥', '불'], water: ['💧', '물'], earth: ['⛰️', '대지'], wind: ['🌪️', '바람'], thunder: ['⚡', '번개'], ice: ['❄️', '얼음'], light: ['✨', '빛'], dark: ['🌑', '어둠'], poison: ['☠️', '독'] };
function dunBeats(a, b) {
  if ((a === 'light' && b === 'dark') || (a === 'dark' && b === 'light')) return true;
  const i = DUN_CYCLE.indexOf(a); return i >= 0 && DUN_CYCLE[(i + 1) % DUN_CYCLE.length] === b;
}
function dunMult(a, b) { return dunBeats(a, b) ? 2 : dunBeats(b, a) ? 0.5 : 1; }
function dunElTag(k) { const e = DUN_EL[k] || ['?', k]; return `<span class="del del-${k}">${e[0]}${e[1]}</span>`; }
function dunMultTag(m) { return `<b class="dmult ${m > 1 ? 'up' : m < 1 ? 'down' : ''}">×${m}</b>`; }
function dunNow() { return Date.now() + dunClockOff; }
function raidSubBar() {
  return `<div class="psub-tabs rsub-tabs">${[['party', '🐲', '파티 레이드'], ['dun', '🌌', '초월 던전']].map(([k, e, l]) =>
    `<button class="psub${raidSub === k ? ' active' : ''}" data-rsub="${k}"><span>${e}</span>${l}</button>`).join('')}</div>`;
}
function setRaidSub(k) {
  raidSub = k === 'dun' ? 'dun' : 'party';
  try { localStorage.setItem('raidSub', raidSub); } catch (_) { /* 저장 불가 환경 무시 */ }
  lastPartyHtml = ''; lastDunHtml = ''; dunBuiltFor = null;
  if (raidSub === 'dun') { loadDungeon().then(paintRaid); }
  else refreshRaidData().then(paintRaid);
  paintRaid();
}
function setDunFight(f) {
  dunF = f || null; dunRecvAt = Date.now();
  if (f && f.serverNow) dunClockOff = f.serverNow - Date.now();
}
async function loadDungeon() {
  dunLastLoad = Date.now();
  try {
    const r = await api('dungeon');
    if (r && r.ok) { dunData = r; if (r.fight && (!dunF || dunF.startTs !== r.fight.startTs || r.fight.status === 'done')) setDunFight(r.fight); if (!r.fight) setDunFight(null); }
  } catch (_) { /* 네트워크 순간 오류 무시 */ }
}
function fmtLeft(ms) { const h = Math.floor(ms / 3600000); return h >= 24 ? Math.floor(h / 24) + '일 ' + (h % 24) + '시간' : h + '시간 ' + Math.floor(ms % 3600000 / 60000) + '분'; }
function dunPhaseChips(phases, cur) {
  return phases.map((ph, i) => `<span class="dph${cur === i ? ' on' : cur != null && i < cur ? ' past' : ''}">${dunElTag(ph.el)}<small>약점 ${ph.weakTo.map(k => DUN_EL[k][0]).join('')}</small></span>`).join('<span class="dph-arrow">→</span>');
}
function paintDungeon() {
  const d = dunData, panel = el('panel');
  let h = raidSubBar();
  if (!d) { h += '<p class="hint">불러오는 중…</p>'; }
  else {
    const n = d.next;
    h += `<div class="dun-head"><div><b class="dun-title">🌌 초월 던전</b><small>매주 월요일 초기화 · ${fmtLeft(d.resetIn)} 남음</small></div>
      <div class="dun-floors"><span>이번 주 <b>${d.floor}</b>층</span><span>최고 <b>${d.best}</b>층</span></div></div>`;
    if (!d.unlocked) h += `<div class="dun-lock">🔒 <b>★1 무기가 있어야 들어갈 수 있어요.</b><br>무기를 +99 까지 키우고 🌈 초월하면 열려요. 초월한 무기는 <b>속성 스킬</b>도 함께 얻어요.</div>`;
    if (d.sweep) h += `<div class="dun-sweep">🧹 지난주 기록으로 <b>1~${d.sweep.to}층 자동 소탕</b>${d.sweep.pending ? ' — 첫 도전 때 확정돼요' : ` · 💠+${d.sweep.shard}${d.sweep.essence ? ' 🌟+' + d.sweep.essence : ''}`}</div>`;
    if (n) {
      const lack = d.weaponCount < n.weapons;
      h += `<div class="dun-next">
        <div class="dun-next-top"><span class="dun-boss">${n.emoji}</span><div class="dun-next-info">
          <div class="bname">${n.floor}층 · ${esc(n.name)} <small class="btier">${esc(n.band)}</small></div>
          <div class="dph-row">${dunPhaseChips(n.phases)}</div></div></div>
        <div class="dun-stats"><span>HP <b>${n.hp.toLocaleString()}</b></span><span>위험도 <b>${n.danger}%</b></span><span>⏱ <b>${n.duration / 1000}초</b></span>
          <span class="${lack ? 'bad' : 'good'}">🗡️ 무기 <b>${n.weapons}</b>자루 필요 · 보유 <b>${d.weaponCount}</b></span></div>
        <div class="dun-rw">보상 💠${n.reward.shard}${n.reward.essence ? ' · 🌟' + n.reward.essence : ''}${n.floor > d.best ? ' · <b class="dun-first">💎3 첫 돌파</b>' : ''}</div>
        <button class="btn primary dun-go" data-dun-start ${!d.unlocked || lack ? 'disabled' : ''}>${lack ? '🔒 무기 ' + n.weapons + '자루부터' : '⚔️ ' + n.floor + '층 도전'}</button>
      </div>`;
      // 내 무기 × 이번 층 단계별 상성
      h += `<div class="dun-sec">내 무기 상성 <small>이 층 기준</small></div><div class="dun-wlist">` + d.weapons.map(w =>
        `<div class="dun-w${w.equipped ? ' on' : ''}"><span class="dun-w-id">${w.emoji} <b>${w.asc ? '★' + w.asc + ' ' : ''}+${w.lv}</b> ${dunElTag(w.el)}</span>
          <span class="dun-w-m">${n.phases.map(ph => dunMultTag(dunMult(w.el, ph.el))).join('')}</span>
          ${w.elemSkill ? `<small class="dun-w-sk">${w.elemSkill.emoji} ${esc(w.elemSkill.name)} — ${esc(w.elemSkill.desc)}</small>` : `<small class="dun-w-sk dim">속성 스킬: ★1 필요</small>`}</div>`).join('') + `</div>`;
      if (d.upcoming && d.upcoming.length) h += `<div class="dun-sec">다음 층들</div><div class="dun-up">` + d.upcoming.map(u =>
        `<div class="dun-up-row"><b>${u.floor}층</b> ${u.emoji} <span class="dph-row sm">${u.phases.map(ph => dunElTag(ph.el)).join('→')}</span><small>🗡️${u.weapons}</small></div>`).join('') + `</div>`;
    } else h += `<div class="dun-lock">🏔️ <b>이번 주 정상(${d.max}층) 정복!</b> 다음 주에 새 속성으로 다시 열려요.</div>`;
    // 상성표
    h += `<details class="odds-table dun-chart"><summary>🔁 속성 상성표 — 이기면 ×2 · 지면 ×0.5</summary><div class="dun-cycle">` +
      DUN_CYCLE.concat(DUN_CYCLE[0]).map(k => DUN_EL[k][0] + '<small>' + DUN_EL[k][1] + '</small>').join('<i>→</i>') +
      `</div><div class="dun-cycle">✨<small>빛</small><i>⇄</i>🌑<small>어둠</small> <small class="dun-note">서로 ×2</small></div>
      <p class="hint" style="margin:6px 12px 10px">물이 불을 끄고 · 불이 얼음을 녹이고 · 얼음이 바람을 얼리고 · 바람이 독기를 흩고 · 독이 땅을 더럽히고 · 땅이 번개를 흘려보내고 · 번개가 물을 감전시켜요.
      속성이 안 맞으면 🛒 상점의 <b>🔁 속성 재련권</b>(에픽 이상 무기 · 강화 10%)으로 다시 뽑아요.</p></details>`;
    // 구간 안내
    h += `<details class="odds-table"><summary>🗺️ 층 구간</summary><table>${d.bands.map(b => `<tr><td>${b.from}~${b.to}층 ${esc(b.name)}</td><td>무기 ${b.weapons}자루 · 속성 ${b.phases}단계</td></tr>`).join('')}</table></details>`;
    // 주간 랭킹
    h += `<div class="dun-sec">🏆 이번 주 최고층</div>` + (d.rank.length ? `<div class="dun-rank">` + d.rank.map((x, i) =>
      `<div class="dun-rank-row${me && x.nick === me.nick ? ' me' : ''}"><span class="rk">${i + 1}</span>${nickSpan(x.nick, x.nickColor)}<small>🗡️${x.weaponCount}</small><b>${x.floor}층</b></div>`).join('') + `</div>` : emptyMsg('이번 주 도전자가 아직 없어요'));
  }
  if (h !== lastDunHtml) { panel.innerHTML = h; lastDunHtml = h; }
}
async function doDunStart() {
  if (dunF && dunF.status === 'done') { const l = await api('dun-leave', 'POST'); if (!l.ok) return toast(l.error, 'bad'); setDunFight(null); }
  const r = await api('dun-start', 'POST');
  if (!r.ok) { toast(r.error, 'bad'); await loadDungeon(); return paintRaid(); }
  applyMe(r.me); setDunFight(r.fight); dunBuiltFor = null; dunFinishing = false; dunLocalHits = 0; lastDunHtml = '';
  paintRaid();
}
async function doDunLeave() {
  const r = await api('dun-leave', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  setDunFight(null); dunBuiltFor = null; lastDunHtml = '';
  await loadDungeon(); paintRaid();
}
function renderDunBattle() {
  const f = dunF, panel = el('panel');
  panel.innerHTML =
    `<div class="raid-battle dun-battle">
       <div class="raid-timerrow"><span class="raid-boss-name">🌌 ${f.floor}층 · ${f.emoji} ${esc(f.name)}</span><span class="raid-timer">⏱ <b id="dTimer">--</b></span></div>
       <div id="dPhases" class="dph-row dun-bphases"></div>
       <div class="raid-stage"><div id="dBoss" class="raid-mon" role="button" aria-label="보스 공격"><span class="rmon-emoji">${f.emoji}</span><span id="dBossEl" class="dun-boss-el"></span></div></div>
       <div class="rbar-label">보스 HP <span id="dBossTxt"></span></div>
       <div class="rbar"><div id="dBossHp" class="rbar-fill boss"></div></div>
       <div class="rbar-label">내 HP <span id="dHpTxt"></span> <small id="dBuffs"></small></div>
       <div class="rbar"><div id="dHp" class="rbar-fill party"></div></div>
       <div id="dSwap" class="dun-swap"></div>
       <div class="dun-skills"><button id="dSkC" class="btn primary sm" data-dskill="class"></button><button id="dSkE" class="btn sm dun-elbtn" data-dskill="elem"></button></div>
       <div id="dEvents" class="raid-events"></div>
       <div id="dResult" class="raid-resultwrap"></div>
     </div>`;
  el('dBoss').addEventListener('pointerdown', tapDunBoss);
  dunBuiltFor = f.startTs;
  updateDunUI();
}
// 화면 시각 기준 예측 — 서버 값 + (받은 뒤 흐른 시간 동안의 보스 공격·힐러 회복)
function dunProjected() {
  const f = dunF, t = Math.min(f.duration, Math.max(0, dunNow() - f.startTs));
  let hp = f.hp, block = f.block;
  if (f.status === 'active') {
    for (const a of f.attacks) { if (a.done || a.t > t) continue; if (block > 0) { block--; continue; } hp -= a.pct * (1 - f.dr / 100); }
    if (f.healPerSec) hp += f.healPerSec * Math.max(0, Date.now() - dunRecvAt) / 1000;
  }
  let ph = 0; f.phases.forEach((p, i) => { if (t >= p.at) ph = i; });
  return { t, hp: Math.max(0, Math.min(100, hp)), ph };
}
function updateDunUI() {
  const f = dunF; if (!f || dunBuiltFor !== f.startTs) return;
  const active = f.status === 'active', pr = dunProjected(), cur = f.phases[pr.ph];
  const tEl = el('dTimer'); if (tEl) tEl.textContent = active ? ((f.duration - pr.t) / 1000).toFixed(1) + 's' : '종료';
  const nx = f.phases[pr.ph + 1];
  const phEl = el('dPhases'); if (phEl) phEl.innerHTML = dunPhaseChips(f.phases, pr.ph) + (active && nx ? `<small class="dph-next">다음 단계 ${((nx.at - pr.t) / 1000).toFixed(1)}s</small>` : '');
  const be = el('dBossEl'); if (be) be.innerHTML = dunElTag(cur.el);
  const bh = el('dBossHp'), bt = el('dBossTxt');
  if (bh) bh.style.width = Math.max(0, f.bossHP / f.bossMax * 100) + '%';
  if (bt) bt.textContent = f.bossHP.toLocaleString() + ' / ' + f.bossMax.toLocaleString();
  const hpb = el('dHp'), hpt = el('dHpTxt'), bf = el('dBuffs');
  if (hpb) { hpb.style.width = pr.hp + '%'; hpb.classList.toggle('low', pr.hp <= 30); }
  if (hpt) hpt.textContent = Math.round(pr.hp) + '%';
  if (bf) bf.textContent = [f.dr ? '🛡️−' + f.dr + '%' : '', f.block ? '❄️막기 ' + f.block : '', f.haste ? '🌪️연타×1.6' : '', f.healPerSec ? '✨+' + f.healPerSec + '%/s' : ''].filter(Boolean).join(' ');
  const cool = f.swapIn - (Date.now() - dunRecvAt) > 0;
  const sw = el('dSwap');
  if (sw) {
    const html = f.weapons.map(w => { const m = dunMult(w.el, cur.el);
      return `<button class="dswap${w.equipped ? ' on' : ''}" data-dswap="${w.cls}" ${!active || w.equipped || cool ? 'disabled' : ''}>
        <span>${w.emoji}${DUN_EL[w.el][0]}</span>${dunMultTag(m)}<small>${w.asc ? '★' + w.asc + ' ' : ''}+${w.lv}</small></button>`; }).join('');
    if (sw.dataset.h !== html) { sw.innerHTML = html; sw.dataset.h = html; }
  }
  const wq = f.weapons.find(w => w.equipped) || {};
  const sc = el('dSkC'), se = el('dSkE');
  if (sc) { sc.textContent = (wq.classSkill || '스킬') + (wq.usedC ? ' ✓' : ''); sc.disabled = !active || wq.usedC; }
  if (se) {
    if (wq.elemSkill) { se.textContent = wq.elemSkill.emoji + ' ' + wq.elemSkill.name + (wq.usedE ? ' ✓' : ''); se.disabled = !active || wq.usedE; se.title = wq.elemSkill.desc; }
    else { se.textContent = '속성 스킬 ★1 필요'; se.disabled = true; se.title = ''; }
  }
  const ev = el('dEvents'); if (ev) ev.innerHTML = (f.events || []).slice(-5).map(e => `<div class="raid-ev">${esc(e.text)}</div>`).join('');
  const boss = el('dBoss'); if (boss && !active) boss.classList.add('dead');
  if (!active) {
    const res = el('dResult');
    if (res && !res.dataset.done) {
      res.dataset.done = '1';
      const rw = f.reward;
      res.innerHTML = `<div class="raid-result ${f.win ? 'win' : 'lose'}"><b>${f.win ? '🏆 ' + f.floor + '층 돌파!' : '☠️ ' + f.floor + '층 패배…'}</b>` +
        (f.win && rw ? `<br>💠 +${rw.shard}${rw.essence ? ' · 🌟 +' + rw.essence : ''}${rw.prism ? ' · <b class="dun-first">💎 +' + rw.prism + ' 첫 돌파</b>' : ''}` : '') +
        (!f.win ? `<br><small>약점: ${f.phases.map(ph => DUN_EL[ph.el][0] + '→' + ph.weakTo.map(k => DUN_EL[k][0]).join('')).join(' · ')} — 약점 무기로 바꿔 끼거나 🔁 재련해 보세요</small>` : '') +
        `</div><div class="dun-after"><button class="btn primary sm" data-dun-start>${f.win ? '다음 층 →' : '다시 도전'}</button><button class="btn ghost sm" data-dun-leave>로비로</button></div>`;
      sfx(f.win ? 'jackpot' : 'destroy'); vibe(f.win ? [15, 40, 25] : [40, 60, 40]);
      pollMe();
    }
  }
}
function tapDunBoss(e) {
  if (e) e.preventDefault();
  if (!dunF || dunF.status !== 'active' || dunNow() - dunF.startTs >= dunF.duration) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (now - dunLastTap < RAID_TAP_MS) return;
  dunLastTap = now; dunLocalHits++;
  vibe(6); sfx('hit');
  const boss = el('dBoss');
  if (boss) { boss.classList.remove('hit'); void boss.offsetWidth; boss.classList.add('hit'); }
  spawnDunSpark();
  if (!dunFlushT) dunFlushT = setTimeout(flushDunHits, RAID_FLUSH_MS);
}
function spawnDunSpark() {
  const boss = el('dBoss'); if (!boss || !dunF) return;
  const w = dunF.weapons.find(x => x.equipped), rc = boss.getBoundingClientRect(), s = document.createElement('div');
  s.className = 'raid-spark'; s.textContent = w ? DUN_EL[w.el][0] : '⚔️';
  s.style.left = (rc.left + rc.width * (0.3 + Math.random() * 0.4)) + 'px';
  s.style.top = (rc.top + rc.height * 0.35) + 'px';
  document.body.appendChild(s); setTimeout(() => s.remove(), 420);
}
async function flushDunHits(force) {
  dunFlushT = null;
  const hits = dunLocalHits; dunLocalHits = 0;
  if ((!hits && !force) || !dunF || dunF.status !== 'active') return;
  dunLastSync = Date.now();
  const r = await api('dun-hit', 'POST', { hits });
  if (r && r.ok && r.fight) { setDunFight(r.fight); updateDunUI(); }
}
async function doDunSwap(cls) {
  if (dunLocalHits) { if (dunFlushT) { clearTimeout(dunFlushT); dunFlushT = null; } await flushDunHits(); }   // 바꾸기 전 연타는 원래 무기로
  const r = await api('dun-swap', 'POST', { class: cls });
  if (!r.ok) return toast(r.error, 'bad');
  if (r.fight) { setDunFight(r.fight); updateDunUI(); }
  sfx('pang'); vibe(12);
}
async function doDunSkill(kind) {
  if (dunLocalHits) { if (dunFlushT) { clearTimeout(dunFlushT); dunFlushT = null; } await flushDunHits(); }
  const r = await api('dun-skill', 'POST', { kind });
  if (!r.ok) return toast(r.error, 'bad');
  if (r.fight) { setDunFight(r.fight); updateDunUI(); }
  if (r.skillText) { toast(r.skillText, 'info'); sfx('crit'); vibe([15, 30, 20]); }
}
async function maybeFinishDun() {
  if (dunFinishing || !dunF || dunF.status !== 'active') return;
  const pr = dunProjected();
  if (pr.t >= dunF.duration || pr.hp <= 0 || dunF.bossHP <= 0) {
    dunFinishing = true;
    if (dunFlushT) { clearTimeout(dunFlushT); dunFlushT = null; }
    if (dunLocalHits) await flushDunHits();
    const r = await api('dun-finish', 'POST');
    if (r && r.ok && r.fight) { setDunFight(r.fight); if (r.me) applyMe(r.me); }
    dunFinishing = false;
    updateDunUI();
  } else if (Date.now() - dunLastSync > 1500 && !dunLocalHits) {
    flushDunHits(true);   // 연타가 없어도 지속 피해·단계 전환을 서버 시계로 맞춘다
  }
}
async function dunLoopTick() {
  const f = dunF;
  if (f && f.status === 'active') {
    if (dunBuiltFor !== f.startTs) renderDunBattle();
    updateDunUI();
    maybeFinishDun();
  } else if (f && f.status === 'done') {
    if (dunBuiltFor !== f.startTs) renderDunBattle();
  } else {
    if (!dunData || Date.now() - dunLastLoad > 20000) await loadDungeon();
    if (dunF) return;   // 불러온 사이 진행 중 전투가 있으면 다음 틱에 전투 화면으로
    paintDungeon();
  }
}

/* ---------- 탭 ---------- */
// 탭 로드 순서 가드: 빠르게 탭을 바꾸면 먼저 시작한 fetch 가 늦게 도착해 나중 탭을
// 덮어쓰는 레이스가 생긴다. 매 로드에 seq 를 찍고, await 후 최신이 아니면 렌더를 버린다.
// tabHtmlCache: 한 번 본 탭은 마지막 화면을 즉시 보여주고(로딩 표시 없이) 뒤에서 갱신.
let tabLoadSeq = 0;
const tabHtmlCache = {};
function cacheableTab(t) { return t !== 'raid' && t !== 'prism'; }
async function loadTab() {
  const panel = el('panel');
  const seq = ++tabLoadSeq;
  const stale = () => seq !== tabLoadSeq;   // 그 사이 새 loadTab 이 시작됐으면 true
  if (currentTab === 'raid') { startRaidLoop(); return; }
  stopRaidLoop();
  if (currentTab === 'prism') {
    const r = await api('prism'); if (stale() || !r.ok) return;
    prismData = r; paintPrism(); return;
  }
  if (currentTab === 'rank') {
    const { list } = await api('rank'); if (stale()) return;
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${medal(i)}</span>
        <div class="nm" data-nick="${esc(p.nick)}">${nmLine(p.nick, p.nickColor, p.title, p.classEmoji)}
          <div class="nm-sub">${esc(p.weapon)} · ${p.wins}승 ${p.losses}패${p.weaponCount > 1 ? ' · 🗡️×' + p.weaponCount : ''}</div></div></div>`).join('') : emptyMsg('아직 참가자가 없어요');
  } else if (currentTab === 'goldrank') {
    const { list } = await api('goldrank'); if (stale()) return;
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${medal(i)}</span>
        <div class="nm" data-nick="${esc(p.nick)}">${nmLine(p.nick, p.nickColor, p.title)}</div>
        <span class="val gold">${p.gold.toLocaleString()}G</span></div>`).join('') : emptyMsg('아직 참가자가 없어요');
  } else if (currentTab === 'shop') {
    const { items } = await api('shop'); if (stale()) return;
    panel.innerHTML = `<p class="hint" style="margin:0 0 10px">보유 💰${me.gold.toLocaleString()}G · 🎒 ${me.inv.used}/${me.inv.slots}칸</p>` +
      items.map(it => {
        // 방지권은 하루 구매 상한이 있고, 초월 ★1+ 는 아예 살 수 없다
        const capped = it.id === 'protect';
        const once = !!it.once;
        const onceDone = once && (me.inv.packBought || me.inv.atMaxSlots);
        const soldOut = (capped && (!me.protectWorks || me.protectBuyLeft <= 0)) || onceDone;
        const note = once ? ` <span class="shop-lim${onceDone ? ' off' : ''}">${onceDone ? '구매 완료' : '계정당 1회'}</span>`
          : !capped ? ''
          : !me.protectWorks ? ' <span class="shop-lim off">초월 이후 사용 불가</span>'
          : ` <span class="shop-lim${me.protectBuyLeft <= 0 ? ' off' : ''}">오늘 ${me.protectBuyLeft}/${me.protectDailyBuy}개</span>`;
        return `<div class="raid-boss"><span class="bemoji">${it.emoji}</span>
          <div class="binfo"><div class="bname">${esc(it.name)} <small>${it.price.toLocaleString()}G</small>${note}</div>
            <div class="bstat">${esc(it.desc)}${capped ? ' · 더 필요하면 🗡️사냥에서 얻으세요' : ''}</div></div>
          <button class="btn sm primary" data-buy="${it.id}" ${me.gold < it.price || soldOut ? 'disabled' : ''}>구매</button></div>`;
      }).join('');
  } else if (currentTab === 'hogu') {
    const { list } = await api('hogu'); if (stale()) return;
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${i < 3 ? ['👑', '🥈', '🥉'][i] : (i + 1)}</span>
        <div class="nm" data-nick="${esc(p.nick)}">${nmLine(p.nick)}</div>
        <span class="val">🕯️ ${p.c}번 파괴</span></div>`).join('') : emptyMsg('😌 오늘은 아직 아무도 안 깨졌어요');
  } else if (currentTab === 'log') {
    const { list } = await api('log'); if (stale()) return;
    panel.innerHTML = list.length ? list.map(l => `<div class="logline">${esc(l.text)}</div>`).join('') : emptyMsg('기록 없음');
  } else if (currentTab === 'fight') {
    const { list } = await api('players'); if (stale()) return;
    const others = list.filter(n => n !== me.nick);
    panel.innerHTML = `<p class="hint" style="margin:0 0 8px">이기면 상대 골드 20% 획득. (남은 싸움 ${me.fightsLeft}/${me.dailyFights})</p>` +
      (others.length ? others.map(n =>
        `<div class="fightrow"><div class="nm" data-nick="${esc(n)}">${nmLine(n)}</div>
          <button class="btn sm primary" data-fight="${esc(n)}" ${me.fightsLeft <= 0 ? 'disabled' : ''}>싸움</button></div>`).join('') : emptyMsg('상대가 없어요'));
  }
  // 렌더 완료분을 캐시 — 다음에 그 탭 누르면 즉시 표시(뒤에서 갱신)
  if (cacheableTab(currentTab)) tabHtmlCache[currentTab] = panel.innerHTML;
}
function medal(i) { return i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1); }
function emptyMsg(m) { return `<div class="empty">${m}</div>`; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
// 닉네임 염색 렌더
function nickSpan(nick, nc) {
  const e = esc(nick);
  if (!nc) return e;
  if (nc.kind === 'solid') return '<span style="color:' + nc.color + '">' + e + '</span>';
  if (nc.kind === 'glow') return '<span class="nick-glow" style="color:' + nc.color + '">' + e + '</span>';
  if (nc.kind === 'silver') return '<span class="nick-silver">' + e + '</span>';
  if (nc.kind === 'gold') return '<span class="nick-gold">' + e + '</span>';
  if (nc.kind === 'rainbow') return '<span class="nick-rainbow">' + e + '</span>';
  if (nc.kind === 'prism') return '<span class="nick-prism">' + e + '</span>';   // 프리즘 상점 전용 오로라색
  return e;
}
// 목록용 닉네임 줄: 닉네임이 길면 말줄임(…), 칭호는 자리가 모자라면 아랫줄로 내려간다
function nmLine(nick, nc, title, emoji) {
  return `<div class="nm-line"><span class="nm-nick">${emoji ? emoji + ' ' : ''}${nickSpan(nick, nc)}</span>${titleTag(title)}</div>`;
}
// 장착 칭호 태그 (닉네임 옆 작게). t = {title,color} 또는 null
function titleTag(t) {
  return t ? ` <span class="title-tag" style="color:${t.color}">「${esc(t.title)}」</span>` : '';
}

/* ---------- 프로필 모달 ---------- */
async function openProfile(nick) {
  const r = await withLoad(() => api('profile?name=' + encodeURIComponent(nick)));
  if (!r.ok) return toast(r.error, 'bad');
  const p = r.profile;
  const isMe = me && p.nick === me.nick;
  const eq = p.equippedTitle;
  el('modalBody').innerHTML =
    `<h3 class="pf-name">${p.classEmoji || '📇'} ${nickSpan(p.nick, p.nickColor)}</h3>
     <div class="pf-sub">${titleTag(eq)}<small>${esc(p.className || '')}</small></div>
     ${p.class && p.grade ? `<div class="pf-weapon">${weaponArtHTML(p)}</div>` : ''}
     ${titlesSection(p, isMe, eq)}
     <div class="pf-line"><span>무기</span><b>${esc(p.weapon)}</b></div>
     ${p.weapons && p.weapons.list.length > 1 ? `<div class="pf-line"><span>보유 무기</span><b class="pf-arm">${p.weapons.list.filter(w => !w.equipped).map(w => w.classEmoji + ' ' + esc(w.name)).join('<br>')}</b></div>` : ''}
     <div class="pf-line"><span>프리즘</span><b>💎 ${(p.prism || 0).toLocaleString()}</b></div>
     <div class="pf-line"><span>속성</span><b>${p.elementEmoji || ''} ${esc(p.elementName || '-')}</b></div>
     <div class="pf-line"><span>골드</span><b>${p.gold.toLocaleString()}G</b></div>
     <div class="pf-line"><span>초월</span><b>${p.ascend > 0 ? '★' + p.ascend : '-'}</b></div>
     ${p.dunBest ? `<div class="pf-line"><span>초월 던전</span><b>🌌 최고 ${p.dunBest}층</b></div>` : ''}
     <div class="pf-line"><span>방지권</span><b>${p.protects}개</b></div>
     <div class="pf-line"><span>전적</span><b>${p.wins}승 ${p.losses}패${p.winRate != null ? ' (' + p.winRate + '%)' : ''}</b></div>
     <div class="pf-line"><span>최고기록</span><b>+${p.best}</b></div>
     <div class="pf-line"><span>파괴</span><b>${p.breaks}회</b></div>
     <div class="pf-line"><span>강화순위</span><b>${p.rank.rank ? p.rank.rank + '/' + p.rank.total + '위' : '-'}</b></div>` +
    (isMe ? `<div style="margin-top:12px;display:flex;gap:6px">
       <input id="renameInput" maxlength="12" value="${esc(p.nick)}" style="flex:1;min-width:0;padding:9px;border-radius:10px;border:1px solid var(--line);background:#0f131c;color:var(--text)">
       <button id="renameBtn" class="btn primary sm">닉변경</button></div>` : '');
  el('modal').hidden = false;
  if (isMe) {
    el('renameBtn').onclick = doRename;
    // 내 프로필: 칭호 클릭 → 장착/해제
    el('modalBody').querySelectorAll('[data-title-id]').forEach(chip => {
      chip.onclick = () => doEquipTitle(chip.dataset.titleId);
    });
  }
}
// 프로필 칭호 진열장. 내 프로필이면 클릭으로 장착/해제(미획득은 🔒 잠금), 남이면 획득 칭호만 표시.
function titlesSection(p, isMe, eq) {
  if (isMe) {
    const roster = p.titleRoster || [];
    const chips = roster.map(t => {
      if (t.earned) {
        const on = eq && eq.id === t.id;
        return `<span class="title-chip earn${on ? ' equipped' : ''}" data-title-id="${t.id}" style="color:${t.color};border-color:${t.color}">${esc(t.title)}</span>`;
      }
      return `<span class="title-chip locked" style="border-color:${t.color}66">🔒</span>`;
    }).join('');
    return `<div class="titles-head">칭호 <small>${p.titleEarned || 0}/${p.titleTotal || roster.length}</small></div>
      <div class="titles-row">
        <span class="title-chip clear${eq ? '' : ' equipped'}" data-title-id="">칭호 없음</span>${chips}
      </div>`;
  }
  return (p.titles && p.titles.length)
    ? `<div class="titles-row">${p.titles.map(t => `<span class="title-chip${eq && eq.id === t.id ? ' equipped' : ''}" style="color:${t.color};border-color:${t.color}">${esc(t.title)}</span>`).join('')}</div>`
    : `<div class="titles-empty">아직 획득한 칭호가 없어요</div>`;
}
async function doEquipTitle(titleId) {
  const r = await withLoad(() => api('title', 'POST', { title: titleId || null }));
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); render();
  openProfile(me.nick);  // 모달 새로고침(선택 상태 반영)
  toast(r.msg, 'ok');
}
async function doRename() {
  const v = el('renameInput').value.trim();
  const r = await withLoad(() => api('rename', 'POST', { nick: v }));
  if (!r.ok) return toast(r.error, 'bad');
  applyMe(r.me); el('modal').hidden = true; render(); loadTab();
  toast('✏️ ' + r.msg, 'ok');
}

/* ---------- 이벤트 ---------- */
let loggingIn = false;
el('loginBtn').onclick = async () => {
  if (loggingIn) return;
  const nick = el('nick').value.trim(), pin = el('pin').value.trim();
  el('loginErr').textContent = '';
  const btn = el('loginBtn');
  loggingIn = true;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.dataset.label = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> 접속 중...';
  try {
    const r = await api('login', 'POST', { nick, pin });
    if (!r.ok) { el('loginErr').textContent = r.error; return; }
    token = r.token; localStorage.setItem('token', token); applyMe(r.me);
    if (r.needClass) return showClassSelect();
    enterGame();
  } catch (e) {
    el('loginErr').textContent = '접속에 실패했어요. 잠시 후 다시 시도하세요.';
  } finally {
    loggingIn = false;
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = btn.dataset.label || '시작';
  }
};
el('pin').addEventListener('keydown', e => { if (e.key === 'Enter') el('loginBtn').click(); });
function doLogout() { stopRaidLoop(); closeEvents(); closeRealtime(); if (sbAuth) sbAuth.auth.signOut().catch(() => {}); token = null; me = null; curRaid = null; localStorage.removeItem('token'); show('login'); }

// 버튼 연타 방지: 액션 사이 최소 간격
const COOLDOWN = 450;
let busy = false;
async function act(fn, btn) {
  if (busy) return;
  busy = true;
  vibe(6); sfx('click');   // 버튼 누름 피드백(진동+효과음)
  loadStart();
  if (btn) btn.classList.add('acting');   // 클릭 즉시 버튼에 처리중 표시(서버 응답 지연 체감↓)
  try { await fn(); }
  finally { loadEnd(); if (btn) btn.classList.remove('acting'); setTimeout(() => { busy = false; }, COOLDOWN); }
}
el('enhanceBtn').onclick = () => act(doEnhance, el('enhanceBtn'));
el('huntBtn').onclick = openHunt;   // 사냥터(연타 처치) 모달 열기
el('mineBtn').onclick = openMine;   // 채굴장(돌 깨기 + 자동채굴 수령) 모달
el('attendBtn').onclick = () => act(doAttend, el('attendBtn'));
// 상단바 내 닉네임 클릭 → 내 프로필(닉변경 가능)
el('hNick').onclick = () => { if (me) openProfile(me.nick); };

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); currentTab = btn.dataset.tab;
    // 본 적 있는 탭이면 캐시를 즉시 표시(로딩 없이), 처음이면 로딩 표시. 그다음 loadTab 이 갱신.
    if (cacheableTab(currentTab)) el('panel').innerHTML = tabHtmlCache[currentTab] || '<div class="empty">불러오는 중…</div>';
    withLoad(loadTab);
  };
});

el('panel').addEventListener('click', e => {
  const f = e.target.closest('[data-fight]'); if (f) return act(() => doFight(f.dataset.fight), f);
  const r = e.target.closest('[data-raid]'); if (r) return act(() => doRaid(r.dataset.raid), r);
  const j = e.target.closest('[data-join]'); if (j) return act(() => doPartyJoin(j.dataset.join), j);
  const bu = e.target.closest('[data-buy]'); if (bu) return act(() => doBuy(bu.dataset.buy), bu);
  const iv = e.target.closest('[data-invite]'); if (iv) return act(() => doInvite(iv.dataset.invite), iv);
  const ac = e.target.closest('[data-accept]'); if (ac) return act(() => doAccept(ac.dataset.accept), ac);
  const rj = e.target.closest('[data-reject]'); if (rj) return act(() => doReject(rj.dataset.reject), rj);
  const ps = e.target.closest('[data-psub]'); if (ps) { prismSub = ps.dataset.psub; return paintPrism(); }
  // 🌌 초월 던전
  const rs = e.target.closest('[data-rsub]'); if (rs) return setRaidSub(rs.dataset.rsub);
  const ds = e.target.closest('[data-dun-start]'); if (ds) return act(doDunStart, ds);
  const dl = e.target.closest('[data-dun-leave]'); if (dl) return act(doDunLeave, dl);
  const dw = e.target.closest('[data-dswap]'); if (dw) return act(() => doDunSwap(dw.dataset.dswap), dw);
  const dk = e.target.closest('[data-dskill]'); if (dk) return act(() => doDunSkill(dk.dataset.dskill), dk);
  const pk = e.target.closest('[data-pick]'); if (pk) return act(() => doOpenBox(+pk.dataset.pick), pk);
  if (e.target.closest('[data-box-again]')) { boxReveal = null; return paintPrism(); }
  const al = e.target.closest('[data-alch]'); if (al) return act(() => doAlchemy(al.dataset.alch), al);
  const ca = e.target.closest('[data-cap]'); if (ca) return act(() => doCapsule(+ca.dataset.cap), ca);
  const pb = e.target.closest('[data-pbuy]'); if (pb) return act(() => doPrismBuy(pb.dataset.pbuy), pb);
  const cp = e.target.closest('#createPartyBtn'); if (cp) return act(doPartyCreate, cp);
  const lp = e.target.closest('#leavePartyBtn'); if (lp) return act(doPartyLeave, lp);
  if (e.target.closest('#closeRaidBtn')) return closeRaid();
  const nm = e.target.closest('[data-nick]'); if (nm) return openProfile(nm.dataset.nick);
});
el('modalClose').onclick = () => { el('modal').hidden = true; };
// 사냥터 모달: 몬스터 연타(pointerdown), 닫기
el('huntMon').addEventListener('pointerdown', tapMonster);
el('huntClose').onclick = closeHunt;
el('huntModal').addEventListener('click', e => { if (e.target === el('huntModal')) closeHunt(); });
// 채굴장 모달: 닫기
el('mineClose').onclick = closeMine;
el('mineModal').addEventListener('click', e => { if (e.target === el('mineModal')) closeMine(); });
el('modal').addEventListener('click', e => { if (e.target === el('modal')) el('modal').hidden = true; });
el('guideClose').onclick = () => { el('guide').hidden = true; localStorage.setItem('guideSeen', '1'); };
el('patchClose').onclick = closePatch;
el('noticeItem').onclick = () => { closeMenu(); openPatch(false); };
/* ---------- 상단바 메뉴(☰) ---------- */
function updateSoundBtn() { el('soundItem').textContent = (soundOn ? '🔊' : '🔇') + ' 효과음 ' + (soundOn ? 'ON' : 'OFF'); }
function closeMenu() { el('menuDrop').hidden = true; }
el('menuBtn').onclick = (e) => { e.stopPropagation(); updateAccountItem(); el('menuDrop').hidden = !el('menuDrop').hidden; };
el('soundItem').onclick = () => { soundOn = !soundOn; localStorage.setItem('soundOff', soundOn ? '0' : '1'); updateSoundBtn(); if (soundOn) { ensureAudio(); sfx('click'); } };
el('helpItem').onclick = () => { closeMenu(); el('guide').hidden = false; };
el('accountItem').onclick = () => {
  closeMenu();
  if (me && me.linked) { toast('✉️ ' + (me.email || '') + ' 계정에 연결돼 있어요', 'ok'); return; }
  openAuth('register');   // 게스트 → 이메일 계정 만들어 캐릭터 저장(연결)
};
el('logoutItem').onclick = () => { closeMenu(); doLogout(); };
// 메뉴 바깥 클릭 시 닫기
document.addEventListener('click', (e) => { if (!el('menuDrop').hidden && !e.target.closest('.menu-wrap')) closeMenu(); });
updateSoundBtn();

/* ---------- 이메일 계정 (Supabase Auth) ----------
 * 게스트(닉+PIN)는 기존 그대로. 이메일 계정은 '선택 업그레이드'로, 현재 캐릭터를
 * Supabase Auth 계정에 연결(auth-link)하거나, 다른 기기에서 복원(auth-login)한다.
 * 회원가입·이메일 인증·비밀번호 재설정은 Supabase 가 처리. 미설정 환경이면 조용히 숨김. */
let sbAuth = null, authMode = 'login', authBusy = false, authManual = false, authPendingEmail = '';

async function initAuth() {
  if (sbAuth || !window.supabase) return;
  try {
    const cfg = await (await fetch('/api/config')).json();
    if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return; // Supabase 미설정 → 게스트 전용
    const base = String(cfg.supabaseUrl).replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
    sbAuth = window.supabase.createClient(base, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'sb-auth' },
    });
    el('emailLoginWrap').hidden = false;   // 로그인 화면에 이메일 버튼 노출
    updateAccountItem();
    sbAuth.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { openAuth('recovery'); return; }
      // 이메일 인증/재설정 링크로 돌아온 경우(우리가 직접 로그인한 게 아닐 때) 자동 완료
      if (event === 'SIGNED_IN' && session && !authManual) afterSupabaseSignIn();
    });
  } catch (_) { /* Supabase 없으면 게스트 전용으로 동작 */ }
}

function updateAccountItem() {
  const it = el('accountItem'); if (!it) return;
  if (!sbAuth) { it.hidden = true; return; }
  it.hidden = false;
  it.textContent = (me && me.linked) ? ('✉️ ' + (me.email || '연결됨')) : '✉️ 계정 만들기';
}

function authSay(text, kind) { const m = el('authMsg'); m.textContent = text || ''; m.className = 'auth-msg' + (kind ? ' ' + kind : ''); }
function setAuthTab() { document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === authMode)); }

function openAuth(mode) {
  if (!sbAuth) return;
  authMode = mode || 'login';
  authSay('');
  const linking = !!(token && me && !me.linked); // 현재 게스트가 있으면 '연결' 모드
  const isSent = authMode === 'sent';
  const intro = el('authIntro'), pw = el('authPw');
  el('authTabs').hidden = !(authMode === 'login' || authMode === 'register');
  el('authForgot').hidden = !(authMode === 'login' || isSent);
  el('authForgot').textContent = isSent ? '이미 인증했어요 · 로그인하기' : '비밀번호를 잊으셨나요?';
  el('authEmail').style.display = (authMode === 'recovery' || isSent) ? 'none' : '';
  el('authPw').style.display = (authMode === 'reset' || isSent) ? 'none' : '';
  if (isSent) {
    // 회원가입 후 '메일 확인 대기' 화면
    el('authTitle').textContent = '📩 인증 메일을 확인하세요';
    el('authSubmit').textContent = '인증 메일 재발송';
    intro.hidden = false;
    intro.innerHTML = '<b>' + esc(authPendingEmail || '') + '</b> 로 인증 메일을 보냈어요.<br>메일의 <b>링크를 누르면 자동으로 로그인</b>돼요. 안 오면 스팸함도 확인하세요!';
  } else {
    intro.hidden = !(linking && (authMode === 'login' || authMode === 'register'));
    if (!intro.hidden) intro.textContent = '현재 캐릭터 「' + (me.nick || '') + '」를 이 이메일 계정에 저장해요.';
    if (authMode === 'login')    { el('authTitle').textContent = linking ? '캐릭터 저장 · 로그인' : '이메일 로그인'; el('authSubmit').textContent = '로그인'; pw.placeholder = '비밀번호'; pw.autocomplete = 'current-password'; }
    if (authMode === 'register') { el('authTitle').textContent = linking ? '캐릭터 저장 · 회원가입' : '이메일 회원가입'; el('authSubmit').textContent = '회원가입'; pw.placeholder = '비밀번호 (6자 이상)'; pw.autocomplete = 'new-password'; }
    if (authMode === 'reset')    { el('authTitle').textContent = '비밀번호 재설정'; el('authSubmit').textContent = '재설정 메일 보내기'; }
    if (authMode === 'recovery') { el('authTitle').textContent = '새 비밀번호 설정'; el('authSubmit').textContent = '비밀번호 변경'; pw.placeholder = '새 비밀번호 (6자 이상)'; pw.autocomplete = 'new-password'; }
  }
  setAuthTab();
  el('authModal').hidden = false;
  if (!isSent && authMode !== 'recovery') el('authEmail').focus();
}
function closeAuth() { el('authModal').hidden = true; }

// Supabase 로그인 성공 후 처리.
// 1) 항상 복원(auth-login) 먼저 — 이 이메일에 이미 캐릭터가 있으면 그걸 불러온다.
// 2) 캐릭터가 없고(needLink) 현재 게스트가 있으면 → 그 게스트를 이 계정에 연결한다.
// (이메일 인증/재설정 링크로 돌아온 경우 me 가 아직 로드 전일 수 있어 순서를 이렇게 둔다)
async function afterSupabaseSignIn() {
  try {
    const { data } = await sbAuth.auth.getSession();
    const at = data && data.session && data.session.access_token;
    if (!at) { authSay('세션을 가져오지 못했어요. 다시 시도해 주세요.', 'err'); return; }
    const r = await api('auth-login', 'POST', { access_token: at });
    if (!r.ok) { authSay(r.error || '로그인에 실패했어요.', 'err'); return; }
    if (!r.needLink) {                       // 이미 캐릭터 있음 → 복원(로그인)
      token = r.token; localStorage.setItem('token', token); applyMe(r.me);
      closeAuth();
      if (r.needClass) showClassSelect(); else { enterGame(); updateAccountItem(); }
      return;
    }
    // 캐릭터 없음 → 현재 게스트가 있으면 연결. me 미로드면 먼저 불러온다.
    if (token && !me) { const r0 = await api('me'); if (r0 && r0.ok) applyMe(r0.me); }
    if (token && me && !me.linked) {
      const rl = await api('auth-link', 'POST', { access_token: at });
      if (!rl.ok) { authSay(rl.error || '연결에 실패했어요.', 'err'); return; }
      applyMe(rl.me); closeAuth(); render(); updateAccountItem();
      toast('✉️ 이메일 계정에 캐릭터를 저장했어요!', 'ok');
      return;
    }
    // 게스트도 없고 이 이메일에 캐릭터도 없음
    if (el('authModal').hidden) openAuth('login');
    authSay('이 이메일에 연결된 캐릭터가 없어요. 먼저 "게스트로 시작"해 캐릭터를 만든 뒤 메뉴의 "계정 만들기"로 연결해 주세요.', 'err');
  } finally { authManual = false; }
}

async function submitAuth() {
  if (authBusy || !sbAuth) return;
  const email = el('authEmail').value.trim().toLowerCase();
  const pw = el('authPw').value;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const btn = el('authSubmit'); const lbl = btn.textContent;
  authBusy = true; btn.disabled = true;
  try {
    if (authMode === 'sent') {   // 인증 메일 재발송
      const { error } = await sbAuth.auth.resend({ type: 'signup', email: authPendingEmail });
      if (error) { authSay(/rate|seconds|only request|too many/i.test(error.message) ? '너무 자주 요청했어요. 1분 뒤 다시 시도해 주세요.' : error.message, 'err'); return; }
      authSay('인증 메일을 다시 보냈어요. 메일함(스팸함)을 확인하세요.', 'ok'); return;
    }
    if (authMode === 'reset') {
      if (!emailOk) { authSay('이메일을 확인해 주세요.', 'err'); return; }
      const { error } = await sbAuth.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      if (error) { authSay(error.message, 'err'); return; }
      authSay('재설정 메일을 보냈어요. 메일함을 확인해 주세요.', 'ok'); return;
    }
    if (authMode === 'recovery') {
      if ((pw || '').length < 6) { authSay('비밀번호는 6자 이상이어야 해요.', 'err'); return; }
      authManual = true;
      const { error } = await sbAuth.auth.updateUser({ password: pw });
      if (error) { authManual = false; authSay(error.message, 'err'); return; }
      authSay('비밀번호를 변경했어요.', 'ok');
      await afterSupabaseSignIn(); return;
    }
    if (!emailOk) { authSay('이메일을 확인해 주세요.', 'err'); return; }
    if ((pw || '').length < 6) { authSay('비밀번호는 6자 이상이어야 해요.', 'err'); return; }
    if (authMode === 'register') {
      authManual = true;
      const { data, error } = await sbAuth.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin } });
      if (error) { authManual = false; authSay(/registered|exists|already/i.test(error.message) ? '이미 가입된 이메일이에요. 로그인해 주세요.' : error.message, 'err'); return; }
      // Supabase는 이미 가입된 이메일도 (열거 방지로) 에러 없이 반환한다 → identities 가 비면 기존 계정.
      if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        authManual = false;
        openAuth('login'); el('authEmail').value = email;
        authSay('이미 가입된 이메일이에요. 비밀번호로 로그인해 주세요.', 'err');
        return;
      }
      if (data && data.session) { await afterSupabaseSignIn(); return; } // 이메일 확인 꺼진 경우 즉시 세션
      authManual = false;
      authPendingEmail = email;
      openAuth('sent'); return;   // 인증 대기 화면으로 전환(재발송·로그인 안내)
    }
    // login
    authManual = true;
    const { error } = await sbAuth.auth.signInWithPassword({ email, password: pw });
    if (error) {
      authManual = false;
      const msg = /confirm/i.test(error.message) ? '이메일 인증을 먼저 완료해 주세요.'
        : /invalid/i.test(error.message) ? '이메일 또는 비밀번호가 올바르지 않아요.' : error.message;
      authSay(msg, 'err'); return;
    }
    await afterSupabaseSignIn();
  } catch (e) { authManual = false; authSay('오류: ' + (e && e.message || e), 'err'); }
  // 버튼 텍스트는 openAuth 가 모드별로 설정하므로 여기서 lbl 로 되돌리지 않는다(sent 전환 시 덮어쓰기 방지)
  finally { authBusy = false; btn.disabled = false; }
}

el('emailAuthBtn').onclick = () => openAuth('login');
el('authClose').onclick = closeAuth;
el('authForgot').onclick = () => openAuth(authMode === 'sent' ? 'login' : 'reset');
el('authSubmit').onclick = submitAuth;
el('authPw').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
el('authEmail').addEventListener('keydown', e => { if (e.key === 'Enter') { if (authMode === 'reset') submitAuth(); else el('authPw').focus(); } });
document.querySelectorAll('.auth-tab').forEach(b => { b.onclick = () => openAuth(b.dataset.mode); });

/* ---------- 미션 & 배틀패스 ---------- */
let missionScope = 'daily';
function updateMissionBadge() {
  const n = (me && me.missionAlert) || 0;
  const dot = el('missionDot'); if (dot) dot.hidden = !(n > 0);
}
async function openMissions() { el('missionModal').hidden = false; await renderMissions(); }
function closeMissions() { el('missionModal').hidden = true; }
async function renderMissions() {
  const r = await api('missions');
  if (!r.ok) { el('missionList').innerHTML = '<div class="empty">불러오기 실패</div>'; return; }
  const list = missionScope === 'daily' ? r.daily : r.weekly;
  document.querySelectorAll('.mission-tab').forEach(b => b.classList.toggle('active', b.dataset.scope === missionScope));
  el('missionList').innerHTML = list.map(m => {
    const pct = Math.min(100, Math.round(m.progress / m.target * 100));
    const btn = m.claimed
      ? '<button class="btn sm mission-claim" disabled>완료 ✓</button>'
      : m.done
        ? '<button class="btn sm primary mission-claim" data-id="' + m.id + '">받기</button>'
        : '<button class="btn sm mission-claim" disabled>' + m.progress + '/' + m.target + '</button>';
    return '<div class="mission-row' + (m.done && !m.claimed ? ' ready' : '') + (m.claimed ? ' claimed' : '') + '">'
      + '<div class="mission-info"><div class="mission-desc">' + esc(m.desc) + '</div>'
      + '<div class="mission-bar"><div class="mission-fill" style="width:' + pct + '%"></div></div>'
      + '<div class="mission-reward">💰' + m.gold.toLocaleString() + ' · 🎟️ XP ' + m.xp + '</div></div>'
      + btn + '</div>';
  }).join('');
  const bp = r.bp;
  el('missionBpFoot').innerHTML = '🎟️ 시즌 패스 Lv.' + bp.level + ' <span class="bpfoot-open" id="missionOpenPass">패스 보기 ›</span>';
  document.querySelectorAll('.mission-claim[data-id]').forEach(b => b.onclick = () => claimMission(b.dataset.id));
  const op = el('missionOpenPass'); if (op) op.onclick = () => { closeMissions(); openPass(); };
}
async function claimMission(id) {
  const r = await api('mission-claim', 'POST', { id });
  if (!r.ok) { toast(r.error, 'bad'); return; }
  applyMe(r.me); sfx('coin'); toast(r.msg, 'ok'); updateMissionBadge();
  await renderMissions();
}

function bpRewardText(r) {
  const parts = [];
  if (r.gold) parts.push('💰' + r.gold.toLocaleString());
  if (r.protect) parts.push('🛡️×' + r.protect);
  if (r.boost) parts.push('🍀×' + r.boost);
  return parts.join(' ') || '-';
}
async function openPass() { el('passModal').hidden = false; await renderPass(); }
function closePass() { el('passModal').hidden = true; }
async function renderPass() {
  const r = await api('battlepass');
  if (!r.ok) { el('passTrack').innerHTML = '<div class="empty">불러오기 실패</div>'; return; }
  const pct = r.atMax ? 100 : Math.round(r.xpInLevel / r.xpPerLevel * 100);
  el('passHead').innerHTML =
    '<div class="pass-title">🎟️ 시즌 패스 <span class="pass-season">' + esc(r.season) + '</span></div>'
    + '<div class="pass-lv">Lv.' + r.level + ' / ' + r.maxLevel + '</div>'
    + '<div class="pass-xpbar"><div class="pass-xpfill" style="width:' + pct + '%"></div></div>'
    + '<div class="pass-xptxt">' + (r.atMax ? '최대 레벨 달성' : (r.xpInLevel + ' / ' + r.xpPerLevel + ' XP')) + '</div>'
    + (r.premium ? '<div class="pass-premium-on">✨ 프리미엄 활성화됨</div>'
                 : '<button class="btn primary sm pass-buy" id="passBuy">시즌 패스 구매</button>');
  el('passTrack').innerHTML =
    '<div class="pass-cols"><span>Lv</span><span>무료</span><span>프리미엄</span></div>'
    + r.track.map(t => {
      const cell = (rw, claimed, claimable, track) => claimed
        ? '<div class="pass-cell claimed">' + bpRewardText(rw) + ' <span class="pass-got">✓</span></div>'
        : '<div class="pass-cell' + (claimable ? ' claimable' : '') + '">' + bpRewardText(rw)
          + (claimable ? ' <button class="btn sm primary pass-claim" data-lv="' + t.level + '" data-track="' + track + '">받기</button>' : '') + '</div>';
      return '<div class="pass-tier' + (t.unlocked ? ' unlocked' : '') + '">'
        + '<div class="pass-tierlv">' + t.level + '</div>'
        + cell(t.free, t.freeClaimed, t.freeClaimable, 'free')
        + cell(t.paid, t.paidClaimed, t.paidClaimable, 'paid')
        + '</div>';
    }).join('');
  const buy = el('passBuy'); if (buy) buy.onclick = buyPassPremium;
  document.querySelectorAll('.pass-claim').forEach(b => b.onclick = () => claimPass(+b.dataset.lv, b.dataset.track));
}
async function claimPass(level, track) {
  const r = await api('bp-claim', 'POST', { level, track });
  if (!r.ok) { toast(r.error, 'bad'); return; }
  applyMe(r.me); sfx('coin'); toast(r.msg, 'ok'); updateMissionBadge();
  await renderPass();
}
async function buyPassPremium() {
  const r = await api('bp-premium', 'POST', {});
  if (!r.ok) { toast(r.error, 'bad'); return; }   // 현재는 '준비중' 안내
  applyMe(r.me); await renderPass();
}
el('ascendBtn').onclick = () => act(doAscend, el('ascendBtn'));
el('armory').addEventListener('click', e => {
  const a = e.target.closest('[data-arm]'); if (a) { if (!a.classList.contains('on')) act(() => doEquipWeapon(a.dataset.arm), a); return; }
  if (e.target.closest('[data-arm-new]')) return openWeaponNew();
  if (e.target.closest('[data-arm-lock]')) return armLockedClick();
});
el('wpnGrid').addEventListener('click', e => { const c = e.target.closest('[data-newcls]'); if (c) act(() => doNewWeapon(c.dataset.newcls), null); });
el('wpnClose').onclick = () => { el('wpnModal').hidden = true; };
el('wpnModal').addEventListener('click', e => { if (e.target === el('wpnModal')) el('wpnModal').hidden = true; });
el('invBtn').onclick = () => { ensureAudio(); openInv(); };
el('invClose').onclick = closeInv;
el('missionBtn').onclick = () => { ensureAudio(); openMissions(); };
el('missionClose').onclick = closeMissions;
el('passBtn').onclick = () => { ensureAudio(); openPass(); };
el('passClose').onclick = closePass;
document.querySelectorAll('.mission-tab').forEach(b => { b.onclick = () => { missionScope = b.dataset.scope; renderMissions(); }; });

/* ---------- 자동 로그인 ---------- */
(async function init() {
  initAuth();   // 이메일 로그인 UI 준비(토큰 유무와 무관하게 항상)
  if (!token) return;
  const r = await api('me');
  if (r.ok) {
    applyMe(r.me);
    if (!me.class) return showClassSelect();
    enterGame();
  } else { token = null; localStorage.removeItem('token'); }
})();

/* 주기적으로 내 상태(채굴 누적·골드·횟수) + 공용 목록 갱신
   (레이드 탭은 자체 폴링 루프가 담당) */
setInterval(async () => {
  if (!me || el('game').hidden || currentTab === 'raid') return;
  try { await pollMe(); } catch (e) { /* 무시 */ }
  // 채굴장 제외(위와 동일 이유): 연타 중 돌 리셋 방지
  if (['rank', 'log', 'hogu', 'goldrank', 'shop'].includes(currentTab)) loadTab();
}, 5000);
