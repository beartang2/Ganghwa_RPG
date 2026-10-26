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
  destroyDropRatio: 0.15,    // 파괴 시 떨어지는 폭(만렙 대비). 99 기준 -15레벨
  stealPct: 0.2, protectPrice: 8000,
  protectDailyBuy: 3,        // 🛡️ 상점 일일 구매 상한 — 나머지는 사냥 드랍으로 얻는다
  fightBreakChance: 0.10,    // 싸움 패배 시 무기 1단계 하락 확률(진 사람만, 확률적)
  dropProtectChance: 0.05, dropGoldChance: 0.07,   // 방지권 주 공급원이 사냥이라 확률을 올림
  mineRate: 12, mineCap: 3000, partyMax: 5, raidMinMembers: 1,   // 1=혼자도 레이드 가능(고레벨 솔로 딜로 잡힘, 난이도는 보스 danger가 담당)
  raidAtkBuffCap: 0.15,      // 힐러 아군 공격 버프 상한
  raidDRCap: 0.40,           // 탱커 아군 피해감소 상한
  // 인터랙티브 레이드(연타 전투)
  raidPartyHpScale: 0.7,     // 인원 1명 늘 때마다 보스 체력 배수 +0.7
                             // (파티는 탱커·힐러가 섞여 인원수만큼 딜이 늘지 않으므로 1.0 미만이어야
                             //  '뭉칠수록 유리' 가 유지된다. 1.35 로 잡으면 5인이 솔로보다 어려워진다)
  raidPartyDangerScale: 0.12,// 인원 1명 늘 때마다 보스 화력 +12%(탱커·힐러가 필요해지는 이유)
  raidDuration: 15000,       // 전투 지속(ms)
  raidHitDmgMult: 0.55,      // 탭 1회 데미지 = memberStats.atk * 이 배율
  raidHitBatchMax: 40,       // raidHit 한 번에 인정하는 최대 타수(치트 방지)
  raidHitMsPerTap: 80,       // 누적 타수 상한 계산용(경과ms/이 값 = 최대 타수)
  raidBossAttMin: 3, raidBossAttMax: 6,   // 타이머 내 보스 공격 횟수
  raidHealPctPerHealer: 2.6, // 힐러 1인당 파티HP 회복(%/초)
  raidDRCapSkill: 0.6,       // 탱커 스킬로 올라갈 수 있는 피해감소 상한
  // 상점
  boostMult: 3.0,            // 강화 부스트권: 성공률 배율(×3)
  boostPityMult: 2.5,        // 부스트 사용 시 장인의 기운 상승 배율(실패·방지 시 pity ×2.5)
  boostCount: 10,            // 강화 부스트권: 지속 횟수
  boostPrice: 8000,
  classChangePrice: 30000,
  dyePrice: 2000,
  // 강화(로스트아크식) — 파괴 시 완전 초기화(+0)
  pityBase: 0.015,      // 장인의 기운 기본 상승폭(실패당) — 저확률에서도 결국 참
  pityScale: 0.34,      // + 성공률 비례분(성공률 높을수록 살짝 더 빨리 참)
  // 사냥
  huntOvertimeMult: 0.15,   // 일일 사냥 소진 후 '무한 사냥' 골드 배율(채굴이 주 수급이라 낮게)
  huntPotionChance: 0.06,   // 무한 사냥 시 '채광 물약' 드랍 확률 → 채굴 기력 회복
  huntPotionStamina: 20,    // 채광 물약 1개가 채워주는 채굴 기력
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
  // 초월(환생) — +99 도달 시 무기를 +0 으로 되돌리고 영구 별(★)을 하나 얻는다.
  ascendGoldBonus: 0.05,     // ★당 골드 획득 증가(+5%/★)
  ascendAtkBonus: 0.08,      // ★당 레이드 공격력 증가(+8%/★)
  ascendPityBonus: 0.03,     // ★당 장인의 기운 상승폭 증가(+3%/★)
  ascendCostMult: 0.8,       // ★당 강화 비용 증가(+80%/★, 선형)
  ascendSuccPenalty: 0.18,   // ★당 성공률 감소(×0.82^★ — 곱연산이라 0 이 되지 않는다).
                             // ★0 앵커를 살짝 완화한 대신 초월 회차는 그보다 확실히 낮게 잡는다.
                             // 고레벨은 장인의 기운이 지배해서 체감이 약하므로, 실질 난이도는
                             // 비용(★당 +80%)과 방지권 무효가 함께 만든다.
  /* 초월 승급 재료 — ★N 로 올리는 데 필요한 양(선형 증가).
   * 등반(0→99)은 '후퇴 없이' 가는 대신 짧아졌으므로, 회차 사이의 시간축은 재료가 잡는다.
   * 파편은 일일 사냥 20회에서 하루 9개(+0)~32개(+99), 정수는 레이드 성공 3회에서
   * 하루 3개(고블린)~12개(공허)가 들어온다. ★1 은 약 10일, ★5 는 약 50일 분량. */
  ascendShardBase: 200, ascendShardStep: 200,   // 💠 초월의 파편(사냥 확률 드랍)
  ascendEssenceBase: 20, ascendEssenceStep: 20, // 🌟 초월의 정수(레이드 확정 드랍)
  huntShardChance: 0.35,     // 일일 사냥에서 파편이 드랍될 확률(희귀도가 높을수록 개수↑)
  raidEssence: 1,            // 레이드 성공 시 참가자 1인당 확정 정수 개수
  // 인벤토리 — 슬롯 = '아이템 종류' 단위(같은 종류는 한 칸에 무제한 스택)
  /* 인벤 칸: 기본 8 → 상점 1회 한정 패키지 +4 → 배틀패스 프리미엄 중간 보상 +4 = 상한 16.
   * 스택이 커서 재료는 1~2칸만 먹는다 — 칸이 모자라지는 건 아이템 '종류' 가 늘 때다.
   * 지금은 6종이라 기본 8칸에 여유 2칸. 컨텐츠로 종류가 늘면 그때 확장이 필요해진다.
   * invSlots 는 '바닥값' 이라 나중에 올리면 기존 유저도 자동으로 그만큼 받는다
   * (추가분은 p.inv.bought 에 따로 쌓여서 사라지지 않는다). */
  invSlots: 8, invSlotsMax: 16,
  invPackSlots: 4,           // 상점 '가방 확장 패키지' 1회 구매로 열리는 칸수
  invPackPrice: 500000,      // 그 가격 — 계정당 딱 한 번
  invBpSlots: 4,             // 배틀패스 프리미엄 중간 보상으로 주는 칸수
  invBpLevel: 15,            // 그 보상이 걸리는 패스 레벨
  /* 한 칸에 쌓이는 최대 개수. 넘으면 다음 칸을 하나 더 먹는다.
   * 크게 잡는 이유: 칸 압박은 '아이템 종류 수' 에서 와야 한다. 스택이 작으면
   * 초월 재료 누적만으로 칸이 다 차서, 나중에 아이템 종류가 늘 때 넣을 자리가 없어진다. */
  invStackMax: 999,
};

/* ---------- 유틸 ---------- */
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
// 'YYYY-MM-DD' 한국시간(KST=UTC+9) 기준. 일일 리셋을 KST 00시로 고정.
// 서버 타임존과 무관하도록 UTC 타임스탬프에 +9h 후 UTC 필드를 읽는다(Vercel=UTC, 로컬 무관).
const KST_OFFSET_MS = 9 * 3600 * 1000;
function today() {
  const d = new Date(Date.now() + KST_OFFSET_MS);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
// 구버전 비패딩 날짜('2026-8-1')를 패딩 형식으로 보정
function normalizeDay(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
  return m ? m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) : String(s || '');
}
function pinKey(pin) { return crypto.createHash('sha256').update('pin:' + pin).digest('hex'); }
/* nick → accountId 인덱스. 매 싸움/초대마다 전체 스캔하지 않도록 캐시한다.
 * db 에 붙는 `_` 접두 필드는 파생 데이터라 영속화되지 않는다. */
function nickIndex(db) {
  if (!db._nickIdx) {
    db._nickIdx = new Map();
    for (const k in db.players) db._nickIdx.set(db.players[k].nick, k);
  }
  return db._nickIdx;
}
function indexNick(db, nick, id) { nickIndex(db).set(nick, id); }
function unindexNick(db, nick) { if (db._nickIdx) db._nickIdx.delete(nick); }
function findByNick(db, nick) {
  const id = nickIndex(db).get(nick);
  return id && db.players[id] && db.players[id].nick === nick ? id : null;
}
// Supabase Auth uid → accountId. 연결된 이메일 계정 로그인 시 캐릭터를 찾는다.
// (uid 는 계정당 하나뿐 → 소규모에선 인메모리 스캔으로 충분, findByNick 과 동일한 패턴)
function findByAuthUid(db, uid) {
  if (!uid) return null;
  for (const id in db.players) if (db.players[id].authUid === uid) return id;
  return null;
}

/* ---------- 직업 ---------- */
const CLASSES = {
  warrior: { id: 'warrior', name: '근거리 딜러', emoji: '⚔️', weapon: '검',     desc: '높은 공격력의 근접 딜러' },
  archer:  { id: 'archer',  name: '원거리 딜러', emoji: '🏹', weapon: '활',     desc: '최고 공격력의 원거리 딜러' },
  tanker:  { id: 'tanker',  name: '탱커',       emoji: '🛡️', weapon: '방패',   desc: '체력·방어가 높고 아군 피해를 줄여줌' },
  healer:  { id: 'healer',  name: '힐러',       emoji: '✨', weapon: '지팡이', desc: '아군을 회복하고 공격력을 올려줌' },
};
function classOf(p) { return CLASSES[p && p.class] || CLASSES.warrior; }

// 레이드 전투 스탯 (직업 + 강화 수치 기반)
//  - 딜러(근/원): 높은 공격, 낮은 체력
//  - 탱커: 낮은 공격, 높은 체력 + 방어(flat armor) + 아군 피해감소(dr)
//  - 힐러: 낮은 공격, 아군 회복(heal) + 아군 공격버프(atkBuff)
function memberStats(p) {
  const L = p.level || 0;
  const base = (12 + L * 8) * (1 + starsOf(p) * CONFIG.ascendAtkBonus);   // 초월 ★당 공격력 +8%
  switch (p.class) {
    case 'archer': return { atk: base * 1.35, hp: 80 + L * 10,  heal: 0, armor: 0, dr: 0, atkBuff: 0 };
    case 'tanker': return { atk: base * 0.6,  hp: 300 + L * 30, heal: 0, armor: 60 + L * 7, dr: 0.05 + L * 0.004, atkBuff: 0 };
    case 'healer': return { atk: base * 0.5,  hp: 150 + L * 15, heal: 45 + L * 9, armor: 0, dr: 0, atkBuff: 0.01 + L * 0.002 };
    case 'warrior':
    default:       return { atk: base * 1.2,  hp: 120 + L * 12, heal: 0, armor: 0, dr: 0, atkBuff: 0 };
  }
}

/* ---------- 등급 / 무기 ---------- */
/* 등급 경계는 만렙 대비 '비율'(r)로 잡는다 — CONFIG.maxLevel 만 올리면 경계가 따라 움직인다.
 * maxLevel 99 기준: 일반0~15, 희귀16~24, 에픽25~48, 전설49~68, 초월69~99 */
const GRADES = [
  { r: 0.70, name: '초월', key: 'transcend', emoji: '🌈', color: '#c471ed' },
  { r: 0.50, name: '전설', key: 'legend',    emoji: '🟠', color: '#f7971e' },
  { r: 0.25, name: '에픽', key: 'epic',      emoji: '🟣', color: '#a770ef' },
  { r: 0.16, name: '희귀', key: 'rare',      emoji: '🔵', color: '#4facfe' },
  { r: 0,    name: '일반', key: 'common',    emoji: '⚪', color: '#9aa0b0' },
];
function gradeMin(g) { return Math.round(CONFIG.maxLevel * g.r); }
function grade(level) { for (const g of GRADES) { if (level >= gradeMin(g)) return g; } return GRADES[GRADES.length - 1]; }
/* 파괴 시 떨어지는 지점 = max(한 등급 아래 시작 레벨, 현재 -15).
 * 등급 바닥만 쓰면 +85 파괴가 +50 으로 48레벨을 날려서, 고레벨 구간의
 * '레벨당 시도 20~65회 × 파괴율' 이 1 을 넘어 진행이 역행한다(며칠치가 증발).
 * 상대 강등을 씌워 후퇴 폭을 묶고, 난이도는 파괴율·비용·성공률로 만든다. */
function destroyDrop() { return Math.max(1, Math.round(CONFIG.maxLevel * CONFIG.destroyDropRatio)); }
function destroyFloor(level) {
  const gi = GRADES.findIndex(g => level >= gradeMin(g)); // GRADES는 비율 내림차순
  const prev = GRADES[gi + 1];
  return Math.max(prev ? gradeMin(prev) : 0, level - destroyDrop());
}

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

