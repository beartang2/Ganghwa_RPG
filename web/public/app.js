'use strict';
/* ---------- 상태 ---------- */
let token = localStorage.getItem('token') || null;
let me = null;
let currentTab = 'rank';

const $ = s => document.querySelector(s);
const el = id => document.getElementById(id);

/* ---------- API ---------- */
async function api(pathName, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (token) opt.headers['x-token'] = token;
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch('/api/' + pathName, opt);
  return res.json();
}

/* ---------- 무기 SVG (등급 색으로 빛나는 검) ---------- */
function weaponSVG(level, color) {
  const glow = Math.min(2 + level * 0.9, 26); // 강화할수록 광채 ↑
  return `
  <svg viewBox="0 0 80 110" xmlns="http://www.w3.org/2000/svg"
       style="filter:drop-shadow(0 0 ${glow}px ${color})">
    <defs>
      <linearGradient id="blade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset=".45" stop-color="${color}"/>
        <stop offset="1" stop-color="${color}"/>
      </linearGradient>
    </defs>
    <!-- 칼날 -->
    <polygon points="40,4 48,20 48,66 40,78 32,66 32,20" fill="url(#blade)" stroke="${color}" stroke-width="1"/>
    <polygon points="40,4 40,78 32,66 32,20" fill="#ffffff" opacity=".18"/>
    <!-- 가드 -->
    <rect x="20" y="76" width="40" height="7" rx="3" fill="#c9a24a"/>
    <!-- 손잡이 -->
    <rect x="36" y="83" width="8" height="20" rx="3" fill="#7a5a2c"/>
    <!-- 폼멜 -->
    <circle cx="40" cy="105" r="5" fill="#c9a24a"/>
  </svg>`;
}

/* ---------- 화면 전환 ---------- */
function showGame() { el('login').hidden = true; el('game').hidden = false; }
function showLogin() { el('login').hidden = false; el('game').hidden = true; }

/* ---------- 렌더 ---------- */
function render() {
  if (!me) return;
  el('hNick').textContent = me.nick;
  el('hGold').textContent = me.gold.toLocaleString();
  el('hProtect').textContent = me.protects;

  el('weaponArt').innerHTML = weaponSVG(me.level, me.grade.color);
  el('weaponName').textContent = me.weapon;
  el('oddsS').textContent = Math.round(me.odds.success * 100) + '%';
  el('oddsD').textContent = Math.round(me.odds.destroy * 100) + '%';
  el('nextCost').textContent = me.nextCost == null ? '🌈 만렙 달성!' : '다음 강화 비용 ' + me.nextCost.toLocaleString() + 'G';
  el('enhanceBtn').disabled = me.nextCost == null || me.gold < me.nextCost;

  el('huntLeft').textContent = '(' + me.huntsLeft + '/' + me.dailyHunts + ')';
  el('huntBtn').disabled = me.huntsLeft <= 0;
  el('attendBtn').disabled = false;

  el('sBest').textContent = '+' + me.best;
  el('sBreaks').textContent = me.breaks + '회';
  el('sRecord').textContent = me.wins + '승 ' + me.losses + '패';
  el('sRank').textContent = me.rank.rank ? me.rank.rank + '/' + me.rank.total + '위' : '-';
  el('sFights').textContent = me.fightsLeft + '/' + me.dailyFights;
}

