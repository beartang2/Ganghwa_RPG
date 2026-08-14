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
  const res = await fetch('/api/' + pathName, opt);
  return res.json();
}

/* ---------- 무기 SVG (직업별 모양 + 등급별 장식 업그레이드) ---------- */
function gradeTier(level) { return level >= 80 ? 4 : level >= 60 ? 3 : level >= 40 ? 2 : level >= 20 ? 1 : 0; }
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
function enterGame() { show('game'); render(); loadTab(); maybeShowGuide(); openEvents(); }

/* ---------- 실시간 이벤트 (SSE) ---------- */
let es = null, refreshT = null;
function onRefresh() {
  if (!me || el('game').hidden || currentTab === 'raid') return; // 레이드 탭은 자체 루프가 담당
  clearTimeout(refreshT);
  refreshT = setTimeout(async () => {
    try { const r = await api('me'); if (r.ok) { me = r.me; render(); } } catch (e) { /* 무시 */ }
    if (['rank', 'goldrank', 'hogu', 'log', 'fight'].includes(currentTab)) loadTab();
  }, 250);
}
function openEvents() {
  closeEvents();
  if (!token) return;
  es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.addEventListener('refresh', onRefresh);
  es.addEventListener('notify', e => { try { const d = JSON.parse(e.data); if (d.msg) toast(d.msg, 'info'); } catch (_) { } onRefresh(); });
}
function closeEvents() { if (es) { es.close(); es = null; } }

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

/* ---------- 렌더 ---------- */
function render() {
  if (!me) return;
  el('hNick').textContent = (me.classEmoji || '') + ' ' + me.nick;
  el('hGold').textContent = me.gold.toLocaleString();
  el('hProtect').textContent = me.protects;

  el('weaponArt').innerHTML = weaponSVG(me.class, me.level, me.grade.color);
  el('weaponName').textContent = me.weapon;
  el('oddsS').textContent = Math.round(me.odds.success * 100) + '%';
  el('oddsD').textContent = Math.round(me.odds.destroy * 100) + '%';
  el('nextCost').textContent = me.nextCost == null ? '🌈 만렙 달성!' : '다음 강화 비용 ' + me.nextCost.toLocaleString() + 'G';
  el('enhanceBtn').disabled = me.nextCost == null || me.gold < me.nextCost;

  el('huntLeft').textContent = '(' + me.huntsLeft + '/' + me.dailyHunts + ')';
  el('huntBtn').disabled = me.huntsLeft <= 0;
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
  else { toast(r.msg, 'bad'); flashWeapon('bad'); }
  if (['rank', 'log', 'hogu'].includes(currentTab)) loadTab();
}
async function doHunt() {
  const r = await api('hunt', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; render();
  let msg = (r.crit ? '💥치명타! ' : '') + r.monster.emoji + ' ' + r.monster.name + '(' + r.monster.rarity + ')에게 ' + r.dealt + ' 데미지' + (r.slain ? ' 처치!' : '') + '  💰+' + r.gold;
  if (r.drop) msg += '  🎁' + r.drop.text;
  toast(msg, r.drop ? 'info' : 'ok');
  if (['log', 'goldrank'].includes(currentTab)) loadTab();
}
async function doMine() {
  const r = await api('mine', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; render(); toast('⛏️ 채굴 완료! +' + r.amount.toLocaleString() + 'G', 'ok');
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
async function loadTab() {
  const panel = el('panel');
  if (currentTab === 'raid') { startRaidLoop(); return; }
  stopRaidLoop();
  if (currentTab === 'rank') {
    const { list } = await api('rank');
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${medal(i)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${p.classEmoji || ''} ${esc(p.nick)}</span>
        <span class="val">${esc(p.weapon)} · ${p.wins}승${p.losses}패</span></div>`).join('') : emptyMsg('아직 참가자가 없어요');
  } else if (currentTab === 'goldrank') {
    const { list } = await api('goldrank');
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${medal(i)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${esc(p.nick)}</span>
        <span class="val gold">${p.gold.toLocaleString()}G</span></div>`).join('') : emptyMsg('아직 참가자가 없어요');
  } else if (currentTab === 'hogu') {
    const { list } = await api('hogu');
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${i < 3 ? ['👑', '🥈', '🥉'][i] : (i + 1)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${esc(p.nick)}</span>
        <span class="val">${p.c}번 파괴 🤡</span></div>`).join('') : emptyMsg('😌 오늘은 아직 아무도 안 깨졌어요');
  } else if (currentTab === 'log') {
    const { list } = await api('log');
    panel.innerHTML = list.length ? list.map(l => `<div class="logline">${esc(l.text)}</div>`).join('') : emptyMsg('기록 없음');
  } else if (currentTab === 'fight') {
    const { list } = await api('players');
    const others = list.filter(n => n !== me.nick);
    panel.innerHTML = `<p class="hint" style="margin:0 0 8px">이기면 상대 골드 20% 획득. (남은 싸움 ${me.fightsLeft}/${me.dailyFights})</p>` +
      (others.length ? others.map(n =>
        `<div class="fightrow"><span class="nm" data-nick="${esc(n)}">${esc(n)}</span>
          <button class="btn sm primary" data-fight="${esc(n)}" ${me.fightsLeft <= 0 ? 'disabled' : ''}>싸움</button></div>`).join('') : emptyMsg('상대가 없어요'));
  }
}
function medal(i) { return i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1); }
function emptyMsg(m) { return `<div class="empty">${m}</div>`; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------- 프로필 모달 ---------- */
async function openProfile(nick) {
  const r = await api('profile?name=' + encodeURIComponent(nick));
  if (!r.ok) return toast(r.error, 'bad');
  const p = r.profile;
  const isMe = me && p.nick === me.nick;
  el('modalBody').innerHTML =
    `<h3>${p.classEmoji || '📇'} ${esc(p.nick)} <small style="color:var(--muted)">${esc(p.className || '')}</small></h3>
     <div class="pf-line"><span>무기</span><b>${esc(p.weapon)}</b></div>
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
el('logoutBtn').onclick = () => { stopRaidLoop(); closeEvents(); token = null; me = null; curRaid = null; localStorage.removeItem('token'); show('login'); };

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

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); currentTab = btn.dataset.tab; loadTab();
  };
});

el('panel').addEventListener('click', e => {
  const f = e.target.closest('[data-fight]'); if (f) return act(() => doFight(f.dataset.fight));
  const r = e.target.closest('[data-raid]'); if (r) return act(() => doRaid(r.dataset.raid));
  const j = e.target.closest('[data-join]'); if (j) return act(() => doPartyJoin(j.dataset.join));
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
  if (['rank', 'log', 'hogu', 'goldrank'].includes(currentTab)) loadTab();
}, 5000);
