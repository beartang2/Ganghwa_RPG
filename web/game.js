'use strict';
/*
 * 게임 로직 (프레임워크 무관, 순수 함수 모음)
 * server.js 가 db 객체를 넘겨주면 여기서 규칙을 처리한다.
 */
const crypto = require('crypto');

const CONFIG = {
  dailyFights: 5,      // 하루 싸움 횟수
  dailyHunts: 20,      // 하루 사냥 횟수
  dailyRaids: 3,       // 하루 보스레이드 횟수
  maxLevel: 25,        // 강화 만렙(초월)
  startGold: 1000,     // 시작 골드
  attendGold: 1000,    // 출석 보상
  stealPct: 0.2,       // 싸움 승리 시 상대 골드 약탈 비율
  protectPrice: 3000,  // 파괴방지권 가격
  fightBreakChance: 0.15,   // 싸움 패배 시 무기 하락 확률
  dropProtectChance: 0.03,  // 사냥 방지권 드랍 확률
  dropGoldChance: 0.07,     // 사냥 골드뭉치 드랍 확률
  mineRate: 12,        // 채굴: 분당 골드
  mineCap: 3000,       // 채굴: 최대 누적 골드
  partyMax: 5,         // 파티 최대 인원
};

/* ---------- 유틸 ---------- */
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function today() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }

/* ---------- 직업 ---------- */
const CLASSES = {
  warrior: { id: 'warrior', name: '근거리 딜러', emoji: '⚔️', weapon: '검',     desc: '높은 공격력의 근접 딜러' },
  archer:  { id: 'archer',  name: '원거리 딜러', emoji: '🏹', weapon: '활',     desc: '최고 공격력의 원거리 딜러' },
  tanker:  { id: 'tanker',  name: '탱커',       emoji: '🛡️', weapon: '대검',   desc: '높은 체력·방어로 파티를 보호' },
  healer:  { id: 'healer',  name: '힐러',       emoji: '✨', weapon: '지팡이', desc: '파티를 회복시키는 지원가' },
};
function classOf(p) { return CLASSES[p && p.class] || CLASSES.warrior; }

// 레이드 전투 스탯 (직업 + 강화 수치 기반)
function memberStats(p) {
  const L = p.level || 0;
  const base = 12 + L * 8;
  switch (p.class) {
    case 'archer': return { atk: base * 1.35, hp: 80 + L * 10,  heal: 0,          armor: 0 };
    case 'tanker': return { atk: base * 0.6,  hp: 300 + L * 30, heal: 0,          armor: 60 + L * 7 };
    case 'healer': return { atk: base * 0.5,  hp: 150 + L * 15, heal: 45 + L * 9, armor: 0 };
    case 'warrior':
    default:       return { atk: base * 1.2,  hp: 120 + L * 12, heal: 0,          armor: 0 };
  }
}

/* ---------- 등급 / 무기 ---------- */
const GRADES = [
  { min: 21, name: '초월', emoji: '🌈', color: '#c471ed' },
  { min: 16, name: '전설', emoji: '🟠', color: '#f7971e' },
  { min: 11, name: '에픽', emoji: '🟣', color: '#a770ef' },
  { min: 6,  name: '희귀', emoji: '🔵', color: '#4facfe' },
  { min: 0,  name: '일반', emoji: '⚪', color: '#9aa0b0' },
];
function grade(level) { for (const g of GRADES) { if (level >= g.min) return g; } return GRADES[GRADES.length - 1]; }
function weaponName(level, cls) {
  const g = grade(level);
  const base = (CLASSES[cls] || CLASSES.warrior).weapon;
  return '+' + level + ' ' + g.emoji + ' ' + g.name + ' ' + base;
}

/* ---------- 강화 확률 / 비용 ---------- */
function odds(level) {
  let s, d;
  if (level <= 4)       { s = 0.95;  d = 0.00; }
  else if (level <= 9)  { s = 0.85;  d = 0.02; }
  else if (level <= 14) { s = 0.72;  d = 0.04; }
  else if (level <= 19) { s = 0.58;  d = 0.06; }
  else                  { s = 0.445; d = 0.09; }
  return { success: s, destroy: d, fail: 1 - s - d };
}
function enhanceCost(level) { return 20 + level * 10; }
// 강화 성공 시 상승폭: 초반(일반·희귀, +0~9)은 확률적으로 +1~3, 이후는 +1
function successGain(level) {
  if (level < 10) {
    const r = Math.random();
    if (r < 0.60) return 1;
    if (r < 0.90) return 2;
    return 3;
  }
  return 1;
}

