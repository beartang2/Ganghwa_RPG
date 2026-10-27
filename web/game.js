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
  classChangePrice: 30000,   // (판매 종료 — 남은 변경권은 속성 재련권으로 이관)
  // 🔁 속성 재련권: 상점 골드 + 사용할 때 강화 수치의 일정 %. 에픽 이상 무기만.
  rerollPrice: 100000, rerollLevelPct: 0.10, rerollMinGrade: 'epic',
  dyePrice: 2000,
  // 강화(로스트아크식) — 파괴 시 완전 초기화(+0)
  pityBase: 0.015,      // 장인의 기운 기본 상승폭(실패당) — 저확률에서도 결국 참
  pityScale: 0.34,      // + 성공률 비례분(성공률 높을수록 살짝 더 빨리 참)
  // 사냥
  atkReportMaxN: 20,        // 사냥 공격 기록 보고 한 번에 인정하는 일반 공격 수(몬스터 1마리 최대 7타 + 여유)
  atkReportMaxS: 4,         //            〃               강공격 수
  atkMsPerTap: 70,          // 보고 사이 흐른 시간으로 본 일반 공격 최소 간격(사냥 연타 간격과 같음)
  atkMsPerStrong: 300,      //            〃          강공격 최소 간격(커맨드를 그리는 시간)
  huntMinGapMs: 750,        // 사냥 요청 사이 최소 간격 — 사람이 가장 빨리 잡는 주기(한 방 처치 ~0.15초 + 다음 몬스터 대기 0.65초 + 통신)보다 아주 조금 짧게
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
  /* 인벤 칸: 기본 10 → 상점 1회 한정 패키지 +4 → 배틀패스 프리미엄 중간 보상 +4 = 상한 18.
   * 스택이 커서 재료는 1~2칸만 먹는다 — 칸이 모자라지는 건 아이템 '종류' 가 늘 때다.
   * 상시 보유 종류는 8종(방지권·부스트·염색약·파편·정수·열쇠·마석 + 사용형 1)이라 기본 10칸에 여유 2칸.
   * invSlots 는 '바닥값' 이라 나중에 올리면 기존 유저도 자동으로 그만큼 받는다
   * (추가분은 p.inv.bought 에 따로 쌓여서 사라지지 않는다). */
  invSlots: 10, invSlotsMax: 18,   // 8→10: 아이템 종류가 8종(🗝️열쇠·🔮마석 추가)이 되어 '여유 2칸' 원칙을 유지
  invPackSlots: 4,           // 상점 '가방 확장 패키지' 1회 구매로 열리는 칸수
  invPackPrice: 500000,      // 그 가격 — 계정당 딱 한 번
  invBpSlots: 4,             // 배틀패스 프리미엄 중간 보상으로 주는 칸수
  invBpLevel: 15,            // 그 보상이 걸리는 패스 레벨
  /* 한 칸에 쌓이는 최대 개수. 넘으면 다음 칸을 하나 더 먹는다.
   * 크게 잡는 이유: 칸 압박은 '아이템 종류 수' 에서 와야 한다. 스택이 작으면
   * 초월 재료 누적만으로 칸이 다 차서, 나중에 아이템 종류가 늘 때 넣을 자리가 없어진다. */
  invStackMax: 999,

  /* 장비 칸(무기 여러 자루) — 한 직업으로 만렙을 찍은 뒤 다른 직업 무기를 따로 키울 수 있다.
   * 무기마다 강화 수치·★·속성·장인의 기운이 따로이고, 장착한 무기가 직업을 정한다.
   * 직업당 한 자루라 최대 4칸. 칸은 💎 프리즘 상점에서 연다(직업 변경권은 판매 종료). */
  weaponSlotsBase: 1, weaponSlotsMax: 4,
  /* 2·3·4번째 칸 가격(💎). 첫 칸 = '첫 무기를 +0→+99 로 키우는 동안 평균적으로 모이는 💎(보통 유저 54.5)' × 1.2,
   * 그 뒤는 2배·3배 — 칸마다 직업 달인 칭호와 초월 던전 깊은 층(무기 수 조건)이 열리므로 갈수록 비싸게.
   * web/tools/sim-climb.js --prices 70,140,210 (보통 유저·+99 무기로 사냥): 칸마다 약 18 → 17 → 25일.
   * 두 번째 무기부터는 +99 무기로 사냥·레이드하면 등반이 약 16일 → 6일로 줄어서, 나머지는 +99 뒤 💎 모으는 기간이다. */
  weaponSlotPrices: [70, 140, 210],
  // 칸 해금 조건: +99 를 찍은(지금 +99 이거나 ★1 이상) 무기 한 자루마다 칸을 하나 살 수 있다.
  //   +99 무기 1자루 → 2번째 칸, 2자루 → 3번째 칸, 3자루 → 4번째 칸. 즉 가진 칸을 다 채워 +99 까지 키워야 다음 칸이 열린다.

  /* 💎 프리즘 — 골드와 별개인 두 번째 재화. 확률 시스템(상자·연금술·캡슐)에서만 나오고
   * 프리즘 상점에서 장비 칸·특별 아이템으로 바꾼다. 확률표는 화면에 그대로 공개한다. */
  // 사냥 드랍: 🗝️ 상자 열쇠 · 🔮 마석(연금 재료). 무한 사냥에서도 나오지만 확률이 낮다.
  keyChance: 0.06, keyChanceOvertime: 0.015,          // 희귀도 tier 당 ×(1+0.2·tier)
  stoneChance: 0.45, stoneChanceOvertime: 0.12,       // 개수: 일일 1+⌊tier/2⌋, 무한 1
  capsulePrice: 30000,                                 // 🧸 캡슐 1회 가격(골드만 있으면 무제한)
  capsuleBatchMax: 10,
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
  prism:     { rank: 5, color: '#c9b8ff' },   // 🌈 이스터에그 전용 — 화면에선 무지갯빛으로 흐른다. 얻기 전엔 등급·이름 모두 숨김(❓)
};
/* ---------- 칭호용 누적 기록 ----------
 * p.atk = { n: 일반 공격, s: 강공격, w: { 직업: 그 무기 강공격 }, ts: 마지막 사냥 보고 시각 }
 * p.ds  = 초월 던전 { clear 층 돌파, weak 약점 타수, swap 무기 교체, elem 속성 스킬, flaw 무피격 심층 돌파 }
 * p.gs  = 프리즘 도박 { box, boxJ, alch, ash, alchJ, cap, capE, capJ }
 * 전부 단조 증가라 한 번 얻은 칭호는 사라지지 않는다. (저장 제외 키 level·gold·nick 은 이름으로 쓰지 않는다) */
