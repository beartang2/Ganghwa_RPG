'use strict';
/* ---------- 상태 ---------- */
let token = localStorage.getItem('token') || null;
let me = null;
let currentTab = 'rank';

const el = id => document.getElementById(id);

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

/* ---------- 무기 SVG (직업별 모양 + 등급별 장식 업그레이드) ---------- */
function gradeTier(level) { return level >= 70 ? 4 : level >= 50 ? 3 : level >= 26 ? 2 : level >= 16 ? 1 : 0; }
function sparkle(x, y, c) { return `<path d="M${x} ${y - 3.2} L${x + 1.8} ${y} L${x} ${y + 3.2} L${x - 1.8} ${y} Z" fill="${c}"/>`; }
function weaponSVG(cls, level, color) {
  const tier = gradeTier(level);
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
    inner = `<polygon points="40,2 53,22 53,64 40,82 27,64 27,22" fill="url(#bl)" stroke="${color}" stroke-width="1.5"/>
      <polygon points="40,2 40,82 27,64 27,22" fill="#fff" opacity=".18"/>
      <rect x="16" y="80" width="48" height="8" rx="3" fill="#c9a24a"/>
      <rect x="35" y="88" width="10" height="17" rx="3" fill="#7a5a2c"/><circle cx="40" cy="107" r="5" fill="#c9a24a"/>`;
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
function maybeShowGuide() { if (!localStorage.getItem('guideSeen')) el('guide').hidden = false; }
function enterGame() { show('game'); render(); withLoad(loadTab); maybeShowGuide(); openEvents(); initRealtime(); }

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
    try { const r = await api('me'); if (r.ok) { me = r.me; render(); } } catch (e) { /* 무시 */ }
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
      me = r.me; enterGame();
      toast('모험을 시작합니다! "출석"·"채굴"·"사냥"으로 골드를 모으세요 🎉', 'info');
    };
  });
}

/* ---------- 무기 이미지 로더 (있으면 이미지, 없으면 SVG 폴백) ----------
 * 우선순위: /weapons/{class}_{element}_{grade}.png → {element}_{grade}.png → SVG */
let lastWeaponKey = '';
function setWeaponArt(m) {
  const key = m.class + '|' + m.element + '|' + m.grade.key;
  if (key === lastWeaponKey) return; // 같은 조합이면 재요청 안 함(404 반복 방지)
  lastWeaponKey = key;
  const art = el('weaponArt');
  const candidates = [
    '/weapons/' + m.class + '_' + m.element + '_' + m.grade.key + '.png',
    '/weapons/' + m.element + '_' + m.grade.key + '.png',
  ];
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) { art.innerHTML = weaponSVG(m.class, m.level, m.grade.color); return; }
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
  el('hNick').innerHTML = (me.classEmoji || '') + ' ' + nickSpan(me.nick, me.nickColor) + titleTag(me.equippedTitle) + ' <span class="edit-hint">✏️</span>';
  el('hGold').textContent = me.gold.toLocaleString();
  el('hProtect').textContent = me.protects;

  setWeaponArt(me);
  el('weaponName').textContent = me.weapon;
  el('weaponElem').textContent = (me.elementEmoji || '') + ' ' + (me.elementName || '') + '속성';
  el('weaponElem').style.color = me.elementColor || 'var(--muted)';
  el('oddsS').textContent = fmtPct(me.odds.success);
  el('oddsD').textContent = fmtPct(me.odds.destroy);
  const pity = Math.round((me.pity || 0) * 100);
  el('pityPct').textContent = pity + '%';
  el('pityBar').style.width = pity + '%';
  el('nextCost').textContent = me.nextCost == null ? '🌈 만렙 달성!' : '다음 강화 비용 ' + me.nextCost.toLocaleString() + 'G';
  el('enhanceBtn').textContent = '⚒️ 강화' + (me.enhanceBoost > 0 ? ' 🍀' + me.enhanceBoost : '');
  el('enhanceBtn').disabled = me.nextCost == null || me.gold < me.nextCost;

  el('huntLeft').textContent = me.huntsLeft > 0 ? '(' + me.huntsLeft + '/' + me.dailyHunts + ')' : '♾️';
  el('huntBtn').disabled = false;   // 무한 사냥: 항상 가능(소진 후엔 보상 축소)
  el('mineAmt').textContent = me.mine > 0 ? '(+' + me.mine.toLocaleString() + ')' : '';
  el('mineBtn').disabled = false;   // 채굴 모달 열기 — 항상 가능(누적 없어도 돌 깨기)

  el('sBest').textContent = '+' + me.best;
  el('sBreaks').textContent = me.breaks + '회';
  el('sRecord').textContent = me.wins + '승 ' + me.losses + '패';
  el('sRank').textContent = me.rank.rank ? me.rank.rank + '/' + me.rank.total + '위' : '-';
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
  }
}
// 첫 사용자 제스처에서 오디오 unlock (iOS 자동재생 정책)
document.addEventListener('pointerdown', () => ensureAudio(), { once: true, capture: true });

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
function flashWeapon(kind) {
  const panel = document.querySelector('.weapon-panel');
  panel.classList.remove('ok', 'bad'); void panel.offsetWidth; panel.classList.add(kind);
  const art = el('weaponArt'); art.classList.remove('shake'); void art.offsetWidth;
  if (kind === 'bad') art.classList.add('shake');
}