/* ---------- 도전과제 / 칭호 ----------
 * 단조 증가 스탯(최고강화·파괴·승·채굴레벨)에만 걸어 한 번 달성하면 사라지지 않는다.
 * 등급 색상: 일반 흰 · 희귀 채도낮은파랑 · 에픽 보라 · 전설 노랑 · 초월 빨강 */
const TITLE_GRADES = {
  common:    { rank: 0, color: '#f0f2f7' },
  rare:      { rank: 1, color: '#7ba3c7' },
  epic:      { rank: 2, color: '#a770ef' },
  legend:    { rank: 3, color: '#ffd93d' },
  transcend: { rank: 4, color: '#ff5d6c' },
};
const ACHIEVEMENTS = [
  // 강화 최고기록
  { id: 'enh25',  title: '강화 입문자',    grade: 'common',    desc: '무기 +25 달성',   check: p => (p.best || 0) >= 25 },
  { id: 'enh50',  title: '전설 강화사',    grade: 'rare',      desc: '무기 +50 달성',   check: p => (p.best || 0) >= 50 },
  { id: 'enh70',  title: '초월자',         grade: 'epic',      desc: '무기 +70 달성',   check: p => (p.best || 0) >= 70 },
  { id: 'enh90',  title: '강화 장인',      grade: 'legend',    desc: '무기 +90 달성',   check: p => (p.best || 0) >= 90 },
  // 아래 강화 마일스톤은 '역사적 기록' 이라 절대값으로 둔다 — 만렙을 올려도
  // 이미 +99 를 찍은 사람이 칭호를 잃지 않는다. 만렙 상향 시엔 새 마일스톤을 추가할 것.
  { id: 'enh99',  title: '강화의 신',      grade: 'transcend', desc: '무기 +99 달성',   check: p => (p.best || 0) >= 99 },
  // 파괴
  { id: 'brk20',  title: '오늘의 호구',    grade: 'common',    desc: '무기 파괴 20회',  check: p => (p.breaks || 0) >= 20 },
  { id: 'brk77',  title: '파괴왕',         grade: 'rare',      desc: '무기 파괴 77회',  check: p => (p.breaks || 0) >= 77 },
  { id: 'brk200', title: '박살의 화신',    grade: 'epic',      desc: '무기 파괴 200회', check: p => (p.breaks || 0) >= 200 },
  // 싸움 — 승리
  { id: 'win10',  title: '싸움꾼',         grade: 'common',    desc: '싸움 10승',       check: p => (p.wins || 0) >= 10 },
  { id: 'win50',  title: '검투사',         grade: 'rare',      desc: '싸움 50승',       check: p => (p.wins || 0) >= 50 },
  { id: 'winmaster', title: '싸움의 달인', grade: 'epic',      desc: '싸움 100승',      check: p => (p.wins || 0) >= 100 },
  { id: 'win150', title: '무패의 전설',    grade: 'legend',    desc: '싸움 150승',      check: p => (p.wins || 0) >= 150 },
  // 채굴
  { id: 'mine10', title: '광부',           grade: 'common',    desc: '채굴 Lv.10',      check: p => (p.mineLevel || 1) >= 10 },
  { id: 'mine30', title: '채굴 장인',      grade: 'rare',      desc: '채굴 Lv.30',      check: p => (p.mineLevel || 1) >= 30 },
  { id: 'mine50', title: '대지의 지배자',  grade: 'epic',      desc: '채굴 Lv.50(만렙)', check: p => (p.mineLevel || 1) >= 50 },
  // 싸움 — 패배(재미)
  { id: 'lose30', title: '동네북',         grade: 'common',    desc: '싸움 30패',       check: p => (p.losses || 0) >= 30 },
  { id: 'lose100', title: '물몸',          grade: 'rare',      desc: '싸움 100패',      check: p => (p.losses || 0) >= 100 },
  // 골드 — 많이 쓴 사람 / 많이 번 사람
  { id: 'flex',   title: 'Flex',           grade: 'epic',      desc: '누적 2천만 골드 소모',   check: p => (p.goldSpent || 0) >= 20000000 },
  { id: 'billion', title: '억만장자',      grade: 'legend',    desc: '누적 5천만 골드 획득',   check: p => (p.goldEarned || 0) >= 50000000 },
  // 싸움 많이 건 사람
  { id: 'maddog', title: '광견',           grade: 'epic',      desc: '싸움 300회 도전',       check: p => (p.fightsTotal || 0) >= 300 },
  // 한 직업으로 +99 달성 (직업의 달인)
  { id: 'm_warrior', title: CLASSES.warrior.name + '의 달인', grade: 'legend', desc: CLASSES.warrior.name + '(으)로 만렙(+' + CONFIG.maxLevel + ') 달성', check: p => (p.masteredClasses || []).includes('warrior') },
  { id: 'm_archer',  title: CLASSES.archer.name  + '의 달인', grade: 'legend', desc: CLASSES.archer.name  + '(으)로 만렙(+' + CONFIG.maxLevel + ') 달성', check: p => (p.masteredClasses || []).includes('archer') },
  { id: 'm_tanker',  title: CLASSES.tanker.name  + '의 달인', grade: 'legend', desc: CLASSES.tanker.name  + '(으)로 만렙(+' + CONFIG.maxLevel + ') 달성', check: p => (p.masteredClasses || []).includes('tanker') },
  { id: 'm_healer',  title: CLASSES.healer.name  + '의 달인', grade: 'legend', desc: CLASSES.healer.name  + '(으)로 만렙(+' + CONFIG.maxLevel + ') 달성', check: p => (p.masteredClasses || []).includes('healer') },
  // 채굴장 노가다
  { id: 'blindmoney', title: '눈먼 돈',    grade: 'epic',      desc: '곡괭이질 5,000회',      check: p => (p.mineSwings || 0) >= 5000 },
  // 몬스터 사냥
  { id: 'monsterhunter', title: '괴물 사냥꾼', grade: 'epic',  desc: '몬스터 1,000마리 처치',  check: p => (p.kills || 0) >= 1000 },
  // 레이드 피해
  { id: 'threatdmg', title: '위협적인 피해량', grade: 'epic',  desc: '단일 레이드 3만 피해',    check: p => (p.raidDmg || 0) >= 30000 },
  // 초월(환생) — ★은 단조 증가라 한 번 얻으면 사라지지 않는다
  { id: 'asc1',  title: '초월의 시작',  grade: 'legend',    desc: '초월 ★1 달성',  check: p => (p.ascend || 0) >= 1 },
  { id: 'asc3',  title: '윤회자',       grade: 'legend',    desc: '초월 ★3 달성',  check: p => (p.ascend || 0) >= 3 },
  { id: 'asc5',  title: '초월의 화신',  grade: 'transcend', desc: '초월 ★5 달성',  check: p => (p.ascend || 0) >= 5 },
  { id: 'asc10', title: '무의 경지',    grade: 'transcend', desc: '초월 ★10 달성', check: p => (p.ascend || 0) >= 10 },
  // 염색
  { id: 'colormage', title: '색채 마술사',  grade: 'epic',     desc: '염색약 40회 사용',       check: p => (p.dyeCount || 0) >= 40 },
  { id: 'fashion',  title: '패션의 완성',   grade: 'transcend', desc: '염색에서 무지개 획득',   check: p => !!p.gotRainbow },
];
// 현재 스탯 기준으로 획득한 칭호 목록(높은 등급 우선). 단조 증가 스탯이라 저장 불필요.
function earnedTitles(p) {
  return ACHIEVEMENTS.filter(a => a.check(p))
    .map(a => ({ id: a.id, title: a.title, grade: a.grade, color: TITLE_GRADES[a.grade].color, desc: a.desc }))
    .sort((x, y) => TITLE_GRADES[y.grade].rank - TITLE_GRADES[x.grade].rank);
}
function hasTitle(p, id) { const a = ACHIEVEMENTS.find(x => x.id === id); return !!(a && a.check(p)); }
// +99(만렙) 달성 시 현재 직업을 '달인' 목록에 기록 (직업의 달인 칭호용)
function markMastery(p) {
  if (p.level >= CONFIG.maxLevel && p.class) {
    if (!Array.isArray(p.masteredClasses)) p.masteredClasses = [];
    if (!p.masteredClasses.includes(p.class)) p.masteredClasses.push(p.class);
  }
}
// 장착 칭호(있으면) 한 개를 {id,title,grade,color} 로 반환. 조건을 잃으면(단조 증가라 실질 없음) null.
function equippedTitleView(p) {
  if (!p || !p.equippedTitle) return null;
  const a = ACHIEVEMENTS.find(x => x.id === p.equippedTitle);
  if (!a || !a.check(p)) return null;
  return { id: a.id, title: a.title, grade: a.grade, color: TITLE_GRADES[a.grade].color };
}
// 칭호 장착/해제. titleId 가 null/'' 이면 해제. 미획득 칭호는 장착 불가.
function equipTitle(db, id, titleId) {
  const p = norm(db.players[id]);
  if (!titleId) { p.equippedTitle = null; return { ok: true, equipped: null, msg: '칭호를 해제했어요.' }; }
  const a = ACHIEVEMENTS.find(x => x.id === titleId);
  if (!a) return { ok: false, error: '없는 칭호예요.' };
  if (!a.check(p)) return { ok: false, error: '아직 획득하지 못한 칭호예요.' };
  p.equippedTitle = titleId;
  return { ok: true, equipped: equippedTitleView(p), msg: '「' + a.title + '」 칭호를 장착했어요.' };
}

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
// 상점은 이제 '인벤토리에 아이템을 넣어주는' 창구다. 염색약·직업변경권은
// 구매 즉시 발동하지 않고 인벤토리에서 useItem 으로 써야 한다.
function shopItems() {
  return [
    { id: 'protect', emoji: ITEMS.protect.emoji, name: ITEMS.protect.name, price: CONFIG.protectPrice, qty: 1, desc: ITEMS.protect.desc },
    { id: 'boost', emoji: ITEMS.boost.emoji, name: ITEMS.boost.name, price: CONFIG.boostPrice, qty: CONFIG.boostCount, desc: '강화 성공률 ' + CONFIG.boostMult + '배 · ' + CONFIG.boostCount + '개 묶음' },
    { id: 'dye', emoji: ITEMS.dye.emoji, name: ITEMS.dye.name, price: CONFIG.dyePrice, qty: 1, desc: ITEMS.dye.desc + ' (레어일수록 희귀)' },
    { id: 'classchange', emoji: ITEMS.classtkt.emoji, name: ITEMS.classtkt.name, price: CONFIG.classChangePrice, qty: 1, desc: ITEMS.classtkt.desc },
    { id: 'invpack', emoji: '🎒', name: '가방 확장 패키지', price: CONFIG.invPackPrice, qty: CONFIG.invPackSlots, once: true,
      desc: '가방 칸 +' + CONFIG.invPackSlots + ' (계정당 1회) · 나머지 ' + CONFIG.invBpSlots + '칸은 배틀패스 프리미엄 Lv.' + CONFIG.invBpLevel + ' 보상' },
  ];
}
// 상점 구매 공통 — 골드 확인 → 인벤토리 지급. 칸이 없으면 결제 전에 막는다.
function buyIntoInv(p, itemId, qty, price) {
  const it = ITEMS[itemId];
  if (p.gold < price) return { ok: false, error: '골드 부족! (필요 ' + price.toLocaleString() + 'G / 보유 ' + p.gold.toLocaleString() + 'G)' };
  if (!canHold(p, itemId)) return { ok: false, error: '🎒 인벤토리가 꽉 찼어요. 칸을 확장하거나 아이템을 쓰세요.' };
  p.gold -= price;
  p.goldSpent = (p.goldSpent || 0) + price;
  addItem(p, itemId, qty);
  return { ok: true, item: itemId, qty, spent: price, msg: it.emoji + ' ' + it.name + ' ' + qty + '개 구매! (-' + price.toLocaleString() + 'G)' };
}
function weaponName(level, cls, ascend) {
  const g = grade(level);
  const base = (CLASSES[cls] || CLASSES.warrior).weapon;
  return stars(ascend) + '+' + level + ' ' + g.emoji + ' ' + g.name + ' ' + base;
}

/* ---------- 강화 확률 / 비용 ---------- */
// 로스트아크식: 성공률은 초반 높고 매끄럽게 급감(초월 0.n~0.0n%),
// 파괴는 낮고 산 모양(65 근처 피크→초월 완화), 나머지는 전부 실패.
// ⚠️ 파괴 = 완전 초기화(+0)라서 확률을 낮게 잡고 시작 구간도 +20 이후로 미룸.
/* 앵커의 첫 값은 '만렙 대비 비율'(0~1) 이다 — CONFIG.maxLevel 을 올리면 곡선이 그대로 늘어난다.
 * 파괴율 상단은 0.7% 로 잡았다. 고레벨은 장인의 기운이 지배해 레벨당 20~65회를 쓰는데,
 * 1.3~1.6% 를 두면 '레벨당 파괴 1회' 를 넘겨 등반이 영구히 역행한다(시뮬로 확인). */