/* ---------- 몬스터 (사냥) ---------- */
const MONSTERS = [
  { name: '들쥐',   emoji: '🐀', hp: 50,   gpp: 1.0 },
  { name: '멧돼지', emoji: '🐗', hp: 120,  gpp: 1.3 },
  { name: '늑대',   emoji: '🐺', hp: 200,  gpp: 1.6 },
  { name: '곰',     emoji: '🐻', hp: 350,  gpp: 2.0 },
  { name: '드래곤', emoji: '🐉', hp: 600,  gpp: 3.0 },
  { name: '마왕',   emoji: '👹', hp: 1000, gpp: 4.0 },
];
function huntDamage(level) { return randInt(10, 30) + level * 8; }

/* ---------- 보스 (레이드) ---------- */
const BOSSES = [
  { id: 'goblin', name: '고블린 군주', emoji: '👺', hp: 2200,  atk: 130, reward: 5000,  dropChance: 0.10 },
  { id: 'golem',  name: '스톤 골렘',   emoji: '🗿', hp: 6500,  atk: 340, reward: 15000, dropChance: 0.20 },
  { id: 'dragon', name: '고대 드래곤', emoji: '🐲', hp: 10500, atk: 600, reward: 40000, dropChance: 0.35 },
  { id: 'demon',  name: '마계 군주',   emoji: '😈', hp: 16000, atk: 780, reward: 90000, dropChance: 0.55 },
];
function bossById(id) { return BOSSES.find(b => b.id === id); }

/* ---------- 플레이어 ---------- */
function makePlayer(pin) {
  const salt = crypto.randomBytes(8).toString('hex');
  return {
    pinHash: hashPin(pin, salt), salt,
    class: null,
    level: 0, best: 0, breaks: 0, wins: 0, losses: 0,
    gold: CONFIG.startGold, protects: 0,
    fightDay: '', fightsUsed: 0, huntDay: '', huntsUsed: 0,
    raidDay: '', raidsUsed: 0,
    attendDay: '', destroyDay: '', destroysToday: 0,
    lastMine: Date.now(), party: null, created: today(),
  };
}
// 예전 데이터 호환: 없는 필드 기본값 채우기
function norm(p) {
  if (p.protects == null) p.protects = 0;
  if (p.raidDay == null) { p.raidDay = ''; p.raidsUsed = 0; }
  if (p.lastMine == null) p.lastMine = Date.now();
  if (p.party === undefined) p.party = null;
  if (p.class === undefined) p.class = null;
  return p;
}
function fightsLeft(p) { return p.fightDay !== today() ? CONFIG.dailyFights : Math.max(0, CONFIG.dailyFights - p.fightsUsed); }
function huntsLeft(p) { return p.huntDay !== today() ? CONFIG.dailyHunts : Math.max(0, CONFIG.dailyHunts - p.huntsUsed); }
function raidsLeft(p) { return p.raidDay !== today() ? CONFIG.dailyRaids : Math.max(0, CONFIG.dailyRaids - p.raidsUsed); }
function winRate(p) { const t = p.wins + p.losses; return t === 0 ? null : Math.round(p.wins / t * 100); }
function pendingMine(p) { return Math.min(CONFIG.mineCap, Math.floor((Date.now() - p.lastMine) / 60000 * CONFIG.mineRate)); }

function publicView(db, nick) {
  const p = norm(db.players[nick]);
  const g = grade(p.level);
  const c = classOf(p);
  let party = null;
  if (p.party && db.parties[p.party]) {
    const pt = db.parties[p.party];
    party = { id: pt.id, leader: pt.leader, count: pt.members.length };
  }
  return {
    nick,
    class: p.class, className: c.name, classEmoji: c.emoji, weaponBase: c.weapon,
    level: p.level, best: p.best, breaks: p.breaks,
    wins: p.wins, losses: p.losses, winRate: winRate(p),
    gold: p.gold, protects: p.protects,
    weapon: weaponName(p.level, p.class),
    grade: { name: g.name, emoji: g.emoji, color: g.color },
    maxLevel: CONFIG.maxLevel,
    nextCost: p.level >= CONFIG.maxLevel ? null : enhanceCost(p.level),
    odds: odds(p.level),
    huntsLeft: huntsLeft(p), dailyHunts: CONFIG.dailyHunts,
    fightsLeft: fightsLeft(p), dailyFights: CONFIG.dailyFights,
    raidsLeft: raidsLeft(p), dailyRaids: CONFIG.dailyRaids,
    mine: pendingMine(p), mineCap: CONFIG.mineCap,
    party,
    rank: enhanceRank(db, nick),
  };
}

