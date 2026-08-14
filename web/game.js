'use strict';
/*
 * 게임 로직 (프레임워크 무관, 순수 함수 모음)
 * 계정 식별 = 8자리 PIN (같은 PIN = 같은 계정). 닉네임은 변경 가능한 표시 이름.
 * db.players 는 pinKey(=sha256(pin)) 로 키를 잡는다. 함수들은 로그인 유저의
 * accountId(=pinKey) 를 받고, 상대 지정은 nick 으로 받아 내부에서 변환한다.
 */
const crypto = require('crypto');

const CONFIG = {
  dailyFights: 5, dailyHunts: 20, dailyRaids: 3,
  maxLevel: 99, startGold: 1000, attendGold: 1000,
  stealPct: 0.2, protectPrice: 3000,
  fightBreakChance: 0.10,    // 싸움 패배 시 무기 1단계 하락 확률(진 사람만, 확률적)
  dropProtectChance: 0.03, dropGoldChance: 0.07,
  mineRate: 12, mineCap: 3000, partyMax: 5, raidMinMembers: 2,
  raidAtkBuffCap: 0.15,      // 힐러 아군 공격 버프 상한
  raidDRCap: 0.40,           // 탱커 아군 피해감소 상한
  // 상점
  boostAmount: 0.10,         // 강화 부스트권: 성공률 +10%p
  boostCount: 10,            // 강화 부스트권: 지속 횟수
  boostPrice: 8000,
  classChangePrice: 30000,
  dyePrice: 2000,
  // 강화(로스트아크식) — 파괴 시 완전 초기화(+0)
  pityBase: 0.02,       // 장인의 기운 기본 상승폭(실패당) — 저확률에서도 결국 참
  pityScale: 0.34,      // + 성공률 비례분(성공률 높을수록 살짝 더 빨리 참)
  // 사냥
  huntOvertimeMult: 0.4, // 일일 사냥 소진 후 '무한 사냥' 골드 배율(희귀 드랍·처치보너스 없음)
  // 채굴장(능동) — 기력을 써서 곡괭이질, 채굴 레벨이 오를수록 수익↑
  staminaMax: 100,          // 기력 최대치
  staminaRegenPerMin: 1.5,  // 분당 기력 회복(가득 차는 데 ~67분)
  staminaPerSwing: 8,       // 곡괭이질 1회 소모 기력(가득이면 ~12회 연속)
  mineOreMin: 45, mineOreMax: 85,  // 곡괭이질 1회 기본 골드 범위(기력 있을 때)
  mineLevelBonus: 0.05,     // 채굴 레벨당 수익 배수(+5%/레벨)
  mineTiredMult: 0.25,      // 기력 0일 때 '지친 곡괭이질' 배율(무한 가능·보상↓)
  mineJackpotChance: 0.08,  // 노다지! 확률(골드 x3)
  mineJackpotMult: 3,
  mineGemChance: 0.03,      // 원석(보너스 골드) 확률 — 기력 있을 때만
  mineProtectChance: 0.006, // 보석 원석 → 방지권 확률 — 기력 있을 때만
  mineLevelCap: 50,
};

/* ---------- 유틸 ---------- */
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function today() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function pinKey(pin) { return crypto.createHash('sha256').update('pin:' + pin).digest('hex'); }
function findByNick(db, nick) { for (const k in db.players) { if (db.players[k].nick === nick) return k; } return null; }

/* ---------- 직업 ---------- */
const CLASSES = {
  warrior: { id: 'warrior', name: '근거리 딜러', emoji: '⚔️', weapon: '검',     desc: '높은 공격력의 근접 딜러' },
  archer:  { id: 'archer',  name: '원거리 딜러', emoji: '🏹', weapon: '활',     desc: '최고 공격력의 원거리 딜러' },
  tanker:  { id: 'tanker',  name: '탱커',       emoji: '🛡️', weapon: '대검',   desc: '체력·방어가 높고 아군 피해를 줄여줌' },
  healer:  { id: 'healer',  name: '힐러',       emoji: '✨', weapon: '지팡이', desc: '아군을 회복하고 공격력을 올려줌' },
};
function classOf(p) { return CLASSES[p && p.class] || CLASSES.warrior; }

// 레이드 전투 스탯 (직업 + 강화 수치 기반)
//  - 딜러(근/원): 높은 공격, 낮은 체력
//  - 탱커: 낮은 공격, 높은 체력 + 방어(flat armor) + 아군 피해감소(dr)
//  - 힐러: 낮은 공격, 아군 회복(heal) + 아군 공격버프(atkBuff)
function memberStats(p) {
  const L = p.level || 0;
  const base = 12 + L * 8;
  switch (p.class) {
    case 'archer': return { atk: base * 1.35, hp: 80 + L * 10,  heal: 0, armor: 0, dr: 0, atkBuff: 0 };
    case 'tanker': return { atk: base * 0.6,  hp: 300 + L * 30, heal: 0, armor: 60 + L * 7, dr: 0.05 + L * 0.004, atkBuff: 0 };
    case 'healer': return { atk: base * 0.5,  hp: 150 + L * 15, heal: 45 + L * 9, armor: 0, dr: 0, atkBuff: 0.01 + L * 0.002 };
    case 'warrior':
    default:       return { atk: base * 1.2,  hp: 120 + L * 12, heal: 0, armor: 0, dr: 0, atkBuff: 0 };
  }
}

/* ---------- 등급 / 무기 ---------- */
// 점진적 등급 경계: 일반0~15, 희귀16~25, 에픽26~49, 전설50~69, 초월70~99
const GRADES = [
  { min: 70, name: '초월', key: 'transcend', emoji: '🌈', color: '#c471ed' },
  { min: 50, name: '전설', key: 'legend',    emoji: '🟠', color: '#f7971e' },
  { min: 26, name: '에픽', key: 'epic',      emoji: '🟣', color: '#a770ef' },
  { min: 16, name: '희귀', key: 'rare',      emoji: '🔵', color: '#4facfe' },
  { min: 0,  name: '일반', key: 'common',    emoji: '⚪', color: '#9aa0b0' },
];
function grade(level) { for (const g of GRADES) { if (level >= g.min) return g; } return GRADES[GRADES.length - 1]; }