const SUCC_ANCHORS = [[0, .97], [.15, .905], [.25, .65], [.40, .22], [.50, .088], [.60, .034], [.70, .014], [.86, .0045], [1, .0018]];
const DESTROY_ANCHORS = [[.20, 0], [.35, .004], [.50, .006], [.66, .007], [.80, .007], [1, .007]];
const DESTROY_FREE_RATIO = 0.20;   // 이 비율 아래에서는 파괴가 아예 없다
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
function levelRatio(level) { return CONFIG.maxLevel > 0 ? level / CONFIG.maxLevel : 0; }
function successRate(level, ascend) { return interpAnchor(SUCC_ANCHORS, levelRatio(level), true) * ascendSuccMult(ascend); }
function destroyRate(level) {
  const r = levelRatio(level);
  return r <= DESTROY_FREE_RATIO ? 0 : interpAnchor(DESTROY_ANCHORS, r, false);
}
function odds(level, ascend) {
  const s = successRate(level, ascend), d = destroyRate(level);
  return { success: s, destroy: d, fail: Math.max(0, 1 - s - d) };
}
// 장인의 기운 상승폭(실패당): 저확률에서도 결국 100% 도달하도록 최소치 보장
function pityGain(success, ascend) { return (CONFIG.pityBase + success * CONFIG.pityScale) * (1 + starsOf(ascend) * CONFIG.ascendPityBonus); }
function enhanceCost(level, ascend) { return Math.round((20 + level * 10) * ascendCostMult(ascend)); }
function successGain(level) {
  if (level < 20) { const r = Math.random(); if (r < 0.60) return 1; if (r < 0.90) return 2; return 3; }
  return 1;
}

/* ---------- 초월(환생) ----------
 * 강화 루프가 이 게임의 코어라서, +99 를 천장이 아니라 관문으로 만든다.
 * +99 에서 초월하면 무기가 +0 으로 돌아가고 영구 별(★)을 하나 얻는다.
 * ★은 단조 증가 — 파괴로도 잃지 않으므로 칭호/랭킹의 기준이 된다.
 *   버프   : 골드 획득 · 레이드 공격력 · 장인의 기운 상승폭
 *   페널티 : 강화 비용↑ · 성공률↓ · 🛡️파괴방지권이 아예 통하지 않음(★1+)
 * 별 개수는 players.data JSON 에 그대로 실려서 스키마 변경이 필요 없다. */
// ★N 로 올리는 데 필요한 재료. 승급마다 선형으로 늘어난다.
// 다음 승급의 재료 진행도 — UI 가 그대로 그릴 수 있는 형태로 돌려준다.
function ascendProgress(p) {
  const to = starsOf(p) + 1, req = ascendReq(to);
  const have = { shard: itemCount(p, 'shard'), essence: itemCount(p, 'essence') };
  return {
    to, req, have, ready: have.shard >= req.shard && have.essence >= req.essence,
    mats: [
      { id: 'shard', emoji: ITEMS.shard.emoji, name: ITEMS.shard.name, have: have.shard, need: req.shard, from: '🗡️ 사냥' },
      { id: 'essence', emoji: ITEMS.essence.emoji, name: ITEMS.essence.name, have: have.essence, need: req.essence, from: '🐲 레이드' },
    ],
  };
}
function ascendReady(p) { return ascendProgress(p).ready; }
function ascendReq(to) {
  return {
    shard: CONFIG.ascendShardBase + CONFIG.ascendShardStep * (to - 1),
    essence: CONFIG.ascendEssenceBase + CONFIG.ascendEssenceStep * (to - 1),
  };
}
function starsOf(v) { return typeof v === 'number' ? v : (v && v.ascend) || 0; }  // 숫자 또는 플레이어 둘 다 받는다
function stars(v) { const n = starsOf(v); return n > 0 ? '★' + n + ' ' : ''; }
// ★1 부터는 방지권이 무효 — 초월 회차는 파괴를 그대로 맞는다.
function protectWorks(p) { return starsOf(p) === 0; }
function goldMult(p) { return 1 + starsOf(p) * CONFIG.ascendGoldBonus; }
function ascendCostMult(v) { return 1 + starsOf(v) * CONFIG.ascendCostMult; }
// 곱연산이라 ★이 아무리 높아도 성공률이 0 이 되지는 않는다(선형 감산이면 12.5★에서 0).
function ascendSuccMult(v) { return Math.pow(1 - CONFIG.ascendSuccPenalty, starsOf(v)); }
// 골드 획득 창구 — 초월 보너스를 적용해 지급하고 누적 획득량(도전과제)까지 기록한다.
// raw=true 는 배수 미적용: 약탈처럼 총량이 보존돼야 하는 이전에 쓴다.
function gainGold(p, amount, raw) {
  const n = Math.max(0, Math.round(raw ? amount : amount * goldMult(p)));
  p.gold += n;
  p.goldEarned = (p.goldEarned || 0) + n;
  return n;
}

/* ---------- 아이템 / 인벤토리 ----------
 * 슬롯 1칸 = 아이템 한 종류 최대 CONFIG.invStackMax(999)개. 넘치면 같은 종류가 한 칸을 더 쓴다.
 * 칸이 꽉 차서 더 넣을 자리가 없으면 그 드랍은 버려진다 —
 * addItem 이 0 을 돌려주므로 호출부가 안내 문구를 붙인다. 골드는 화폐라 슬롯 밖.
 * 상태(p.inv)는 players.data JSON 에 실려서 스키마 변경이 필요 없다. */
const ITEMS = {
  protect:  { id: 'protect',  emoji: '🛡️', name: '파괴방지권',   kind: 'passive', desc: '파괴를 1회 자동으로 막아줍니다 (초월 ★1+ 무효)' },
  boost:    { id: 'boost',    emoji: '🍀', name: '강화 부스트권', kind: 'passive', desc: '강화 성공률 ' + CONFIG.boostMult + '배 (1개 = 1회 소모)' },
  dye:      { id: 'dye',      emoji: '🎨', name: '닉네임 염색약', kind: 'use',     desc: '사용하면 닉네임 색을 랜덤으로 뽑아요' },
  classtkt: { id: 'classtkt', emoji: '🔄', name: '직업 변경권',   kind: 'use',     desc: '사용하면 직업을 다시 선택합니다 (레벨·골드 유지)' },
  shard:    { id: 'shard',    emoji: '💠', name: '초월의 파편',   kind: 'mat',     desc: '몬스터 사냥 드랍 · 초월 승급 재료' },
  essence:  { id: 'essence',  emoji: '🌟', name: '초월의 정수',   kind: 'mat',     desc: '보스 레이드 확정 드랍 · 초월 승급 재료' },
};
/* 칸수는 절대값이 아니라 '구매한 확장 횟수(bought)' 로 저장한다.
 * 이렇게 해야 CONFIG.invSlots 를 올렸을 때 기존 유저도 자동으로 늘어나고,
 * 이미 돈 주고 산 확장분이 사라지지 않는다. */
function ensureInv(p) {
  if (!p.inv || typeof p.inv !== 'object') p.inv = { bought: 0, items: {} };
  if (!p.inv.items || typeof p.inv.items !== 'object') p.inv.items = {};
  if (p.inv.bought == null) {   // 구버전(절대 slots 저장) 1회 이관
    p.inv.bought = Math.max(0, (p.inv.slots || CONFIG.invSlots) - CONFIG.invSlots);
    delete p.inv.slots;
  }
  return p.inv;
}
function invSlots(p) { return Math.min(CONFIG.invSlotsMax, CONFIG.invSlots + ensureInv(p).bought); }
function itemCount(p, id) { return ensureInv(p).items[id] || 0; }
// 한 종류가 몇 칸을 먹는지 — CONFIG.invStackMax(999)개마다 한 칸.
function slotsFor(count) { return Math.ceil(count / CONFIG.invStackMax); }
function usedSlots(p) { const it = ensureInv(p).items; let n = 0; for (const k in it) if (it[k] > 0) n += slotsFor(it[k]); return n; }
// 지금 더 받을 수 있는 최대 개수 = 마지막 칸의 남은 자리 + 빈 칸 × invStackMax
function freeSpace(p, id) {
  const inv = ensureInv(p);
  const cur = inv.items[id] || 0;
  const tailRoom = cur > 0 ? slotsFor(cur) * CONFIG.invStackMax - cur : 0;
  const freeSlots = Math.max(0, invSlots(p) - usedSlots(p));
  return tailRoom + freeSlots * CONFIG.invStackMax;
}
function canHold(p, id) { return freeSpace(p, id) > 0; }
// 실제로 넣은 개수를 돌려준다(자리가 모자라면 부분 지급). 0 = 전부 버려짐.
function addItem(p, id, n) {
  n = n == null ? 1 : n;
  if (!ITEMS[id] || n <= 0) return 0;
  const put = Math.min(n, freeSpace(p, id));
  if (put <= 0) return 0;
  const inv = ensureInv(p);
  inv.items[id] = (inv.items[id] || 0) + put;
  return put;
}
// 0 개가 되면 키를 지워 칸을 비운다(usedSlots 가 종류 수를 세므로).
function takeItem(p, id, n) {
  n = n == null ? 1 : n;
  const inv = ensureInv(p);
  if ((inv.items[id] || 0) < n) return false;
  inv.items[id] -= n;
  if (inv.items[id] <= 0) delete inv.items[id];
  return true;
}
/* 칸 지급 — 상한을 넘지 않게 잘라서 '실제로 늘어난 칸수' 를 돌려준다.
 * 칸은 아이템이 아니라 계정 속성이라, 인벤이 꽉 차 있어도 유실되지 않는다
 * (확장권을 아이템으로 만들면 그 확장권이 도로 한 칸을 먹는 모순이 생긴다). */
function addSlots(p, n) {
  const inv = ensureInv(p);
  const before = invSlots(p);
  inv.bought += Math.max(0, n | 0);
  const after = invSlots(p);
  if (after === before) inv.bought -= Math.max(0, n | 0);   // 상한이라 못 늘렸으면 되돌린다
  return after - before;
}
function invPackBought(p) { return !!p.invPackBought; }
function invView(p) {
  const inv = ensureInv(p);
  const used = usedSlots(p), slots = invSlots(p);
  const held = Object.keys(ITEMS).filter(k => inv.items[k] > 0);
  // 칸 단위 셀: 99개 넘는 종류는 여러 칸으로 쪼개서 내려준다
  const cells = [];
  for (const k of held) {
    let left = inv.items[k];
    while (left > 0) {
      const n = Math.min(CONFIG.invStackMax, left);
      cells.push({ id: k, emoji: ITEMS[k].emoji, name: ITEMS[k].name, kind: ITEMS[k].kind, desc: ITEMS[k].desc, count: n, total: inv.items[k] });
      left -= n;
    }
  }
  return {
    slots, used, max: CONFIG.invSlotsMax, full: used >= slots, stackMax: CONFIG.invStackMax,
    // 칸을 더 여는 경로(상점 1회 패키지 / 배틀패스 프리미엄) 안내용
    packBought: invPackBought(p), packSlots: CONFIG.invPackSlots, packPrice: CONFIG.invPackPrice,
    bpSlots: CONFIG.invBpSlots, bpLevel: CONFIG.invBpLevel,
    atMaxSlots: slots >= CONFIG.invSlotsMax,
    cells,
    items: held.map(k => ({ id: k, emoji: ITEMS[k].emoji, name: ITEMS[k].name, kind: ITEMS[k].kind, desc: ITEMS[k].desc, count: inv.items[k] })),
  };
}
// 가방 확장 패키지 — 계정당 1회, 고액 골드. 반복 구매가 아니라 '한 번 여는' 물건이다.
function buyInvPack(db, id) {
  const p = norm(db.players[id]);
  if (invPackBought(p)) return { ok: false, error: '가방 확장 패키지는 계정당 한 번만 살 수 있어요.' };
  if (invSlots(p) >= CONFIG.invSlotsMax) return { ok: false, error: '이미 최대 칸수(' + CONFIG.invSlotsMax + ')예요.' };
  if (p.gold < CONFIG.invPackPrice) {
    return { ok: false, error: '골드 부족! (필요 ' + CONFIG.invPackPrice.toLocaleString() + 'G / 보유 ' + p.gold.toLocaleString() + 'G)' };
  }
  p.gold -= CONFIG.invPackPrice;
  p.goldSpent = (p.goldSpent || 0) + CONFIG.invPackPrice;
  p.invPackBought = true;
  const got = addSlots(p, CONFIG.invPackSlots);
  addLog(db, '🎒 ' + p.nick + ' 가방 확장 패키지 구매 (+' + got + '칸)');
  return { ok: true, slots: invSlots(p), gained: got, msg: '🎒 가방이 ' + invSlots(p) + '칸으로 늘었어요! (+' + got + '칸)' };
}
// 사용형 아이템 발동. 방지권·부스트권은 자동 소모라 여기서 쓰지 않는다.
function useItem(db, id, itemId) {
  const p = norm(db.players[id]);
  const it = ITEMS[itemId];
  if (!it) return { ok: false, error: '없는 아이템이에요.' };
  if (it.kind !== 'use') return { ok: false, error: it.emoji + ' ' + it.name + '은(는) 자동으로 쓰이는 아이템이에요.' };
  if (itemCount(p, itemId) < 1) return { ok: false, error: it.name + '이(가) 없어요.' };
  if (itemId === 'dye') {
    takeItem(p, 'dye', 1);
    p.dyeCount = (p.dyeCount || 0) + 1;              // 도전과제: 염색 횟수
    const dye = rollDye();
    p.nickColor = dye;
    if (dye.kind === 'rainbow') p.gotRainbow = true; // 도전과제: 무지개 획득
    addLog(db, '🎨 ' + p.nick + ' 염색: ' + dye.name + (dye.rarity !== '기본' ? ' [' + dye.rarity + ']' : ''));
    return { ok: true, used: 'dye', dye, msg: '🎨 염색 결과: ' + dye.name + ' [' + dye.rarity + ']' };
  }
  if (itemId === 'classtkt') {
    takeItem(p, 'classtkt', 1);
    p.class = null;                                  // 재선택 필요
    if (p.party) partyLeave(db, id);                 // 파티에 있으면 나가기(직업 재선택 중)
    return { ok: true, used: 'classtkt', needReselect: true, msg: '직업을 다시 선택하세요.' };
  }
  return { ok: false, error: '아직 쓸 수 없는 아이템이에요.' };
}