const atkN = p => (p.atk && p.atk.n) || 0;
const atkS = p => (p.atk && p.atk.s) || 0;
const atkSW = (p, cls) => (p.atk && p.atk.w && p.atk.w[cls]) || 0;
const dStat = (p, k) => (p.ds && p.ds[k]) || 0;
const gStat = (p, k) => (p.gs && p.gs[k]) || 0;
// 🥚 이스터에그 — 한 번 찾으면 끝(1회 bool). p.eggs = { heart: 1, ... }
const eggOf = (p, k) => !!(p.eggs && p.eggs[k]);
function setEgg(p, k) { if (!p.eggs || typeof p.eggs !== 'object') p.eggs = {}; if (p.eggs[k]) return false; p.eggs[k] = 1; return true; }
// 클라에서 찾는 이스터에그(그리기·화면) — 사냥 것은 최근 5분 안에 사냥을 했어야 인정(아무 데서나 호출 방지)
const CLIENT_EGGS = { heart: 'hunt', spiral: 'hunt', inf: 'hunt', konami: 'hunt', forge: 'any', console: 'any', sudo: 'any' };
// 🔨 개발자 이스터에그 중 서버 주소로만 열리는 것(헤더 탐정 /api/anvil · 찻주전자 /api/coffee) — /api/egg 로는 못 연다
function devEgg(db, id, eggId) {
  if (!['header', 'teapot'].includes(eggId)) return { ok: false, error: '…?' };
  return { ok: true, silent: true, found: setEgg(norm(db.players[id]), eggId) ? eggId : null };
}
function eggFound(db, id, eggId) {
  const p = norm(db.players[id]);
  const where = CLIENT_EGGS[eggId];
  if (!where) return { ok: false, error: '…?' };
  if (where === 'hunt' && Date.now() - (p.huntTs || 0) > 5 * 60000) return { ok: false, error: '사냥터에서만 찾을 수 있어요.' };
  return { ok: true, silent: true, found: setEgg(p, eggId) ? eggId : null };
}
function atkStat(p) { if (!p.atk || typeof p.atk !== 'object') p.atk = { n: 0, s: 0, w: {} }; if (!p.atk.w) p.atk.w = {}; return p.atk; }
function bumpD(p, k, n) { if (!p.ds || typeof p.ds !== 'object') p.ds = {}; p.ds[k] = (p.ds[k] || 0) + (n == null ? 1 : n); }
function bumpG(p, k, n) { if (!p.gs || typeof p.gs !== 'object') p.gs = {}; p.gs[k] = (p.gs[k] || 0) + (n == null ? 1 : n); }
function addTaps(p, n) { n = n | 0; if (n > 0) atkStat(p).n += n; }
// 사냥 공격 기록 보고(클라 → 서버). 위조할 수 있으니 한 번에 n≤20·s≤4, 그리고 지난 보고 이후
// 흐른 시간 안에 사람이 낼 수 있는 만큼만 센다(일반 0.07초·강공격 0.3초에 1번).
function reportAtk(p, a) {
  if (!a || typeof a !== 'object') return;
  const st = atkStat(p), now = Date.now(), dt = Math.max(0, now - (st.ts || 0));
  const n = Math.max(0, Math.min(parseInt(a.n, 10) || 0, CONFIG.atkReportMaxN, Math.floor(dt / CONFIG.atkMsPerTap) + 1));
  const sN = Math.max(0, Math.min(parseInt(a.s, 10) || 0, CONFIG.atkReportMaxS, Math.floor(dt / CONFIG.atkMsPerStrong) + 1));
  st.ts = now; st.n += n; st.s += sN;
  if (sN && p.class) st.w[p.class] = (st.w[p.class] || 0) + sN;
}
// 사냥창을 닫을 때 남은 기록만 따로 보낼 때
function atkReport(db, id, a) { reportAtk(norm(db.players[id]), a); return { ok: true, silent: true }; }
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
  { id: 'asc1',  title: '초월의 시작',  grade: 'legend',    desc: '초월 ★1 달성',  check: p => ascendMax(p) >= 1 },
  { id: 'asc3',  title: '윤회자',       grade: 'legend',    desc: '초월 ★3 달성',  check: p => ascendMax(p) >= 3 },
  { id: 'asc5',  title: '초월의 화신',  grade: 'transcend', desc: '초월 ★5 달성',  check: p => ascendMax(p) >= 5 },
  { id: 'asc10', title: '무의 경지',    grade: 'transcend', desc: '초월 ★10 달성', check: p => ascendMax(p) >= 10 },
  // 🌌 초월 던전 — 평생 최고층 기준(주간 초기화와 무관하게 남는다)
  { id: 'dun10', title: '심연 탐험가',   grade: 'epic',      desc: '초월 던전 10층 돌파', check: p => dunBest(p) >= 10 },
  { id: 'dun30', title: '심연의 정복자', grade: 'legend',    desc: '초월 던전 30층 돌파', check: p => dunBest(p) >= 30 },
  { id: 'dun50', title: '초월 던전 정상', grade: 'transcend', desc: '초월 던전 50층 돌파', check: p => dunBest(p) >= 50 },
  // ⚡ 일반 공격 — 사냥 연타 + 레이드·던전 연타(서버가 검증한 타수)
  { id: 'tap1k',   title: '연타 입문',     grade: 'common',    desc: '일반 공격 1,000회',     check: p => atkN(p) >= 1000 },
  { id: 'tap10k',  title: '연타의 달인',   grade: 'rare',      desc: '일반 공격 10,000회',    check: p => atkN(p) >= 10000 },
  { id: 'tap100k', title: '손가락 폭풍',   grade: 'epic',      desc: '일반 공격 100,000회',   check: p => atkN(p) >= 100000 },
  { id: 'tap300k', title: '무한 연타',     grade: 'legend',    desc: '일반 공격 300,000회',   check: p => atkN(p) >= 300000 },
  // ⚡ 강공격 — 무기별 커맨드(지금은 사냥터)
  { id: 'str30',   title: '한 방의 맛',    grade: 'common',    desc: '강공격 30회',           check: p => atkS(p) >= 30 },
  { id: 'str300',  title: '필살의 손끝',   grade: 'rare',      desc: '강공격 300회',          check: p => atkS(p) >= 300 },
  { id: 'str2000', title: '일격필살',      grade: 'epic',      desc: '강공격 2,000회',        check: p => atkS(p) >= 2000 },
  { id: 'str_warrior', title: '검풍',          grade: 'epic',  desc: '⚔️ 베어 가르기(검 강공격) 500회',  check: p => atkSW(p, 'warrior') >= 500 },
  { id: 'str_archer',  title: '백발백중',      grade: 'epic',  desc: '🏹 관통 사격(활 강공격) 500회',    check: p => atkSW(p, 'archer') >= 500 },
  { id: 'str_tanker',  title: '부동의 방패',   grade: 'epic',  desc: '🛡️ 방패 강타(방패 강공격) 500회',  check: p => atkSW(p, 'tanker') >= 500 },
  { id: 'str_healer',  title: '별을 그리는 자', grade: 'epic', desc: '✨ 별빛 폭발(지팡이 강공격) 500회', check: p => atkSW(p, 'healer') >= 500 },
  // 🌌 초월 던전 전용 — 누적 기록(주간 초기화와 무관)
  { id: 'dclear100', title: '심연 순례자',  grade: 'epic',     desc: '초월 던전 층 돌파 누적 100회',      check: p => dStat(p, 'clear') >= 100 },
  { id: 'dweak3k',   title: '약점 저격수',  grade: 'epic',     desc: '초월 던전에서 약점 속성으로 3,000타', check: p => dStat(p, 'weak') >= 3000 },
  { id: 'dswap100',  title: '천변만화',     grade: 'rare',     desc: '초월 던전 전투 중 무기 교체 100회',  check: p => dStat(p, 'swap') >= 100 },
  { id: 'delem30',   title: '원소술사',     grade: 'rare',     desc: '초월 던전에서 속성 스킬 30회',      check: p => dStat(p, 'elem') >= 30 },
  { id: 'dflawless', title: '무결의 정복자', grade: 'legend',  desc: '초월 던전 31층 이상을 한 대도 안 맞고 돌파', check: p => dStat(p, 'flaw') >= 1 },
  // 💎 프리즘 도박 — 상자·연금술·캡슐
  { id: 'box50',     title: '보물상자 사냥꾼', grade: 'rare',      desc: '📦 상자 50회 열기',               check: p => gStat(p, 'box') >= 50 },
  { id: 'boxjack',   title: '황금 열쇠',       grade: 'legend',    desc: '📦 상자에서 💎 프리즘 15개 당첨',  check: p => gStat(p, 'boxJ') >= 1 },
  { id: 'alch100',   title: '연금술사',        grade: 'epic',      desc: '⚗️ 연금술 100회',                 check: p => gStat(p, 'alch') >= 100 },
  { id: 'ash50',     title: '잿더미 수집가',   grade: 'rare',      desc: '⚗️ 연금술 꽝(잿더미) 50회',        check: p => gStat(p, 'ash') >= 50 },
  { id: 'alchjack',  title: '현자의 돌',       grade: 'legend',    desc: '⚗️ 연금술 최고 칸 당첨',           check: p => gStat(p, 'alchJ') >= 1 },
  { id: 'cap500',    title: '캡슐 중독',       grade: 'epic',      desc: '🧸 캡슐 500회',                   check: p => gStat(p, 'cap') >= 500 },
  { id: 'capempty50', title: '허탕의 달인',    grade: 'rare',      desc: '🧸 빈 캡슐 50회',                 check: p => gStat(p, 'capE') >= 50 },
  { id: 'capjack',   title: '천운',            grade: 'transcend', desc: '🧸 캡슐에서 💎 프리즘 50개 당첨',  check: p => gStat(p, 'capJ') >= 1 },
  // 🌈 프리즘 등급 — 이스터에그(조건은 얻기 전까지 비공개)
  { id: 'egg_heart',   title: '사랑의 사냥꾼',  grade: 'prism', hidden: true, desc: '사냥터에서 ❤️ 하트를 그렸다',            check: p => eggOf(p, 'heart') },
  { id: 'egg_spiral',  title: '빙글빙글',       grade: 'prism', hidden: true, desc: '사냥터에서 🌀 소용돌이를 그렸다',        check: p => eggOf(p, 'spiral') },
  { id: 'egg_inf',     title: '무한의 사냥꾼',  grade: 'prism', hidden: true, desc: '사냥터에서 ♾️ 무한을 그렸다',            check: p => eggOf(p, 'inf') },
  { id: 'egg_konami',  title: '고전 게이머',    grade: 'prism', hidden: true, desc: '사냥터에서 ↑↑↓↓←→←→ 후 두 번 톡톡',     check: p => eggOf(p, 'konami') },
  { id: 'egg_forge',   title: '화로 두드리는 자', grade: 'prism', hidden: true, desc: '대장간 무기를 쉬지 않고 10번 두드렸다', check: p => eggOf(p, 'forge') },
  { id: 'egg_44',      title: '불길한 숫자',    grade: 'prism', hidden: true, desc: '+44에서 무기가 파괴됐다',                check: p => eggOf(p, 'd44') },
  { id: 'egg_77',      title: '럭키 세븐',      grade: 'prism', hidden: true, desc: '딱 +77에 도착했다',                      check: p => eggOf(p, 'l77') },
  { id: 'egg_pity99',  title: '한 끗 차이',     grade: 'prism', hidden: true, desc: '장인의 기운 99% 이상에서 파괴됐다',       check: p => eggOf(p, 'pity99') },
  { id: 'egg_air',     title: '공기 수집가',    grade: 'prism', hidden: true, desc: '캡슐에서 빈 캡슐 3연속',                 check: p => eggOf(p, 'air') },
  // 🔨 개발자만 찾을 수 있는 것 — 콘솔 · 응답 헤더 · HTTP 418 · 키보드(정답은 해시로만)
  { id: 'egg_console', title: '콘솔 강화',  grade: 'prism', hidden: true, desc: '개발자 콘솔에서 강화했다',                check: p => eggOf(p, 'console') },
  { id: 'egg_header',  title: '헤더 탐정',  grade: 'prism', hidden: true, desc: '응답 헤더의 단서를 따라 모루를 두드렸다', check: p => eggOf(p, 'header') },
  { id: 'egg_teapot',  title: '찻주전자',   grade: 'prism', hidden: true, desc: '서버에게 커피를 주문했다 (418)',         check: p => eggOf(p, 'teapot') },
  { id: 'egg_sudo',    title: 'sudo 초월', grade: 'prism', hidden: true, desc: '관리자 권한으로 초월을 부탁했다',         check: p => eggOf(p, 'sudo') },
  { id: 'egg_halloween', title: '할로윈의 사냥꾼', grade: 'prism', hidden: true, desc: '할로윈(10/31)에 몬스터를 사냥했다',     check: p => eggOf(p, 'halloween') },
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
    { id: 'eltkt', emoji: ITEMS.eltkt.emoji, name: ITEMS.eltkt.name, price: CONFIG.rerollPrice, qty: 1, desc: '🟣에픽(+' + rerollMinLevel() + ') 이상 무기의 속성을 다시 뽑아요 · 쓸 때 강화 수치의 ' + Math.round(CONFIG.rerollLevelPct * 100) + '%가 깎여요 · 초월 던전 상성 맞추기용' },
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
// 지금까지 얻은 최고 ★ — 무기를 바꿔 들어도 줄지 않는다(칭호 기준)
function ascendMax(p) {
  let m = Math.max(p.ascendMax || 0, p.ascend || 0);
  if (Array.isArray(p.armory)) for (const w of p.armory) m = Math.max(m, w.asc || 0);
  return m;
}
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
  eltkt:    { id: 'eltkt',    emoji: '🔁', name: '속성 재련권',   kind: 'use',     desc: '장착한 무기(🟣에픽 +25 이상)의 속성을 무작위로 다시 뽑아요 · 강화 수치의 ' + Math.round(CONFIG.rerollLevelPct * 100) + '%가 깎여요' },
  shard:    { id: 'shard',    emoji: '💠', name: '초월의 파편',   kind: 'mat',     desc: '몬스터 사냥 드랍 · 초월 승급 재료' },
  essence:  { id: 'essence',  emoji: '🌟', name: '초월의 정수',   kind: 'mat',     desc: '보스 레이드 확정 드랍 · 초월 승급 재료' },
  boxkey:   { id: 'boxkey',   emoji: '🗝️', name: '상자 열쇠',     kind: 'key',     desc: '몬스터 사냥 드랍 · 💎 프리즘 탭에서 상자 3개 중 하나를 골라 열어요' },
  stone:    { id: 'stone',    emoji: '🔮', name: '마석',          kind: 'mat',     desc: '몬스터 사냥 드랍 · ⚗️ 연금술 재료(골드와 함께 넣어요)' },
  hammer:   { id: 'hammer',   emoji: '🔨', name: '장인의 망치',   kind: 'use',     desc: '사용하면 장착한 무기의 장인의 기운 +50% (최대 100%)' },
  prismdye: { id: 'prismdye', emoji: '🫧', name: '프리즘 염색약', kind: 'use',     desc: '사용하면 닉네임이 프리즘 오로라색(흰빛 위로 하늘·보랏빛이 반짝이며 일렁임)이 돼요 · 프리즘 상점 전용 색' },
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
function rerollMinLevel() { return gradeMin(GRADES.find(g => g.key === CONFIG.rerollMinGrade)); }
function rerollCost(level) { return Math.max(1, Math.floor(level * CONFIG.rerollLevelPct)); }
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
  if (itemId === 'hammer') {
    if (p.level >= CONFIG.maxLevel) return { ok: false, error: '만렙 무기에는 쓸 필요가 없어요. 🌈 초월하세요!' };
    if ((p.pity || 0) >= 1) return { ok: false, error: '장인의 기운이 이미 100%예요.' };
    takeItem(p, 'hammer', 1);
    p.pity = Math.min(1, (p.pity || 0) + 0.5);
    return { ok: true, used: 'hammer', msg: '🔨 쾅! 장인의 기운 ' + Math.round(p.pity * 100) + '%' };
  }
  if (itemId === 'prismdye') {
    takeItem(p, 'prismdye', 1);
    // 염색약 뽑기에서는 절대 나오지 않는 프리즘 상점 전용 색 — 칭호 조건(무지개 등)과는 무관
    p.nickColor = { kind: 'prism', name: '프리즘 오로라', rarity: '프리즘' };
    addLog(db, '🫧 ' + p.nick + ' 프리즘 오로라 닉네임!');
    return { ok: true, used: 'prismdye', msg: '🫧 닉네임이 프리즘 오로라색이 됐어요!' };
  }
  if (itemId === 'eltkt') {
    // 🔁 속성 재련 — 에픽 이상 무기만. 강화 수치의 일정 %(내림, 최소 1)를 내고 속성을 무작위로(지금 속성 제외) 다시 뽑는다.
    if (!p.class) return { ok: false, error: '먼저 직업을 고르세요.' };
    if (inDungeonFight(p)) return { ok: false, error: '던전 전투 중에는 재련할 수 없어요.' };
    const minLv = rerollMinLevel();
    if (p.level < minLv) return { ok: false, error: '🔁 재련은 🟣에픽(+' + minLv + ') 이상 무기만 할 수 있어요. (지금 +' + p.level + ')' };
    const cost = rerollCost(p.level), before = elementOf(p.element), lv0 = p.level;
    const pool = ELEMENTS.filter(e => e.key !== p.element);
    takeItem(p, 'eltkt', 1);
    p.element = pool[randInt(0, pool.length - 1)].key;
    p.level = lv0 - cost;
    bumpRank(db);
    const after = elementOf(p.element);
    addLog(db, '🔁 ' + p.nick + ' 속성 재련 ' + before.emoji + '→' + after.emoji + ' (+' + lv0 + '→+' + p.level + ')');
    return { ok: true, used: 'eltkt', element: p.element, msg: '🔁 속성 재련! ' + before.emoji + ' ' + before.name + ' → ' + after.emoji + ' ' + after.name + ' · +' + lv0 + ' → +' + p.level };
  }
  return { ok: false, error: '아직 쓸 수 없는 아이템이에요.' };
}