/* ---------- 무기 속성(원소) ---------- */
const ELEMENTS = [
  { key: 'fire',    name: '불',   emoji: '🔥', color: '#ff6b4a' },
  { key: 'water',   name: '물',   emoji: '💧', color: '#4facfe' },
  { key: 'earth',   name: '대지', emoji: '⛰️', color: '#b08d57' },
  { key: 'wind',    name: '바람', emoji: '🌪️', color: '#7ee8a2' },
  { key: 'thunder', name: '번개', emoji: '⚡', color: '#ffd93d' },
  { key: 'ice',     name: '얼음', emoji: '❄️', color: '#9fe6ff' },
  { key: 'light',   name: '빛',   emoji: '✨', color: '#fff3b0' },
  { key: 'dark',    name: '어둠', emoji: '🌑', color: '#9b6bd6' },
  { key: 'poison',  name: '독',   emoji: '☠️', color: '#a3e635' },
];
function randomElementKey() { return ELEMENTS[randInt(0, ELEMENTS.length - 1)].key; }
function elementOf(key) { return ELEMENTS.find(e => e.key === key) || ELEMENTS[0]; }

/* ---------- 닉네임 염색(가챠) ---------- */
const DYE_BASIC = [
  { name: '빨강', hex: '#ff5d6c' }, { name: '주황', hex: '#ff9f45' }, { name: '노랑', hex: '#ffd93d' },
  { name: '초록', hex: '#49d17a' }, { name: '파랑', hex: '#4facfe' }, { name: '남색', hex: '#6c8cff' },
  { name: '보라', hex: '#a770ef' }, { name: '흰색', hex: '#ffffff' },
];
// 확률: 기본 60%(8색 균등) → glow 30%(8색 균등) → 은 6% → 금 3% → 무지개 1%
function rollDye() {
  const r = Math.random();
  if (r < 0.01) return { kind: 'rainbow', name: '무지개', rarity: '무지개' };
  if (r < 0.04) return { kind: 'gold', name: '금색', rarity: '금색' };
  if (r < 0.10) return { kind: 'silver', name: '은색', rarity: '은색' };
  const c = DYE_BASIC[randInt(0, DYE_BASIC.length - 1)];
  if (r < 0.40) return { kind: 'glow', color: c.hex, name: c.name + ' 빛나는', rarity: 'glow' };
  return { kind: 'solid', color: c.hex, name: c.name, rarity: '기본' };
}
function shopItems() {
  return [
    { id: 'protect', emoji: '🛡️', name: '파괴방지권', price: CONFIG.protectPrice, desc: '파괴를 1회 자동으로 막아줍니다' },
    { id: 'boost', emoji: '🍀', name: '강화 부스트권', price: CONFIG.boostPrice, desc: '다음 ' + CONFIG.boostCount + '회 강화 성공률 +' + Math.round(CONFIG.boostAmount * 100) + '%p' },
    { id: 'dye', emoji: '🎨', name: '염색약', price: CONFIG.dyePrice, desc: '닉네임 색상을 랜덤으로 뽑아요 (레어일수록 희귀)' },
    { id: 'classchange', emoji: '🔄', name: '직업 변경권', price: CONFIG.classChangePrice, desc: '직업을 다시 선택합니다 (레벨·골드 유지)' },
  ];
}
function weaponName(level, cls) {
  const g = grade(level);
  const base = (CLASSES[cls] || CLASSES.warrior).weapon;
  return '+' + level + ' ' + g.emoji + ' ' + g.name + ' ' + base;
}

/* ---------- 강화 확률 / 비용 ---------- */
// 로스트아크식: 성공률은 초반 높고 매끄럽게 급감(초월 0.n~0.0n%),
// 파괴는 낮고 산 모양(65 근처 피크→초월 완화), 나머지는 전부 실패.
// ⚠️ 파괴 = 완전 초기화(+0)라서 확률을 낮게 잡고 시작 구간도 +20 이후로 미룸.
const SUCC_ANCHORS = [[0, .97], [15, .90], [25, .62], [40, .20], [50, .08], [60, .03], [70, .012], [85, .004], [99, .0015]];
const DESTROY_ANCHORS = [[20, 0], [35, .003], [50, .006], [65, .010], [80, .007], [99, .004]];
function interpAnchor(A, L, log) {
  if (L <= A[0][0]) return A[0][1];
  for (let i = 1; i < A.length; i++) {
    if (L <= A[i][0]) {
      const [l0, v0] = A[i - 1], [l1, v1] = A[i], t = (L - l0) / (l1 - l0);
      return log ? v0 * Math.pow(v1 / v0, t) : v0 + (v1 - v0) * t;
    }
  }
  return A[A.length - 1][1];
}
function successRate(level) { return interpAnchor(SUCC_ANCHORS, level, true); }
function destroyRate(level) { return level <= 20 ? 0 : interpAnchor(DESTROY_ANCHORS, level, false); }
function odds(level) {
  const s = successRate(level), d = destroyRate(level);
  return { success: s, destroy: d, fail: Math.max(0, 1 - s - d) };
}
// 장인의 기운 상승폭(실패당): 저확률에서도 결국 100% 도달하도록 최소치 보장
function pityGain(success) { return CONFIG.pityBase + success * CONFIG.pityScale; }
function enhanceCost(level) { return 20 + level * 10; }
function successGain(level) {
  if (level < 20) { const r = Math.random(); if (r < 0.60) return 1; if (r < 0.90) return 2; return 3; }
  return 1;
}

/* ---------- 몬스터 (사냥) ----------
 * 희귀도(일반~신화)가 난이도를 결정한다. 몬스터 체력은 내 레벨(=예상 데미지)에
 * 비례하므로, 무기 강화 수치와 무관하게 "희귀할수록 어렵다"가 유지된다.
 * 무기가 강해질수록 희귀 몬스터가 점점 자주 출몰한다. */