/* ---------- 몬스터 (사냥) ----------
 * 희귀도(일반~신화)가 난이도를 결정한다. 몬스터 체력은 내 레벨(=예상 데미지)에
 * 비례하므로, 무기 강화 수치와 무관하게 "희귀할수록 어렵다"가 유지된다.
 * 무기가 강해질수록 희귀 몬스터가 점점 자주 출몰한다. */
const RARITIES = [
  { name: '일반', hpMult: 0.55, gpp: 1.2, mons: [['🐀', '들쥐'], ['🟩', '슬라임'], ['🦇', '박쥐'], ['🐛', '애벌레'], ['🐸', '두꺼비'], ['🕷️', '거미'], ['🐌', '달팽이'], ['🐜', '일개미']] },
  { name: '희귀', hpMult: 1.00, gpp: 1.8, mons: [['🐺', '늑대'], ['🐗', '멧돼지'], ['👹', '오크'], ['🐻', '곰'], ['🦂', '전갈'], ['🦎', '도마뱀'], ['🐍', '독사'], ['🦅', '하피']] },
  { name: '에픽', hpMult: 1.35, gpp: 2.6, mons: [['🗿', '골렘'], ['🧌', '트롤'], ['🐂', '미노타우로스'], ['🦏', '코뿔괴수'], ['🐊', '악어괴물'], ['🧛', '흡혈귀'], ['👁️', '사이클롭스'], ['🕸️', '거대거미']] },
  { name: '전설', hpMult: 1.80, gpp: 3.6, mons: [['🐉', '와이번'], ['🐍', '히드라'], ['🐙', '크라켄'], ['🦁', '만티코어'], ['🦈', '리바이어던'], ['🦅', '로크']] },
  { name: '신화', hpMult: 2.35, gpp: 5.0, mons: [['🦖', '고대괴수'], ['🐲', '마룡'], ['👑', '마왕'], ['🌑', '공허의 감시자'], ['🔥', '이프리트'], ['☄️', '운석 괴수']] },
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
// danger = 타이머 동안 보스가 파티 HP(100%)에 넣는 총 피해(%). 탱커 DR·힐러 회복으로 상쇄.
// hp/danger 는 '1인 기준' 값이고 raidScale() 이 참여 인원만큼 키운다.
// reqLevel/reqAscend 를 모든 참가자가 만족해야 입장할 수 있다.
// hp 는 각 보스의 reqLevel 근처 플레이어가 15초 안에 '쉬지 않고 연타 + 스킬' 로
// 겨우 넘기는 선에 맞춰져 있다 — 대충 두들기면 못 깬다.
const BOSSES = [
  { id: 'goblin', name: '고블린 군주', emoji: '👺', tier: '입문',   hp: 2000,  atk: 130,  reward: 5000,   dropChance: 0.10, danger: 60,  essence: 1, reqLevel: 0,  reqAscend: 0 },
  { id: 'golem',  name: '스톤 골렘',   emoji: '🗿', tier: '보통',   hp: 20000, atk: 340,  reward: 15000,  dropChance: 0.18, danger: 80,  essence: 1, reqLevel: 30, reqAscend: 0 },
  { id: 'dragon', name: '고대 드래곤', emoji: '🐲', tier: '어려움', hp: 38000, atk: 600,  reward: 40000,  dropChance: 0.28, danger: 100, essence: 2, reqLevel: 60, reqAscend: 0 },
  { id: 'demon',  name: '마계 군주',   emoji: '😈', tier: '지옥',   hp: 60000, atk: 780,  reward: 90000,  dropChance: 0.40, danger: 115, essence: 2, reqLevel: 85, reqAscend: 0 },
  // 초월 전용 — ★ 가 있어야 입장 가능
  { id: 'titan',  name: '초월의 거인', emoji: '🌋', tier: '초월',   hp: 43000, atk: 900,  reward: 150000, dropChance: 0.45, danger: 110, essence: 3, reqLevel: 50, reqAscend: 1 },
  { id: 'void',   name: '공허의 군주', emoji: '🌌', tier: '초월',   hp: 76000, atk: 1200, reward: 300000, dropChance: 0.60, danger: 125, essence: 4, reqLevel: 80, reqAscend: 3 },
];
function bossById(id) { return BOSSES.find(b => b.id === id); }
// 참여 인원에 맞춘 난이도 스케일. 체력은 인원수보다 가파르게, 화력은 완만하게 올라간다
// (인원이 늘면 총 딜도 늘고 탱커·힐러 덕에 생존 시간까지 늘기 때문).
function raidScale(n) {
  const k = Math.max(0, n - 1);
  return { hp: 1 + k * CONFIG.raidPartyHpScale, danger: 1 + k * CONFIG.raidPartyDangerScale };
}
// 입장 조건 미달 사유. 만족하면 null.
function bossLock(p, boss) {
  if ((p.level || 0) < boss.reqLevel) return '무기 +' + boss.reqLevel + ' 이상 필요';
  if (starsOf(p) < boss.reqAscend) return '초월 ★' + boss.reqAscend + ' 이상 필요';
  return null;
}

/* ---------- 플레이어 ---------- */
function makePlayer(nick) {
  return {
    nick, class: null, element: null, nickColor: null,
    level: 0, best: 0, breaks: 0, wins: 0, losses: 0, ascend: 0,
    gold: CONFIG.startGold, pity: 0, inv: { bought: 0, items: {} },
    fightDay: '', fightsUsed: 0, huntDay: '', huntsUsed: 0, raidDay: '', raidsUsed: 0,
    attendDay: '', destroyDay: '', destroysToday: 0,
    lastMine: Date.now(), party: null, created: today(),
  };
}
function norm(p) {
  // 구버전 필드(protects/enhanceBoost) → 인벤토리로 이관 후 제거.
  // 남아 있는 값은 '덮어쓰기'가 아니라 가방에 '더해서' 합친다 — 이전 배포(구버전 코드)와
  // 새 배포가 잠시 같은 DB 를 함께 쓰는 동안 구버전이 protects 를 다시 써 넣어도
  // 다음 로드 때 가방으로 합쳐져서 아이템이 사라지지 않는다(이미 옮긴 값은 지웠으니 중복 없음).
  const inv0 = ensureInv(p);
  if (p.protects > 0) inv0.items.protect = (inv0.items.protect || 0) + p.protects;
  if (p.enhanceBoost > 0) inv0.items.boost = (inv0.items.boost || 0) + p.enhanceBoost;
  delete p.protects; delete p.enhanceBoost;
  if (p.raidDay == null) { p.raidDay = ''; p.raidsUsed = 0; }
  if (p.lastMine == null) p.lastMine = Date.now();
  if (p.party === undefined) p.party = null;
  if (p.class === undefined) p.class = null;
  if (!p.element && p.class) p.element = randomElementKey(); // 기존 데이터 보정
  if (p.nickColor === undefined) p.nickColor = null;
  if (p.pity == null) p.pity = 0;
  if (p.ascend == null) p.ascend = 0;          // 초월 별(★) — 기존 데이터 보정
  if (p.stamina == null) p.stamina = CONFIG.staminaMax;
  if (p.lastStamina == null) p.lastStamina = Date.now();
  if (p.mineLevel == null) p.mineLevel = 1;
  if (p.mineXp == null) p.mineXp = 0;
  if (p._lim === undefined) p._lim = null; // player_limits 오버라이드 (없으면 CONFIG 기본값)
  // 도전과제용 누적 카운터(단조 증가 → 칭호가 사라지지 않음)
  if (p.goldSpent == null) p.goldSpent = 0;
  if (p.goldEarned == null) p.goldEarned = 0;
  if (p.fightsTotal == null) p.fightsTotal = 0;
  if (p.mineSwings == null) p.mineSwings = 0;
  if (p.kills == null) p.kills = 0;
  if (p.raidDmg == null) p.raidDmg = 0;      // 단일 레이드 최고 기여 피해
  if (p.dyeCount == null) p.dyeCount = 0;
  if (p.gotRainbow == null) p.gotRainbow = false;
  if (!Array.isArray(p.masteredClasses)) p.masteredClasses = []; // +99 달성한 직업들
  if (p.equippedTitle === undefined) p.equippedTitle = null;     // 장착 칭호 id
  return p;
}

// 채굴장(능동): 기력 회복 계산 + 채굴 레벨 진행
function currentStamina(p) {
  const regen = (Date.now() - (p.lastStamina || Date.now())) / 60000 * CONFIG.staminaRegenPerMin;
  return Math.min(CONFIG.staminaMax, (p.stamina || 0) + regen);
}
function mineXpNext(level) { return 50 + level * 45; }

/* ---------- 유저별 일일 상한 ----------
 * 기본값은 CONFIG, 유저별 예외는 player_limits 테이블 → p._lim 으로 주입된다.
 * p._lim 은 파생 데이터라 players.data JSON 에는 저장하지 않는다. */
const LIMIT_KEYS = ['dailyFights', 'dailyHunts', 'dailyRaids'];
function limitOf(p, key) {
  const v = p && p._lim ? p._lim[key] : null;
  return v == null ? CONFIG[key] : v;
}
// patch 의 값이 null/'' 이면 해당 상한 해제(=CONFIG 기본값으로 복귀). 적용된 오버라이드를 반환.
function setLimits(p, patch) {
  const lim = Object.assign({}, p._lim || {});
  for (const k of LIMIT_KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v == null || v === '') { delete lim[k]; continue; }
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 0) return { ok: false, error: k + ' 은(는) 0 이상의 정수여야 합니다.' };
    lim[k] = n;
  }
  p._lim = Object.keys(lim).length ? lim : null;
  return { ok: true, limits: p._lim };
}

/* ---------- 일일 카운터 ----------
 * 저장 계층이 player_daily 테이블로 분리 영속화한다. players.data JSON 에는 넣지 않는다. */
const DAILY_FIELDS = ['fightDay', 'fightsUsed', 'huntDay', 'huntsUsed', 'raidDay', 'raidsUsed', 'attendDay', 'destroyDay', 'destroysToday'];
// 메모리 플레이어 → 오늘자 사용량 (날짜가 어제면 0 으로 떨어뜨린다)
function dailyUsage(p) {
  const t = today();
  return {
    hunts:    p.huntDay    === t ? (p.huntsUsed     || 0) : 0,
    fights:   p.fightDay   === t ? (p.fightsUsed    || 0) : 0,
    raids:    p.raidDay    === t ? (p.raidsUsed     || 0) : 0,
    destroys: p.destroyDay === t ? (p.destroysToday || 0) : 0,
    attended: p.attendDay  === t ? 1 : 0,
  };
}
// player_daily 오늘자 행 → 메모리 플레이어 (행이 없으면 전부 리셋 상태)
function applyDaily(p, row) {
  const t = today();
  p.huntDay = ''; p.huntsUsed = 0;
  p.fightDay = ''; p.fightsUsed = 0;
  p.raidDay = ''; p.raidsUsed = 0;
  p.destroyDay = ''; p.destroysToday = 0;
  p.attendDay = '';
  if (!row) return p;
  if (row.hunts_used > 0) { p.huntDay = t; p.huntsUsed = row.hunts_used; }
  if (row.fights_used > 0) { p.fightDay = t; p.fightsUsed = row.fights_used; }
  if (row.raids_used > 0) { p.raidDay = t; p.raidsUsed = row.raids_used; }
  if (row.destroys > 0) { p.destroyDay = t; p.destroysToday = row.destroys; }
  if (row.attended) p.attendDay = t;
  return p;
}