function addLog(db, text) {
  db.log.push({ t: Date.now(), text });
  if (db.log.length > 60) db.log.shift();
}
function enhanceRank(db, nick) {
  const arr = Object.keys(db.players).map(n => ({ n, lv: db.players[n].level, best: db.players[n].best }));
  arr.sort((a, b) => b.lv - a.lv || b.best - a.best);
  const i = arr.findIndex(x => x.n === nick);
  return { rank: i < 0 ? null : i + 1, total: arr.length };
}

/* ---------- 인증 / 직업 ---------- */
function login(db, nick, pin) {
  nick = (nick || '').trim();
  pin = (pin || '').trim();
  if (nick.length < 1 || nick.length > 12) return { ok: false, error: '닉네임은 1~12자로 입력하세요.' };
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN은 숫자 4자리여야 합니다.' };
  if (!db.players[nick]) {
    db.players[nick] = makePlayer(pin);
    return { ok: true, isNew: true, needClass: true };
  }
  const p = norm(db.players[nick]);
  if (hashPin(pin, p.salt) !== p.pinHash) return { ok: false, error: 'PIN이 일치하지 않습니다.' };
  return { ok: true, isNew: false, needClass: !p.class };
}
function setClass(db, nick, cls) {
  const p = norm(db.players[nick]);
  if (p.class) return { ok: false, error: '이미 직업을 선택했어요.' };
  if (!CLASSES[cls]) return { ok: false, error: '올바른 직업을 선택하세요.' };
  p.class = cls;
  p.lastMine = Date.now();
  addLog(db, CLASSES[cls].emoji + ' ' + nick + ' 님이 ' + CLASSES[cls].name + '(으)로 모험 시작!');
  return { ok: true };
}

/* ---------- 액션 ---------- */
function enhance(db, nick) {
  const p = norm(db.players[nick]);
  if (p.level >= CONFIG.maxLevel) return { ok: false, error: '이미 만렙(+' + CONFIG.maxLevel + ' 초월)입니다!' };
  const cost = enhanceCost(p.level);
  if (p.gold < cost) return { ok: false, error: '골드 부족! (필요 ' + cost + ' / 보유 ' + p.gold + ')' };
  p.gold -= cost;

  const before = p.level;
  const o = odds(before);
  const r = Math.random();
  let result, msg;
  if (r < o.success) {
    const gain = successGain(before);
    p.level = Math.min(CONFIG.maxLevel, before + gain);
    if (p.level > p.best) p.best = p.level;
    result = 'success';
    msg = (gain > 1 ? '💫 대성공! +' + gain + '  ' : '강화 성공! ') + '+' + before + ' → +' + p.level;
    addLog(db, '✅ ' + nick + ' +' + before + '→+' + p.level + (gain > 1 ? ' (+' + gain + ')' : ''));
  } else if (r < o.success + o.destroy) {
    if (p.protects > 0) {
      p.protects--;
      result = 'protected'; msg = '🛡️ 파괴 방지 발동! +' + before + ' 유지 (남은 방지권 ' + p.protects + ')';
      addLog(db, '🛡️ ' + nick + ' +' + before + ' 파괴방지');
    } else {
      p.level = 0; p.breaks++;
      if (p.destroyDay !== today()) { p.destroyDay = today(); p.destroysToday = 0; }
      p.destroysToday++;
      result = 'destroy'; msg = '💥 파괴!! +' + before + ' 무기가 산산조각... 처음부터 다시!';
      addLog(db, '💥 ' + nick + ' +' + before + '→0 파괴');
    }
  } else {
    if (p.level >= 10) { p.level--; result = 'down'; msg = '❌ 실패... +' + before + ' → +' + p.level + ' (하락)'; }
    else { result = 'keep'; msg = '❌ 실패... +' + before + ' 유지'; }
  }
  return { ok: true, result, msg, cost };
}

