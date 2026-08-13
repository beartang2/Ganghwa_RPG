'use strict';
/*
 * 게임 로직 (프레임워크 무관, 순수 함수 모음)
 * server.js 가 db 객체를 넘겨주면 여기서 규칙을 처리한다.
 */
const crypto = require('crypto');

const CONFIG = {
  dailyFights: 5,      // 하루 싸움 횟수
  dailyHunts: 20,      // 하루 사냥 횟수
  maxLevel: 25,        // 강화 만렙(초월)
  startGold: 1000,     // 시작 골드
  attendGold: 1000,    // 출석 보상
  stealPct: 0.2,       // 싸움 승리 시 상대 골드 약탈 비율
  protectPrice: 3000,  // 파괴방지권 가격
  fightBreakChance: 0.15,   // 싸움 패배 시 무기 하락 확률
  dropProtectChance: 0.03,  // 사냥 방지권 드랍 확률
  dropGoldChance: 0.07,     // 사냥 골드뭉치 드랍 확률
};

/* ---------- 유틸 ---------- */
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function today() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }

/* ---------- 등급 / 무기 ---------- */
const GRADES = [
  { min: 21, name: '초월', emoji: '🌈', color: '#c471ed' },
  { min: 16, name: '전설', emoji: '🟠', color: '#f7971e' },
  { min: 11, name: '에픽', emoji: '🟣', color: '#a770ef' },
  { min: 6,  name: '희귀', emoji: '🔵', color: '#4facfe' },
  { min: 0,  name: '일반', emoji: '⚪', color: '#9aa0b0' },
];
function grade(level) { for (const g of GRADES) { if (level >= g.min) return g; } return GRADES[GRADES.length - 1]; }
function weaponName(level) { const g = grade(level); return '+' + level + ' ' + g.emoji + ' ' + g.name; }

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

/* ---------- 몬스터 ---------- */
const MONSTERS = [
  { name: '들쥐',   emoji: '🐀', hp: 50,   gpp: 1.0 },
  { name: '멧돼지', emoji: '🐗', hp: 120,  gpp: 1.3 },
  { name: '늑대',   emoji: '🐺', hp: 200,  gpp: 1.6 },
  { name: '곰',     emoji: '🐻', hp: 350,  gpp: 2.0 },
  { name: '드래곤', emoji: '🐉', hp: 600,  gpp: 3.0 },
  { name: '마왕',   emoji: '👹', hp: 1000, gpp: 4.0 },
];
function huntDamage(level) { return randInt(10, 30) + level * 8; }

/* ---------- 플레이어 ---------- */
function makePlayer(pin) {
  const salt = crypto.randomBytes(8).toString('hex');
  return {
    pinHash: hashPin(pin, salt), salt,
    level: 0, best: 0, breaks: 0, wins: 0, losses: 0,
    gold: CONFIG.startGold, protects: 0,
    fightDay: '', fightsUsed: 0, huntDay: '', huntsUsed: 0,
    attendDay: '', destroyDay: '', destroysToday: 0, created: today(),
  };
}
function fightsLeft(p) { return p.fightDay !== today() ? CONFIG.dailyFights : Math.max(0, CONFIG.dailyFights - p.fightsUsed); }
function huntsLeft(p) { return p.huntDay !== today() ? CONFIG.dailyHunts : Math.max(0, CONFIG.dailyHunts - p.huntsUsed); }
function winRate(p) { const t = p.wins + p.losses; return t === 0 ? null : Math.round(p.wins / t * 100); }