function fightsLeft(p) { const L = limitOf(p, 'dailyFights'); return p.fightDay !== today() ? L : Math.max(0, L - p.fightsUsed); }
function huntsLeft(p) { const L = limitOf(p, 'dailyHunts'); return p.huntDay !== today() ? L : Math.max(0, L - p.huntsUsed); }
function raidsLeft(p) { const L = limitOf(p, 'dailyRaids'); return p.raidDay !== today() ? L : Math.max(0, L - p.raidsUsed); }
function winRate(p) { const t = p.wins + p.losses; return t === 0 ? null : Math.round(p.wins / t * 100); }
function pendingMine(p) { return Math.min(CONFIG.mineCap, Math.floor((Date.now() - p.lastMine) / 60000 * CONFIG.mineRate)); }

function publicView(db, id) {
  const p = norm(db.players[id]);
  const g = grade(p.level);
  const c = classOf(p);
  const em = elementOf(p.element);
  let od = odds(p.level, p.ascend);
  if (itemCount(p, 'boost') > 0) { const s = Math.min(0.97, od.success * CONFIG.boostMult); od = { success: s, destroy: od.destroy, fail: Math.max(0, 1 - s - od.destroy) }; }
  let party = null;
  if (p.party && db.parties[p.party]) {
    const pt = db.parties[p.party];
    party = { id: pt.id, leaderNick: db.players[pt.leader] ? db.players[pt.leader].nick : '?', count: pt.members.length };
  }
  return {
    ts: Date.now(),   // 응답 생성 시각 — 클라가 더 오래된 스냅샷을 버리는 데 사용(숫자 깜빡임 방지)
    nick: p.nick,
    email: p.email || null, linked: !!p.authUid,   // 이메일 계정 연결 여부(게스트=false)
    class: p.class, className: c.name, classEmoji: c.emoji, weaponBase: c.weapon,
    level: p.level, best: p.best, breaks: p.breaks,
    wins: p.wins, losses: p.losses, winRate: winRate(p),
    gold: p.gold, protects: itemCount(p, 'protect'),   // 인벤토리에서 파생 — 표시 전용
    weapon: weaponName(p.level, p.class, p.ascend),
    grade: { name: g.name, key: g.key, emoji: g.emoji, color: g.color },
    element: p.element, elementName: em.name, elementEmoji: em.emoji, elementColor: em.color,
    titles: earnedTitles(p).map(t => ({ id: t.id, title: t.title, grade: t.grade, color: t.color })),
    equippedTitle: equippedTitleView(p),
    // 프로필 칭호 진열장: 획득한 건 이름 노출, 미획득은 잠금(이름·조건 비공개)
    titleRoster: ACHIEVEMENTS.map(a => {
      const got = a.check(p);
      return got
        ? { id: a.id, title: a.title, grade: a.grade, color: TITLE_GRADES[a.grade].color, earned: true }
        : { grade: a.grade, color: TITLE_GRADES[a.grade].color, earned: false };
    }).sort((x, y) => TITLE_GRADES[y.grade].rank - TITLE_GRADES[x.grade].rank || (y.earned === x.earned ? 0 : y.earned ? 1 : -1)),
    titleTotal: ACHIEVEMENTS.length, titleEarned: earnedTitles(p).length,
    maxLevel: CONFIG.maxLevel,
    nextCost: p.level >= CONFIG.maxLevel ? null : enhanceCost(p.level, p.ascend),
    // 초월 — ★, 승급 재료 진행도, 방지권이 아직 통하는지(★1+ 는 무효)
    ascend: starsOf(p), atMax: p.level >= CONFIG.maxLevel, protectWorks: protectWorks(p),
    canAscend: p.level >= CONFIG.maxLevel && ascendReady(p),
    ascendNext: ascendProgress(p),
    ascendBonus: { gold: starsOf(p) * CONFIG.ascendGoldBonus, atk: starsOf(p) * CONFIG.ascendAtkBonus, cost: starsOf(p) * CONFIG.ascendCostMult, succ: 1 - ascendSuccMult(p) },
    odds: od, enhanceBoost: itemCount(p, 'boost'), pity: p.pity || 0, nickColor: p.nickColor || null,
    inv: invView(p), protectBuyLeft: protectBuyLeft(p), protectDailyBuy: CONFIG.protectDailyBuy,
    huntsLeft: huntsLeft(p), dailyHunts: limitOf(p, 'dailyHunts'),
    fightsLeft: fightsLeft(p), dailyFights: limitOf(p, 'dailyFights'),
    raidsLeft: raidsLeft(p), dailyRaids: limitOf(p, 'dailyRaids'),
    limitOverride: p._lim || null,
    mine: pendingMine(p), mineCap: CONFIG.mineCap,
    stamina: Math.floor(currentStamina(p)), staminaMax: CONFIG.staminaMax,
    mineLevel: p.mineLevel, mineXp: p.mineXp, mineXpNext: mineXpNext(p.mineLevel),
    party,
    invites: myInvites(db, id),
    rank: enhanceRank(db, id),
    missionAlert: missionAlert(p),   // 미션·패스에서 받을 수 있는 보상 개수(빨간점)
  };
}

// n = 단조 증가 시퀀스. 저장 계층이 '아직 기록하지 않은 로그'만 append 하는 데 쓴다.
function addLog(db, text) {
  db.logSeq = (db.logSeq || 0) + 1;
  db.log.push({ t: Date.now(), n: db.logSeq, text });
  if (db.log.length > 60) db.log.shift();
}

/* 강화 랭킹은 /api/me 마다 호출된다 — 매번 전체 정렬하면 O(P log P) × 요청수.
 * 결과를 캐시하고, 레벨이 바뀌는 지점에서만 무효화한다(TTL 은 누락 대비 백스톱). */
const RANK_TTL = 2000;
function bumpRank(db) { db._rank = null; }
function enhanceRank(db, id) {
  let c = db._rank;
  if (!c || Date.now() - c.t > RANK_TTL) {
    const ks = Object.keys(db.players);
    ks.sort((a, b) => starsOf(db.players[b]) - starsOf(db.players[a]) || db.players[b].level - db.players[a].level || db.players[b].best - db.players[a].best);
    c = db._rank = { t: Date.now(), map: new Map(ks.map((k, i) => [k, i + 1])) };
  }
  return { rank: c.map.get(id) || null, total: c.map.size };
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
  indexNick(db, nick, key);
  bumpRank(db); // 총원 변동
  return { ok: true, id: key, isNew: true, needClass: true };
}
// 게스트(PIN) 캐릭터를 Supabase Auth 계정(uid+email)에 연결 = '계정 만들기'.
// 이후 다른 기기에서 이메일 로그인하면 authLogin 이 이 캐릭터를 복원한다.
function authLink(db, playerId, uid, email) {
  const p = db.players[playerId];
  if (!p) return { ok: false, error: '캐릭터를 찾을 수 없어요.' };
  const owner = findByAuthUid(db, uid);
  if (owner && owner !== playerId) return { ok: false, error: '이 이메일은 이미 다른 캐릭터에 연결돼 있어요.' };
  if (p.authUid && p.authUid !== uid) return { ok: false, error: '이 캐릭터는 이미 다른 이메일에 연결돼 있어요.' };
  const already = !!p.authUid;
  p.authUid = uid;
  p.email = (email || '').trim().toLowerCase() || null;
  if (!already) addLog(db, '🔗 ' + p.nick + ' 님이 이메일 계정을 연결했어요.');
  return { ok: true, id: playerId, linked: true };
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
  unindexNick(db, old); indexNick(db, newNick, id);
  addLog(db, '✏️ ' + old + ' → ' + newNick + ' 닉네임 변경');
  return { ok: true, msg: '닉네임을 ' + newNick + '(으)로 변경했어요.' };
}

/* ---------- 액션 ---------- */
function enhance(db, id) {
  const p = norm(db.players[id]);
  if (p.level >= CONFIG.maxLevel) return { ok: false, error: '이미 만렙(+' + CONFIG.maxLevel + ')! 🌈 초월로 새 회차를 시작하세요.' };
  const cost = enhanceCost(p.level, p.ascend);
  if (p.gold < cost) return { ok: false, error: '골드 부족! (필요 ' + cost + ' / 보유 ' + p.gold + ')' };
  p.gold -= cost;
  p.goldSpent = (p.goldSpent || 0) + cost;   // 도전과제: 누적 소모 골드
  bumpMstat(p, 'enh');                        // 미션: 강화 시도
  const before = p.level;
  const base = odds(before, p.ascend);

  // 장인의 기운 100% → 확정 성공 (부스트·확률 무시, 소모 없음)
  if (p.pity >= 1) {
    const gain = successGain(before);
    p.level = Math.min(CONFIG.maxLevel, before + gain);
    if (p.level > p.best) p.best = p.level;
    markMastery(p);
    bumpMstat(p, 'enhWin');                   // 미션: 강화 성공
    p.pity = 0;
    bumpRank(db);
    addLog(db, '🔨 ' + p.nick + ' 장인의 기운 확정성공 +' + before + '→+' + p.level);
    return { ok: true, result: 'success', guaranteed: true, cost, boosted: false, boostLeft: itemCount(p, 'boost'), pity: 0, msg: '🔨 장인의 기운 100%! 확정 성공!  +' + before + ' → +' + p.level };
  }

  // 강화 부스트권(성공률 +)
  let o = base, boosted = false;
  if (itemCount(p, 'boost') > 0) {
    const s = Math.min(0.97, base.success * CONFIG.boostMult);
    o = { success: s, destroy: base.destroy, fail: Math.max(0, 1 - s - base.destroy) };
    takeItem(p, 'boost', 1);
    boosted = true;
  }

  // 장인의 기운 상승폭 — 부스트권 사용 시 더 크게 오른다(성공률↑ + 실패해도 pity 빨리 참)
  const pg = pityGain(o.success, p.ascend) * (boosted ? CONFIG.boostPityMult : 1);
  const r = Math.random();
  let result, msg;
  if (r < o.success) {
    const gain = successGain(before);
    p.level = Math.min(CONFIG.maxLevel, before + gain);
    if (p.level > p.best) p.best = p.level;
    markMastery(p);
    bumpMstat(p, 'enhWin');                   // 미션: 강화 성공
    p.pity = 0;
    bumpRank(db);
    result = 'success';
    msg = (gain > 1 ? '💫 대성공! +' + gain + '  ' : '강화 성공! ') + '+' + before + ' → +' + p.level;
    addLog(db, '✅ ' + p.nick + ' +' + before + '→+' + p.level + (gain > 1 ? ' (+' + gain + ')' : ''));
  } else if (r < o.success + o.destroy) {
    if (protectWorks(p) && takeItem(p, 'protect', 1)) {
      result = 'protected';
      p.pity = Math.min(1, p.pity + pg); // 방지도 시도로 치고 기운 상승
      msg = '🛡️ 파괴 방지 발동! +' + before + ' 유지 (남은 방지권 ' + itemCount(p, 'protect') + ')';
      addLog(db, '🛡️ ' + p.nick + ' +' + before + ' 파괴방지');
    } else {
      const floor = destroyFloor(before);   // 한 등급 아래 시작 레벨로 강등(안전선)
      p.level = floor; p.breaks++; p.pity = 0; // 파괴 = 강등 · 장인의 기운 초기화
      bumpRank(db);                         // 레벨이 바뀌었으니 랭킹 캐시 무효화
      if (p.destroyDay !== today()) { p.destroyDay = today(); p.destroysToday = 0; }
      p.destroysToday++;
      result = 'destroy';
      if (floor === 0) {
        // +0으로 떨어지는 진짜 파괴 → 속성 재부여
        const newElem = randomElementKey(); p.element = newElem;
        msg = '💥 무기 완전 파괴!! +' + before + ' → +0 (초기화 · 장인의 기운 리셋)' +
          '\n새 속성: ' + elementOf(newElem).emoji + ' ' + elementOf(newElem).name;
        addLog(db, '💥 ' + p.nick + ' +' + before + ' 무기 완전 파괴 → +0 (새속성 ' + elementOf(newElem).name + ')');
      } else {
        // 등급 강등(속성 유지)
        const gname = grade(floor).name;
        msg = '💥 무기 파괴! +' + before + ' → +' + floor + ' (' + gname + ' 등급으로 강등 · 속성 유지)';
        addLog(db, '💥 ' + p.nick + ' +' + before + ' 무기 파괴 → +' + floor + ' (' + gname + ' 강등)');
      }
    }
  } else {
    // 실패 = 유지 + 장인의 기운 상승
    p.pity = Math.min(1, p.pity + pg);
    result = 'fail';
    msg = '❌ 실패... +' + before + ' 유지 · 🔨 장인의 기운 ' + Math.round(p.pity * 100) + '%';
  }
  return { ok: true, result, msg, cost, boosted, boostLeft: itemCount(p, 'boost'), pity: p.pity };
}
/* 초월 실행 — +99 에서만. 무기를 +0 으로 되돌리고 ★을 하나 얻는다.
 * 골드·방지권·부스트·칭호·최고기록(best)·채굴 레벨은 전부 유지된다. */