/* ---------- 장비 칸 (무기 여러 자루) ----------
 * 손에 든 무기는 예전 그대로 p.class · p.level · p.element · p.pity · p.ascend 에 둔다.
 * 강화·초월·레이드·싸움·사냥 코드가 전부 '지금 든 무기' 를 보므로 손댈 필요가 없고,
 * 바꿔 들 때만 p.armory(보관 무기)와 맞바꾼다. 무기마다 강화·★·속성·장인의 기운이 따로다.
 * ⚠️ 보관 무기의 키는 lv/cls/el/asc 로 쓴다 — 저장 계층이 'level'·'gold'·'nick' 키를
 *    JSON 어디에 있든 빼 버리므로(컬럼 소유 필드), 같은 이름이면 보관 무기의 레벨이 저장 때 사라진다. */
function ensureArmory(p) { if (!Array.isArray(p.armory)) p.armory = []; return p.armory; }
function weaponSlots(p) { return Math.min(CONFIG.weaponSlotsMax, CONFIG.weaponSlotsBase + (p.weaponSlotBought || 0)); }
function activeWeapon(p) { return { cls: p.class, lv: p.level || 0, el: p.element, pity: p.pity || 0, asc: p.ascend || 0 }; }
function loadWeapon(p, w) { p.class = w.cls; p.level = w.lv || 0; p.element = w.el || randomElementKey(); p.pity = w.pity || 0; p.ascend = w.asc || 0; }
function allWeapons(p) {
  const list = p.class ? [Object.assign(activeWeapon(p), { equipped: true })] : [];
  for (const w of ensureArmory(p)) list.push(Object.assign({}, w, { equipped: false }));
  return list;
}
function ownedClasses(p) { return allWeapons(p).map(w => w.cls); }
// 랭킹 기준 무기 = ★ 이 가장 높은 것, 같으면 강화가 높은 것(새 무기를 들어도 순위가 안 떨어진다)
function bestWeapon(p) {
  let b = null;
  for (const w of allWeapons(p)) if (!b || w.asc > b.asc || (w.asc === b.asc && w.lv > b.lv)) b = w;
  return b || { cls: p.class, lv: p.level || 0, asc: p.ascend || 0, el: p.element };
}
function rankCmp(a, b) {
  const x = bestWeapon(a), y = bestWeapon(b);
  return (y.asc - x.asc) || (y.lv - x.lv) || ((b.best || 0) - (a.best || 0));
}
function weaponCard(w) {
  const c = CLASSES[w.cls] || CLASSES.warrior, g = grade(w.lv), em = elementOf(w.el);
  return { cls: w.cls, classEmoji: c.emoji, className: c.name, base: c.weapon, level: w.lv, ascend: w.asc || 0,
    name: weaponName(w.lv, w.cls, w.asc), grade: { key: g.key, emoji: g.emoji, name: g.name, color: g.color },
    element: w.el, elementEmoji: em.emoji, elementName: em.name, pity: w.pity || 0, equipped: !!w.equipped };
}
// +99 를 한 번이라도 찍은 무기 — 지금 +99 이거나, 이미 초월해서 ★ 이 붙은 무기(초월하면 +0 으로 돌아가므로 ★ 로 센다)
function isTopped(w) { return (w.lv || 0) >= CONFIG.maxLevel || (w.asc || 0) >= 1; }
function toppedCount(p) { return allWeapons(p).filter(isTopped).length; }
// 다음 장비 칸을 살 수 있는지 — 산 칸 수보다 +99 무기가 많아야 한다(need = 지금까지 산 칸 + 1)
function slotUnlock(p) {
  const bought = p.weaponSlotBought || 0;
  const maxed = weaponSlots(p) >= CONFIG.weaponSlotsMax;
  const need = bought + 1, have = toppedCount(p);
  return { maxed, need, have, ok: !maxed && have >= need, price: maxed ? null : CONFIG.weaponSlotPrices[bought] };
}
function slotLockMsg(su) { return '+' + CONFIG.maxLevel + ' 무기 ' + su.have + '/' + su.need + '자루'; }   // 좁은 화면에서도 한 줄
function weaponsView(p) {
  const list = allWeapons(p);
  const su = slotUnlock(p);
  return {
    slots: weaponSlots(p), max: CONFIG.weaponSlotsMax, list: list.map(weaponCard),
    canNew: !!p.class && list.length < weaponSlots(p),
    missing: Object.keys(CLASSES).filter(k => !list.some(w => w.cls === k)),
    nextSlotPrice: su.price,
    // 다음 칸 해금 상태(최대면 null) — 화로 위 🔒 칸이 '살 수 있음/조건 미달' 을 구분해 보여준다
    nextSlot: su.maxed ? null : { price: su.price, need: su.need, have: su.have, ok: su.ok, msg: slotLockMsg(su) },
  };
}
function inActiveRaid(db, id) {
  const p = db.players[id], pt = p && p.party && db.parties[p.party];
  return !!(pt && pt.raid && pt.raid.status === 'active' && pt.raid.participants.some(m => m.id === id));
}
// 빈 장비 칸에 새 직업 무기를 만든다 — +0·★0·새 속성. 지금 든 무기는 보관함으로, 새 무기를 바로 든다.
function newWeapon(db, id, cls) {
  const p = norm(db.players[id]);
  if (!p.class) return { ok: false, error: '먼저 직업을 고르세요.' };
  if (!CLASSES[cls]) return { ok: false, error: '올바른 직업을 고르세요.' };
  if (ownedClasses(p).includes(cls)) return { ok: false, error: '이미 ' + CLASSES[cls].weapon + '을(를) 갖고 있어요. 장비 칸에서 바꿔 들 수 있어요.' };
  if (allWeapons(p).length >= weaponSlots(p)) return { ok: false, error: '장비 칸이 꽉 찼어요. 무기를 +' + CONFIG.maxLevel + '까지 키우면 💎 프리즘 상점에서 칸을 늘릴 수 있어요.' };
  if (inActiveRaid(db, id)) return { ok: false, error: '레이드 중에는 무기를 바꿀 수 없어요.' };
  if (inDungeonFight(p)) return { ok: false, error: '던전 전투 중에는 새 무기를 만들 수 없어요.' };
  ensureArmory(p).push(activeWeapon(p));
  loadWeapon(p, { cls, lv: 0, el: randomElementKey(), pity: 0, asc: 0 });
  bumpRank(db);
  const c = CLASSES[cls], em = elementOf(p.element);
  addLog(db, c.emoji + ' ' + p.nick + ' 님이 새 ' + c.weapon + '(' + em.name + '속성)을 만들었어요 — 이제 ' + c.name + '!');
  return { ok: true, msg: c.emoji + ' 새 ' + c.weapon + ' 제작! (' + em.emoji + ' ' + em.name + '속성) 이제 ' + c.name + '예요.' };
}
// 보관 중인 무기로 바꿔 든다(직업도 그 무기를 따라 바뀐다).
function equipWeapon(db, id, cls) {
  const p = norm(db.players[id]);
  if (inActiveRaid(db, id)) return { ok: false, error: '레이드 중에는 무기를 바꿀 수 없어요.' };
  if (inDungeonFight(p)) return { ok: false, error: '던전 전투 중에는 전투 화면의 교체 버튼을 쓰세요.' };
  return swapWeapon(db, p, cls);
}
// 실제 맞바꾸기 — 장비 칸 교체와 던전 전투 중 교체가 함께 쓴다
function swapWeapon(db, p, cls) {
  if (p.class === cls) return { ok: false, error: '이미 들고 있는 무기예요.' };
  const arm = ensureArmory(p), i = arm.findIndex(w => w.cls === cls);
  if (i < 0) return { ok: false, error: '그 무기가 장비 칸에 없어요.' };
  const cur = activeWeapon(p);
  loadWeapon(p, arm[i]);
  arm[i] = cur;
  bumpRank(db);
  const c = CLASSES[p.class];
  return { ok: true, msg: c.emoji + ' ' + weaponName(p.level, p.class, p.ascend) + ' 장착 — 이제 ' + c.name + '예요.' };
}

/* ---------- 💎 프리즘 (상자 · 연금술 · 캡슐 → 프리즘 상점) ----------
 * 확률표는 서버가 이 표 그대로 굴리고, 화면도 이 표를 그대로 보여준다(확률 공개).
 * 기대값(프리즘): 상자 열쇠 1개 ≈ 0.54 · 연금 약불 ≈ 0.58 / 중불 ≈ 2.28 / 강불 ≈ 6.79 · 캡슐 1회 ≈ 0.37
 * (2026-10-26 첫 제안값의 약 절반으로 하향 — 프리즘을 더 귀하게)
 * 골드 환산: 캡슐 ≈ 6.5만G/💎(환급 포함), 연금은 불이 셀수록 마석 효율↑·골드 효율↓ */