const RARITIES = [
  { name: '일반', hpMult: 0.55, gpp: 1.2, mons: [['🐀', '들쥐'], ['🟩', '슬라임'], ['🦇', '박쥐']] },
  { name: '희귀', hpMult: 1.00, gpp: 1.8, mons: [['🐺', '늑대'], ['🐗', '멧돼지'], ['👹', '오크']] },
  { name: '에픽', hpMult: 1.35, gpp: 2.6, mons: [['🗿', '골렘'], ['🧌', '트롤'], ['🐂', '미노타우로스']] },
  { name: '전설', hpMult: 1.80, gpp: 3.6, mons: [['🐉', '와이번'], ['🐍', '히드라']] },
  { name: '신화', hpMult: 2.35, gpp: 5.0, mons: [['🦖', '고대괴수'], ['🐲', '마룡']] },
];
function huntDamage(level) { return randInt(10, 30) + level * 8; }
// 무기 강화 수치에 따라 희귀도를 가중 추첨 (레벨↑ → 희귀 몬스터 출몰↑)
function huntSpawn(level) {
  const nr = RARITIES.length;
  const et = level / CONFIG.maxLevel * (nr - 1); // 기대 희귀도 인덱스
  const w = RARITIES.map((r, i) => {
    let x = Math.max(0.03, 1 - Math.abs(i - et) * 0.7);
    if (i < et - 1.5) x *= 0.15;  // 너무 낮은 등급은 고레벨에서 희박
    if (i > et + 1) x *= 0.5;     // 아주 높은 등급은 희귀하게 등장
    return x;
  });
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total, ri = nr - 1;
  for (let i = 0; i < nr; i++) { r -= w[i]; if (r <= 0) { ri = i; break; } }
  const R = RARITIES[ri];
  const m = R.mons[randInt(0, R.mons.length - 1)];
  const base = 20 + level * 8; // 대략적인 기대 데미지
  const hp = Math.max(10, Math.round(base * R.hpMult * (0.85 + Math.random() * 0.3)));
  return { emoji: m[0], name: m[1], rarity: R.name, tier: ri, gpp: R.gpp, hp };
}

/* ---------- 보스 (레이드) ---------- */
const BOSSES = [
  { id: 'goblin', name: '고블린 군주', emoji: '👺', hp: 2200,  atk: 130, reward: 5000,  dropChance: 0.10 },
  { id: 'golem',  name: '스톤 골렘',   emoji: '🗿', hp: 6500,  atk: 340, reward: 15000, dropChance: 0.20 },
  { id: 'dragon', name: '고대 드래곤', emoji: '🐲', hp: 10500, atk: 600, reward: 40000, dropChance: 0.35 },
  { id: 'demon',  name: '마계 군주',   emoji: '😈', hp: 16000, atk: 780, reward: 90000, dropChance: 0.55 },
];
function bossById(id) { return BOSSES.find(b => b.id === id); }

/* ---------- 플레이어 ---------- */
function makePlayer(nick) {
  return {
    nick, class: null, element: null, nickColor: null,
    level: 0, best: 0, breaks: 0, wins: 0, losses: 0,
    gold: CONFIG.startGold, protects: 0, enhanceBoost: 0, pity: 0,
    fightDay: '', fightsUsed: 0, huntDay: '', huntsUsed: 0, raidDay: '', raidsUsed: 0,
    attendDay: '', destroyDay: '', destroysToday: 0,
    lastMine: Date.now(), party: null, created: today(),
  };
}
function norm(p) {
  if (p.protects == null) p.protects = 0;
  if (p.raidDay == null) { p.raidDay = ''; p.raidsUsed = 0; }
  if (p.lastMine == null) p.lastMine = Date.now();
  if (p.party === undefined) p.party = null;
  if (p.class === undefined) p.class = null;
  if (!p.element && p.class) p.element = randomElementKey(); // 기존 데이터 보정
  if (p.enhanceBoost == null) p.enhanceBoost = 0;
  if (p.nickColor === undefined) p.nickColor = null;
  if (p.pity == null) p.pity = 0;
  if (p.stamina == null) p.stamina = CONFIG.staminaMax;
  if (p.lastStamina == null) p.lastStamina = Date.now();
  if (p.mineLevel == null) p.mineLevel = 1;
  if (p.mineXp == null) p.mineXp = 0;
  return p;
}
// 채굴장(능동): 기력 회복 계산 + 채굴 레벨 진행
function currentStamina(p) {
  const regen = (Date.now() - (p.lastStamina || Date.now())) / 60000 * CONFIG.staminaRegenPerMin;
  return Math.min(CONFIG.staminaMax, (p.stamina || 0) + regen);
}
function mineXpNext(level) { return 50 + level * 45; }
function fightsLeft(p) { return p.fightDay !== today() ? CONFIG.dailyFights : Math.max(0, CONFIG.dailyFights - p.fightsUsed); }
function huntsLeft(p) { return p.huntDay !== today() ? CONFIG.dailyHunts : Math.max(0, CONFIG.dailyHunts - p.huntsUsed); }
function raidsLeft(p) { return p.raidDay !== today() ? CONFIG.dailyRaids : Math.max(0, CONFIG.dailyRaids - p.raidsUsed); }
function winRate(p) { const t = p.wins + p.losses; return t === 0 ? null : Math.round(p.wins / t * 100); }
function pendingMine(p) { return Math.min(CONFIG.mineCap, Math.floor((Date.now() - p.lastMine) / 60000 * CONFIG.mineRate)); }