function ascend(db, id) {
  const p = norm(db.players[id]);
  if (p.level < CONFIG.maxLevel) {
    return { ok: false, error: '+' + CONFIG.maxLevel + ' 만렙에서만 초월할 수 있어요. (현재 +' + p.level + ')' };
  }
  const to = starsOf(p) + 1;
  const req = ascendReq(to);
  const have = { shard: itemCount(p, 'shard'), essence: itemCount(p, 'essence') };
  if (have.shard < req.shard || have.essence < req.essence) {
    return {
      ok: false, req, have,
      error: '재료가 부족해요 — ' + ITEMS.shard.emoji + ' ' + have.shard + '/' + req.shard +
        ' · ' + ITEMS.essence.emoji + ' ' + have.essence + '/' + req.essence +
        ' (파편은 사냥, 정수는 레이드에서 나와요)',
    };
  }
  takeItem(p, 'shard', req.shard);
  takeItem(p, 'essence', req.essence);
  markMastery(p);                          // 현재 직업을 '달인' 으로 확정 기록
  p.ascend = to;
  p.level = 0;
  p.pity = 0;
  p.element = randomElementKey();          // 새 회차 = 새 속성
  bumpRank(db);
  const em = elementOf(p.element);
  addLog(db, '🌈 ' + p.nick + ' 초월! ★' + to + ' — 무기가 +0 으로 돌아갔습니다 (새속성 ' + em.name + ')');
  return {
    ok: true, ascend: to, element: p.element, spent: req,
    msg: '🌈 초월 ★' + to + ' 달성!\n무기 +0 · 새 속성 ' + em.emoji + ' ' + em.name +
      '\n영구 보너스 — 골드 +' + Math.round(to * CONFIG.ascendGoldBonus * 100) + '% · 레이드 공격 +' + Math.round(to * CONFIG.ascendAtkBonus * 100) + '%' +
      '\n⚠️ 이제부터 🛡️ 파괴방지권은 통하지 않습니다.',
  };
}
function attend(db, id) {
  const p = norm(db.players[id]);
  if (p.attendDay === today()) return { ok: false, error: '오늘은 이미 출석했어요!' };
  p.attendDay = today();
  bumpMstat(p, 'attend');                     // 미션: 출석
  const gained = gainGold(p, CONFIG.attendGold);
  return { ok: true, gained, msg: '출석 완료! +' + gained + 'G' };
}
function mine(db, id) {
  const p = norm(db.players[id]);
  const pending = pendingMine(p);
  if (pending <= 0) return { ok: false, error: '아직 채굴된 골드가 없어요. 시간이 지나면 쌓여요.' };
  p.lastMine = Date.now();
  const amount = gainGold(p, pending);
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
      const got = addItem(p, 'protect', 1);
      gem = got ? { type: 'protect', text: '💎 보석 원석 발견 → 🛡️ 방지권 1개!' }
                : { type: 'full', text: '💎 원석을 찾았지만 🎒 인벤토리가 꽉 찼어요!' };
      if (got) addLog(db, '💎 ' + p.nick + ' 채굴장에서 방지권 원석 발견!');
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
  gold = gainGold(p, gold);                        // 초월 보너스 적용 후 실지급액
  p.mineSwings = (p.mineSwings || 0) + 1;          // 도전과제: 곡괭이질 횟수
  bumpMstat(p, 'mine');                            // 미션: 채굴
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
  // 일일 사냥(20회)은 풀보상 + 희귀 드랍. 소진 후엔 '무한 사냥'(보상↓·가끔 채광 물약)으로 계속 가능
  const overtime = p.huntsUsed >= limitOf(p, 'dailyHunts');
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
  gold = gainGold(p, gold);        // 초월 보너스 적용 후 실지급액
  p.kills = (p.kills || 0) + 1;   // 도전과제: 사냥 1회 = 몬스터 1마리 처치(탭 UI에선 항상 잡음)
  bumpMstat(p, 'hunt');           // 미션: 사냥
  // 희귀할수록(=tier↑) 드랍 확률 상승. 무한 사냥은 아이템 대신 가끔 '채광 물약'(채굴 기력 회복)
  let drop = null, mat = null;
  if (!overtime) {
    const pc = CONFIG.dropProtectChance * (1 + m.tier * 0.35);
    const gc = CONFIG.dropGoldChance * (1 + m.tier * 0.2);
    if (Math.random() < pc) {
      const got = addItem(p, 'protect', 1);
      drop = got ? { type: 'protect', text: '🛡️ 파괴방지권 1개!' } : { type: 'full', text: '🎒 인벤토리가 꽉 차 방지권을 놓쳤어요!' };
      if (got) addLog(db, '🎁 ' + p.nick + ' [' + m.name + ']에게서 방지권 드랍!');
    }
    else if (Math.random() < gc) { const bonus = gainGold(p, Math.round(randInt(200, 600) * m.gpp)); drop = { type: 'gold', amount: bonus, text: '💰 골드뭉치 +' + bonus }; }
    // 💠 초월의 파편 — 방지권/골드뭉치와 배타가 아닌 별도 축(초월 승급 재료)
    if (Math.random() < CONFIG.huntShardChance) {
      const n = 1 + m.tier;                      // 일반 1개 … 신화 5개
      const got = addItem(p, 'shard', n);
      mat = got ? { type: 'shard', amount: got, text: ITEMS.shard.emoji + ' ' + ITEMS.shard.name + ' +' + got }
                : { type: 'full', text: '🎒 인벤토리가 꽉 차 파편을 놓쳤어요!' };
    }
    addLog(db, '🗡️ ' + p.nick + ' ' + m.emoji + '[' + m.name + '](' + m.rarity + ') ' + (slain ? '처치' : '사냥') + ' +' + gold + 'G');
  } else {
    // 무한 사냥: 기력에 여유가 있을 때만 채광 물약(꽉 차 있으면 낭비 안 함)
    const st = currentStamina(p);
    if (st < CONFIG.staminaMax && Math.random() < CONFIG.huntPotionChance) {
      const ns = Math.min(CONFIG.staminaMax, st + CONFIG.huntPotionStamina);
      p.stamina = ns; p.lastStamina = Date.now();
      drop = { type: 'potion', stamina: Math.round(ns - st), text: '⛏️ 채광 물약! 채굴 기력 +' + Math.round(ns - st) };
    }
  }
  return { ok: true, monster: { name: m.name, emoji: m.emoji, hp: m.hp, rarity: m.rarity, tier: m.tier }, dmg, dealt, slain, crit, gold, drop, mat, overtime };
}
// 방지권 상점 구매는 하루 CONFIG.protectDailyBuy 개까지. 나머지는 사냥 드랍으로 얻는다.
// 날짜 필드는 players.data JSON 에 남아 '읽을 때 지연 리셋' 된다(일일 사냥과 같은 방식).
function protectBuyLeft(p) {
  return p.protectBuyDay === today() ? Math.max(0, CONFIG.protectDailyBuy - (p.protectBuyUsed || 0)) : CONFIG.protectDailyBuy;
}
function buyProtect(db, id, qty) {
  const p = norm(db.players[id]);
  // 초월 회차에는 효과가 없는 물건이라 아예 팔지 않는다(골드만 태우는 걸 막는다).
  if (!protectWorks(p)) return { ok: false, error: '초월 ★' + starsOf(p) + ' 이후에는 파괴방지권이 통하지 않아요.' };
  qty = parseInt(qty, 10); if (isNaN(qty) || qty < 1) qty = 1;
  const left = protectBuyLeft(p);
  if (left <= 0) return { ok: false, error: '🛡️ 방지권은 하루 ' + CONFIG.protectDailyBuy + '개까지만 살 수 있어요. 나머지는 🗡️사냥에서 얻으세요.' };
  if (qty > left) return { ok: false, error: '오늘 남은 구매 가능 개수는 ' + left + '개예요. (하루 ' + CONFIG.protectDailyBuy + '개 제한)' };
  const r = buyIntoInv(p, 'protect', qty, CONFIG.protectPrice * qty);
  if (!r.ok) return r;
  if (p.protectBuyDay !== today()) { p.protectBuyDay = today(); p.protectBuyUsed = 0; }
  p.protectBuyUsed += qty;
  r.buyLeft = protectBuyLeft(p);
  r.msg += ' (오늘 남은 구매 ' + r.buyLeft + '개)';
  return r;
}
function buyBoost(db, id) {
  return buyIntoInv(norm(db.players[id]), 'boost', CONFIG.boostCount, CONFIG.boostPrice);
}
function buyDye(db, id) {
  return buyIntoInv(norm(db.players[id]), 'dye', 1, CONFIG.dyePrice);
}
function buyClassChange(db, id) {
  return buyIntoInv(norm(db.players[id]), 'classtkt', 1, CONFIG.classChangePrice);
}
function fight(db, id, targetNick) {
  targetNick = (targetNick || '').trim();
  const targetId = findByNick(db, targetNick);
  if (!targetId) return { ok: false, error: '"' + targetNick + '" 님을 찾을 수 없어요.' };
  if (targetId === id) return { ok: false, error: '자기 자신과는 싸울 수 없어요.' };
  const atk = norm(db.players[id]);
  const def = norm(db.players[targetId]);
  if (atk.fightDay !== today()) { atk.fightDay = today(); atk.fightsUsed = 0; }
  if (atk.fightsUsed >= limitOf(atk, 'dailyFights')) return { ok: false, error: '오늘 싸움 횟수를 다 썼어요!' };
  atk.fightsUsed++;
  atk.fightsTotal = (atk.fightsTotal || 0) + 1;    // 도전과제: 싸움 도전 횟수(광견)
  let pWin = 0.5 + (atk.level - def.level) * 0.05;
  pWin = Math.max(0.1, Math.min(0.9, pWin));
  const atkWin = Math.random() < pWin;
  bumpMstat(atk, 'fight'); if (atkWin) bumpMstat(atk, 'fightWin');   // 미션: 싸움/승리
  const winP = atkWin ? atk : def, loseP = atkWin ? def : atk;
  const winner = atkWin ? atk.nick : def.nick, loser = atkWin ? def.nick : atk.nick;
  winP.wins++; loseP.losses++;
  const steal = Math.floor(loseP.gold * CONFIG.stealPct);
  loseP.gold -= steal;
  gainGold(winP, steal, true);   // 약탈 = 이전이라 초월 배수 미적용(골드 총량 보존)
  let broke = null;
  if (loseP.level > 0 && Math.random() < CONFIG.fightBreakChance) {
    const b = loseP.level; loseP.level--; broke = { who: loser, from: b, to: loseP.level };
    bumpRank(db);
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
// 폴링용(GET, 읽기전용): 저장 상태로부터 '지금 시점' 을 투영해 보여준다. 저장은 하지 않는다.
function raidState(db, id) {
  const p = norm(db.players[id]);
  if (!p.party || !db.parties[p.party]) return { ok: true, raid: null };
  return { ok: true, raid: raidProject(db.parties[p.party].raid) };
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

/* ---------- 인터랙티브 레이드(연타 전투) ----------
 * 공유 전투: 파티원이 15초간 보스를 함께 연타(연타=딜). 보스는 타이머 내 랜덤 횟수로 파티를 강타.
 * 탱커=피해감소, 힐러=파티 HP 회복 → 파티 HP 0이면 전멸. 스킬 1회씩.
 * 서버리스라 백그라운드 타이머 없이 요청마다 raidTick 으로 시계를 진행(결정적 스케줄).
 *   raidStart  파티장 시작(공격 스케줄 확정)
 *   raidHit    누적 타수 제출 → 딜(쓰기 경로에서 tick+저장)
 *   raidSkill  직업 스킬 1회
 *   raidFinish 종료 확정(타임아웃·전멸 등, 클라가 종료 감지 시 1회 호출)
 *   raidState  폴링(GET, 읽기전용 투영) — raidProject */
function raidStart(db, id, bossId) {
  const p = norm(db.players[id]);
  if (!p.party) return { ok: false, error: '먼저 파티를 만들거나 참가하세요.' };
  const pt = db.parties[p.party];
  if (!pt) { p.party = null; return { ok: false, error: '파티 정보를 찾을 수 없어요.' }; }
  if (pt.leader !== id) return { ok: false, error: '파티장만 레이드를 시작할 수 있어요.' };
  if (pt.raid && pt.raid.status === 'active' && Date.now() - pt.raid.startTs < CONFIG.raidDuration + 5000)
    return { ok: false, error: '이미 전투가 진행 중이에요.' };
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
  // 입장 조건은 참가자 전원이 만족해야 한다(한 명이라도 미달이면 시작 불가)
  const blocked = participants.map(k => ({ nick: db.players[k].nick, why: bossLock(db.players[k], boss) })).filter(x => x.why);
  if (blocked.length) {
    return { ok: false, error: boss.emoji + ' ' + boss.name + ' 입장 조건 미달 — ' + blocked.map(b => b.nick + '(' + b.why + ')').join(', ') };
  }
  // 레이드 횟수는 '성공했을 때만' 차감한다(raidResolve). 실패하면 보상도 없고 횟수도 안 깎인다.
  // 파티 집계: 탱커 피해감소, 힐러 회복
  let dr = 0, healPct = 0;
  participants.forEach(k => {
    const mp = db.players[k], s = memberStats(mp);
    dr += s.dr;
    if (mp.class === 'healer') healPct += CONFIG.raidHealPctPerHealer;
  });
  dr = Math.min(CONFIG.raidDRCap, dr);
  // 인원 스케일 — 체력·화력·보상을 참여 인원에 맞춰 키운다
  const sc = raidScale(participants.length);
  const bossHp = Math.round(boss.hp * sc.hp);
  const bossDanger = boss.danger * sc.danger;
  const bossReward = Math.round(boss.reward * sc.hp);
  // 보스 공격 스케줄(결정적): N회, 랜덤 시각, 총 danger% 를 균등 배분
  const N = randInt(CONFIG.raidBossAttMin, CONFIG.raidBossAttMax);
  const times = [];
  for (let i = 0; i < N; i++) times.push(randInt(1000, CONFIG.raidDuration - 600));
  times.sort((a, b) => a - b);
  const attacks = times.map(t => ({ t, pct: bossDanger / N, applied: false }));
  const parts = participants.map(k => {
    const mp = db.players[k];
    return { id: k, nick: mp.nick, class: mp.class, level: mp.level, classEmoji: classOf(mp).emoji };
  });
  const now = Date.now();
  pt.raid = {
    status: 'active', startTs: now, lastTick: now, duration: CONFIG.raidDuration,
    boss: { id: boss.id, name: boss.name, emoji: boss.emoji, hp: bossHp, atk: boss.atk, reward: bossReward, dropChance: boss.dropChance, essence: boss.essence },
    scale: { members: participants.length, hp: sc.hp, danger: sc.danger },
    bossHP: bossHp, partyHP: 100, dr, drBase: dr, healPct, attacks, participants: parts,
    contrib: {}, hits: {}, skillUsed: {}, events: [{ t: 0, text: '⚔️ 전투 시작!' }], win: null, rewards: [], topContributor: null,
  };
  parts.forEach(m => { pt.raid.contrib[m.nick] = 0; pt.raid.hits[m.nick] = 0; pt.raid.skillUsed[m.nick] = false; });
  addLog(db, '⚔️ ' + p.nick + ' 파티가 ' + boss.emoji + '[' + boss.name + '] 레이드 시작! (' + parts.length + '명)');
  return { ok: true, raid: raidView(pt.raid) };
}
// 시계 진행(쓰기 경로에서만 호출) — 보스 공격·힐 적용 후 종료면 결산
function raidTick(db, pt) {
  const raid = pt && pt.raid;
  if (!raid || raid.status !== 'active') return;
  const now = Date.now();
  const elapsed = now - raid.startTs;
  const dt = Math.max(0, now - raid.lastTick) / 1000;
  raid.lastTick = now;
  if (raid.healPct > 0 && raid.partyHP > 0) raid.partyHP = Math.min(100, raid.partyHP + raid.healPct * dt);
  for (const a of raid.attacks) {
    if (!a.applied && elapsed >= a.t) {
      a.applied = true;
      const net = a.pct * (1 - raid.dr);
      raid.partyHP = Math.max(0, raid.partyHP - net);
      raid.events.push({ t: a.t, text: '💥 보스 공격! 파티 HP -' + Math.round(net) + '%' });
    }
  }
  if (raid.bossHP <= 0) return raidResolve(db, pt, true);
  if (raid.partyHP <= 0) return raidResolve(db, pt, false);
  if (elapsed >= raid.duration) {
    for (const a of raid.attacks) if (!a.applied) { a.applied = true; raid.partyHP = Math.max(0, raid.partyHP - a.pct * (1 - raid.dr)); }
    return raidResolve(db, pt, raid.bossHP <= 0);
  }
}
function raidResolve(db, pt, win) {
  const raid = pt.raid;
  if (!raid || raid.status === 'done') return;
  raid.status = 'done'; raid.win = !!win; raid.endTs = Date.now();
  const boss = raid.boss, rewards = [];
  raid.participants.forEach(m => {
    const mp = db.players[m.id]; if (!mp) return;
    const c = Math.round(raid.contrib[m.nick] || 0);
    if (c > (mp.raidDmg || 0)) mp.raidDmg = c;   // 도전과제: 개인 기여 피해 최고치
  });
  if (win) {
    const each = Math.floor(boss.reward / raid.participants.length);
    raid.participants.forEach(m => {
      const mp = db.players[m.id]; if (!mp) return;
      // 레이드 횟수는 성공했을 때만 차감한다(실패는 보상도 차감도 없음)
      if (mp.raidDay !== today()) { mp.raidDay = today(); mp.raidsUsed = 0; }
      mp.raidsUsed++;
      bumpMstat(mp, 'raid');                       // 미션: 레이드 성공
      const got = gainGold(mp, each);
      let drop = null;
      if (Math.random() < boss.dropChance) drop = addItem(mp, 'protect', 1) ? '🛡️ 방지권' : null;
      // 🌟 초월의 정수 — 레이드 성공 시 참가자 전원 확정 지급(인벤이 꽉 차면 놓친다)
      const want = boss.essence || CONFIG.raidEssence;
      const ess = addItem(mp, 'essence', want);
      rewards.push({ nick: mp.nick, gold: got, drop, essence: ess, invFull: ess < want });
    });
    addLog(db, '🏆 ' + boss.emoji + '[' + boss.name + '] 레이드 성공! (' + raid.participants.length + '명)');
  } else {
    addLog(db, '☠️ ' + boss.emoji + '[' + boss.name + '] 레이드 실패... (횟수 차감 없음)');
  }
  raid.rewards = rewards;
  raid.topContributor = Object.keys(raid.contrib).sort((a, b) => raid.contrib[b] - raid.contrib[a])[0] || null;
}
function raidMember(db, id) {
  const p = norm(db.players[id]);
  const pt = p.party && db.parties[p.party];
  return { p, pt, raid: pt && pt.raid };
}
function raidHit(db, id, hits) {
  const { p, pt, raid } = raidMember(db, id);
  if (!raid) return { ok: false, error: '진행 중인 레이드가 없어요.' };
  raidTick(db, pt);
  if (raid.status !== 'active') return { ok: true, ended: true, raid: raidView(raid) };
  if (!(p.nick in raid.contrib)) return { ok: false, error: '이 레이드 참가자가 아니에요.' };
  hits = Math.max(0, Math.min(parseInt(hits, 10) || 0, CONFIG.raidHitBatchMax));
  // 누적 타수 상한: 경과시간으로 물리적 최대치 초과분은 버림(오토클리커 방지)
  const maxTotal = Math.floor((Date.now() - raid.startTs) / CONFIG.raidHitMsPerTap) + 12;
  if ((raid.hits[p.nick] || 0) + hits > maxTotal) hits = Math.max(0, maxTotal - (raid.hits[p.nick] || 0));
  const dmg = Math.round(hits * memberStats(p).atk * CONFIG.raidHitDmgMult);
  raid.bossHP = Math.max(0, raid.bossHP - dmg);
  raid.contrib[p.nick] = (raid.contrib[p.nick] || 0) + dmg;
  raid.hits[p.nick] = (raid.hits[p.nick] || 0) + hits;
  if (raid.bossHP <= 0) raidTick(db, pt);
  return { ok: true, dmg, raid: raidView(raid) };
}
function raidSkill(db, id) {
  const { p, pt, raid } = raidMember(db, id);
  if (!raid) return { ok: false, error: '진행 중인 레이드가 없어요.' };
  raidTick(db, pt);
  if (raid.status !== 'active') return { ok: true, ended: true, raid: raidView(raid) };
  if (!(p.nick in raid.skillUsed)) return { ok: false, error: '이 레이드 참가자가 아니에요.' };
  if (raid.skillUsed[p.nick]) return { ok: false, error: '이미 스킬을 사용했어요.' };
  raid.skillUsed[p.nick] = true;
  const s = memberStats(p);
  let text, kind;
  if (p.class === 'warrior') { const d = Math.round(s.atk * CONFIG.raidHitDmgMult * 45); raid.bossHP = Math.max(0, raid.bossHP - d); raid.contrib[p.nick] += d; text = '⚔️ ' + p.nick + ' 강타! 보스 -' + d.toLocaleString(); kind = 'dmg'; }
  else if (p.class === 'archer') { const d = Math.round(s.atk * CONFIG.raidHitDmgMult * 60); raid.bossHP = Math.max(0, raid.bossHP - d); raid.contrib[p.nick] += d; text = '🏹 ' + p.nick + ' 난사! 보스 -' + d.toLocaleString(); kind = 'dmg'; }
  else if (p.class === 'tanker') { raid.dr = Math.min(CONFIG.raidDRCapSkill, raid.dr + 0.25); raid.partyHP = Math.min(100, raid.partyHP + 10); text = '🛡️ ' + p.nick + ' 철벽! 피해감소↑ · 파티 HP +10%'; kind = 'buff'; }
  else { raid.partyHP = Math.min(100, raid.partyHP + 40); text = '✨ ' + p.nick + ' 치유의 물결! 파티 HP +40%'; kind = 'heal'; }
  raid.events.push({ t: Date.now() - raid.startTs, text });
  if (raid.bossHP <= 0) raidTick(db, pt);
  return { ok: true, skillText: text, skillKind: kind, raid: raidView(raid) };
}
function raidFinish(db, id) {
  const { pt, raid } = raidMember(db, id);
  if (!raid) return { ok: true, raid: null };
  raidTick(db, pt);   // 시계 진행 → 종료조건이면 결산·저장
  return { ok: true, raid: raidView(raid) };
}
// 저장 상태 그대로의 뷰(쓰기 응답용 — 값이 이미 확정)
function raidView(raid) {
  if (!raid) return null;
  return {
    status: raid.status, startTs: raid.startTs, duration: raid.duration,
    remain: Math.max(0, raid.duration - (Date.now() - raid.startTs)),
    boss: { id: raid.boss.id, name: raid.boss.name, emoji: raid.boss.emoji, hp: raid.boss.hp, atk: raid.boss.atk },
    bossHP: Math.round(raid.bossHP), bossMax: raid.boss.hp, partyHP: Math.round(raid.partyHP),
    dr: Math.round(raid.dr * 100), scale: raid.scale || null,
    participants: raid.participants.map(m => ({ nick: m.nick, classEmoji: m.classEmoji, class: m.class, hits: raid.hits[m.nick] || 0, contrib: Math.round(raid.contrib[m.nick] || 0), skillUsed: !!raid.skillUsed[m.nick] })),
    events: raid.events.slice(-8),
    win: raid.win, rewards: raid.rewards, topContributor: raid.topContributor,
  };
}
// 폴링용 투영(읽기전용): 저장값에서 '지금'을 계산해 보여주되 저장/난수 없음
function raidProject(raid) {
  if (!raid) return null;
  if (raid.status === 'done') return raidView(raid);
  const now = Date.now(), elapsed = now - raid.startTs;
  let php = raid.partyHP + (raid.healPct > 0 ? raid.healPct * Math.max(0, now - raid.lastTick) / 1000 : 0);
  for (const a of raid.attacks) if (!a.applied && elapsed >= a.t) php -= a.pct * (1 - raid.dr);
  php = Math.max(0, Math.min(100, php));
  const v = raidView(raid);
  v.partyHP = Math.round(php);
  v.projectedEnded = raid.bossHP <= 0 || php <= 0 || elapsed >= raid.duration;   // 클라가 보면 raid-finish 호출
  return v;
}

/* ---------- 조회 ---------- */
function profile(db, nick) {
  const k = findByNick(db, nick);
  if (!k) return { ok: false, error: '"' + nick + '" 님을 찾을 수 없어요.' };
  return { ok: true, profile: publicView(db, k) };
}
function ranking(db) {
  return Object.values(db.players).map(p => p)
    .sort((a, b) => starsOf(b) - starsOf(a) || b.level - a.level || b.best - a.best).slice(0, 20)
    .map(p => ({ nick: p.nick, level: p.level, ascend: starsOf(p), weapon: weaponName(p.level, p.class, p.ascend), classEmoji: classOf(p).emoji, wins: p.wins, losses: p.losses, nickColor: p.nickColor || null, title: equippedTitleView(p) }));
}
function goldRanking(db) {
  return Object.values(db.players).map(p => ({ nick: p.nick, gold: p.gold, nickColor: p.nickColor || null, title: equippedTitleView(p) })).sort((a, b) => b.gold - a.gold).slice(0, 20);
}
function hogu(db) {
  const t = today();
  return Object.values(db.players).map(p => ({ nick: p.nick, c: p.destroyDay === t ? p.destroysToday : 0 }))
    .filter(x => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 10);
}
function recentLog(db) { return db.log.slice(-20).reverse(); }
function playerList(db) { return Object.values(db.players).filter(p => p.class).map(p => p.nick).sort(); }

/* ---------- 미션 & 배틀패스 ----------
 * 전부 요청 기반(백그라운드 잡 없음). 진행도는 플레이어 카운터로 쌓고, 일일/주간/시즌
 * 리셋은 today()/weekStart()/thisSeason() 로 '읽을 때 지연 리셋'(일일 사냥 리셋과 동일).
 * 상태(mstat/mclaim/bp)는 players.data JSON 에 저장 → 스키마 변경 없음. */
function kstNow() { return new Date(Date.now() + KST_OFFSET_MS); }
// 주(week) 버킷 = 그 주 월요일의 날짜키(KST). 매주 월요일 00시 KST 에 바뀐다.
function weekStart() {
  const d = kstNow();
  const dow = (d.getUTCDay() + 6) % 7;               // 월=0 … 일=6
  const mon = new Date(d.getTime() - dow * 86400000);
  return mon.getUTCFullYear() + '-' + pad2(mon.getUTCMonth() + 1) + '-' + pad2(mon.getUTCDate());
}
function thisSeason() { const d = kstNow(); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); } // 월 단위 시즌

const MSTAT_KEYS = ['hunt', 'enh', 'enhWin', 'mine', 'fight', 'fightWin', 'raid', 'attend'];
function emptyStat() { const o = {}; for (const k of MSTAT_KEYS) o[k] = 0; return o; }
function ensureMstat(p) {
  if (!p.mstat) p.mstat = { day: today(), week: weekStart(), d: emptyStat(), w: emptyStat() };
  if (p.mstat.day !== today()) { p.mstat.day = today(); p.mstat.d = emptyStat(); }
  if (p.mstat.week !== weekStart()) { p.mstat.week = weekStart(); p.mstat.w = emptyStat(); }
  return p.mstat;
}
// 액션 함수들이 호출 — 일일·주간 버킷 동시 증가
function bumpMstat(p, key, n) { const m = ensureMstat(p); n = n || 1; m.d[key] = (m.d[key] || 0) + n; m.w[key] = (m.w[key] || 0) + n; }

const DAILY_POOL = [
  { id: 'd_hunt',   stat: 'hunt',   target: 15, gold: 1200, xp: 30, desc: '몬스터 15마리 사냥' },
  { id: 'd_enh',    stat: 'enh',    target: 20, gold: 1000, xp: 30, desc: '강화 20회 시도' },
  { id: 'd_mine',   stat: 'mine',   target: 12, gold: 1000, xp: 30, desc: '곡괭이질 12회' },
  { id: 'd_attend', stat: 'attend', target: 1,  gold: 800,  xp: 20, desc: '출석하기' },
  { id: 'd_fight',  stat: 'fight',  target: 1,  gold: 800,  xp: 20, desc: '싸움 1회 도전' },
  { id: 'd_raid',   stat: 'raid',   target: 1,  gold: 1500, xp: 40, desc: '레이드 1회 참여' },
];
const WEEKLY_POOL = [
  { id: 'w_enh',      stat: 'enh',      target: 100, gold: 6000, xp: 120, desc: '강화 100회 시도' },
  { id: 'w_hunt',     stat: 'hunt',     target: 150, gold: 6000, xp: 120, desc: '몬스터 150마리 처치' },
  { id: 'w_fightwin', stat: 'fightWin', target: 10,  gold: 6000, xp: 120, desc: '싸움 10승' },
  { id: 'w_raid',     stat: 'raid',     target: 5,   gold: 8000, xp: 150, desc: '레이드 5회 참여' },
  { id: 'w_mine',     stat: 'mine',     target: 80,  gold: 6000, xp: 120, desc: '곡괭이질 80회' },
];
const DAILY_COUNT = 4, WEEKLY_COUNT = 4;
function seedNum(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
// 날짜/주 시드로 결정적 선택 → 모든 유저가 같은 '오늘의 미션'을 본다(재현 가능·소셜).
function pickMissions(pool, n, seedStr) {
  if (n >= pool.length) return pool.slice();
  const start = seedNum(seedStr) % pool.length, out = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}
function currentDaily() { return pickMissions(DAILY_POOL, DAILY_COUNT, today()); }
function currentWeekly() { return pickMissions(WEEKLY_POOL, WEEKLY_COUNT, weekStart()); }

function ensureMclaim(p) {
  if (!p.mclaim) p.mclaim = { day: today(), week: weekStart(), d: [], w: [] };
  if (p.mclaim.day !== today()) { p.mclaim.day = today(); p.mclaim.d = []; }
  if (p.mclaim.week !== weekStart()) { p.mclaim.week = weekStart(); p.mclaim.w = []; }
  return p.mclaim;
}
function missionRow(p, m, scope) {
  const st = ensureMstat(p), cl = ensureMclaim(p);
  const prog = Math.min(m.target, (scope === 'daily' ? st.d : st.w)[m.stat] || 0);
  const claimed = (scope === 'daily' ? cl.d : cl.w).includes(m.id);
  return { id: m.id, desc: m.desc, target: m.target, progress: prog, done: prog >= m.target, claimed, gold: m.gold, xp: m.xp };
}
function missionAlert(p) { // 받을 수 있는 보상 개수(빨간점 배지용)
  let n = 0;
  for (const m of currentDaily()) { const r = missionRow(p, m, 'daily'); if (r.done && !r.claimed) n++; }
  for (const m of currentWeekly()) { const r = missionRow(p, m, 'weekly'); if (r.done && !r.claimed) n++; }
  n += bpAlert(p);
  return n;
}
function missionView(db, id) {
  const p = norm(db.players[id]);
  return {
    ok: true,
    daily: currentDaily().map(m => missionRow(p, m, 'daily')),
    weekly: currentWeekly().map(m => missionRow(p, m, 'weekly')),
    resetDaily: today(), resetWeek: weekStart(),
    bp: bpSummary(p),
  };
}
function missionClaim(db, id, missionId) {
  const p = norm(db.players[id]);
  const inDaily = currentDaily().find(m => m.id === missionId);
  const inWeekly = inDaily ? null : currentWeekly().find(m => m.id === missionId);
  const m = inDaily || inWeekly;
  if (!m) return { ok: false, error: '없는 미션이에요.' };
  const scope = inDaily ? 'daily' : 'weekly';
  const row = missionRow(p, m, scope);
  if (row.claimed) return { ok: false, error: '이미 받은 보상이에요.' };
  if (!row.done) return { ok: false, error: '아직 완료하지 않았어요.' };
  const cl = ensureMclaim(p);
  (scope === 'daily' ? cl.d : cl.w).push(m.id);
  const gold = gainGold(p, m.gold);
  addBpXp(p, m.xp);
  return { ok: true, gold, xp: m.xp, msg: '미션 완료! +' + gold + 'G · 패스 XP +' + m.xp };
}

// ----- 배틀패스 -----
const BP_XP_PER_LEVEL = 100, BP_MAX_LEVEL = 30;
function buildBpTrack() {
  const t = [];
  for (let lv = 1; lv <= BP_MAX_LEVEL; lv++) {
    const free = { gold: 500 + lv * 100 };
    if (lv % 5 === 0) free.protect = 1;                 // 5레벨마다 방지권
    const paid = { gold: 1500 + lv * 200 };
    if (lv % 3 === 0) paid.boost = 5;                   // 3레벨마다 부스트 5회
    if (lv % 5 === 0) paid.protect = 2;
    if (lv === CONFIG.invBpLevel) paid.slots = CONFIG.invBpSlots;   // 중간 보상: 가방 칸 +4
    t.push({ level: lv, free, paid });
  }
  return t;
}
const BP_TRACK = buildBpTrack();
function ensureBp(p) {
  if (!p.bp || p.bp.season !== thisSeason()) p.bp = { season: thisSeason(), xp: 0, free: [], paid: [], premium: false };
  return p.bp;
}
function bpLevelOf(xp) { return Math.max(0, Math.min(BP_MAX_LEVEL, Math.floor(xp / BP_XP_PER_LEVEL))); }
function addBpXp(p, xp) { const bp = ensureBp(p); bp.xp = Math.min(BP_MAX_LEVEL * BP_XP_PER_LEVEL, (bp.xp || 0) + (xp || 0)); }
function bpAlert(p) {
  const bp = ensureBp(p), lv = bpLevelOf(bp.xp); let n = 0;
  for (const t of BP_TRACK) {
    if (t.level <= lv && !bp.free.includes(t.level)) n++;
    if (t.level <= lv && bp.premium && !bp.paid.includes(t.level)) n++;
  }
  return n;
}
function bpSummary(p) {
  const bp = ensureBp(p), lv = bpLevelOf(bp.xp);
  return {
    season: bp.season, level: lv, maxLevel: BP_MAX_LEVEL, premium: !!bp.premium,
    xp: bp.xp, xpPerLevel: BP_XP_PER_LEVEL,
    xpInLevel: bp.xp - lv * BP_XP_PER_LEVEL, atMax: lv >= BP_MAX_LEVEL,
  };
}
function bpView(db, id) {
  const p = norm(db.players[id]);
  const bp = ensureBp(p), lv = bpLevelOf(bp.xp);
  return {
    ok: true, ...bpSummary(p),
    track: BP_TRACK.map(t => ({
      level: t.level, free: t.free, paid: t.paid,
      unlocked: t.level <= lv,
      freeClaimed: bp.free.includes(t.level),
      paidClaimed: bp.paid.includes(t.level),
      freeClaimable: t.level <= lv && !bp.free.includes(t.level),
      paidClaimable: t.level <= lv && bp.premium && !bp.paid.includes(t.level),
    })),
  };
}
// 배틀패스 보상 지급. 초월 배수가 붙을 수 있어 '실제로 준 것' 을 돌려준다.
function grantBundle(p, r) {
  const out = {};
  if (r.gold) out.gold = gainGold(p, r.gold);
  if (r.protect) out.protect = addItem(p, 'protect', r.protect);
  if (r.boost) out.boost = addItem(p, 'boost', r.boost);
  if (r.slots) out.slots = addSlots(p, r.slots);
  return out;
}
function bpClaim(db, id, level, track) {
  const p = norm(db.players[id]);
  const bp = ensureBp(p), lv = bpLevelOf(bp.xp);
  const t = BP_TRACK.find(x => x.level === level);
  if (!t) return { ok: false, error: '없는 보상이에요.' };
  if (level > lv) return { ok: false, error: '아직 도달하지 않은 레벨이에요.' };
  if (track === 'paid') {
    if (!bp.premium) return { ok: false, error: '시즌 패스(유료 트랙)가 필요해요.' };
    if (bp.paid.includes(level)) return { ok: false, error: '이미 받았어요.' };
    bp.paid.push(level);
    return { ok: true, reward: grantBundle(p, t.paid), msg: '패스 보상 수령! (Lv.' + level + ' 프리미엄)' };
  }
  if (bp.free.includes(level)) return { ok: false, error: '이미 받았어요.' };
  bp.free.push(level);
  return { ok: true, reward: grantBundle(p, t.free), msg: '패스 보상 수령! (Lv.' + level + ')' };
}
// 시즌 패스(유료) 구매 — 결제 연동 전까지 '준비중'. 결제 붙으면 여기서 bp.premium=true 로.
function bpBuyPremium(db, id) {
  return { ok: false, error: '시즌 패스는 곧 출시됩니다! (준비중)' };
}

module.exports = {
  CONFIG, GRADES, RARITIES, CLASSES, BOSSES, odds, enhanceCost, weaponName, grade,
  missionView, missionClaim, bpView, bpClaim, bpBuyPremium,
  login, setClass, rename, publicView, enhance, ascend, attend, mine, mineSwing, hunt, buyProtect, fight,
  ITEMS, useItem, buyInvPack, invView, ascendReq, ascendProgress,
  partyCreate, partyJoin, partyLeave, partyList, partyView, raidStart,
  partyInvite, partyAccept, partyReject, myInvites, raidState,
  raidHit, raidSkill, raidFinish,
  buyBoost, buyDye, buyClassChange, shopItems, equipTitle,
  profile, ranking, goldRanking, hogu, recentLog, playerList, findByNick,
  findByAuthUid, authLink,
  // 저장 계층(server.js)용 — 일일 카운터 / 유저별 상한
  today, normalizeDay, LIMIT_KEYS, DAILY_FIELDS, limitOf, setLimits, dailyUsage, applyDaily, norm,
  // 서버리스(Vercel/Supabase) 어댑터용
  makePlayer, validNick, pinKey, indexNick,
};