const BOX_TABLE = [
  { p: 0.20, kind: 'prism', n: 1 }, { p: 0.08, kind: 'prism', n: 2 }, { p: 0.02, kind: 'prism', n: 5 }, { p: 0.005, kind: 'prism', n: 15 },
  { p: 0.35, kind: 'gold', n: 8000 }, { p: 0.18, kind: 'item', item: 'stone', n: 3 },
  { p: 0.10, kind: 'item', item: 'boost', n: 2 }, { p: 0.065, kind: 'item', item: 'protect', n: 1 },
];
const ALCHEMY = [
  { id: 'low',  name: '약불', emoji: '🔥',       stone: 5,  gold: 20000,  table: [{ p: 0.62, n: 0 }, { p: 0.27, n: 1 }, { p: 0.08, n: 2 },  { p: 0.025, n: 4 },  { p: 0.005, n: 10 }] },
  { id: 'mid',  name: '중불', emoji: '🔥🔥',     stone: 15, gold: 100000, table: [{ p: 0.52, n: 0 }, { p: 0.30, n: 3 }, { p: 0.125, n: 5 }, { p: 0.045, n: 10 }, { p: 0.01, n: 30 }] },
  { id: 'high', name: '강불', emoji: '🔥🔥🔥',   stone: 40, gold: 400000, table: [{ p: 0.52, n: 0 }, { p: 0.28, n: 8 }, { p: 0.13, n: 15 },  { p: 0.06, n: 30 },  { p: 0.01, n: 80 }] },
];
const CAPSULE_TABLE = [
  { p: 0.160, kind: 'prism', n: 1 }, { p: 0.040, kind: 'prism', n: 3 }, { p: 0.006, kind: 'prism', n: 10 }, { p: 0.0005, kind: 'prism', n: 50 },
  { p: 0.420, kind: 'gold', n: 10000 }, { p: 0.040, kind: 'gold', n: 50000 },
  { p: 0.200, kind: 'item', item: 'stone', n: 2 }, { p: 0.1335, kind: 'none' },
];
function rollTable(t) {
  let r = Math.random();
  for (const e of t) { r -= e.p; if (r < 0) return e; }
  return t[t.length - 1];
}
function gainPrism(p, n) { n = Math.max(0, n | 0); p.prism = (p.prism || 0) + n; p.prismEarned = (p.prismEarned || 0) + n; return n; }
function rewardText(e) {
  if (e.kind === 'prism') return '💎 프리즘 ' + e.n;
  if (e.kind === 'gold') return '💰 ' + e.n.toLocaleString() + 'G';
  if (e.kind === 'item') return ITEMS[e.item].emoji + ' ' + ITEMS[e.item].name + ' ×' + e.n;
  return '빈 캡슐';
}
// 표에서 뽑힌 보상을 실제로 지급하고 '받은 것' 을 돌려준다(가방이 꽉 차면 아이템은 놓친다).
function grantRoll(p, e) {
  if (e.kind === 'prism') return { kind: 'prism', n: gainPrism(p, e.n), text: rewardText(e) };
  if (e.kind === 'gold') return { kind: 'gold', n: gainGold(p, e.n, true), text: rewardText(e) };
  if (e.kind === 'item') {
    const got = addItem(p, e.item, e.n);
    return { kind: 'item', item: e.item, n: got, text: rewardText(e) + (got < e.n ? ' (가방이 꽉 차 ' + (e.n - got) + '개 놓침)' : '') };
  }
  return { kind: 'none', n: 0, text: rewardText(e) };
}
const tableView = t => t.map(e => ({ p: e.p, text: e.kind ? rewardText(e) : (e.n ? '💎 프리즘 ' + e.n : '💨 잿더미(꽝)') }));
function prismInfo() {
  return {
    box: { table: tableView(BOX_TABLE) },
    alchemy: ALCHEMY.map(a => ({ id: a.id, name: a.name, emoji: a.emoji, stone: a.stone, gold: a.gold, table: tableView(a.table) })),
    capsule: { price: CONFIG.capsulePrice, batchMax: CONFIG.capsuleBatchMax, table: tableView(CAPSULE_TABLE) },
  };
}
// 📦 상자 — 열쇠 1개로 상자 3개 중 하나를 고른다. 세 상자의 내용물을 그 순간 굴려서
// 고른 것만 주고, 나머지 둘은 '이게 들어 있었어요' 로 보여준다(고른 뒤에 굴리므로 미리 알 방법이 없다).
function openBox(db, id, pick) {
  const p = norm(db.players[id]);
  pick = parseInt(pick, 10);
  if (!(pick >= 0 && pick <= 2)) return { ok: false, error: '상자를 하나 고르세요.' };
  if (!takeItem(p, 'boxkey', 1)) return { ok: false, error: '🗝️ 상자 열쇠가 없어요. 몬스터를 사냥하면 가끔 나와요.' };
  const rolls = [rollTable(BOX_TABLE), rollTable(BOX_TABLE), rollTable(BOX_TABLE)];
  const got = grantRoll(p, rolls[pick]);
  bumpG(p, 'box'); if (rolls[pick] === BOX_TABLE[3]) bumpG(p, 'boxJ');   // 칭호용(💎15 = 상자 최고 칸)
  if (got.kind === 'prism' && got.n >= 5) addLog(db, '📦 ' + p.nick + ' 상자에서 💎 프리즘 ' + got.n + '개!');
  // items: 세 상자 내용물의 종류(화면이 보상 아이콘을 그리는 데 쓴다). boxes 는 예전 화면 호환용 글자
  return { ok: true, pick, boxes: rolls.map(rewardText), items: rolls.map(e => ({ kind: e.kind, n: e.n, item: e.item || null })),
    got, keysLeft: itemCount(p, 'boxkey'), msg: '📦 ' + got.text + ' 획득!' };
}
// ⚗️ 연금술 — 마석 + 골드를 함께 넣고 돌린다. 불이 셀수록 마석당 기대값↑, 골드당 기대값↓.
function alchemy(db, id, tierId) {
  const p = norm(db.players[id]);
  const a = ALCHEMY.find(x => x.id === tierId);
  if (!a) return { ok: false, error: '불 세기를 고르세요.' };
  if (itemCount(p, 'stone') < a.stone) return { ok: false, error: '🔮 마석이 부족해요 (' + itemCount(p, 'stone') + '/' + a.stone + ') — 몬스터 사냥에서 나와요.' };
  if (p.gold < a.gold) return { ok: false, error: '골드 부족! (필요 ' + a.gold.toLocaleString() + 'G / 보유 ' + p.gold.toLocaleString() + 'G)' };
  takeItem(p, 'stone', a.stone);
  p.gold -= a.gold; p.goldSpent = (p.goldSpent || 0) + a.gold;
  const e = rollTable(a.table);
  const n = gainPrism(p, e.n);
  bumpG(p, 'alch'); if (!e.n) bumpG(p, 'ash'); if (e === a.table[a.table.length - 1]) bumpG(p, 'alchJ');   // 칭호용
  if (n >= 30) addLog(db, '⚗️ ' + p.nick + ' 연금술 대성공! 💎 프리즘 ' + n + '개');
  return { ok: true, tier: a.id, prism: n, msg: n > 0 ? '⚗️ ' + a.name + ' 연금 성공! 💎 프리즘 +' + n : '💨 잿더미만 남았어요… (' + a.name + ')' };
}
// 🧸 캡슐 — 골드만 있으면 몇 번이든. 한 번에 최대 10번까지 묶어서 돌릴 수 있다.
function capsule(db, id, times) {
  const p = norm(db.players[id]);
  times = Math.max(1, Math.min(CONFIG.capsuleBatchMax, parseInt(times, 10) || 1));
  const price = CONFIG.capsulePrice;
  if (p.gold < price) return { ok: false, error: '골드 부족! (캡슐 1회 ' + price.toLocaleString() + 'G)' };
  const results = [];
  let prism = 0, gold = 0, airRun = 0;
  for (let i = 0; i < times && p.gold >= price; i++) {
    p.gold -= price; p.goldSpent = (p.goldSpent || 0) + price;
    const e = rollTable(CAPSULE_TABLE), g = grantRoll(p, e);
    results.push(g);
    bumpG(p, 'cap'); if (e.kind === 'none') bumpG(p, 'capE'); if (e === CAPSULE_TABLE[3]) bumpG(p, 'capJ');   // 칭호용(💎50 = 최고 칸)
    airRun = e.kind === 'none' ? airRun + 1 : 0; if (airRun >= 3) setEgg(p, 'air');   // 🥚 빈 캡슐 3연속
    if (g.kind === 'prism') prism += g.n;
    if (g.kind === 'gold') gold += g.n;
  }
  const big = results.find(r => r.kind === 'prism' && r.n >= 10);
  if (big) addLog(db, '🧸 ' + p.nick + ' 캡슐에서 💎 프리즘 ' + big.n + '개!');
  return { ok: true, silent: true, results, prism, gold, spent: results.length * price,
    msg: '🧸 캡슐 ' + results.length + '회 — 💎 +' + prism + (gold ? ' · 💰 +' + gold.toLocaleString() + 'G' : '') };
}
// 💎 프리즘 상점
function prismShopItems(p) {
  const su = slotUnlock(p || {});
  return [
    { id: 'slot', emoji: '🗡️', name: '장비 칸 +1', price: su.price, soldOut: su.maxed,
      locked: !su.maxed && !su.ok, lockMsg: su.maxed ? '' : slotLockMsg(su),
      desc: '+' + CONFIG.maxLevel + ' 을 찍은 무기 한 자루마다 한 칸(★ 초월 무기 포함). 새 직업 무기를 +0·★0부터 따로 키워요 · 영구 · 최대 ' + CONFIG.weaponSlotsMax + '칸' },
    { id: 'prismdye', emoji: ITEMS.prismdye.emoji, name: ITEMS.prismdye.name, price: 60, desc: ITEMS.prismdye.desc, nickPreview: 'prism' },
    { id: 'hammer', emoji: ITEMS.hammer.emoji, name: ITEMS.hammer.name, price: 8, desc: ITEMS.hammer.desc },
    { id: 'ascpack', emoji: '🎁', name: '초월 꾸러미', price: 25, desc: ITEMS.shard.emoji + ' 초월의 파편 30 + ' + ITEMS.essence.emoji + ' 초월의 정수 3' },
  ];
}
// 💎 프리즘 탭 — 확률표·상점 목록·재료 보유량(본인 기준 가격 포함)
function prismView(db, id) {
  const p = norm(db.players[id]);
  return { ok: true, prism: p.prism || 0, keys: itemCount(p, 'boxkey'), stones: itemCount(p, 'stone'), gold: p.gold,
    info: prismInfo(), shop: prismShopItems(p) };
}
function buyPrism(db, id, itemId) {
  const p = norm(db.players[id]);
  const it = prismShopItems(p).find(x => x.id === itemId);
  if (!it) return { ok: false, error: '없는 상품이에요.' };
  if (it.soldOut) return { ok: false, error: '장비 칸이 이미 최대(' + CONFIG.weaponSlotsMax + '칸)예요.' };
  if (it.locked) return { ok: false, error: '🔒 장비 칸은 +' + CONFIG.maxLevel + ' 무기 한 자루마다 하나씩 열려요 (' + it.lockMsg + ')' };
  if ((p.prism || 0) < it.price) return { ok: false, error: '💎 프리즘 부족! (필요 ' + it.price + ' / 보유 ' + (p.prism || 0) + ')' };
  if (itemId === 'prismdye' || itemId === 'hammer') {
    if (!canHold(p, itemId)) return { ok: false, error: '🎒 가방이 꽉 찼어요.' };
    p.prism -= it.price; addItem(p, itemId, 1);
  } else if (itemId === 'ascpack') {
    if (freeSpace(p, 'shard') < 30 || freeSpace(p, 'essence') < 3) return { ok: false, error: '🎒 가방이 꽉 찼어요.' };
    p.prism -= it.price; addItem(p, 'shard', 30); addItem(p, 'essence', 3);
  } else if (itemId === 'slot') {
    p.prism -= it.price;
    p.weaponSlotBought = (p.weaponSlotBought || 0) + 1;
    addLog(db, '🗡️ ' + p.nick + ' 장비 칸 확장! (' + weaponSlots(p) + '칸)');
    return { ok: true, msg: '🗡️ 장비 칸이 ' + weaponSlots(p) + '칸이 됐어요! 무기 칸의 ➕ 를 눌러 새 직업 무기를 만들어 보세요.' };
  }
  return { ok: true, msg: it.emoji + ' ' + it.name + ' 구매! (💎 -' + it.price + ')' };
}

/* ---------- 속성 상성 (포켓몬식 순환) ----------
 * 7속성 순환: 앞이 바로 뒤를 이긴다 — 물이 불을 끄고 · 불이 얼음을 녹이고 · 얼음이 바람을 얼리고
 *   · 바람이 독기를 흩고 · 독이 땅을 더럽히고 · 땅이 번개를 흘려보내고 · 번개가 물을 감전시킨다.
 * 빛 ⇄ 어둠은 서로를 이긴다. 이기면 피해 ×2, 지면 ×0.5, 나머지 ×1. */
const ELEMENT_CYCLE = ['water', 'fire', 'ice', 'wind', 'poison', 'earth', 'thunder'];
const ELEMENT_BEATS = { light: ['dark'], dark: ['light'] };
ELEMENT_CYCLE.forEach((k, i) => { ELEMENT_BEATS[k] = [ELEMENT_CYCLE[(i + 1) % ELEMENT_CYCLE.length]]; });
function beats(a, b) { return !!(ELEMENT_BEATS[a] && ELEMENT_BEATS[a].includes(b)); }
// 공격 속성 a 가 방어 속성 b 를 칠 때 배율. 빛·어둠은 서로 이기므로 '이김' 을 먼저 본다.
function elemMult(a, b) { return beats(a, b) ? 2 : beats(b, a) ? 0.5 : 1; }
function weakTo(b) { return ELEMENTS.filter(e => beats(e.key, b)).map(e => e.key); }   // b 를 이기는 속성들
function elementChart() {
  return ELEMENTS.map(e => ({ key: e.key, name: e.name, emoji: e.emoji, color: e.color, beats: ELEMENT_BEATS[e.key] || [], weakTo: weakTo(e.key) }));
}

/* ---------- 속성 스킬 (★1 이상 무기) ----------
 * 초월한 무기는 직업 스킬과 별개로 그 무기 속성의 스킬을 전투마다 1회 쓸 수 있다(초월 던전).
 * 피해량은 '연타 n회분'(tap = 공격력 × raidHitDmgMult) 으로 잡고, 보스 속성과의 상성 배율이 곱해진다. */