function publicView(db, id) {
  const p = norm(db.players[id]);
  const g = grade(p.level);
  const c = classOf(p);
  const em = elementOf(p.element);
  let od = odds(p.level);
  if ((p.enhanceBoost || 0) > 0) { const s = Math.min(0.97, od.success + CONFIG.boostAmount); od = { success: s, destroy: od.destroy, fail: Math.max(0, 1 - s - od.destroy) }; }
  let party = null;
  if (p.party && db.parties[p.party]) {
    const pt = db.parties[p.party];
    party = { id: pt.id, leaderNick: db.players[pt.leader] ? db.players[pt.leader].nick : '?', count: pt.members.length };
  }
  return {
    nick: p.nick,
    class: p.class, className: c.name, classEmoji: c.emoji, weaponBase: c.weapon,
    level: p.level, best: p.best, breaks: p.breaks,
    wins: p.wins, losses: p.losses, winRate: winRate(p),
    gold: p.gold, protects: p.protects,
    weapon: weaponName(p.level, p.class),
    grade: { name: g.name, key: g.key, emoji: g.emoji, color: g.color },
    element: p.element, elementName: em.name, elementEmoji: em.emoji, elementColor: em.color,
    maxLevel: CONFIG.maxLevel,
    nextCost: p.level >= CONFIG.maxLevel ? null : enhanceCost(p.level),
    odds: od, enhanceBoost: p.enhanceBoost || 0, pity: p.pity || 0, nickColor: p.nickColor || null,
    huntsLeft: huntsLeft(p), dailyHunts: CONFIG.dailyHunts,
    fightsLeft: fightsLeft(p), dailyFights: CONFIG.dailyFights,
    raidsLeft: raidsLeft(p), dailyRaids: CONFIG.dailyRaids,
    mine: pendingMine(p), mineCap: CONFIG.mineCap,
    stamina: Math.floor(currentStamina(p)), staminaMax: CONFIG.staminaMax,
    mineLevel: p.mineLevel, mineXp: p.mineXp, mineXpNext: mineXpNext(p.mineLevel),
    party,
    invites: myInvites(db, id),
    rank: enhanceRank(db, id),
  };
}

function addLog(db, text) { db.log.push({ t: Date.now(), text }); if (db.log.length > 60) db.log.shift(); }
function enhanceRank(db, id) {
  const arr = Object.keys(db.players).map(k => ({ k, lv: db.players[k].level, best: db.players[k].best }));
  arr.sort((a, b) => b.lv - a.lv || b.best - a.best);
  const i = arr.findIndex(x => x.k === id);
  return { rank: i < 0 ? null : i + 1, total: arr.length };
}

/* ---------- 인증 / 계정 ---------- */
function validNick(nick) { return typeof nick === 'string' && nick.trim().length >= 1 && nick.trim().length <= 12; }
function login(db, nick, pin) {
  nick = (nick || '').trim();
  pin = (pin || '').trim();
  if (!validNick(nick)) return { ok: false, error: '닉네임은 1~12자로 입력하세요.' };
  if (!/^\d{8}$/.test(pin)) return { ok: false, error: 'PIN은 숫자 8자리여야 합니다.' };
  const key = pinKey(pin);
  if (db.players[key]) {
    const p = norm(db.players[key]);
    if (p.nick !== nick) return { ok: false, error: '이 PIN의 닉네임과 일치하지 않습니다.' };
    return { ok: true, id: key, isNew: false, needClass: !p.class };
  }
  // 신규: 닉네임 중복 방지
  if (findByNick(db, nick)) return { ok: false, error: '이미 사용 중인 닉네임이에요. 다른 닉네임을 쓰세요.' };
  db.players[key] = makePlayer(nick);
  return { ok: true, id: key, isNew: true, needClass: true };
}
function setClass(db, id, cls) {
  const p = norm(db.players[id]);
  if (p.class) return { ok: false, error: '이미 직업을 선택했어요.' };
  if (!CLASSES[cls]) return { ok: false, error: '올바른 직업을 선택하세요.' };
  const first = !p.class;
  p.class = cls;
  if (!p.element) p.element = randomElementKey(); // 최초 1회만 속성 부여(직업 변경 시 유지)
  if (first) addLog(db, CLASSES[cls].emoji + ' ' + p.nick + ' 님이 ' + CLASSES[cls].name + '(' + elementOf(p.element).name + '속성)으로 모험 시작!');
  else addLog(db, '🔄 ' + p.nick + ' 님이 ' + CLASSES[cls].name + '(으)로 직업 변경');
  return { ok: true };
}
function rename(db, id, newNick) {
  newNick = (newNick || '').trim();
  if (!validNick(newNick)) return { ok: false, error: '닉네임은 1~12자로 입력하세요.' };
  const p = db.players[id];
  if (newNick === p.nick) return { ok: false, error: '현재 닉네임과 같아요.' };
  const other = findByNick(db, newNick);
  if (other && other !== id) return { ok: false, error: '이미 사용 중인 닉네임이에요.' };
  const old = p.nick;
  p.nick = newNick;
  addLog(db, '✏️ ' + old + ' → ' + newNick + ' 닉네임 변경');
  return { ok: true, msg: '닉네임을 ' + newNick + '(으)로 변경했어요.' };
}

