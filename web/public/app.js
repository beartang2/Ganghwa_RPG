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
function maybeShowGuide() { if (!sessionStorage.getItem('guideSeen')) el('guide').hidden = false; }
function enterGame() { show('game'); render(); loadTab(); maybeShowGuide(); openEvents(); initRealtime(); }

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
    if (['rank', 'goldrank', 'hogu', 'log', 'fight', 'shop', 'mine'].includes(currentTab)) loadTab();
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
  const { classes } = await api('classes');
  el('classGrid').innerHTML = Object.values(classes).map(c =>
    `<div class="class-card" data-class="${c.id}">
      <div class="cemoji">${c.emoji}</div>
      <div class="cname">${esc(c.name)}</div>
      <div class="cdesc">${esc(c.desc)}</div>
      <div class="cweapon">무기: ${esc(c.weapon)}</div>
    </div>`).join('');
  el('classGrid').querySelectorAll('.class-card').forEach(card => {
    card.onclick = async () => {
      const r = await api('setclass', 'POST', { class: card.dataset.class });
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
  el('hNick').innerHTML = (me.classEmoji || '') + ' ' + nickSpan(me.nick, me.nickColor) + ' <span class="edit-hint">✏️</span>';
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
  el('mineBtn').disabled = me.mine <= 0;

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
  if (r.result === 'success') { toast(r.msg, 'ok'); flashWeapon('ok'); }
  else if (r.result === 'destroy') { toast(r.msg, 'bad'); flashWeapon('bad'); }
  else if (r.result === 'protected') { toast(r.msg, 'info'); flashWeapon('ok'); }
  else { toast(r.msg, ''); } // 실패는 흔한 결과 → 번쩍임 없이 담백하게
  if (['rank', 'log', 'hogu'].includes(currentTab)) loadTab();
}
async function doHunt() {
  const r = await api('hunt', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; render();
  let msg = (r.overtime ? '♾️ ' : '') + (r.crit ? '💥치명타! ' : '') + r.monster.emoji + ' ' + r.monster.name + '(' + r.monster.rarity + ')에게 ' + r.dealt + ' 데미지' + (r.slain ? ' 처치!' : '') + '  💰+' + r.gold;
  if (r.drop) msg += '  🎁' + r.drop.text;
  toast(msg, r.drop ? 'info' : 'ok');
  if (['log', 'goldrank'].includes(currentTab)) loadTab();
}
async function doMine() {
  const r = await api('mine', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; render(); toast('⛏️ 채굴 완료! +' + r.amount.toLocaleString() + 'G', 'ok');
  if (currentTab === 'mine') renderMinePanel();
}
/* ---------- 채굴장(능동) ---------- */
let mineSession = 0, lastMineFb;
function renderMinePanel(fb) {
  if (currentTab !== 'mine' || !me) return;
  if (fb !== undefined) lastMineFb = fb;
  const f = lastMineFb;
  const stPct = Math.round(me.stamina / me.staminaMax * 100);
  const xpPct = Math.round(me.mineXp / me.mineXpNext * 100);
  const tired = me.stamina < 8;
  el('panel').innerHTML =
    `<div class="mine-top">
       <span class="mine-lv">⛏️ 채굴 <b>Lv.${me.mineLevel}</b></span>
       <span class="mine-xptxt">${me.mineXp}/${me.mineXpNext} XP</span>
     </div>
     <div class="mine-bar xp"><div class="mine-fill xp" style="width:${xpPct}%"></div></div>
     <div class="mine-stamlabel">💪 기력 <span>${me.stamina}/${me.staminaMax}</span></div>
     <div class="mine-bar stam"><div class="mine-fill stam${tired ? ' low' : ''}" style="width:${stPct}%"></div></div>
     <button class="btn primary big" data-mineswing style="margin:14px 0 6px">⛏️ 곡괭이질</button>
     <div class="mine-fb ${f ? f.kind : ''}">${f ? f.text : (tired
        ? '💤 기력이 바닥이라 지친 곡괭이질(보상↓)만 돼요. 시간당 회복!'
        : '곡괭이질로 골드를 캐고 숙련도를 올려요. 기력이 있으면 💥노다지·💎원석 찬스!')}</div>
     <div class="mine-auto">
       <span>🕳️ 자동 채굴 누적 <b>+${me.mine.toLocaleString()}G</b></span>
       <button class="btn sm primary" data-minecollect ${me.mine <= 0 ? 'disabled' : ''}>수령</button>
     </div>
     <div class="mine-session">이번 세션 획득 💰 <b>+${mineSession.toLocaleString()}G</b></div>`;
}
async function doMineSwing() {
  const r = await api('mine/swing', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; mineSession += r.gold; render();
  renderMinePanel({ text: r.msg, kind: r.jackpot ? 'ok' : r.gem ? 'info' : r.tired ? 'tired' : '' });
  if (r.leveledTo) toast('🎉 채굴 레벨 ' + r.leveledTo + ' 달성! 채굴 수익 증가', 'ok');
  else if (r.gem && r.gem.type === 'protect') toast(r.gem.text, 'info');
}
async function doMineCollect() {
  const r = await api('mine', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; mineSession += r.amount; render();
  renderMinePanel({ text: '🕳️ 자동 채굴 수령 +' + r.amount.toLocaleString() + 'G', kind: 'ok' });
}
async function doAttend() {
  const r = await api('attend', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; render(); toast('📅 ' + r.msg, 'ok');
}
async function doProtect() {
  const qty = prompt('파괴방지권 몇 개를 살까요? (개당 3,000G)', '1');
  if (qty == null) return;
  const r = await api('protect', 'POST', { qty });
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; render(); toast('🛡️ ' + r.msg, 'info');
}
async function doBuy(item) {
  if (item === 'classchange' && !confirm('직업 변경권 30,000G — 직업을 다시 선택합니다(레벨·골드 유지). 구매할까요?')) return;
  const r = await api('shop/buy', 'POST', { item });
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

async function doPartyCreate() { const r = await api('party/create', 'POST'); if (!r.ok) return toast(r.error, 'bad'); me = r.me; await refreshRaidData(); paintRaid(); }
async function doPartyLeave() { const r = await api('party/leave', 'POST'); if (!r.ok) return toast(r.error, 'bad'); me = r.me; if (curRaid) dismissedRaidTs = curRaid.startTs; await refreshRaidData(); paintRaid(); }
async function doPartyJoin(id) { const r = await api('party/join', 'POST', { id }); if (!r.ok) return toast(r.error, 'bad'); me = r.me; await refreshRaidData(); paintRaid(); }
async function doInvite(nick) { const r = await api('party/invite', 'POST', { nick }); toast(r.ok ? ('📨 ' + r.msg) : r.error, r.ok ? 'info' : 'bad'); await refreshRaidData(); paintRaid(); }
async function doAccept(id) { const r = await api('party/accept', 'POST', { id }); if (!r.ok) return toast(r.error, 'bad'); me = r.me; await refreshRaidData(); paintRaid(); }
async function doReject(id) { await api('party/reject', 'POST', { id }); await refreshRaidData(); paintRaid(); }
async function doRaid(boss) { const r = await api('raid', 'POST', { boss }); if (!r.ok) return toast(r.error, 'bad'); me = r.me; dismissedRaidTs = null; await refreshRaidData(); paintRaid(); }
function closeRaid() { if (curRaid) dismissedRaidTs = curRaid.startTs; lastPartyHtml = ''; paintRaid(); }

async function refreshRaidData() {
  lastFetch = Date.now();
  try {
    if (!BOSS_CACHE.length) { const br = await api('bosses'); BOSS_CACHE = br.bosses || []; }
    const [meR, raidR, partiesR, playersR] = await Promise.all([api('me'), api('party/raid'), api('parties'), api('players')]);
    if (meR.ok) { me = meR.me; render(); }
    curRaid = raidR.raid; cacheParties = partiesR.list || []; cachePlayers = playersR.list || [];
  } catch (e) { /* 네트워크 순간 오류 무시 */ }
}
function startRaidLoop() {
  stopRaidLoop();
  lastPartyHtml = ''; // 탭 재진입 시 항상 다시 그리도록 캐시 리셋
  refreshRaidData().then(paintRaid);
  raidTimer = setInterval(async () => {
    if (currentTab !== 'raid') return;
    if (Date.now() - lastFetch > 1600) await refreshRaidData();
    paintRaid();
  }, 500);
}
function stopRaidLoop() { if (raidTimer) clearInterval(raidTimer); raidTimer = null; }

function paintRaid() {
  if (currentTab !== 'raid') return;
  const panel = el('panel');
  if (curRaid && curRaid.startTs !== dismissedRaidTs) paintBattle(panel, curRaid);
  else paintParty(panel);
}
function bar(pct, color) {
  const w = Math.max(0, Math.min(100, pct));
  return `<div style="background:#0f131c;border-radius:6px;height:15px;overflow:hidden;border:1px solid var(--line)"><div style="height:100%;width:${w}%;background:${color};transition:width .35s"></div></div>`;
}
function paintBattle(panel, raid) {
  const len = raid.timeline.length;
  let idx = Math.floor((Date.now() - raid.startTs) / 700);
  if (idx > len) idx = len;
  const done = idx >= len;
  const e = idx <= 0 ? { bossHP: raid.boss.hp, partyHP: raid.maxHP, dmg: 0, incoming: 0, enrage: false } : raid.timeline[idx - 1];
  let html = `<div style="text-align:center;margin-bottom:8px"><div style="font-size:38px">${raid.boss.emoji}</div>
      <b>${esc(raid.boss.name)}</b> ${done ? '' : '<small style="color:var(--muted)">⚔️ 전투 중...</small>'}</div>
    <div style="font-size:12px;color:var(--muted)">보스 HP</div>${bar(e.bossHP / raid.boss.hp * 100, '#ff5d6c')}
    <div style="font-size:12px;color:var(--muted);margin-top:6px">파티 HP</div>${bar(e.partyHP / raid.maxHP * 100, '#49d17a')}
    <div style="text-align:center;margin:10px 0;font-size:13px">라운드 ${Math.min(idx, len)}/${len} ${e.enrage ? '🔥광폭화' : ''}<br>
      <span style="color:#ffd479">파티 −${e.dmg}</span> · <span style="color:#ff8a94">피격 ${e.incoming}</span></div>
    <div style="text-align:center;font-size:14px">${raid.participants.map(p => p.classEmoji + esc(p.nick)).join('  ')}</div>`;
  if (done) {
    html += `<div class="raid-result ${raid.win ? 'win' : 'lose'}" style="margin-top:12px"><b>${raid.win ? '🏆 레이드 성공!' : '☠️ 레이드 실패...'}</b>` +
      (raid.win ? '<br>' + raid.rewards.map(rw => esc(rw.nick) + ' 💰+' + rw.gold.toLocaleString() + (rw.drop ? ' ' + rw.drop : '')).join('<br>') : '') +
      `</div><button class="btn ghost sm" id="closeRaidBtn" style="margin-top:8px">닫기</button>`;
  }
  panel.innerHTML = html;
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
    } else html += `<p class="hint">파티장이 레이드를 시작할 수 있어요. 시작하면 여기서 함께 전투를 관전해요.</p>`;
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
function cacheableTab(t) { return t !== 'raid' && t !== 'mine'; }
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
        <span class="nm" data-nick="${esc(p.nick)}">${p.classEmoji || ''} ${nickSpan(p.nick, p.nickColor)}</span>
        <span class="val">${esc(p.weapon)} · ${p.wins}승${p.losses}패</span></div>`).join('') : emptyMsg('아직 참가자가 없어요');
  } else if (currentTab === 'mine') {
    renderMinePanel();
  } else if (currentTab === 'goldrank') {
    const { list } = await api('goldrank'); if (stale()) return;
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${medal(i)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${nickSpan(p.nick, p.nickColor)}</span>
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

/* ---------- 프로필 모달 ---------- */
async function openProfile(nick) {
  const r = await api('profile?name=' + encodeURIComponent(nick));
  if (!r.ok) return toast(r.error, 'bad');
  const p = r.profile;
  const isMe = me && p.nick === me.nick;
  el('modalBody').innerHTML =
    `<h3>${p.classEmoji || '📇'} ${nickSpan(p.nick, p.nickColor)} <small style="color:var(--muted)">${esc(p.className || '')}</small></h3>
     ${p.titles && p.titles.length
      ? `<div class="titles-row">${p.titles.map(t => `<span class="title-chip" style="color:${t.color};border-color:${t.color}" title="${esc(t.desc)}">${esc(t.title)}</span>`).join('')}</div>`
      : `<div class="titles-empty">아직 획득한 칭호가 없어요</div>`}
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
  if (isMe) el('renameBtn').onclick = doRename;
}
async function doRename() {
  const v = el('renameInput').value.trim();
  const r = await api('rename', 'POST', { nick: v });
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; el('modal').hidden = true; render(); loadTab();
  toast('✏️ ' + r.msg, 'ok');
}

/* ---------- 이벤트 ---------- */
el('loginBtn').onclick = async () => {
  const nick = el('nick').value.trim(), pin = el('pin').value.trim();
  el('loginErr').textContent = '';
  const r = await api('login', 'POST', { nick, pin });
  if (!r.ok) { el('loginErr').textContent = r.error; return; }
  token = r.token; localStorage.setItem('token', token); me = r.me;
  if (r.needClass) return showClassSelect();
  enterGame();
};
el('pin').addEventListener('keydown', e => { if (e.key === 'Enter') el('loginBtn').click(); });
el('logoutBtn').onclick = () => { stopRaidLoop(); closeEvents(); closeRealtime(); token = null; me = null; curRaid = null; localStorage.removeItem('token'); show('login'); };

// 버튼 연타 방지: 액션 사이 최소 간격
const COOLDOWN = 450;
let busy = false;
async function act(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } finally { setTimeout(() => { busy = false; }, COOLDOWN); }
}
el('enhanceBtn').onclick = () => act(doEnhance);
el('huntBtn').onclick = () => act(doHunt);
el('mineBtn').onclick = () => act(doMine);
el('attendBtn').onclick = () => act(doAttend);
el('protectBtn').onclick = () => act(doProtect);
// 상단바 내 닉네임 클릭 → 내 프로필(닉변경 가능)
el('hNick').onclick = () => { if (me) openProfile(me.nick); };

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); currentTab = btn.dataset.tab;
    if (currentTab === 'mine') { mineSession = 0; lastMineFb = null; }
    // 본 적 있는 탭이면 캐시를 즉시 표시(로딩 없이), 처음이면 로딩 표시. 그다음 loadTab 이 갱신.
    if (cacheableTab(currentTab)) el('panel').innerHTML = tabHtmlCache[currentTab] || '<div class="empty">불러오는 중…</div>';
    loadTab();
  };
});

el('panel').addEventListener('click', e => {
  const f = e.target.closest('[data-fight]'); if (f) return act(() => doFight(f.dataset.fight));
  const r = e.target.closest('[data-raid]'); if (r) return act(() => doRaid(r.dataset.raid));
  const j = e.target.closest('[data-join]'); if (j) return act(() => doPartyJoin(j.dataset.join));
  const bu = e.target.closest('[data-buy]'); if (bu) return act(() => doBuy(bu.dataset.buy));
  if (e.target.closest('[data-mineswing]')) return act(doMineSwing);
  if (e.target.closest('[data-minecollect]')) return act(doMineCollect);
  const iv = e.target.closest('[data-invite]'); if (iv) return act(() => doInvite(iv.dataset.invite));
  const ac = e.target.closest('[data-accept]'); if (ac) return act(() => doAccept(ac.dataset.accept));
  const rj = e.target.closest('[data-reject]'); if (rj) return act(() => doReject(rj.dataset.reject));
  if (e.target.closest('#createPartyBtn')) return act(doPartyCreate);
  if (e.target.closest('#leavePartyBtn')) return act(doPartyLeave);
  if (e.target.closest('#closeRaidBtn')) return closeRaid();
  const nm = e.target.closest('[data-nick]'); if (nm) return openProfile(nm.dataset.nick);
});
el('modalClose').onclick = () => { el('modal').hidden = true; };
el('modal').addEventListener('click', e => { if (e.target === el('modal')) el('modal').hidden = true; });
el('guideClose').onclick = () => { el('guide').hidden = true; sessionStorage.setItem('guideSeen', '1'); };

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
  if (['rank', 'log', 'hogu', 'goldrank', 'shop', 'mine'].includes(currentTab)) loadTab();
}, 5000);