const ELEMENT_SKILLS = {
  fire:    { name: '화염 폭발', desc: '즉시 연타 35회분 + 5초간 화상(초당 9회분)', dmg: 35, dot: { per: 9, ms: 5000 } },
  water:   { name: '치유의 비', desc: 'HP +35%', heal: 35 },
  earth:   { name: '대지의 방벽', desc: '6초 동안 받는 피해 −40%', buff: { k: 'dr', v: 0.4, ms: 6000 } },
  wind:    { name: '질풍', desc: '6초 동안 연타 피해 ×1.6', buff: { k: 'haste', v: 1.6, ms: 6000 } },
  thunder: { name: '낙뢰', desc: '즉시 연타 65회분', dmg: 65 },
  ice:     { name: '빙결', desc: '보스의 다음 공격 1회 무효 + 연타 15회분', dmg: 15, block: 1 },
  light:   { name: '성광', desc: '연타 25회분 + HP +20%', dmg: 25, heal: 20 },
  dark:    { name: '흡혈', desc: '연타 40회분 + HP +15%', dmg: 40, heal: 15 },
  poison:  { name: '맹독', desc: '전투가 끝날 때까지 초당 연타 6회분 지속 피해', dot: { per: 6, ms: 0 } },   // ms 0 = 끝까지
};
/* ---------- ⚡ 강공격 커맨드(레이드·던전 서버 판정) ----------
 * 화면(gesture.js)이 무기별 커맨드를 인식하면 *-strong 을 보낸다. 서버는 모양을 볼 수 없으니
 * 위력·쿨타임을 여기서 정하고 막는다 — 같은 사람의 강공격은 gapMs 안에 다시 못 쓴다(그리는 데 드는 최소 시간).
 * 위력은 '연타 n회분'(사냥터 STRONG 표와 같은 값). 활은 당긴 길이(power 0.4~1)만큼, 지팡이는 '마력 공명'(5초 연타 ×1.5). */
const STRONG_ATTACKS = {
  warrior: { name: '베어 가르기', emoji: '⚔️', taps: 6,  gapMs: 350 },
  archer:  { name: '관통 사격',   emoji: '🏹', taps: 8,  gapMs: 350 },
  tanker:  { name: '방패 강타',   emoji: '🛡️', taps: 5,  gapMs: 750 },
  healer:  { name: '별빛 폭발',   emoji: '✨', taps: 22, gapMs: 900, buff: { mult: 1.5, ms: 5000 } },
};
function strongUnits(cls, power) {
  const c = STRONG_ATTACKS[cls] || STRONG_ATTACKS.warrior;
  const pw = cls === 'archer' ? Math.max(0.4, Math.min(1, Number(power) || 1)) : 1;
  return Math.max(1, Math.round(c.taps * pw));
}
function countStrong(p) { const st = atkStat(p); st.s++; if (p.class) st.w[p.class] = (st.w[p.class] || 0) + 1; }
const CLASS_SKILLS = {
  warrior: { name: '강타', emoji: '⚔️', desc: '연타 45회분', dmg: 45 },
  archer:  { name: '난사', emoji: '🏹', desc: '연타 60회분', dmg: 60 },
  tanker:  { name: '철벽', emoji: '🛡️', desc: '남은 전투 동안 받는 피해 −25% · HP +10%', buff: { k: 'dr', v: 0.25, ms: 0 }, heal: 10 },
  healer:  { name: '치유의 물결', emoji: '✨', desc: 'HP +40%', heal: 40 },
};
function elementSkillView(el) { const s = ELEMENT_SKILLS[el]; const e = elementOf(el); return s ? { el, emoji: e.emoji, name: s.name, desc: s.desc } : null; }

/* ---------- 🌌 초월 던전 ----------
 * ★1 무기가 있어야 들어간다(엔드 콘텐츠). 매주 월요일(KST) 1층부터 다시 오르고, 층마다 보스 속성이
 * 주차 시드로 새로 섞인다 → 매주 다른 무기·재련이 필요하다. 지난주 기록 −5층까지는 자동 소탕.
 *   입구(1~15)  : 속성 1개. 아무 무기로나 밀다가 막히면 약점 속성 무기로 넘긴다.
 *   중층(16~30) : 무기 2자루 이상 · 전투 중 보스 속성이 2번 바뀐다 → 바꿔 끼며 싸운다.
 *   심층(31~45) : 무기 3자루 · 3단계.   심연(46~50): 무기 4자루 · 4단계.
 * 전투는 레이드와 같은 연타식(혼자). 들고 있는 무기의 공격력·직업 패시브(탱커 피해감소·힐러 회복)가
 * 그대로 적용되고, 무기마다 직업 스킬·속성 스킬(★1+)을 1회씩 쓸 수 있다.
 * 상태는 players.data.dun 에 실린다(⚠️ level/gold/nick·일일 필드 이름은 저장 때 빠지므로 쓰지 않는다). */