/* ---------- 액션 ---------- */
function enhance(db, id) {
  const p = norm(db.players[id]);
  if (p.level >= CONFIG.maxLevel) return { ok: false, error: '이미 만렙(+' + CONFIG.maxLevel + ' 초월)입니다!' };
  const cost = enhanceCost(p.level);
  if (p.gold < cost) return { ok: false, error: '골드 부족! (필요 ' + cost + ' / 보유 ' + p.gold + ')' };
  p.gold -= cost;
  const before = p.level;
  const base = odds(before);

  // 장인의 기운 100% → 확정 성공 (부스트·확률 무시, 소모 없음)
  if (p.pity >= 1) {
    const gain = successGain(before);
    p.level = Math.min(CONFIG.maxLevel, before + gain);
    if (p.level > p.best) p.best = p.level;
    p.pity = 0;
    addLog(db, '🔨 ' + p.nick + ' 장인의 기운 확정성공 +' + before + '→+' + p.level);
    return { ok: true, result: 'success', guaranteed: true, cost, boosted: false, boostLeft: p.enhanceBoost, pity: 0, msg: '🔨 장인의 기운 100%! 확정 성공!  +' + before + ' → +' + p.level };
  }

  // 강화 부스트권(성공률 +)
  let o = base, boosted = false;
  if (p.enhanceBoost > 0) {
    const s = Math.min(0.97, base.success + CONFIG.boostAmount);
    o = { success: s, destroy: base.destroy, fail: Math.max(0, 1 - s - base.destroy) };
    p.enhanceBoost--;
    boosted = true;
  }

  const r = Math.random();
  let result, msg;
  if (r < o.success) {
    const gain = successGain(before);
    p.level = Math.min(CONFIG.maxLevel, before + gain);
    if (p.level > p.best) p.best = p.level;
    p.pity = 0;
    result = 'success';
    msg = (gain > 1 ? '💫 대성공! +' + gain + '  ' : '강화 성공! ') + '+' + before + ' → +' + p.level;
    addLog(db, '✅ ' + p.nick + ' +' + before + '→+' + p.level + (gain > 1 ? ' (+' + gain + ')' : ''));
  } else if (r < o.success + o.destroy) {
    if (p.protects > 0) {
      p.protects--; result = 'protected';
      p.pity = Math.min(1, p.pity + pityGain(o.success)); // 방지도 시도로 치고 기운 상승
      msg = '🛡️ 파괴 방지 발동! +' + before + ' 유지 (남은 방지권 ' + p.protects + ')';
      addLog(db, '🛡️ ' + p.nick + ' +' + before + ' 파괴방지');
    } else {
      p.level = 0; p.breaks++; p.pity = 0; // 파괴 = 완전 초기화(+0) · 장인의 기운 초기화
      const newElem = randomElementKey(); p.element = newElem; // 속성 재부여
      if (p.destroyDay !== today()) { p.destroyDay = today(); p.destroysToday = 0; }
      p.destroysToday++;
      result = 'destroy';
      msg = '💥 무기 파괴!! +' + before + ' → +0 (완전 초기화 · 장인의 기운 리셋)' +
        '\n새 속성: ' + elementOf(newElem).emoji + ' ' + elementOf(newElem).name;
      addLog(db, '💥 ' + p.nick + ' +' + before + ' 무기 파괴 → +0 (새속성 ' + elementOf(newElem).name + ')');
    }
  } else {
    // 실패 = 유지 + 장인의 기운 상승
    p.pity = Math.min(1, p.pity + pityGain(o.success));
    result = 'fail';
    msg = '❌ 실패... +' + before + ' 유지 · 🔨 장인의 기운 ' + Math.round(p.pity * 100) + '%';
  }
  return { ok: true, result, msg, cost, boosted, boostLeft: p.enhanceBoost, pity: p.pity };
}
function attend(db, id) {
  const p = norm(db.players[id]);
  if (p.attendDay === today()) return { ok: false, error: '오늘은 이미 출석했어요!' };
  p.attendDay = today(); p.gold += CONFIG.attendGold;
  return { ok: true, gained: CONFIG.attendGold, msg: '출석 완료! +' + CONFIG.attendGold + 'G' };
}
function mine(db, id) {
  const p = norm(db.players[id]);
  const amount = pendingMine(p);
  if (amount <= 0) return { ok: false, error: '아직 채굴된 골드가 없어요. 시간이 지나면 쌓여요.' };
  p.gold += amount; p.lastMine = Date.now();
  return { ok: true, amount, msg: '⛏️ 채굴 +' + amount + 'G' };
}
// 채굴장 곡괭이질: 기력을 소모해 골드 채굴. 기력 0이면 '지친' 상태로 소량이나마 계속 가능.
function mineSwing(db, id) {
  const p = norm(db.players[id]);
  const st = currentStamina(p);
  const tired = st < CONFIG.staminaPerSwing;
  // 회복분 반영 후 소모(지쳤으면 소모 없이 유지)
  p.stamina = tired ? st : st - CONFIG.staminaPerSwing;
  p.lastStamina = Date.now();

  const mult = 1 + (p.mineLevel - 1) * CONFIG.mineLevelBonus;
  let gold = Math.round(randInt(CONFIG.mineOreMin, CONFIG.mineOreMax) * mult * (tired ? CONFIG.mineTiredMult : 1));
  gold = Math.max(1, gold);
  let jackpot = false, gem = null, leveledTo = 0;
  if (!tired) {
    if (Math.random() < CONFIG.mineJackpotChance) { gold *= CONFIG.mineJackpotMult; jackpot = true; }
    if (Math.random() < CONFIG.mineProtectChance) {
      p.protects++; gem = { type: 'protect', text: '💎 보석 원석 발견 → 🛡️ 방지권 1개!' };
      addLog(db, '💎 ' + p.nick + ' 채굴장에서 방지권 원석 발견!');
    } else if (Math.random() < CONFIG.mineGemChance) {
      const bonus = Math.round(randInt(200, 500) * mult); gold += bonus;
      gem = { type: 'gold', amount: bonus, text: '💎 원석 +' + bonus + 'G' };
    }
  }
  // 채굴 숙련도 — 지친 곡괭이질도 소량 경험치(노가다 보상)
  p.mineXp += tired ? 1 : 2;
  if (p.mineLevel < CONFIG.mineLevelCap && p.mineXp >= mineXpNext(p.mineLevel)) {
    p.mineXp -= mineXpNext(p.mineLevel); p.mineLevel++; leveledTo = p.mineLevel;
    addLog(db, '⛏️ ' + p.nick + ' 채굴 레벨 ' + p.mineLevel + ' 달성!');
  }
  p.gold += gold;
  let msg = (tired ? '💤 지친 곡괭이질' : jackpot ? '💥 노다지!!' : '⛏️ 채굴') + ' +' + gold + 'G';
  if (gem) msg += '  ' + gem.text;
  if (leveledTo) msg += '  🎉 채굴Lv.' + leveledTo;
  return {
    ok: true, silent: true, gold, tired, jackpot, gem, leveledTo,
    stamina: Math.floor(p.stamina), staminaMax: CONFIG.staminaMax,
    mineLevel: p.mineLevel, mineXp: p.mineXp, mineXpNext: mineXpNext(p.mineLevel), msg,
  };
}
function hunt(db, id) {
  const p = norm(db.players[id]);
  if (p.huntDay !== today()) { p.huntDay = today(); p.huntsUsed = 0; }
  // 일일 사냥(20회)은 풀보상 + 희귀 드랍. 소진 후엔 '무한 사냥'(보상 축소·드랍 없음)으로 계속 가능
  const overtime = p.huntsUsed >= CONFIG.dailyHunts;
  p.huntsUsed++;
  const m = huntSpawn(p.level);
  let dmg = huntDamage(p.level);
  const crit = Math.random() < 0.15;      // 치명타: 데미지 2배
  if (crit) dmg *= 2;
  const dealt = Math.min(dmg, m.hp);
  const slain = dmg >= m.hp;
  let gold = Math.round(dealt * m.gpp);
  if (slain && !overtime) gold = Math.round(gold * 1.5);   // 처치 보너스는 일일 사냥만
  if (overtime) gold = Math.max(1, Math.round(gold * CONFIG.huntOvertimeMult));
  p.gold += gold;
  // 희귀할수록(=tier↑) 드랍 확률 상승 — 무한 사냥에선 드랍 없음
  let drop = null;
  if (!overtime) {
    const pc = CONFIG.dropProtectChance * (1 + m.tier * 0.35);
    const gc = CONFIG.dropGoldChance * (1 + m.tier * 0.2);
    if (Math.random() < pc) { p.protects++; drop = { type: 'protect', text: '🛡️ 파괴방지권 1개!' }; addLog(db, '🎁 ' + p.nick + ' ' + m.name + '에게서 방지권 드랍!'); }
    else if (Math.random() < gc) { const bonus = Math.round(randInt(200, 600) * m.gpp); p.gold += bonus; drop = { type: 'gold', amount: bonus, text: '💰 골드뭉치 +' + bonus }; }
    addLog(db, '🗡️ ' + p.nick + ' ' + m.emoji + m.name + '(' + m.rarity + ') ' + (slain ? '처치' : '사냥') + ' +' + gold + 'G');
  }
  return { ok: true, monster: { name: m.name, emoji: m.emoji, hp: m.hp, rarity: m.rarity, tier: m.tier }, dmg, dealt, slain, crit, gold, drop, overtime };
}
function buyProtect(db, id, qty) {
  const p = norm(db.players[id]);
  qty = parseInt(qty, 10); if (isNaN(qty) || qty < 1) qty = 1;
  const total = CONFIG.protectPrice * qty;
  if (p.gold < total) return { ok: false, error: '골드 부족! (' + qty + '개 = ' + total + 'G / 보유 ' + p.gold + ')' };
  p.gold -= total; p.protects += qty;
  return { ok: true, qty, spent: total, msg: '파괴방지권 ' + qty + '개 구매!' };
}
function buyBoost(db, id) {
  const p = norm(db.players[id]);
  if (p.gold < CONFIG.boostPrice) return { ok: false, error: '골드 부족! (' + CONFIG.boostPrice + 'G)' };
  p.gold -= CONFIG.boostPrice; p.enhanceBoost += CONFIG.boostCount;
  return { ok: true, msg: '🍀 강화 부스트 ' + CONFIG.boostCount + '회 획득! (남은 부스트 ' + p.enhanceBoost + '회)' };
}
function buyDye(db, id) {
  const p = norm(db.players[id]);
  if (p.gold < CONFIG.dyePrice) return { ok: false, error: '골드 부족! (' + CONFIG.dyePrice + 'G)' };
  p.gold -= CONFIG.dyePrice;
  const dye = rollDye();
  p.nickColor = dye;
  addLog(db, '🎨 ' + p.nick + ' 염색: ' + dye.name + (dye.rarity !== '기본' ? ' [' + dye.rarity + ']' : ''));
  return { ok: true, dye, msg: '🎨 염색 결과: ' + dye.name + ' [' + dye.rarity + ']' };
}
function buyClassChange(db, id) {
  const p = norm(db.players[id]);
  if (p.gold < CONFIG.classChangePrice) return { ok: false, error: '골드 부족! (' + CONFIG.classChangePrice + 'G)' };
  p.gold -= CONFIG.classChangePrice;
  p.class = null; // 재선택 필요
  if (p.party) partyLeave(db, id); // 파티에 있으면 나가기(직업 재선택 중)
  return { ok: true, needReselect: true, msg: '직업을 다시 선택하세요.' };
}
function fight(db, id, targetNick) {
  targetNick = (targetNick || '').trim();
  const targetId = findByNick(db, targetNick);
  if (!targetId) return { ok: false, error: '"' + targetNick + '" 님을 찾을 수 없어요.' };
  if (targetId === id) return { ok: false, error: '자기 자신과는 싸울 수 없어요.' };
  const atk = norm(db.players[id]);
  const def = norm(db.players[targetId]);
  if (atk.fightDay !== today()) { atk.fightDay = today(); atk.fightsUsed = 0; }
  if (atk.fightsUsed >= CONFIG.dailyFights) return { ok: false, error: '오늘 싸움 횟수를 다 썼어요!' };
  atk.fightsUsed++;
  let pWin = 0.5 + (atk.level - def.level) * 0.05;
  pWin = Math.max(0.1, Math.min(0.9, pWin));
  const atkWin = Math.random() < pWin;
  const winP = atkWin ? atk : def, loseP = atkWin ? def : atk;
  const winner = atkWin ? atk.nick : def.nick, loser = atkWin ? def.nick : atk.nick;
  winP.wins++; loseP.losses++;
  const steal = Math.floor(loseP.gold * CONFIG.stealPct);
  loseP.gold -= steal; winP.gold += steal;
  let broke = null;
  if (loseP.level > 0 && Math.random() < CONFIG.fightBreakChance) {
    const b = loseP.level; loseP.level--; broke = { who: loser, from: b, to: loseP.level };
    addLog(db, '💢 ' + loser + ' 무기 손상 +' + b + '→+' + loseP.level);
  }
  addLog(db, '⚔️ ' + winner + ' 승 vs ' + loser + ' (' + steal + 'G 약탈)');
  return { ok: true, iWon: winner === atk.nick, winner, loser, steal, broke, atk: { nick: atk.nick, level: atk.level }, def: { nick: def.nick, level: def.level } };
}