/* ---------- 토스트 ---------- */
let toastTimer = null;
function toast(msg, kind) {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind || '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function flashWeapon(kind) {
  const panel = $('.weapon-panel');
  panel.classList.remove('ok', 'bad');
  void panel.offsetWidth;
  panel.classList.add(kind);
  const art = el('weaponArt');
  art.classList.remove('shake'); void art.offsetWidth;
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
  if (currentTab === 'rank' || currentTab === 'log' || currentTab === 'hogu') loadTab();
}
async function doHunt() {
  const r = await api('hunt', 'POST');
  if (!r.ok) return toast(r.error, 'bad');
  me = r.me; render();
  let msg = r.monster.emoji + ' ' + r.monster.name + '에게 ' + r.dealt + ' 데미지' + (r.slain ? ' 처치!' : '') + '  💰+' + r.gold;
  if (r.drop) msg += '  🎁' + r.drop.text;
  toast(msg, r.drop ? 'info' : 'ok');
  if (currentTab === 'log' || currentTab === 'goldrank') loadTab();
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

/* ---------- 탭 ---------- */
async function loadTab() {
  const panel = el('panel');
  if (currentTab === 'rank') {
    const { list } = await api('rank');
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${medal(i)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${esc(p.nick)}</span>
        <span class="val">${esc(p.weapon)} · ${p.wins}승${p.losses}패</span></div>`).join('')
      : emptyMsg('아직 참가자가 없어요');
  } else if (currentTab === 'goldrank') {
    const { list } = await api('goldrank');
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${medal(i)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${esc(p.nick)}</span>
        <span class="val gold">${p.gold.toLocaleString()}G</span></div>`).join('')
      : emptyMsg('아직 참가자가 없어요');
  } else if (currentTab === 'hogu') {
    const { list } = await api('hogu');
    panel.innerHTML = list.length ? list.map((p, i) =>
      `<div class="row"><span class="rk">${i < 3 ? ['👑', '🥈', '🥉'][i] : (i + 1)}</span>
        <span class="nm" data-nick="${esc(p.nick)}">${esc(p.nick)}</span>
        <span class="val">${p.c}번 파괴 🤡</span></div>`).join('')
      : emptyMsg('😌 오늘은 아직 아무도 안 깨졌어요');
  } else if (currentTab === 'log') {
    const { list } = await api('log');
    panel.innerHTML = list.length ? list.map(l => `<div class="logline">${esc(l.text)}</div>`).join('')
      : emptyMsg('기록 없음');
  } else if (currentTab === 'fight') {
    const { list } = await api('players');
    const others = list.filter(n => n !== me.nick);
    panel.innerHTML = `<p class="hint" style="margin:0 0 8px">상대를 골라 결투! 이기면 상대 골드 20% 획득. (남은 싸움 ${me.fightsLeft}/${me.dailyFights})</p>` +
      (others.length ? others.map(n =>
        `<div class="fightrow"><span class="nm" data-nick="${esc(n)}">${esc(n)}</span>
          <button class="btn sm primary" data-fight="${esc(n)}" ${me.fightsLeft <= 0 ? 'disabled' : ''}>싸움</button></div>`).join('')
        : emptyMsg('상대가 없어요'));
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
  el('modalBody').innerHTML =
    `<h3>📇 ${esc(p.nick)}</h3>
     <div class="pf-line"><span>무기</span><b>${esc(p.weapon)}</b></div>
     <div class="pf-line"><span>골드</span><b>${p.gold.toLocaleString()}G</b></div>
     <div class="pf-line"><span>방지권</span><b>${p.protects}개</b></div>
     <div class="pf-line"><span>전적</span><b>${p.wins}승 ${p.losses}패${p.winRate != null ? ' (' + p.winRate + '%)' : ''}</b></div>
     <div class="pf-line"><span>최고기록</span><b>+${p.best}</b></div>
     <div class="pf-line"><span>파괴</span><b>${p.breaks}회</b></div>
     <div class="pf-line"><span>강화순위</span><b>${p.rank.rank ? p.rank.rank + '/' + p.rank.total + '위' : '-'}</b></div>`;
  el('modal').hidden = false;
}

/* ---------- 이벤트 ---------- */
el('loginBtn').onclick = async () => {
  const nick = el('nick').value.trim();
  const pin = el('pin').value.trim();
  el('loginErr').textContent = '';
  const r = await api('login', 'POST', { nick, pin });
  if (!r.ok) { el('loginErr').textContent = r.error; return; }
  token = r.token; localStorage.setItem('token', token);
  me = r.me; showGame(); render(); loadTab();
  if (r.isNew) toast('환영합니다! "출석"으로 골드를 받고 강화를 시작하세요 🎉', 'info');
};
el('pin').addEventListener('keydown', e => { if (e.key === 'Enter') el('loginBtn').click(); });
el('logoutBtn').onclick = () => { token = null; me = null; localStorage.removeItem('token'); showLogin(); };

el('enhanceBtn').onclick = doEnhance;
el('huntBtn').onclick = doHunt;
el('attendBtn').onclick = doAttend;
el('protectBtn').onclick = doProtect;

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    loadTab();
  };
});

// 리스트/싸움 버튼 위임
el('panel').addEventListener('click', e => {
  const fightBtn = e.target.closest('[data-fight]');
  if (fightBtn) return doFight(fightBtn.dataset.fight);
  const nm = e.target.closest('[data-nick]');
  if (nm) return openProfile(nm.dataset.nick);
});
el('modalClose').onclick = () => { el('modal').hidden = true; };
el('modal').addEventListener('click', e => { if (e.target === el('modal')) el('modal').hidden = true; });

/* ---------- 자동 로그인 시도 ---------- */
(async function init() {
  if (!token) return;
  const r = await api('me');
  if (r.ok) { me = r.me; showGame(); render(); loadTab(); }
  else { token = null; localStorage.removeItem('token'); }
})();

/* 주기적으로 랭킹/로그 갱신(다른 사람 활동 반영) */
setInterval(() => { if (me && !el('game').hidden && (currentTab === 'rank' || currentTab === 'log' || currentTab === 'hogu' || currentTab === 'goldrank')) loadTab(); }, 8000);