const DUNGEON = {
  floors: 50, sweepBack: 5, firstClearPrism: 3,
  swapCooldown: 1200,                 // 전투 중 무기 교체 쿨타임(ms)
  baseDuration: 15000, phaseDuration: 5000,   // 전투 시간 = 15초 + 5초 × (단계 − 1)
  /* 보스 HP = 구간 시작값 × 성장률^(층 − 구간 첫 층).
   * 무기 공격력은 +99 에서 멈추고 ★ 당 +8% 뿐이라, 깊은 층의 난이도는 HP 보다 '상성 맞추기(단계마다 약점 무기)'
   * 와 위험도(회복·피해감소 필요)가 만든다. 입구는 가파르게 — 무상성 +99 가 10층 근처에서 막히고 약점 무기로 15층까지.
   * tools/sim-dungeon.js 로 장비별 도달 층을 확인할 것. */
  bands: [
    { from: 1,  to: 15, weapons: 1, phases: 1, name: '입구', hp0: 22000,  g: 1.149 },
    { from: 16, to: 30, weapons: 2, phases: 2, name: '중층', hp0: 140000, g: 1.04 },
    { from: 31, to: 45, weapons: 3, phases: 3, name: '심층', hp0: 260000, g: 1.027 },
    { from: 46, to: 50, weapons: 4, phases: 4, name: '심연', hp0: 420000, g: 1.054 },
  ],
  danger1: 40, dangerStep: 2.5,       // 보스가 전투 동안 넣는 총 피해(HP %). 100 을 넘으면 회복·감소가 필요
  attacksBase: 3,                     // 보스 공격 횟수 = 3 + 단계 수
  healPerSec: 2.6,                    // 힐러 무기를 들고 있는 동안 초당 HP 회복(%) — 레이드와 같음
  /* 🛡️ 보스 보호막 — 스킬 한 번(즉시 피해 + 그 스킬의 지속 피해 합계)으로 깎을 수 있는 건 보스 최대 체력의 40%까지.
   * 낮은 층에서 약점 스킬 한 방에 끝나지 않게 하고(연타가 필요), 깊은 층은 스킬이 원래 40%보다 약해서 거의 영향이 없다. */
  skillCap: 0.4,
};
const DUN_MONSTERS = {
  fire: ['🔥', '불꽃 거인'], water: ['🐙', '심해의 크라켄'], earth: ['🗿', '대지의 거상'], wind: ['🦅', '폭풍의 그리폰'],
  thunder: ['⚡', '뇌전의 군주'], ice: ['❄️', '빙결의 여왕'], light: ['😇', '타락한 천사'], dark: ['🦇', '그림자 군주'], poison: ['🐍', '역병의 히드라'],
};
const DUN_CHIMERA = { 2: ['🐲', '쌍두 키메라'], 3: ['👹', '원소의 군주'], 4: ['🌌', '심연의 지배자'] };
// 이번 주 키(월요일 시작, KST) 'YYYY-MM-DD'
function weekKey(offset) {
  const d = new Date(Date.now() + KST_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7 + 7 * (offset || 0));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
function weekResetIn() {
  const d = new Date(Date.now() + KST_OFFSET_MS);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7 + 7) - KST_OFFSET_MS;
  return Math.max(0, next - Date.now());
}
// 문자열 시드 난수(mulberry32) — 같은 주·같은 층이면 모두에게 같은 보스
function seededRng(str) {
  let a = seedNum(str) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function dunBand(floor) { return DUNGEON.bands.find(b => floor >= b.from && floor <= b.to) || DUNGEON.bands[DUNGEON.bands.length - 1]; }
function dunHp(floor) { const b = dunBand(floor); return Math.round(b.hp0 * Math.pow(b.g, floor - b.from)); }
// 층 첫 돌파(그 주) 보상 — 소탕한 층도 같은 보상을 받는다
function dunReward(floor) { return { shard: Math.ceil(floor / 3) + 2, essence: floor % 10 === 0 ? 2 : floor % 5 === 0 ? 1 : 0 }; }
function dunFloor(floor, wk) {
  const band = dunBand(floor);
  const rng = seededRng('dun:' + wk + ':' + floor);
  const keys = ELEMENTS.map(e => e.key), els = [];
  while (els.length < band.phases) { const k = keys[Math.floor(rng() * keys.length)]; if (!els.includes(k)) els.push(k); }
  const duration = DUNGEON.baseDuration + DUNGEON.phaseDuration * (band.phases - 1);
  const look = band.phases === 1 ? DUN_MONSTERS[els[0]] : DUN_CHIMERA[band.phases];
  return {
    floor, band: band.name, weapons: band.weapons, duration, hp: dunHp(floor),
    danger: Math.round(DUNGEON.danger1 + DUNGEON.dangerStep * (floor - 1)),
    emoji: look[0], name: look[1], reward: dunReward(floor),
    phases: els.map((el, i) => ({ el, at: Math.round(duration * i / els.length) })),
  };
}
function dunState(p) {
  if (!p.dun || typeof p.dun !== 'object') p.dun = { wk: '', fl: 0, best: 0, at: 0, fight: null, sweep: null };
  return p.dun;
}
function dunBest(p) { return (p && p.dun && p.dun.best) || 0; }
// 새 주가 됐으면 지난 기록 −5층까지 소탕(보상 지급)하고 이번 주로 넘긴다 — 쓰기 경로에서만 호출
function dunEnsure(p) {
  const d = dunState(p), wk = weekKey();
  if (d.wk === wk) return d;
  const to = Math.max(0, Math.min(DUNGEON.floors, (d.fl || 0) - DUNGEON.sweepBack));
  let shard = 0, essence = 0;
  for (let f = 1; f <= to; f++) { const r = dunReward(f); shard += r.shard; essence += r.essence; }
  const got = { shard: shard ? addItem(p, 'shard', shard) : 0, essence: essence ? addItem(p, 'essence', essence) : 0 };
  d.prevWk = d.wk || null; d.prevFl = d.fl || 0;
  d.wk = wk; d.fl = to; d.at = to ? Date.now() : 0; d.fight = null;
  d.sweep = to ? { to, shard: got.shard, essence: got.essence } : null;
  return d;
}
// 읽기 전용 — GET 화면용으로 '이번 주라면' 어떻게 보일지만 계산(저장·지급 없음)
function dunProjectWeek(p) {
  const d = dunState(p), wk = weekKey();
  if (d.wk === wk) return { wk, fl: d.fl || 0, best: d.best || 0, sweep: d.sweep || null };
  const to = Math.max(0, Math.min(DUNGEON.floors, (d.fl || 0) - DUNGEON.sweepBack));
  return { wk, fl: to, best: d.best || 0, sweep: to ? { to, pending: true } : null };
}
function dunFight(p) { return p.dun && p.dun.fight; }
function inDungeonFight(p) { const f = dunFight(p); return !!(f && f.status === 'active' && Date.now() - f.startTs < f.duration + 2000); }
function dunPhaseIdx(f, t) { let i = 0; for (let k = 0; k < f.phases.length; k++) if (t >= f.phases[k].at) i = k; return i; }
function dunPhaseEl(f, t) { return f.phases[dunPhaseIdx(f, t)].el; }
function dunBuff(f, k, t) { return f.buffs.filter(b => b.k === k && t >= b.from && (b.to === 0 || t < b.to)); }
// 받는 피해 감소: 탱커 무기를 들고 있으면 패시브(레이드 상한 0.4) + 철벽·대지의 방벽 버프, 합계 상한 0.6
function dunDR(p, f, t) {
  const base = p.class === 'tanker' ? Math.min(CONFIG.raidDRCap, memberStats(p).dr) : 0;
  return Math.min(CONFIG.raidDRCapSkill, base + dunBuff(f, 'dr', t).reduce((a, b) => a + b.v, 0));
}
function dunEvent(f, t, text) { f.events.push({ t, text }); if (f.events.length > 30) f.events.shift(); }
// 시계 진행(쓰기 경로) — 힐러 회복 · 지속 피해 · 단계 전환 · 보스 공격 → 종료 판정
function dunTick(db, p, f) {
  if (!f || f.status !== 'active') return;
  const now = Date.now(), el = Math.min(now - f.startTs, f.duration), from = f.lastEl || 0;
  if (el > from) {
    if (p.class === 'healer' && f.hp > 0) f.hp = Math.min(100, f.hp + DUNGEON.healPerSec * (el - from) / 1000);
    for (const d of f.dots) {
      const a = Math.max(d.from, d.done), b = Math.min(d.to || f.duration, el);
      if (b > a) {
        let x = d.per * (b - a) / 1000 * elemMult(d.el, dunPhaseEl(f, (a + b) / 2));
        if (d.capLeft != null) { x = Math.min(x, d.capLeft); d.capLeft -= x; }   // 보호막: 그 스킬의 남은 한도까지만
        f.bossHP = Math.max(0, f.bossHP - x); f.dmg += x; d.done = b;
      }
    }
    for (let k = 1; k < f.phases.length; k++) {
      const ph = f.phases[k];
      if (ph.at > from && ph.at <= el) { const e = elementOf(ph.el); dunEvent(f, ph.at, '🌀 보스가 ' + e.emoji + ' ' + e.name + ' 속성으로 바뀌었다! 약점: ' + weakTo(ph.el).map(x => elementOf(x).emoji + elementOf(x).name).join('·')); }
    }
    f.lastEl = el;
  }
  if (f.bossHP <= 0) return dunResolve(db, p, f, true);
  for (const a of f.attacks) {
    if (a.done || a.t > el) continue;
    a.done = true;
    if (f.block > 0) { f.block--; dunEvent(f, a.t, '❄️ 빙결 — 보스의 공격을 막았다!'); continue; }
    const net = a.pct * (1 - dunDR(p, f, a.t));
    f.hp = Math.max(0, f.hp - net);
    if (net > 0) f.hurt = true;   // 한 대라도 맞았나(무결의 정복자)
    dunEvent(f, a.t, '💥 보스 공격! HP -' + Math.round(net) + '%');
    if (f.hp <= 0) break;
  }
  if (f.hp <= 0) return dunResolve(db, p, f, false);
  if (now - f.startTs >= f.duration) return dunResolve(db, p, f, false);
}
function dunResolve(db, p, f, win) {
  if (f.status === 'done') return;
  f.status = 'done'; f.win = !!win; f.endTs = Date.now();
  if (!win) { dunEvent(f, f.lastEl || 0, '☠️ 패배…'); return; }
  bumpD(p, 'clear');
  if (f.floor >= 31 && !f.hurt) p.ds.flaw = 1;
  const d = dunState(p);
  const rw = dunReward(f.floor), got = { shard: 0, essence: 0, prism: 0, first: false };
  if (f.floor === (d.fl || 0) + 1) {           // 이번 주 처음 넘는 층만 보상(재도전 파밍 방지)
    d.fl = f.floor; d.at = Date.now();
    got.shard = addItem(p, 'shard', rw.shard);
    if (rw.essence) got.essence = addItem(p, 'essence', rw.essence);
    if (f.floor > (d.best || 0)) { d.best = f.floor; got.prism = gainPrism(p, DUNGEON.firstClearPrism); got.first = true; }
  }
  f.reward = got;
  dunEvent(f, f.lastEl || 0, '🏆 ' + f.floor + '층 돌파!');
  if (got.first && (f.floor % 5 === 0 || f.floor >= DUNGEON.floors)) addLog(db, '🌌 ' + p.nick + ' 초월 던전 ' + f.floor + '층 최초 돌파!');
}
function dunWeaponsView(p, f, t) {
  const cur = f ? dunPhaseEl(f, t) : null;
  return allWeapons(p).map(w => {
    const e = elementOf(w.el), c = CLASSES[w.cls] || CLASSES.warrior, u = (f && f.used[w.cls]) || {};
    return { cls: w.cls, emoji: c.emoji, weapon: c.weapon, lv: w.lv, asc: w.asc || 0, el: w.el, elEmoji: e.emoji, elName: e.name,
      equipped: !!w.equipped, mult: cur ? elemMult(w.el, cur) : null, usedC: !!u.c, usedE: !!u.e,
      classSkill: CLASS_SKILLS[w.cls] ? CLASS_SKILLS[w.cls].emoji + ' ' + CLASS_SKILLS[w.cls].name : null,
      elemSkill: (w.asc || 0) >= 1 ? elementSkillView(w.el) : null };
  });
}
// 전투 뷰(저장값 기준). 보스 공격 시각도 같이 내려서 클라가 폴링 없이 HP 를 예측한다(솔로라 숨길 이유 없음 — 오히려 '예고' 가 된다)
function dunFightView(p) {
  const f = dunFight(p);
  if (!f) return null;
  const now = Date.now(), t = Math.min(now - f.startTs, f.duration);
  return {
    status: f.status, floor: f.floor, name: f.name, emoji: f.emoji, startTs: f.startTs, duration: f.duration,
    remain: Math.max(0, f.duration - (now - f.startTs)), serverNow: now,
    phases: f.phases.map(ph => ({ el: ph.el, at: ph.at, emoji: elementOf(ph.el).emoji, name: elementOf(ph.el).name, weakTo: weakTo(ph.el) })),
    phase: dunPhaseIdx(f, t), bossHP: Math.round(f.bossHP), bossMax: f.bossMax, hp: Math.round(f.hp * 10) / 10,
    dr: Math.round(dunDR(p, f, t) * 100), block: f.block, haste: dunBuff(f, 'haste', t).length > 0,
    attacks: f.attacks.map(a => ({ t: a.t, pct: a.pct, done: a.done })),
    healPerSec: p.class === 'healer' ? DUNGEON.healPerSec : 0,
    swapIn: Math.max(0, (f.swapAt || 0) - now), danger: f.danger,
    weapons: dunWeaponsView(p, f, t), hits: f.hits, dmg: Math.round(f.dmg),
    events: f.events.slice(-6), win: f.win, reward: f.reward || null,
  };
}
function dungeonView(db, id) {
  const p = norm(db.players[id]);
  const w = dunProjectWeek(p), wk = w.wk;
  const unlocked = ascendMax(p) >= 1;
  const next = w.fl < DUNGEON.floors ? dunFloor(w.fl + 1, wk) : null;
  const look = (fl) => fl && Object.assign({}, fl, {
    phases: fl.phases.map(ph => ({ el: ph.el, emoji: elementOf(ph.el).emoji, name: elementOf(ph.el).name, weakTo: weakTo(ph.el) })),
  });
  const list = Object.keys(db.players).map(k => db.players[k]).filter(q => q && q.dun && q.dun.wk === wk && q.dun.fl > 0)
    .sort((a, b) => (b.dun.fl - a.dun.fl) || ((a.dun.at || 0) - (b.dun.at || 0))).slice(0, 20)
    .map(q => ({ nick: q.nick, floor: q.dun.fl, best: q.dun.best || 0, nickColor: q.nickColor || null, weaponCount: allWeapons(q).length }));
  return {
    ok: true, unlocked, week: wk, resetIn: weekResetIn(), floor: w.fl, best: w.best, sweep: w.sweep, max: DUNGEON.floors,
    weaponCount: allWeapons(p).length, next: look(next),
    upcoming: [2, 3, 4].map(n => w.fl + n <= DUNGEON.floors ? look(dunFloor(w.fl + n, wk)) : null).filter(Boolean),
    weapons: dunWeaponsView(p, null, 0), chart: elementChart(), bands: DUNGEON.bands, skillCap: DUNGEON.skillCap,
    // 끝난 던전 전투도 1분이 지나면 로비로(결과 화면이 계속 남지 않게)
    fight: (() => { const f = dunFight(p); return f && (f.status === 'active' || Date.now() - (f.endTs || 0) < RESULT_KEEP_MS) ? dunFightView(p) : null; })(), rank: list,
  };
}
function dunStart(db, id) {
  const p = norm(db.players[id]);
  if (!p.class) return { ok: false, error: '먼저 직업을 고르세요.' };
  if (ascendMax(p) < 1) return { ok: false, error: '🔒 초월 던전은 ★1 무기가 있어야 들어갈 수 있어요. (+99 에서 🌈 초월)' };
  const d = dunEnsure(p);
  if (d.fight && d.fight.status === 'active') {
    dunTick(db, p, d.fight);
    if (d.fight.status === 'active') return { ok: false, error: '이미 전투 중이에요.' };
  }
  if (inActiveRaid(db, id)) return { ok: false, error: '레이드 중에는 던전에 들어갈 수 없어요.' };
  const floor = (d.fl || 0) + 1;
  if (floor > DUNGEON.floors) return { ok: false, error: '🏔️ 이번 주 정상(' + DUNGEON.floors + '층)을 정복했어요! 다음 주에 다시 도전하세요.' };
  const fl = dunFloor(floor, d.wk);
  const have = allWeapons(p).length;
  if (have < fl.weapons) return { ok: false, error: '🗡️ ' + floor + '층(' + fl.band + ')부터는 무기 ' + fl.weapons + '자루 이상이 필요해요. (지금 ' + have + '자루)' };
  const nA = DUNGEON.attacksBase + fl.phases.length, times = [];
  for (let i = 0; i < nA; i++) times.push(randInt(1000, fl.duration - 600));
  times.sort((a, b) => a - b);
  const now = Date.now();
  d.fight = {
    status: 'active', floor, name: fl.name, emoji: fl.emoji, startTs: now, lastEl: 0, duration: fl.duration,
    phases: fl.phases, bossMax: fl.hp, bossHP: fl.hp, hp: 100, danger: fl.danger,
    attacks: times.map(t => ({ t, pct: fl.danger / nA, done: false })),
    dots: [], buffs: [], block: 0, used: {}, swapAt: 0, hits: 0, dmg: 0, win: null, reward: null,
    events: [{ t: 0, text: fl.emoji + ' ' + floor + '층 ' + fl.name + ' — ' + fl.phases.map(ph => elementOf(ph.el).emoji + elementOf(ph.el).name).join(' → ') }],
  };
  return { ok: true, silent: true, fight: dunFightView(p) };
}
function dunActive(db, id) {
  const p = norm(db.players[id]), f = dunFight(p);
  if (!f) return { p, f: null, err: { ok: false, error: '진행 중인 던전 전투가 없어요.' } };
  dunTick(db, p, f);
  return { p, f };
}
function dunHit(db, id, hits) {
  const { p, f, err } = dunActive(db, id); if (err) return err;
  if (f.status !== 'active') return { ok: true, silent: true, ended: true, fight: dunFightView(p) };
  hits = Math.max(0, Math.min(parseInt(hits, 10) || 0, CONFIG.raidHitBatchMax));
  const t = Date.now() - f.startTs;
  const maxTotal = Math.floor(t / CONFIG.raidHitMsPerTap) + 12;   // 경과시간으로 물리적 최대치를 넘는 타수는 버린다
  const usedD = f.hits + (f.sUnits || 0);                          // 강공격(연타 n회분)도 같은 예산
  if (usedD + hits > maxTotal) hits = Math.max(0, maxTotal - usedD);
  const haste = dunBuff(f, 'haste', t).reduce((m, b) => Math.max(m, b.v), 1);
  const mult = elemMult(p.element, dunPhaseEl(f, t));
  const dmg = hits * memberStats(p).atk * CONFIG.raidHitDmgMult * mult * haste;
  f.bossHP = Math.max(0, f.bossHP - dmg); f.hits += hits; f.dmg += dmg;
  addTaps(p, hits); if (mult > 1 && hits) bumpD(p, 'weak', hits);   // 칭호용
  if (f.bossHP <= 0) dunTick(db, p, f);
  return { ok: true, silent: true, dmg: Math.round(dmg), mult, fight: dunFightView(p) };
}
// 스킬 효과 적용(직업·속성 공통) — 피해는 지금 단계 속성과의 상성 배율을 곱한다
function dunApplySkill(p, f, s, t, srcEl) {
  const tap = memberStats(p).atk * CONFIG.raidHitDmgMult, mult = elemMult(srcEl, dunPhaseEl(f, t)), parts = [];
  let cap = f.bossMax * DUNGEON.skillCap;   // 🛡️ 보스 보호막 — 이 스킬로 깎을 수 있는 최대치
  if (s.dmg) {
    const raw = s.dmg * tap * mult, d = Math.min(raw, cap);
    cap -= d; f.bossHP = Math.max(0, f.bossHP - d); f.dmg += d;
    parts.push('보스 -' + Math.round(d).toLocaleString() + (mult > 1 ? ' (효과 굉장!)' : mult < 1 ? ' (효과 별로…)' : '') + (raw > d ? ' 🛡️보호막' : ''));
  }
  if (s.dot) { f.dots.push({ per: s.dot.per * tap, el: srcEl, from: t, to: s.dot.ms ? t + s.dot.ms : 0, done: t, capLeft: cap }); parts.push('지속 피해'); }
  if (s.heal) { f.hp = Math.min(100, f.hp + s.heal); parts.push('HP +' + s.heal + '%'); }
  if (s.buff) { f.buffs.push({ k: s.buff.k, v: s.buff.v, from: t, to: s.buff.ms ? t + s.buff.ms : 0 }); parts.push(s.buff.k === 'dr' ? '피해 −' + Math.round(s.buff.v * 100) + '%' : '연타 ×' + s.buff.v); }
  if (s.block) { f.block += s.block; parts.push('다음 공격 무효'); }
  return parts.join(' · ');
}
// ⚡ 던전 강공격 — 연타 n회분 × 지금 단계 상성 배율. 지팡이는 5초 연타 ×1.5(던전의 haste 버프로)
function dunStrong(db, id, power) {
  const { p, f, err } = dunActive(db, id); if (err) return err;
  if (f.status !== 'active') return { ok: true, silent: true, ended: true, fight: dunFightView(p) };
  const c = STRONG_ATTACKS[p.class] || STRONG_ATTACKS.warrior, now = Date.now(), t = now - f.startTs;
  if (now - (f.strongAt || 0) < c.gapMs) return { ok: false, silent: true, error: '강공격 준비 중…' };
  const units = strongUnits(p.class, power), mult = elemMult(p.element, dunPhaseEl(f, t));
  if (f.hits + (f.sUnits || 0) + units > Math.floor(t / CONFIG.raidHitMsPerTap) + 12) return { ok: false, silent: true, error: '숨 고르는 중…' };
  f.strongAt = now; f.sUnits = (f.sUnits || 0) + units;
  const dmg = units * memberStats(p).atk * CONFIG.raidHitDmgMult * mult;
  f.bossHP = Math.max(0, f.bossHP - dmg); f.dmg += dmg;
  let text = c.emoji + ' ' + c.name + '! 보스 -' + Math.round(dmg).toLocaleString() + (mult > 1 ? ' (효과 굉장!)' : mult < 1 ? ' (효과 별로…)' : '');
  if (c.buff) { f.buffs.push({ k: 'haste', v: c.buff.mult, from: t, to: t + c.buff.ms }); text += ' · ✨ 마력 공명'; }
  dunEvent(f, t, text);
  countStrong(p);
  dunTick(db, p, f);
  return { ok: true, silent: true, dmg: Math.round(dmg), mult, strongText: text, fight: dunFightView(p) };
}
function dunSkill(db, id, kind) {
  const { p, f, err } = dunActive(db, id); if (err) return err;
  if (f.status !== 'active') return { ok: true, silent: true, ended: true, fight: dunFightView(p) };
  const t = Date.now() - f.startTs, u = f.used[p.class] || (f.used[p.class] = {});
  let text;
  if (kind === 'elem') {
    if ((p.ascend || 0) < 1) return { ok: false, error: '속성 스킬은 ★1 이상 무기만 쓸 수 있어요.' };
    if (u.e) return { ok: false, error: '이 무기의 속성 스킬은 이미 썼어요.' };
    u.e = true; bumpD(p, 'elem');
    const s = ELEMENT_SKILLS[p.element], e = elementOf(p.element);
    text = e.emoji + ' ' + s.name + '! ' + dunApplySkill(p, f, s, t, p.element);
  } else {
    if (u.c) return { ok: false, error: '이 무기의 직업 스킬은 이미 썼어요.' };
    u.c = true;
    const s = CLASS_SKILLS[p.class] || CLASS_SKILLS.warrior;
    text = s.emoji + ' ' + s.name + '! ' + dunApplySkill(p, f, s, t, p.element);
  }
  dunEvent(f, t, text);
  dunTick(db, p, f);
  return { ok: true, silent: true, skillText: text, fight: dunFightView(p) };
}
function dunSwap(db, id, cls) {
  const { p, f, err } = dunActive(db, id); if (err) return err;
  if (f.status !== 'active') return { ok: true, silent: true, ended: true, fight: dunFightView(p) };
  const now = Date.now();
  if (now < (f.swapAt || 0)) return { ok: false, error: '교체 준비 중… (' + ((f.swapAt - now) / 1000).toFixed(1) + '초)' };
  const r = swapWeapon(db, p, cls);
  if (!r.ok) return r;
  f.swapAt = now + DUNGEON.swapCooldown; bumpD(p, 'swap');
  const t = now - f.startTs, e = elementOf(p.element), m = elemMult(p.element, dunPhaseEl(f, t));
  dunEvent(f, t, '🔄 ' + classOf(p).emoji + ' ' + classOf(p).weapon + '(' + e.emoji + e.name + ')로 교체' + (m > 1 ? ' — 약점을 찌른다!' : m < 1 ? ' — 상성 불리…' : ''));
  dunTick(db, p, f);
  return { ok: true, silent: true, fight: dunFightView(p) };
}
function dunFinish(db, id) {
  const { p, f } = dunActive(db, id);
  return { ok: true, silent: true, fight: f ? dunFightView(p) : null };
}
// 결과 화면을 닫으면 전투 기록을 지운다(다음 층 정보로)
function dunLeave(db, id) {
  const p = norm(db.players[id]), d = dunState(p);
  if (d.fight && d.fight.status === 'active') { dunTick(db, p, d.fight); if (d.fight.status === 'active') return { ok: false, error: '전투가 끝난 뒤에 나갈 수 있어요.' }; }
  d.fight = null; d.sweep = null;
  return { ok: true, silent: true };
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
  // 직업 변경권은 장비 칸으로 대체됐다 — 갖고 있던 건 속성 재련권으로 1:1 바꿔 준다
  if (inv0.items.classtkt > 0) { inv0.items.eltkt = (inv0.items.eltkt || 0) + inv0.items.classtkt; }
  delete inv0.items.classtkt;
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
  ensureArmory(p);                                               // 보관 무기(장비 칸)
  if (p.prism == null) p.prism = 0;                              // 💎 프리즘
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
        ? { id: a.id, title: a.title, grade: a.grade, color: TITLE_GRADES[a.grade].color, earned: true, desc: a.desc }
        : a.hidden ? { grade: 'prism', hidden: true, earned: false }
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
    prism: p.prism || 0,             // 💎 프리즘
    weapons: weaponsView(p),         // 장비 칸(무기 여러 자루)
    dunBest: dunBest(p), dunOpen: ascendMax(p) >= 1, inDungeon: inDungeonFight(p),
    rerollCost: rerollCost(p.level || 0), rerollMin: rerollMinLevel(),   // 🔁 속성 재련 확인창용
    elemSkill: (p.ascend || 0) >= 1 ? elementSkillView(p.element) : null,   // ★1+ 무기의 속성 스킬(초월 던전)
    ascendMax: ascendMax(p),
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
    ks.sort((a, b) => rankCmp(db.players[a], db.players[b]));
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
/* 회원 탈퇴 — 캐릭터를 통째로 지운다(되돌릴 수 없음). 확인용으로 닉네임을 정확히 다시 입력받는다.
 * 여기서는 인메모리 db 만 정리한다(파티 해산·탈퇴, 남의 파티 초대 목록, 닉네임 색인).
 * 저장 계층이 players 행·일일 기록·상한·세션·속도제한 행을 따로 지운다(diff 저장은 '없어진 플레이어' 를 모른다). */
function deleteAccount(db, id, confirmNick) {
  const p = db.players[id] && norm(db.players[id]);
  if (!p) return { ok: false, error: '계정을 찾을 수 없어요.' };
  if (String(confirmNick || '').trim() !== p.nick) return { ok: false, error: '닉네임이 일치하지 않아요. 탈퇴하려면 닉네임을 정확히 입력하세요.' };
  if (inActiveRaid(db, id)) return { ok: false, error: '레이드 전투 중에는 탈퇴할 수 없어요. 전투가 끝난 뒤에 다시 시도하세요.' };
  if (p.party && db.parties[p.party]) partyLeave(db, id);      // 파티장이면 해산, 파티원이면 빠지기
  for (const k in db.parties) {                                // 받은 초대 목록에서도 지운다
    const pt = db.parties[k];
    if (pt.pending && pt.pending.includes(id)) pt.pending = pt.pending.filter(x => x !== id);
    if (pt.members && pt.members.includes(id)) pt.members = pt.members.filter(x => x !== id);
  }
  unindexNick(db, p.nick);
  delete db.players[id];
  bumpRank(db);
  return { ok: true, deletedId: id, nick: p.nick, wasLinked: !!p.authUid, msg: '탈퇴가 완료됐어요. 그동안 함께해 줘서 고마워요!' };
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
  if (ensureArmory(p).some(w => w.cls === cls)) return { ok: false, error: '이미 ' + CLASSES[cls].weapon + '이(가) 장비 칸에 있어요. 다른 직업을 고르세요.' };
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
  if (inDungeonFight(p)) return { ok: false, error: '던전 전투 중에는 강화할 수 없어요.' };
  const cost = enhanceCost(p.level, p.ascend);
  if (p.gold < cost) return { ok: false, error: '골드 부족! (필요 ' + cost + ' / 보유 ' + p.gold + ')' };
  p.gold -= cost;
  p.goldSpent = (p.goldSpent || 0) + cost;   // 도전과제: 누적 소모 골드
  bumpMstat(p, 'enh');                        // 미션: 강화 시도
  const before = p.level, pityBefore = p.pity || 0;
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
    const lucky = p.level === 77 && setEgg(p, 'l77');
    return { ok: true, result: 'success', guaranteed: true, egg: lucky ? 'l77' : null, cost, boosted: false, boostLeft: itemCount(p, 'boost'), pity: 0, msg: '🔨 장인의 기운 100%! 확정 성공!  +' + before + ' → +' + p.level };
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
  let result, msg, egg = null, d44First = false;
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
    if (p.level === 77 && setEgg(p, 'l77')) { egg = 'l77'; msg = '🎰 럭키 세븐! ' + msg; }   // 처음 한 번만
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
      if (before === 44 && setEgg(p, 'd44')) { egg = 'd44'; d44First = true; }
      if (pityBefore >= 0.99 && setEgg(p, 'pity99')) egg = egg || 'pity99';
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
  if (d44First) msg += '\n…사(死)의 숫자였다.';   // 처음 한 번만
  return { ok: true, result, msg, cost, boosted, boostLeft: itemCount(p, 'boost'), pity: p.pity, egg };
}
/* 초월 실행 — +99 에서만. 무기를 +0 으로 되돌리고 ★을 하나 얻는다.
 * 골드·방지권·부스트·칭호·최고기록(best)·채굴 레벨은 전부 유지된다. */
function ascend(db, id) {
  const p = norm(db.players[id]);
  if (p.level < CONFIG.maxLevel) {
    return { ok: false, error: '+' + CONFIG.maxLevel + ' 만렙에서만 초월할 수 있어요. (현재 +' + p.level + ')' };
  }
  if (inDungeonFight(p)) return { ok: false, error: '던전 전투 중에는 초월할 수 없어요.' };
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
  p.ascendMax = Math.max(p.ascendMax || 0, to);   // 최고 ★ — 무기를 바꿔 들어도 칭호 기준은 유지
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
function hunt(db, id, atk) {
  const p = norm(db.players[id]);
  // 🛡️ 매크로 방지 — 직전 사냥 요청과의 간격이 사람이 낼 수 있는 최소 주기보다 짧으면 거절(보상·횟수 변화 없음)
  if (Date.now() - (p.huntTs || 0) < CONFIG.huntMinGapMs) return { ok: false, silent: true, tooFast: true, error: '숨 고르는 중…' };
  reportAtk(p, atk);   // 직전 몬스터를 잡을 때의 일반·강공격 횟수(칭호용)
  p.huntTs = Date.now();   // 사냥 간격 기준 + 사냥터 이스터에그 인정 창
  if (today().slice(5) === '10-31') setEgg(p, 'halloween');   // 🎃 KST 기준 할로윈
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
  }
  // 💎 프리즘 재료 — 🗝️ 상자 열쇠 · 🔮 마석. 무한 사냥에서도 나오지만 확률이 낮다(요청: 무한일 때도 나오게)
  const loot = [];
  const kc = (overtime ? CONFIG.keyChanceOvertime : CONFIG.keyChance) * (1 + m.tier * 0.2);
  if (Math.random() < kc) {
    const got = addItem(p, 'boxkey', 1);
    loot.push(got ? { type: 'boxkey', amount: got, text: ITEMS.boxkey.emoji + ' 상자 열쇠!' } : { type: 'full', text: '🎒 가방이 꽉 차 열쇠를 놓쳤어요!' });
  }
  if (Math.random() < (overtime ? CONFIG.stoneChanceOvertime : CONFIG.stoneChance)) {
    const want = overtime ? 1 : 1 + Math.floor(m.tier / 2);
    const got = addItem(p, 'stone', want);
    loot.push(got ? { type: 'stone', amount: got, text: ITEMS.stone.emoji + ' 마석 +' + got } : { type: 'full', text: '🎒 가방이 꽉 차 마석을 놓쳤어요!' });
  }
  if (overtime) {
    // 무한 사냥: 기력에 여유가 있을 때만 채광 물약(꽉 차 있으면 낭비 안 함)
    const st = currentStamina(p);
    if (st < CONFIG.staminaMax && Math.random() < CONFIG.huntPotionChance) {
      const ns = Math.min(CONFIG.staminaMax, st + CONFIG.huntPotionStamina);
      p.stamina = ns; p.lastStamina = Date.now();
      drop = { type: 'potion', stamina: Math.round(ns - st), text: '⛏️ 채광 물약! 채굴 기력 +' + Math.round(ns - st) };
    }
  }
  return { ok: true, monster: { name: m.name, emoji: m.emoji, hp: m.hp, rarity: m.rarity, tier: m.tier }, dmg, dealt, slain, crit, gold, drop, mat, loot, overtime };
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
function buyReroll(db, id) {
  return buyIntoInv(norm(db.players[id]), 'eltkt', 1, CONFIG.rerollPrice);
}
function buyDye(db, id) {
  return buyIntoInv(norm(db.players[id]), 'dye', 1, CONFIG.dyePrice);
}
function buyClassChange(db, id) {
  return { ok: false, error: '직업 변경권은 판매가 끝났어요 — 💎 프리즘 상점의 장비 칸으로 새 직업 무기를 따로 키울 수 있어요. (갖고 있는 변경권은 가방에서 그대로 쓸 수 있어요)' };
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
// 끝난 전투 결과는 이 시간 동안만 다시 보여준다 — 그 뒤에 탭에 들어오면 지난 보스 화면 대신 로비
const RESULT_KEEP_MS = 60000;
function raidState(db, id) {
  const p = norm(db.players[id]);
  if (!p.party || !db.parties[p.party]) return { ok: true, raid: null };
  const raid = db.parties[p.party].raid;
  if (raid && raid.status === 'done' && Date.now() - (raid.endTs || raid.startTs + raid.duration) > RESULT_KEEP_MS) return { ok: true, raid: null };
  return { ok: true, raid: raidProject(raid) };
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
  // 연타와 강공격(연타 n회분)을 한 예산으로 센다 — 매크로가 연타 상한을 채우면서 강공격까지 얹지 못하게
  const maxTotal = Math.floor((Date.now() - raid.startTs) / CONFIG.raidHitMsPerTap) + 12;
  const usedR = (raid.hits[p.nick] || 0) + ((raid.sUnits && raid.sUnits[p.nick]) || 0);
  if (usedR + hits > maxTotal) hits = Math.max(0, maxTotal - usedR);
  const res = raid.res && raid.res[p.nick] > Date.now() ? STRONG_ATTACKS.healer.buff.mult : 1;   // ✨ 마력 공명
  const dmg = Math.round(hits * memberStats(p).atk * CONFIG.raidHitDmgMult * res);
  raid.bossHP = Math.max(0, raid.bossHP - dmg);
  raid.contrib[p.nick] = (raid.contrib[p.nick] || 0) + dmg;
  raid.hits[p.nick] = (raid.hits[p.nick] || 0) + hits;
  addTaps(p, hits);   // 칭호용 일반 공격(서버가 검증한 타수)
  if (raid.bossHP <= 0) raidTick(db, pt);
  return { ok: true, dmg, raid: raidView(raid) };
}
// ⚡ 레이드 강공격 — 그린 커맨드 1번 = 연타 n회분(쿨타임은 서버가 막는다)
function raidStrong(db, id, power) {
  const { p, pt, raid } = raidMember(db, id);
  if (!raid) return { ok: false, error: '진행 중인 레이드가 없어요.' };
  raidTick(db, pt);
  if (raid.status !== 'active') return { ok: true, ended: true, raid: raidView(raid) };
  if (!(p.nick in raid.contrib)) return { ok: false, error: '이 레이드 참가자가 아니에요.' };
  const c = STRONG_ATTACKS[p.class] || STRONG_ATTACKS.warrior, now = Date.now();
  if (!raid.strongAt) raid.strongAt = {};
  if (now - (raid.strongAt[p.nick] || 0) < c.gapMs) return { ok: false, silent: true, error: '강공격 준비 중…' };
  const units = strongUnits(p.class, power);
  if (!raid.sUnits) raid.sUnits = {};
  const budget = Math.floor((now - raid.startTs) / CONFIG.raidHitMsPerTap) + 12;   // raidHit 과 같은 예산
  if ((raid.hits[p.nick] || 0) + (raid.sUnits[p.nick] || 0) + units > budget) return { ok: false, silent: true, error: '숨 고르는 중…' };
  raid.strongAt[p.nick] = now;
  raid.sUnits[p.nick] = (raid.sUnits[p.nick] || 0) + units;
  const dmg = Math.round(units * memberStats(p).atk * CONFIG.raidHitDmgMult);
  raid.bossHP = Math.max(0, raid.bossHP - dmg);
  raid.contrib[p.nick] = (raid.contrib[p.nick] || 0) + dmg;
  let text = c.emoji + ' ' + p.nick + ' ' + c.name + '! 보스 -' + dmg.toLocaleString();
  if (c.buff) { if (!raid.res) raid.res = {}; raid.res[p.nick] = now + c.buff.ms; text += ' · ✨ 마력 공명(연타 ×' + c.buff.mult + ')'; }
  raid.events.push({ t: now - raid.startTs, text });
  countStrong(p);
  if (raid.bossHP <= 0) raidTick(db, pt);
  return { ok: true, silent: true, dmg, units, strongText: text, raid: raidView(raid) };
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
// 남의 프로필(로그인 없이도 열린다) — 프로필 창이 그리는 필드만 보낸다.
// 예전엔 publicView 를 통째로 보내서 이메일·가방·칭호 진열장(얻는 법 설명 포함)까지 응답에 실렸다.
// 내 프로필은 클라가 /api/me(로그인 필요)로 그린다.
const PROFILE_KEYS = ['nick', 'nickColor', 'class', 'className', 'classEmoji', 'weaponBase', 'level', 'best', 'breaks',
  'wins', 'losses', 'winRate', 'gold', 'prism', 'protects', 'weapon', 'grade', 'element', 'elementName', 'elementEmoji', 'elementColor',
  'equippedTitle', 'ascend', 'dunBest', 'rank'];
function profile(db, nick) {
  const k = findByNick(db, nick);
  if (!k) return { ok: false, error: '"' + nick + '" 님을 찾을 수 없어요.' };
  const v = publicView(db, k), out = {};
  for (const key of PROFILE_KEYS) out[key] = v[key];
  out.titles = v.titles;                                   // 얻은 칭호 이름·등급만(얻는 법은 비공개)
  // 보유 무기 줄 — 이름·등급·속성만(장인의 기운 같은 진행 정보는 뺀다)
  out.weapons = { list: (v.weapons.list || []).map(w => ({ cls: w.cls, classEmoji: w.classEmoji, name: w.name, level: w.level, ascend: w.ascend,
    grade: w.grade, elementEmoji: w.elementEmoji, equipped: w.equipped })) };
  return { ok: true, profile: out };
}
function ranking(db) {
  // 순위·표시는 '가장 좋은 무기' 기준 — 새 직업 무기를 들고 있어도 순위가 떨어지지 않는다
  return Object.values(db.players).sort(rankCmp).slice(0, 20)
    .map(p => { const w = bestWeapon(p); return { nick: p.nick, level: w.lv, ascend: w.asc || 0, weapon: weaponName(w.lv, w.cls, w.asc), classEmoji: (CLASSES[w.cls] || classOf(p)).emoji, weaponCount: allWeapons(p).length, wins: p.wins, losses: p.losses, nickColor: p.nickColor || null, title: equippedTitleView(p) }; });
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
  devEgg, raidStrong, dunStrong, STRONG_ATTACKS, eggFound, atkReport, reportAtk, ACHIEVEMENTS,
  CONFIG, GRADES, RARITIES, CLASSES, BOSSES, odds, enhanceCost, weaponName, grade,
  missionView, missionClaim, bpView, bpClaim, bpBuyPremium,
  login, setClass, rename, publicView, enhance, ascend, attend, mine, mineSwing, hunt, buyProtect, fight,
  ITEMS, useItem, buyInvPack, invView, ascendReq, ascendProgress,
  partyCreate, partyJoin, partyLeave, partyList, partyView, raidStart,
  partyInvite, partyAccept, partyReject, myInvites, raidState,
  raidHit, raidSkill, raidFinish,
  buyBoost, buyDye, buyClassChange, shopItems, equipTitle,
  newWeapon, equipWeapon, weaponsView, slotUnlock, openBox, alchemy, capsule, buyPrism, prismShopItems, prismInfo, prismView,
  BOX_TABLE, ALCHEMY, CAPSULE_TABLE,
  // 속성 상성 · 초월 던전
  ELEMENTS, elemMult, elementChart, ELEMENT_SKILLS, DUNGEON, dunFloor, dunHp, weekKey, buyReroll,
  dungeonView, dunStart, dunHit, dunSkill, dunSwap, dunFinish, dunLeave,
  profile, ranking, goldRanking, hogu, recentLog, playerList, findByNick,
  findByAuthUid, authLink, deleteAccount,
  // 저장 계층(server.js)용 — 일일 카운터 / 유저별 상한
  today, normalizeDay, LIMIT_KEYS, DAILY_FIELDS, limitOf, setLimits, dailyUsage, applyDaily, norm,
  // 서버리스(Vercel/Supabase) 어댑터용
  makePlayer, validNick, pinKey, indexNick,
};