/* ---------- 파티 / 레이드 (멤버는 accountId 로 저장, 표시만 nick) ---------- */
function partyView(db, pid) {
  const pt = db.parties[pid];
  if (!pt) return null;
  return {
    id: pt.id, leaderNick: db.players[pt.leader] ? db.players[pt.leader].nick : '?',
    members: pt.members.map(k => {
      const mp = db.players[k]; const c = classOf(mp);
      return { nick: mp ? mp.nick : '?', classEmoji: c.emoji, className: c.name, level: mp ? mp.level : 0, raidsLeft: mp ? raidsLeft(mp) : 0, isLeader: k === pt.leader };
    }),
    count: pt.members.length, max: CONFIG.partyMax,
  };
}
function partyCreate(db, id) {
  const p = norm(db.players[id]);
  if (p.party) return { ok: false, error: '이미 파티에 속해 있어요.' };
  const pid = crypto.randomBytes(3).toString('hex');
  db.parties[pid] = { id: pid, leader: id, members: [id], pending: [], raid: null, created: Date.now() };
  p.party = pid;
  return { ok: true, party: partyView(db, pid) };
}
// 파티장이 특정 유저를 초대
function partyInvite(db, leaderId, targetNick) {
  const p = norm(db.players[leaderId]);
  if (!p.party) return { ok: false, error: '파티가 없어요.' };
  const pt = db.parties[p.party];
  if (!pt || pt.leader !== leaderId) return { ok: false, error: '파티장만 초대할 수 있어요.' };
  if (!pt.pending) pt.pending = [];
  const tid = findByNick(db, (targetNick || '').trim());
  if (!tid) return { ok: false, error: '"' + targetNick + '" 님을 찾을 수 없어요.' };
  if (pt.members.includes(tid)) return { ok: false, error: '이미 파티원이에요.' };
  if (pt.members.length >= CONFIG.partyMax) return { ok: false, error: '파티가 가득 찼어요.' };
  if (pt.pending.includes(tid)) return { ok: false, error: '이미 초대했어요.' };
  pt.pending.push(tid);
  return { ok: true, msg: db.players[tid].nick + ' 님을 초대했어요.', targetId: tid, targetNick: db.players[tid].nick, byNick: p.nick };
}
function myInvites(db, id) {
  const out = [];
  for (const pid in db.parties) {
    const pt = db.parties[pid];
    if (pt.pending && pt.pending.includes(id)) {
      out.push({ partyId: pid, leaderNick: db.players[pt.leader] ? db.players[pt.leader].nick : '?', count: pt.members.length, max: CONFIG.partyMax });
    }
  }
  return out;
}
function partyAccept(db, id, pid) {
  const p = norm(db.players[id]);
  if (p.party) return { ok: false, error: '이미 파티에 속해 있어요.' };
  const pt = db.parties[pid];
  if (!pt || !pt.pending || !pt.pending.includes(id)) return { ok: false, error: '초대가 만료되었어요.' };
  if (pt.members.length >= CONFIG.partyMax) return { ok: false, error: '파티가 가득 찼어요.' };
  // 다른 파티의 대기 초대 정리
  for (const k in db.parties) { if (db.parties[k].pending) db.parties[k].pending = db.parties[k].pending.filter(x => x !== id); }
  pt.members.push(id); p.party = pid;
  addLog(db, '🤝 ' + p.nick + ' 님이 ' + (db.players[pt.leader] ? db.players[pt.leader].nick : '?') + ' 파티 초대를 수락');
  return { ok: true, party: partyView(db, pid) };
}
function partyReject(db, id, pid) {
  const pt = db.parties[pid];
  if (pt && pt.pending) pt.pending = pt.pending.filter(x => x !== id);
  return { ok: true };
}
function raidState(db, id) {
  const p = norm(db.players[id]);
  if (!p.party || !db.parties[p.party]) return { ok: true, raid: null };
  return { ok: true, raid: db.parties[p.party].raid || null };
}
function partyJoin(db, id, pid) {
  const p = norm(db.players[id]);
  if (p.party) return { ok: false, error: '이미 파티에 속해 있어요.' };
  const pt = db.parties[pid];
  if (!pt) return { ok: false, error: '파티를 찾을 수 없어요.' };
  if (pt.members.length >= CONFIG.partyMax) return { ok: false, error: '파티가 가득 찼어요.' };
  pt.members.push(id); p.party = pid;
  addLog(db, '🤝 ' + p.nick + ' 님이 ' + (db.players[pt.leader] ? db.players[pt.leader].nick : '?') + ' 파티에 합류');
  return { ok: true, party: partyView(db, pid) };
}
function partyLeave(db, id) {
  const p = norm(db.players[id]);
  if (!p.party) return { ok: false, error: '속한 파티가 없어요.' };
  const pt = db.parties[p.party];
  p.party = null;
  if (pt) {
    pt.members = pt.members.filter(k => k !== id);
    if (pt.leader === id || pt.members.length === 0) {
      pt.members.forEach(k => { if (db.players[k]) db.players[k].party = null; });
      delete db.parties[pt.id];
    }
  }
  return { ok: true };
}
function partyList(db) {
  return Object.values(db.parties).map(pt => partyView(db, pt.id)).sort((a, b) => b.count - a.count);
}