function attend(db, nick) {
  const p = norm(db.players[nick]);
  if (p.attendDay === today()) return { ok: false, error: '오늘은 이미 출석했어요!' };
  p.attendDay = today();
  p.gold += CONFIG.attendGold;
  return { ok: true, gained: CONFIG.attendGold, msg: '출석 완료! +' + CONFIG.attendGold + 'G' };
}

function mine(db, nick) {
  const p = norm(db.players[nick]);
  const amount = pendingMine(p);
  if (amount <= 0) return { ok: false, error: '아직 채굴된 골드가 없어요. 시간이 지나면 쌓여요.' };
  p.gold += amount;
  p.lastMine = Date.now();
  return { ok: true, amount, msg: '⛏️ 채굴 +' + amount + 'G' };
}

function hunt(db, nick) {
  const p = norm(db.players[nick]);
  if (p.huntDay !== today()) { p.huntDay = today(); p.huntsUsed = 0; }
  if (p.huntsUsed >= CONFIG.dailyHunts) return { ok: false, error: '오늘 사냥을 다 했어요! 내일 다시.' };
  p.huntsUsed++;

  const m = MONSTERS[randInt(0, MONSTERS.length - 1)];
  const dmg = huntDamage(p.level);
  const dealt = Math.min(dmg, m.hp);
  const slain = dmg >= m.hp;
  let gold = Math.round(dealt * m.gpp);
  if (slain) gold = Math.round(gold * 1.5);
  p.gold += gold;

  let drop = null;
  if (Math.random() < CONFIG.dropProtectChance) {
    p.protects++; drop = { type: 'protect', text: '🛡️ 파괴방지권 1개!' };
    addLog(db, '🎁 ' + nick + ' 방지권 드랍!');
  } else if (Math.random() < CONFIG.dropGoldChance) {
    const bonus = Math.round(randInt(200, 600) * m.gpp);
    p.gold += bonus; drop = { type: 'gold', amount: bonus, text: '💰 골드뭉치 +' + bonus };
  }
  addLog(db, '🗡️ ' + nick + ' ' + m.emoji + m.name + ' ' + (slain ? '처치' : '사냥') + ' +' + gold + 'G');
  return { ok: true, monster: { name: m.name, emoji: m.emoji, hp: m.hp }, dmg, dealt, slain, gold, drop };
}

function buyProtect(db, nick, qty) {
  const p = norm(db.players[nick]);
  qty = parseInt(qty, 10); if (isNaN(qty) || qty < 1) qty = 1;
  const total = CONFIG.protectPrice * qty;
  if (p.gold < total) return { ok: false, error: '골드 부족! (' + qty + '개 = ' + total + 'G / 보유 ' + p.gold + ')' };
  p.gold -= total; p.protects += qty;
  return { ok: true, qty, spent: total, msg: '파괴방지권 ' + qty + '개 구매!' };
}

function fight(db, nick, targetName) {
  targetName = (targetName || '').trim();
  if (!targetName) return { ok: false, error: '상대를 선택하세요.' };
  if (targetName === nick) return { ok: false, error: '자기 자신과는 싸울 수 없어요.' };
  if (!db.players[targetName]) return { ok: false, error: '"' + targetName + '" 님을 찾을 수 없어요.' };

  const atk = norm(db.players[nick]);
  const def = norm(db.players[targetName]);
  if (atk.fightDay !== today()) { atk.fightDay = today(); atk.fightsUsed = 0; }
  if (atk.fightsUsed >= CONFIG.dailyFights) return { ok: false, error: '오늘 싸움 횟수를 다 썼어요!' };
  atk.fightsUsed++;

  let pWin = 0.5 + (atk.level - def.level) * 0.05;
  pWin = Math.max(0.1, Math.min(0.9, pWin));
  const atkWin = Math.random() < pWin;
  const winP = atkWin ? atk : def, loseP = atkWin ? def : atk;
  const winner = atkWin ? nick : targetName, loser = atkWin ? targetName : nick;
  winP.wins++; loseP.losses++;

  const steal = Math.floor(loseP.gold * CONFIG.stealPct);
  loseP.gold -= steal; winP.gold += steal;

  let broke = null;
  if (loseP.level > 0 && Math.random() < CONFIG.fightBreakChance) {
    const b = loseP.level; loseP.level--;
    broke = { who: loser, from: b, to: loseP.level };
    addLog(db, '💢 ' + loser + ' 무기 손상 +' + b + '→+' + loseP.level);
  }
  addLog(db, '⚔️ ' + winner + ' 승 vs ' + loser + ' (' + steal + 'G 약탈)');
  return {
    ok: true, iWon: winner === nick, winner, loser, steal, broke,
    atk: { nick, level: atk.level }, def: { nick: targetName, level: def.level },
  };
}