// 클라이언트로 내보낼 안전한 플레이어 뷰(비밀 제거 + 파생값)
function publicView(db, nick) {
  const p = db.players[nick];
  const g = grade(p.level);
  return {
    nick,
    level: p.level, best: p.best, breaks: p.breaks,
    wins: p.wins, losses: p.losses, winRate: winRate(p),
    gold: p.gold, protects: p.protects,
    weapon: weaponName(p.level),
    grade: { name: g.name, emoji: g.emoji, color: g.color },
    maxLevel: CONFIG.maxLevel,
    nextCost: p.level >= CONFIG.maxLevel ? null : enhanceCost(p.level),
    odds: odds(p.level),
    huntsLeft: huntsLeft(p), dailyHunts: CONFIG.dailyHunts,
    fightsLeft: fightsLeft(p), dailyFights: CONFIG.dailyFights,
    rank: enhanceRank(db, nick),
  };
}

function addLog(db, text) {
  db.log.push({ t: Date.now(), text });
  if (db.log.length > 40) db.log.shift();
}

function enhanceRank(db, nick) {
  const arr = Object.keys(db.players).map(n => ({ n, lv: db.players[n].level, best: db.players[n].best }));
  arr.sort((a, b) => b.lv - a.lv || b.best - a.best);
  const i = arr.findIndex(x => x.n === nick);
  return { rank: i < 0 ? null : i + 1, total: arr.length };
}

/* ---------- 인증 ---------- */
function login(db, nick, pin) {
  nick = (nick || '').trim();
  pin = (pin || '').trim();
  if (nick.length < 1 || nick.length > 12) return { ok: false, error: '닉네임은 1~12자로 입력하세요.' };
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN은 숫자 4자리여야 합니다.' };
  if (!db.players[nick]) {
    db.players[nick] = makePlayer(pin);
    return { ok: true, isNew: true };
  }
  const p = db.players[nick];
  if (hashPin(pin, p.salt) !== p.pinHash) return { ok: false, error: 'PIN이 일치하지 않습니다.' };
  return { ok: true, isNew: false };
}

/* ---------- 액션 ---------- */
function enhance(db, nick) {
  const p = db.players[nick];
  if (p.level >= CONFIG.maxLevel) return { ok: false, error: '이미 만렙(+' + CONFIG.maxLevel + ' 초월)입니다!' };
  const cost = enhanceCost(p.level);
  if (p.gold < cost) return { ok: false, error: '골드 부족! (필요 ' + cost + ' / 보유 ' + p.gold + ')' };
  p.gold -= cost;

  const before = p.level;
  const o = odds(before);
  const r = Math.random();
  let result, msg;
  if (r < o.success) {
    p.level++; if (p.level > p.best) p.best = p.level;
    result = 'success'; msg = '강화 성공! +' + before + ' → +' + p.level;
    addLog(db, '✅ ' + nick + ' +' + before + '→+' + p.level);
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
  const p = db.players[nick];
  if (p.attendDay === today()) return { ok: false, error: '오늘은 이미 출석했어요!' };
  p.attendDay = today();
  p.gold += CONFIG.attendGold;
  return { ok: true, gained: CONFIG.attendGold, msg: '출석 완료! +' + CONFIG.attendGold + 'G' };
}

function hunt(db, nick) {
  const p = db.players[nick];
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
  const p = db.players[nick];
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

  const atk = db.players[nick];
  const def = db.players[targetName];
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

/* ---------- 조회 ---------- */
function profile(db, name) {
  if (!db.players[name]) return { ok: false, error: '"' + name + '" 님을 찾을 수 없어요.' };
  return { ok: true, profile: publicView(db, name) };
}
function ranking(db) {
  return Object.keys(db.players).map(n => ({ nick: n, ...db.players[n] }))
    .sort((a, b) => b.level - a.level || b.best - a.best)
    .slice(0, 20)
    .map(p => ({ nick: p.nick, level: p.level, weapon: weaponName(p.level), wins: p.wins, losses: p.losses }));
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
function recentLog(db) { return db.log.slice(-15).reverse(); }
function playerList(db) { return Object.keys(db.players).sort(); }

module.exports = {
  CONFIG, GRADES, MONSTERS, odds, enhanceCost, weaponName, grade,
  login, publicView, enhance, attend, hunt, buyProtect, fight,
  profile, ranking, goldRanking, hogu, recentLog, playerList,
};