// 레이드 전투 시뮬레이션 (직업 버프 반영, 라운드별 로그 포함)
function simulateRaid(parts, boss) {
  const st = parts.map(p => ({ nick: p.nick, cls: p.class, s: memberStats(p) }));
  let dps = 0, heal = 0, flatArmor = 0, maxHP = 0, dr = 0, atkBuff = 0;
  st.forEach(m => {
    dps += m.s.atk; heal += m.s.heal; flatArmor += m.s.armor; maxHP += m.s.hp;
    dr += m.s.dr; atkBuff += m.s.atkBuff;
  });
  dr = Math.min(CONFIG.raidDRCap, dr);
  atkBuff = Math.min(CONFIG.raidAtkBuffCap, atkBuff);
  const contrib = {}; st.forEach(m => contrib[m.nick] = 0);
  let hp = maxHP, bossHP = boss.hp, round = 0;
  const timeline = [];
  while (bossHP > 0 && hp > 0 && round < 60) {
    round++;
    let roundDmg = 0;
    st.forEach(m => { const d = m.s.atk * (1 + atkBuff) * (0.9 + Math.random() * 0.2); roundDmg += d; contrib[m.nick] += d; });
    bossHP = Math.max(0, bossHP - roundDmg);
    const enrage = round > 20 ? 1 + (round - 20) * 0.09 : 1;
    let incoming = 0;
    if (bossHP > 0) { incoming = Math.max(0, boss.atk * enrage * (1 - dr) - flatArmor); hp = Math.max(0, hp - incoming); if (hp > 0) hp = Math.min(maxHP, hp + heal); }
    timeline.push({ round, bossHP: Math.round(bossHP), partyHP: Math.round(hp), dmg: Math.round(roundDmg), incoming: Math.round(incoming), enrage: enrage > 1 });
    if (bossHP <= 0 || hp <= 0) break;
  }
  return {
    win: bossHP <= 0, rounds: round, maxHP: Math.round(maxHP), remainHP: Math.max(0, Math.round(hp)),
    bossRemain: Math.max(0, Math.round(bossHP)), dps: Math.round(dps * (1 + atkBuff)), heal: Math.round(heal),
    armor: Math.round(flatArmor), dr: Math.round(dr * 100), atkBuff: Math.round(atkBuff * 100), contrib, timeline,
  };
}
function raidStart(db, id, bossId) {
  const p = norm(db.players[id]);
  if (!p.party) return { ok: false, error: '먼저 파티를 만들거나 참가하세요.' };
  const pt = db.parties[p.party];
  if (!pt) { p.party = null; return { ok: false, error: '파티 정보를 찾을 수 없어요.' }; }
  if (pt.leader !== id) return { ok: false, error: '파티장만 레이드를 시작할 수 있어요.' };
  const boss = bossById(bossId);
  if (!boss) return { ok: false, error: '보스를 선택하세요.' };
  const participants = [];
  for (const k of pt.members) {
    const mp = norm(db.players[k]);
    if (mp.raidDay !== today()) { mp.raidDay = today(); mp.raidsUsed = 0; }
    if (raidsLeft(mp) > 0) participants.push(k);
  }
  if (participants.length === 0) return { ok: false, error: '파티원 모두 오늘 레이드 횟수를 소진했어요.' };
  if (participants.length < CONFIG.raidMinMembers) return { ok: false, error: '레이드는 최소 ' + CONFIG.raidMinMembers + '명이 필요해요. (혼자서는 불가 — 동료를 초대하세요)' };
  participants.forEach(k => { db.players[k].raidsUsed++; });
  const parts = participants.map(k => ({ nick: db.players[k].nick, class: db.players[k].class, level: db.players[k].level }));
  const sim = simulateRaid(parts, boss);
  const rewards = [];
  if (sim.win) {
    const each = Math.floor(boss.reward / participants.length);
    participants.forEach(k => {
      const mp = db.players[k]; mp.gold += each;
      let drop = null;
      if (Math.random() < boss.dropChance) { mp.protects++; drop = '🛡️ 방지권'; }
      rewards.push({ nick: mp.nick, gold: each, drop });
    });
    addLog(db, '🏆 ' + (db.players[pt.leader] ? db.players[pt.leader].nick : '?') + ' 파티가 ' + boss.emoji + boss.name + ' 레이드 성공! (' + participants.length + '명)');
  } else {
    addLog(db, '☠️ ' + (db.players[pt.leader] ? db.players[pt.leader].nick : '?') + ' 파티가 ' + boss.emoji + boss.name + ' 레이드 실패...');
  }
  const topNick = Object.keys(sim.contrib).sort((a, b) => sim.contrib[b] - sim.contrib[a])[0];
  // 라이브 관전용 상태를 파티에 저장 (전원이 폴링해서 함께 관전)
  pt.raid = {
    startTs: Date.now(),
    boss: { name: boss.name, emoji: boss.emoji, hp: boss.hp, atk: boss.atk },
    maxHP: sim.maxHP, rounds: sim.rounds, win: sim.win, timeline: sim.timeline,
    rewards, topContributor: topNick,
    participants: parts.map(x => ({ nick: x.nick, classEmoji: (CLASSES[x.class] || CLASSES.warrior).emoji })),
  };
  return {
    ok: true, win: sim.win,
    boss: { name: boss.name, emoji: boss.emoji, hp: boss.hp, atk: boss.atk },
    sim: { rounds: sim.rounds, maxHP: sim.maxHP, remainHP: sim.remainHP, bossRemain: sim.bossRemain, dps: sim.dps, heal: sim.heal, armor: sim.armor, dr: sim.dr, atkBuff: sim.atkBuff, timeline: sim.timeline },
    participants: parts, rewards, topContributor: topNick, raid: pt.raid,
  };
}