/* ---------- 파티 / 레이드 ---------- */
function partyView(db, id) {
  const pt = db.parties[id];
  if (!pt) return null;
  return {
    id: pt.id, leader: pt.leader,
    members: pt.members.map(n => {
      const mp = db.players[n]; const c = classOf(mp);
      return { nick: n, classEmoji: c.emoji, className: c.name, level: mp ? mp.level : 0, raidsLeft: mp ? raidsLeft(mp) : 0 };
    }),
    count: pt.members.length, max: CONFIG.partyMax,
  };
}
function partyCreate(db, nick) {
  const p = norm(db.players[nick]);
  if (p.party) return { ok: false, error: '이미 파티에 속해 있어요.' };
  const id = crypto.randomBytes(3).toString('hex');
  db.parties[id] = { id, leader: nick, members: [nick], created: Date.now() };
  p.party = id;
  return { ok: true, party: partyView(db, id) };
}
function partyJoin(db, nick, id) {
  const p = norm(db.players[nick]);
  if (p.party) return { ok: false, error: '이미 파티에 속해 있어요.' };
  const pt = db.parties[id];
  if (!pt) return { ok: false, error: '파티를 찾을 수 없어요.' };
  if (pt.members.length >= CONFIG.partyMax) return { ok: false, error: '파티가 가득 찼어요.' };
  pt.members.push(nick); p.party = id;
  addLog(db, '🤝 ' + nick + ' 님이 ' + pt.leader + ' 파티에 합류');
  return { ok: true, party: partyView(db, id) };
}
function partyLeave(db, nick) {
  const p = norm(db.players[nick]);
  if (!p.party) return { ok: false, error: '속한 파티가 없어요.' };
  const pt = db.parties[p.party];
  p.party = null;
  if (pt) {
    pt.members = pt.members.filter(n => n !== nick);
    if (pt.leader === nick || pt.members.length === 0) {
      // 파티장이 나가면 해산
      pt.members.forEach(n => { if (db.players[n]) db.players[n].party = null; });
      delete db.parties[pt.id];
    }
  }
  return { ok: true };
}
function partyList(db) {
  return Object.values(db.parties).map(pt => partyView(db, pt.id)).sort((a, b) => b.count - a.count);
}

// 레이드 전투 시뮬레이션
function simulateRaid(parts, boss) {
  const st = parts.map(p => ({ nick: p.nick, s: memberStats(p) }));
  let dps = 0, heal = 0, armor = 0, maxHP = 0;
  st.forEach(m => { dps += m.s.atk; heal += m.s.heal; armor += m.s.armor; maxHP += m.s.hp; });
  const contrib = {}; st.forEach(m => contrib[m.nick] = 0);
  let hp = maxHP, bossHP = boss.hp, round = 0;
  while (bossHP > 0 && hp > 0 && round < 60) {
    round++;
    let roundDmg = 0;
    st.forEach(m => { const d = m.s.atk * (0.9 + Math.random() * 0.2); roundDmg += d; contrib[m.nick] += d; });
    bossHP -= roundDmg;
    if (bossHP <= 0) break;
    const enrage = round > 20 ? 1 + (round - 20) * 0.09 : 1; // 20라운드 후 광폭화
    const incoming = Math.max(0, boss.atk * enrage - armor);
    hp -= incoming;
    if (hp <= 0) break;
    hp = Math.min(maxHP, hp + heal);
  }
  return {
    win: bossHP <= 0, rounds: round, maxHP: Math.round(maxHP),
    remainHP: Math.max(0, Math.round(hp)), bossRemain: Math.max(0, Math.round(bossHP)),
    dps: Math.round(dps), heal: Math.round(heal), armor: Math.round(armor), contrib,
  };
}