/* ---------- 액션 ---------- */
async function doEnhance() {
  const r = await api('enhance', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; render();
  if (r.result === 'success') { toast(r.msg, 'ok'); flashWeapon('ok'); vibe(r.guaranteed ? [18, 40, 30] : 16); sfx(r.guaranteed ? 'guaranteed' : 'success'); }
  else if (r.result === 'destroy') { toast(r.msg, 'bad'); flashWeapon('bad'); vibe([30, 50, 30, 50, 40]); sfx('destroy'); } // 파괴는 길고 강하게
  else if (r.result === 'protected') { toast(r.msg, 'info'); flashWeapon('ok'); vibe([20, 35, 20]); sfx('protect'); }
  else { toast(r.msg, ''); vibe(5); sfx('fail'); } // 실패는 짧게
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
  huntOpen = true; huntSession = 0; huntKills = 0; huntCur = null;
  el('huntModal').hidden = false;
  updateHuntHud();
  el('huntFb').textContent = '';
  spawnHuntMonster();
}
function closeHunt() { huntOpen = false; huntCur = null; el('huntModal').hidden = true; }
function updateHuntHud() {
  if (!me) return;
  const overtime = me.huntsLeft <= 0;
  el('huntCount').textContent = overtime ? '♾️ 무한 사냥' : ('오늘 ' + (me.dailyHunts - me.huntsLeft) + '/' + me.dailyHunts);
  el('huntSession').innerHTML = '처치 <b>' + huntKills + '</b> · 획득 💰 <b>+' + huntSession.toLocaleString() + 'G</b>';
}
async function spawnHuntMonster() {
  if (!huntOpen || huntSpawning) return;
  huntSpawning = true;
  const mon = el('huntMon'); if (mon) mon.classList.remove('dead');
  const r = await withLoad(() => api('hunt', 'POST'));   // 서버가 몬스터·보상·치명타 결정(보상은 서버에 즉시 반영)
  huntSpawning = false;
  if (!huntOpen) return;                  // 그새 닫힘
  if (!r.ok) { el('huntFb').textContent = r.error + ' — 잠시 후 다시'; huntCur = null;
    setTimeout(() => { if (huntOpen && !huntCur) spawnHuntMonster(); }, 1200); return; }
  const m = r.monster;
  const need = Math.min(7, 4 + (m.tier || 0));   // 강한(희귀) 몬스터일수록 더 여러 번
  huntCur = { r, taps: 0, need, dmgPerTap: Math.max(1, Math.ceil((m.hp || 10) / need)) };
  const monEl = el('huntMon');
  monEl.className = 'hunt-mon t' + (m.tier || 0);
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
  me = r.me; huntSession += r.gold; huntKills++; render();  // 서버 반영분을 이제 화면에 리빌
  let msg = '💰 +' + r.gold.toLocaleString() + 'G' + (r.crit ? ' 💥치명타!' : '');
  if (r.drop) msg += r.drop.type === 'potion' ? '  ' + r.drop.text : '  🎁' + r.drop.text;
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
  me = r.me; mineSession += r.amount; render(); vibe(12); sfx('coin');
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
  me = r.me; mineSession += r.gold; render();
  vibe(r.jackpot || r.gem ? [14, 30, 20] : 16);   // 돌 파괴 햅틱(노다지·원석은 강하게)
  sfx(r.jackpot || r.gem ? 'jackpot' : 'break');
  spawnRockReward(r);
  setTimeout(() => {
    rockHits = 0; rockBusy = false;
    renderMinePanel({ text: r.msg, kind: r.jackpot ? 'ok' : r.gem ? 'info' : r.tired ? 'tired' : '' });
    if (r.leveledTo) toast('🎉 채굴 레벨 ' + r.leveledTo + ' 달성! 채굴 수익 증가', 'ok');
    else if (r.gem && r.gem.type === 'protect') toast(r.gem.text, 'info');
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
  me = r.me; render(); toast('📅 ' + r.msg, 'ok');
}
async function doBuy(item) {
  if (item === 'classchange' && !confirm('직업 변경권 30,000G — 직업을 다시 선택합니다(레벨·골드 유지). 구매할까요?')) return;
  const r = await api('shop-buy', 'POST', { item });
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me;
  if (item === 'classchange' && r.needReselect) { showClassSelect(); return; }
  render();
  if (item === 'dye') toast('🎨 ' + r.dye.name + ' [' + r.dye.rarity + '] 뽑기 완료!', r.dye.rarity === '기본' ? 'ok' : 'info');
  else toast(r.msg || '구매 완료', 'ok');
  if (currentTab === 'shop') loadTab();
}
async function doFight(target) {
  const r = await api('fight', 'POST', { target });
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; render();
  let msg = (r.iWon ? '🏆 승리! ' : '😢 패배... ') + r.winner + ' 승 (💰' + r.steal + ' 이동)';
  if (r.broke) msg += ' · 💢' + r.broke.who + ' 무기 +' + r.broke.from + '→+' + r.broke.to;
  toast(msg, r.iWon ? 'ok' : 'bad');
  loadTab();
}

/* ---------- 파티 / 레이드 (폴링 기반 실시간 관전) ---------- */
let raidTimer = null, curRaid = null, cacheParties = [], cachePlayers = [], BOSS_CACHE = [];
let lastFetch = 0, dismissedRaidTs = null, lastPartyHtml = '';

async function doPartyCreate() { const r = await api('party-create', 'POST'); if (!r.ok) return toast(r.error, 'bad'); me = r.me; await refreshRaidData(); paintRaid(); }
async function doPartyLeave() { const r = await api('party-leave', 'POST'); if (!r.ok) return toast(r.error, 'bad'); me = r.me; if (curRaid) dismissedRaidTs = curRaid.startTs; await refreshRaidData(); paintRaid(); }
async function doPartyJoin(id) { const r = await api('party-join', 'POST', { id }); if (!r.ok) return toast(r.error, 'bad'); me = r.me; await refreshRaidData(); paintRaid(); }
async function doInvite(nick) { const r = await api('party-invite', 'POST', { nick }); toast(r.ok ? ('📨 ' + r.msg) : r.error, r.ok ? 'info' : 'bad'); await refreshRaidData(); paintRaid(); }
async function doAccept(id) { const r = await api('party-accept', 'POST', { id }); if (!r.ok) return toast(r.error, 'bad'); me = r.me; await refreshRaidData(); paintRaid(); }
async function doReject(id) { await api('party-reject', 'POST', { id }); await refreshRaidData(); paintRaid(); }
async function doRaid(boss) {
  const r = await api('raid', 'POST', { boss });
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; curRaid = r.raid; dismissedRaidTs = null; raidBuiltFor = null; raidFinishing = false; raidLocalHits = 0;
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
        (raid.win && raid.rewards && raid.rewards.length ? '<br>' + raid.rewards.map(rw => esc(rw.nick) + ' 💰+' + rw.gold.toLocaleString() + (rw.drop ? ' ' + rw.drop : '')).join('<br>') : '') +
        `<div class="raid-mvp">기여: ${parts2.map(p => esc(p.nick) + ' ' + p.contrib.toLocaleString()).join(' · ')}</div>` +
        `</div><button class="btn ghost sm" id="closeRaidBtn" style="margin-top:8px">닫기</button>`;
      sfx(raid.win ? 'jackpot' : 'destroy'); vibe(raid.win ? [15, 40, 25] : [40, 60, 40]);
      api('me').then(mr => { if (mr && mr.ok) { me = mr.me; render(); } });   // 보상 반영(상단바 골드)
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
  if (r && r.ok && r.raid) { curRaid = r.raid; if (r.me) me = r.me; if (raidBuiltFor === curRaid.startTs) updateBattleUI(); }
}
async function doRaidSkill() {
  if (!curRaid || curRaid.status !== 'active') return;
  const r = await api('raid-skill', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  if (r.raid) { curRaid = r.raid; if (r.me) me = r.me; updateBattleUI(); }
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
    if (r && r.ok && r.raid) { curRaid = r.raid; if (r.me) me = r.me; }
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
    if (!BOSS_CACHE.length) { const br = await api('bosses'); BOSS_CACHE = br.bosses || []; }
    const [meR, raidR, partiesR, playersR] = await Promise.all([api('me'), api('party-raid'), api('parties'), api('players')]);
    if (meR.ok) { me = meR.me; render(); }
    curRaid = raidR.raid; cacheParties = partiesR.list || []; cachePlayers = playersR.list || [];
  } catch (e) { /* 네트워크 순간 오류 무시 */ }
}
function startRaidLoop() {
  stopRaidLoop();
  lastPartyHtml = ''; raidBuiltFor = null;
  refreshRaidData().then(paintRaid);
  raidTimer = setInterval(raidLoopTick, 300);
}
function stopRaidLoop() { if (raidTimer) { clearInterval(raidTimer); raidTimer = null; } if (raidFlushT) { clearTimeout(raidFlushT); raidFlushT = null; } }
async function raidLoopTick() {
  if (currentTab !== 'raid') return;
  const inBattle = curRaid && curRaid.status && curRaid.startTs !== dismissedRaidTs;
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
  if (inBattle) renderBattle(curRaid);
  else paintParty(el('panel'));
}
function paintParty(panel) {
  let html = '';
  if (me.invites && me.invites.length) {
    html += `<div style="margin-bottom:6px"><b>📨 받은 파티 초대</b></div>` +
      me.invites.map(iv => `<div class="party-member"><b>${esc(iv.leaderNick)}</b> 파티 <small>${iv.count}/${iv.max}</small>
        <span style="margin-left:auto;display:flex;gap:6px"><button class="btn sm primary" data-accept="${iv.partyId}">수락</button>
        <button class="btn sm ghost" data-reject="${iv.partyId}">거절</button></span></div>`).join('') + `<div style="height:12px"></div>`;
  }
  if (me.party) {
    const pt = cacheParties.find(x => x.id === me.party.id);
    const amLeader = pt && pt.leaderNick === me.nick;
    html += `<div style="margin-bottom:8px"><b>내 파티</b> <small>(${pt ? pt.count : 1}/${pt ? pt.max : 5}명)</small></div>`;
    if (pt) html += pt.members.map(m =>
      `<div class="party-member">${m.classEmoji} <b>${esc(m.nick)}</b> <small>+${m.level}</small>
        ${m.isLeader ? '<span class="leader">👑파티장</span>' : ''}
        <span style="margin-left:auto" class="w">레이드 ${m.raidsLeft}회</span></div>`).join('');
    html += `<button class="btn ghost sm" id="leavePartyBtn" style="margin:10px 0">파티 나가기</button>`;
    if (amLeader) {
      const invitable = cachePlayers.filter(n => n !== me.nick && !(pt && pt.members.some(m => m.nick === n)));
      html += `<div style="margin:6px 0"><b>동료 초대</b></div>` +
        (invitable.length ? invitable.map(n => `<div class="party-member"><b>${esc(n)}</b><button class="btn sm primary" data-invite="${esc(n)}" style="margin-left:auto">초대</button></div>`).join('') : emptyMsg('초대할 유저가 없어요'));
      html += `<div style="margin:12px 0 6px"><b>보스 선택</b> <small>(남은 레이드 ${me.raidsLeft}/${me.dailyRaids})</small></div>`;
      html += BOSS_CACHE.map((b, i) =>
        `<div class="raid-boss"><span class="bemoji">${b.emoji}</span>
          <div class="binfo"><div class="bname">${esc(b.name)} <small>${['입문', '보통', '어려움', '지옥'][i] || ''}</small></div>
            <div class="bstat">HP ${b.hp.toLocaleString()} · 공격 ${b.atk} · 보상 💰${b.reward.toLocaleString()}</div></div>
          <button class="btn sm primary" data-raid="${b.id}">도전</button></div>`).join('');
    } else html += `<p class="hint">파티장이 레이드를 시작할 수 있어요. 시작하면 여기서 다같이 보스를 연타해요!</p>`;
  } else {
    html += `<p class="hint" style="margin:0 0 8px">파티를 만들어 동료를 초대하거나, 열린 파티에 참가하세요! (탱커·힐러 조합이 중요)</p>`;
    html += `<button class="btn primary sm" id="createPartyBtn" style="margin-bottom:10px">➕ 파티 만들기</button>`;
    html += `<div style="margin:6px 0"><b>파티 목록</b></div>`;
    html += cacheParties.length ? cacheParties.map(pt =>
      `<div class="party-member">👑 <b>${esc(pt.leaderNick)}</b> <small>${pt.count}/${pt.max}명</small>
        <button class="btn sm primary" data-join="${pt.id}" style="margin-left:auto" ${pt.count >= pt.max ? 'disabled' : ''}>참가</button></div>`).join('')
      : emptyMsg('열린 파티가 없어요. 직접 만들어보세요!');
  }
  if (html !== lastPartyHtml) { panel.innerHTML = html; lastPartyHtml = html; }
}

/* ---------- 탭 ---------- */
// 탭 로드 순서 가드: 빠르게 탭을 바꾸면 먼저 시작한 fetch 가 늦게 도착해 나중 탭을
// 덮어쓰는 레이스가 생긴다. 매 로드에 seq 를 찍고, await 후 최신이 아니면 렌더를 버린다.
// tabHtmlCache: 한 번 본 탭은 마지막 화면을 즉시 보여주고(로딩 표시 없이) 뒤에서 갱신.
let tabLoadSeq = 0;
const tabHtmlCache = {};
function cacheableTab(t) { return t !== 'raid'; }
async function loadTab() {
  const panel = el('panel');
  const seq = ++tabLoadSeq;
  const stale = () => seq !== tabLoadSeq;   // 그 사이 새 loadTab 이 시작됐으면 true
  if (currentTab === 'raid') { startRaidLoop(); return; }
  stopRaidLoop();
  if (currentTab === 'rank') {
    const { list } = await api('rank'); if (stale()) return;
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${medal(i)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${p.classEmoji || ''} ${nickSpan(p.nick, p.nickColor)}${titleTag(p.title)}</span>
        <span class="val">${esc(p.weapon)} · ${p.wins}승${p.losses}패</span></div>`).join('') : emptyMsg('아직 참가자가 없어요');
  } else if (currentTab === 'goldrank') {
    const { list } = await api('goldrank'); if (stale()) return;
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${medal(i)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${nickSpan(p.nick, p.nickColor)}${titleTag(p.title)}</span>
        <span class="val gold">${p.gold.toLocaleString()}G</span></div>`).join('') : emptyMsg('아직 참가자가 없어요');
  } else if (currentTab === 'shop') {
    const { items } = await api('shop'); if (stale()) return;
    panel.innerHTML = `<p class="hint" style="margin:0 0 10px">보유 💰${me.gold.toLocaleString()}G${me.enhanceBoost > 0 ? ' · 🍀 강화부스트 ' + me.enhanceBoost + '회' : ''}</p>` +
      items.map(it =>
        `<div class="raid-boss"><span class="bemoji">${it.emoji}</span>
          <div class="binfo"><div class="bname">${esc(it.name)} <small>${it.price.toLocaleString()}G</small></div>
            <div class="bstat">${esc(it.desc)}</div></div>
          <button class="btn sm primary" data-buy="${it.id}" ${me.gold < it.price ? 'disabled' : ''}>구매</button></div>`).join('');
  } else if (currentTab === 'hogu') {
    const { list } = await api('hogu'); if (stale()) return;
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${i < 3 ? ['👑', '🥈', '🥉'][i] : (i + 1)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${esc(p.nick)}</span>
        <span class="val">${p.c}번 파괴 🤡</span></div>`).join('') : emptyMsg('😌 오늘은 아직 아무도 안 깨졌어요');
  } else if (currentTab === 'log') {
    const { list } = await api('log'); if (stale()) return;
    panel.innerHTML = list.length ? list.map(l => `<div class="logline">${esc(l.text)}</div>`).join('') : emptyMsg('기록 없음');
  } else if (currentTab === 'fight') {
    const { list } = await api('players'); if (stale()) return;
    const others = list.filter(n => n !== me.nick);
    panel.innerHTML = `<p class="hint" style="margin:0 0 8px">이기면 상대 골드 20% 획득. (남은 싸움 ${me.fightsLeft}/${me.dailyFights})</p>` +
      (others.length ? others.map(n =>
        `<div class="fightrow"><span class="nm" data-nick="${esc(n)}">${esc(n)}</span>
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
  return e;
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
    `<h3>${p.classEmoji || '📇'} ${nickSpan(p.nick, p.nickColor)}${titleTag(eq)} <small style="color:var(--muted)">${esc(p.className || '')}</small></h3>
     ${titlesSection(p, isMe, eq)}
     <div class="pf-line"><span>무기</span><b>${esc(p.weapon)}</b></div>
     <div class="pf-line"><span>속성</span><b>${p.elementEmoji || ''} ${esc(p.elementName || '-')}</b></div>
     <div class="pf-line"><span>골드</span><b>${p.gold.toLocaleString()}G</b></div>
     <div class="pf-line"><span>방지권</span><b>${p.protects}개</b></div>
     <div class="pf-line"><span>전적</span><b>${p.wins}승 ${p.losses}패${p.winRate != null ? ' (' + p.winRate + '%)' : ''}</b></div>
     <div class="pf-line"><span>최고기록</span><b>+${p.best}</b></div>
     <div class="pf-line"><span>파괴</span><b>${p.breaks}회</b></div>
     <div class="pf-line"><span>강화순위</span><b>${p.rank.rank ? p.rank.rank + '/' + p.rank.total + '위' : '-'}</b></div>` +
    (isMe ? `<div style="margin-top:12px;display:flex;gap:6px">
       <input id="renameInput" maxlength="12" value="${esc(p.nick)}" style="flex:1;padding:9px;border-radius:10px;border:1px solid var(--line);background:#0f131c;color:var(--text)">
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
  me = r.me; render();
  openProfile(me.nick);  // 모달 새로고침(선택 상태 반영)
  toast(r.msg, 'ok');
}
async function doRename() {
  const v = el('renameInput').value.trim();
  const r = await withLoad(() => api('rename', 'POST', { nick: v }));
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; el('modal').hidden = true; render(); loadTab();
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
    token = r.token; localStorage.setItem('token', token); me = r.me;
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
function doLogout() { stopRaidLoop(); closeEvents(); closeRealtime(); token = null; me = null; curRaid = null; localStorage.removeItem('token'); show('login'); }

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
/* ---------- 상단바 메뉴(☰) ---------- */
function updateSoundBtn() { el('soundItem').textContent = (soundOn ? '🔊' : '🔇') + ' 효과음 ' + (soundOn ? 'ON' : 'OFF'); }
function closeMenu() { el('menuDrop').hidden = true; }
el('menuBtn').onclick = (e) => { e.stopPropagation(); el('menuDrop').hidden = !el('menuDrop').hidden; };
el('soundItem').onclick = () => { soundOn = !soundOn; localStorage.setItem('soundOff', soundOn ? '0' : '1'); updateSoundBtn(); if (soundOn) { ensureAudio(); sfx('click'); } };
el('helpItem').onclick = () => { closeMenu(); el('guide').hidden = false; };
el('logoutItem').onclick = () => { closeMenu(); doLogout(); };
// 메뉴 바깥 클릭 시 닫기
document.addEventListener('click', (e) => { if (!el('menuDrop').hidden && !e.target.closest('.menu-wrap')) closeMenu(); });
updateSoundBtn();

/* ---------- 자동 로그인 ---------- */
(async function init() {
  if (!token) return;
  const r = await api('me');
  if (r.ok) {
    me = r.me;
    if (!me.class) return showClassSelect();
    enterGame();
  } else { token = null; localStorage.removeItem('token'); }
})();

/* 주기적으로 내 상태(채굴 누적·골드·횟수) + 공용 목록 갱신
   (레이드 탭은 자체 폴링 루프가 담당) */
setInterval(async () => {
  if (!me || el('game').hidden || currentTab === 'raid') return;
  try { const r = await api('me'); if (r.ok) { me = r.me; render(); } } catch (e) { /* 무시 */ }
  // 채굴장 제외(위와 동일 이유): 연타 중 돌 리셋 방지
  if (['rank', 'log', 'hogu', 'goldrank', 'shop'].includes(currentTab)) loadTab();
}, 5000);