/* ---------- 조회 ---------- */
function profile(db, nick) {
  const k = findByNick(db, nick);
  if (!k) return { ok: false, error: '"' + nick + '" 님을 찾을 수 없어요.' };
  return { ok: true, profile: publicView(db, k) };
}
function ranking(db) {
  return Object.values(db.players).map(p => p)
    .sort((a, b) => b.level - a.level || b.best - a.best).slice(0, 20)
    .map(p => ({ nick: p.nick, level: p.level, weapon: weaponName(p.level, p.class), classEmoji: classOf(p).emoji, wins: p.wins, losses: p.losses, nickColor: p.nickColor || null }));
}
function goldRanking(db) {
  return Object.values(db.players).map(p => ({ nick: p.nick, gold: p.gold, nickColor: p.nickColor || null })).sort((a, b) => b.gold - a.gold).slice(0, 20);
}
function hogu(db) {
  const t = today();
  return Object.values(db.players).map(p => ({ nick: p.nick, c: p.destroyDay === t ? p.destroysToday : 0 }))
    .filter(x => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 10);
}
function recentLog(db) { return db.log.slice(-20).reverse(); }
function playerList(db) { return Object.values(db.players).filter(p => p.class).map(p => p.nick).sort(); }

module.exports = {
  CONFIG, GRADES, RARITIES, CLASSES, BOSSES, odds, enhanceCost, weaponName, grade,
  login, setClass, rename, publicView, enhance, attend, mine, mineSwing, hunt, buyProtect, fight,
  partyCreate, partyJoin, partyLeave, partyList, partyView, raidStart,
  partyInvite, partyAccept, partyReject, myInvites, raidState,
  buyBoost, buyDye, buyClassChange, shopItems,
  profile, ranking, goldRanking, hogu, recentLog, playerList, findByNick,
};