function raidStart(db, nick, bossId) {
  const p = norm(db.players[nick]);
  if (!p.party) return { ok: false, error: '먼저 파티를 만들거나 참가하세요.' };
  const pt = db.parties[p.party];
  if (!pt) { p.party = null; return { ok: false, error: '파티 정보를 찾을 수 없어요.' }; }
  if (pt.leader !== nick) return { ok: false, error: '파티장만 레이드를 시작할 수 있어요.' };
  const boss = bossById(bossId);
  if (!boss) return { ok: false, error: '보스를 선택하세요.' };

  // 참가자 = 오늘 레이드 횟수 남은 파티원
  const participants = [];
  for (const n of pt.members) {
    const mp = norm(db.players[n]);
    if (mp.raidDay !== today()) { mp.raidDay = today(); mp.raidsUsed = 0; }
    if (raidsLeft(mp) > 0) participants.push(n);
  }
  if (participants.length === 0) return { ok: false, error: '파티원 모두 오늘 레이드 횟수를 소진했어요.' };
  participants.forEach(n => { db.players[n].raidsUsed++; });

  const parts = participants.map(n => ({ nick: n, class: db.players[n].class, level: db.players[n].level }));
  const sim = simulateRaid(parts, boss);

  const rewards = [];
  if (sim.win) {
    const each = Math.floor(boss.reward / participants.length);
    participants.forEach(n => {
      const mp = db.players[n];
      mp.gold += each;
      let drop = null;
      if (Math.random() < boss.dropChance) { mp.protects++; drop = '🛡️ 방지권'; }
      rewards.push({ nick: n, gold: each, drop });
    });
    addLog(db, '🏆 ' + pt.leader + ' 파티가 ' + boss.emoji + boss.name + ' 레이드 성공! (' + participants.length + '명)');
  } else {
    addLog(db, '☠️ ' + pt.leader + ' 파티가 ' + boss.emoji + boss.name + ' 레이드 실패...');
  }
  // 기여도 정리
  const topNick = Object.keys(sim.contrib).sort((a, b) => sim.contrib[b] - sim.contrib[a])[0];
  return {
    ok: true, win: sim.win,
    boss: { name: boss.name, emoji: boss.emoji, hp: boss.hp, atk: boss.atk },
    sim: { rounds: sim.rounds, maxHP: sim.maxHP, remainHP: sim.remainHP, bossRemain: sim.bossRemain, dps: sim.dps, heal: sim.heal, armor: sim.armor },
    participants, rewards, topContributor: topNick,
  };
}

/* ---------- 조회 ---------- */
function profile(db, name) {
  if (!db.players[name]) return { ok: false, error: '"' + name + '" 님을 찾을 수 없어요.' };
  return { ok: true, profile: publicView(db, name) };
}
function ranking(db) {
  return Object.keys(db.players).map(n => ({ nick: n, p: db.players[n] }))
    .sort((a, b) => b.p.level - a.p.level || b.p.best - a.p.best)
    .slice(0, 20)
    .map(x => ({ nick: x.nick, level: x.p.level, weapon: weaponName(x.p.level, x.p.class), classEmoji: classOf(x.p).emoji, wins: x.p.wins, losses: x.p.losses }));
}
function goldRanking(db) {
  return Object.keys(db.players).map(n => ({ nick: n, gold: db.players[n].gold }))
    .sort((a, b) => b.gold - a.gold).slice(0, 20);
}
function hogu(db) {
  const t = today();
  return Object.keys(db.players).map(n => ({ nick: n, c: db.players[n].destroyDay === t ? db.players[n].destroysToday : 0 }))
    .filter(x => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 10);
}
function recentLog(db) { return db.log.slice(-20).reverse(); }
function playerList(db) { return Object.keys(db.players).filter(n => db.players[n].class).sort(); }

module.exports = {
  CONFIG, GRADES, MONSTERS, CLASSES, BOSSES, odds, enhanceCost, weaponName, grade,
  login, setClass, publicView, enhance, attend, mine, hunt, buyProtect, fight,
  partyCreate, partyJoin, partyLeave, partyList, partyView, raidStart,
  profile, ranking, goldRanking, hogu, recentLog, playerList,
};
