#!/usr/bin/env node
'use strict';
/* 0→+99 등반 몬테카를로 — 장비 칸 가격(CONFIG.weaponSlotPrices)의 근거.
 * 실제 game.js 함수(강화·사냥·채굴·출석·상자·연금술·무기 교체)를 그대로 호출하고,
 * 시계(Date.now)만 가짜로 돌려서 일일 리셋·기력 회복·채굴 적립이 실제 규칙대로 돌게 한다.
 *
 * 사용법: node tools/sim-climb.js [계정 수=300]
 *         node tools/sim-climb.js [계정 수] --prices 70,100,130   ← 칸 가격안별 '+99 후 며칠 더 모아야 사는지'
 * 결과: 유저 유형 × 무기 교체 여부 × 등반 회차(1~3)별로 걸린 날·사냥 수·열쇠·마석·
 *       그리고 '+99 에 닿은 순간 손에 쥔 💎(실현분)' 의 평균과 10/50/90 백분위.
 *
 * 유저 모델(가정 — 바꾸려면 PROFILES 수정):
 *   접속 시각마다 채굴 적립 수령 + 기력이 바닥날 때까지 곡괭이질.
 *   첫 접속에 출석·미션 골드(정액)·일일 사냥 20 + 무한 사냥·레이드(그 레벨로 들어갈 수 있는 가장 센 보스, 솔로 보상).
 *   매 접속: 열쇠는 바로 상자 열기 → 골드가 10만G 이상이고 마석 15개 이상이면 중불 연금 1회
 *            → +20 이상이면 방지권 하루 3개 구매 → 남은 골드는 전부 강화.
 *   남은 마석은 💎 로 치지 않는다(골드를 넣어야 💎 가 되므로) — 다음 회차로 이월.
 *   swap: 두 번째 무기부터 사냥·레이드는 +99 무기로 하고 강화만 새 무기로(장착 교체는 무료).
 *   싸움(약탈)·부스트권 구매·캡슐은 넣지 않았다(등반 중).
 *   --prices: +99 에 닿으면 강화할 데가 없으니 골드를 전부 💎 로 돌린다
 *            (중불 → 약불 → 남은 골드는 캡슐). 가격만큼 모이면 칸을 사고(💎 차감) 다음 무기를 시작. */
const path = require('path').join(__dirname, '..', 'game.js');
let NOW = Date.UTC(2026, 0, 1, 15, 0, 0);          // KST 2026-01-02 00:00
Date.now = () => NOW;
const G = require(path);
const DAY = 86400000, H = 3600000;
const C = G.CONFIG;
const BOX_EV = G.BOX_TABLE.filter(x => x.kind === 'prism').reduce((a, x) => a + x.p * x.n, 0);
const mid = G.ALCHEMY.find(a => a.id === 'mid');
const STONE_EV = mid.table.reduce((a, x) => a + x.p * x.n, 0) / mid.stone;

const PROFILES = {
  light:  { sessions: [9, 21],                 over: 0,   missions: 4000, raids: 1 },
  normal: { sessions: [8, 12, 18, 22],         over: 40,  missions: 7800, raids: 3 },
  heavy:  { sessions: [7, 10, 13, 16, 19, 22], over: 200, missions: 7800, raids: 3 },
};
const CLS = ['warrior', 'archer', 'tanker', 'healer'];
function raidGold(lv) { const b = G.BOSSES.filter(b => !b.reqAscend && b.reqLevel <= lv).pop(); return b ? b.reward : 0; }
function cnt(p, id) { return (p.inv && p.inv.items && p.inv.items[id]) || 0; }

function newAccount() {
  const db = { players: {}, parties: {}, log: [], nickIdx: null };
  const id = 'sim'; db.players[id] = G.makePlayer('sim' + Math.random()); G.norm(db.players[id]);
  G.setClass(db, id, CLS[0]);
  return { db, id, p: db.players[id], day: 0 };
}
// 하루 진행. mode 'climb' = 남은 골드로 강화, 'save' = +99 라 골드를 전부 💎 로(중불 → 약불 → 캡슐)
function playDay(A, prof, swap, mode, st) {
  const { db, id, p } = A;
  const climbCls = p.class;
  const best = () => G.weaponsView(p).list.reduce((b, w) => (!b || w.level > b.level ? w : b), null);
  const dayStart = NOW = Date.UTC(2026, 0, 1, 15) + A.day * DAY;
  prof.sessions.forEach((h, si) => {
    NOW = dayStart + h * H;
    G.mine(db, id);
    for (let i = 0; i < 40; i++) { const r = G.mineSwing(db, id); if (r.tired) break; }
    if (si === 0) {
      G.attend(db, id);
      p.gold += prof.missions;
      // 스왑 전략: 사냥·레이드는 가장 센 무기로, 강화는 키우는 무기로(장착 교체는 무료)
      const b = best(); const farmCls = swap && b.cls !== p.class ? b.cls : null;
      if (farmCls) G.equipWeapon(db, id, farmCls);
      const k0 = cnt(p, 'boxkey'), s0 = cnt(p, 'stone');
      for (let i = 0; i < C.dailyHunts + prof.over; i++) { G.hunt(db, id); st.hunts++; }
      st.keys += cnt(p, 'boxkey') - k0; st.stones += cnt(p, 'stone') - s0;
      p.gold += prof.raids * raidGold(p.level);
      if (farmCls) G.equipWeapon(db, id, climbCls);
    }
    while (cnt(p, 'boxkey') > 0) G.openBox(db, id, 0);
    if (mode === 'climb') {
      // 연금술: 한 번 접속에 쓸 골드가 10만G 이상 모였고 마석이 15개 이상이면 중불 1회 — 나머지 골드는 전부 강화
      if (cnt(p, 'stone') >= mid.stone && p.gold >= mid.gold) { G.alchemy(db, id, 'mid'); st.alch++; }
      if (p.level >= 20 && p.ascend === 0 && p.gold >= 3 * C.protectPrice * 4) G.buyProtect(db, id, 3);
      while (p.level < C.maxLevel && p.gold >= G.enhanceCost(p.level, p.ascend)) G.enhance(db, id);
    } else {
      while (cnt(p, 'stone') >= mid.stone && p.gold >= mid.gold) G.alchemy(db, id, 'mid');
      while (cnt(p, 'stone') >= low.stone && p.gold >= low.gold) G.alchemy(db, id, 'low');
      while (p.gold >= C.capsulePrice) G.capsule(db, id, Math.min(C.capsuleBatchMax, Math.floor(p.gold / C.capsulePrice)));
      while (cnt(p, 'boxkey') > 0) G.openBox(db, id, 0);
    }
  });
  A.day++;
}
function runAccount(prof, swap, climbs) {
  const A = newAccount(), p = A.p;
  const out = [];
  for (let k = 0; k < climbs; k++) {
    const st = { hunts: 0, keys: 0, stones: 0, alch: 0 };
    const prismStart = p.prism, d0 = A.day;
    while (p.level < C.maxLevel) { playDay(A, prof, swap, 'climb', st); if (A.day - d0 > 3000) throw new Error('stuck'); }
    // +99 에 닿은 순간 손에 쥔 💎(실현분)만 센다. 남은 마석은 다음 회차로 이월(골드를 넣어야 💎 가 되므로 기대값으로 더하지 않음)
    out.push(Object.assign(st, { days: A.day - d0, left: cnt(p, 'stone'), prism: p.prism - prismStart }));
    // 다음 칸: +99 조건 충족 → 칸 구매(가격은 집계에서 빼지 않음) → 새 직업 무기
    if (k + 1 < climbs) { p.weaponSlotBought = (p.weaponSlotBought || 0) + 1; const r = G.newWeapon(db0(A), A.id, CLS[k + 1]); if (!r.ok) throw new Error(r.error); }
  }
  return out;
}
function db0(A) { return A.db; }
// 가격안 타임라인: 등반 → (+99) 저축 → 칸 구매 → 다음 무기 등반 … 각 구간이 며칠인지
function runTimeline(prof, swap, prices) {
  const A = newAccount(), p = A.p, seg = [];
  for (let k = 0; k < prices.length; k++) {
    const st = { hunts: 0, keys: 0, stones: 0, alch: 0 };
    let d0 = A.day;
    while (p.level < C.maxLevel) { playDay(A, prof, swap, 'climb', st); if (A.day - d0 > 3000) throw new Error('stuck'); }
    const climb = A.day - d0, atTop = p.prism; d0 = A.day;
    while (p.prism < prices[k]) { playDay(A, prof, swap, 'save', st); if (A.day - d0 > 3000) throw new Error('stuck save'); }
    seg.push({ climb, wait: A.day - d0, atTop });
    p.prism -= prices[k]; p.weaponSlotBought = (p.weaponSlotBought || 0) + 1;
    const r = G.newWeapon(A.db, A.id, CLS[k + 1]); if (!r.ok) throw new Error(r.error);
  }
  return seg;
}
const low = G.ALCHEMY.find(a => a.id === 'low');
const pi = process.argv.indexOf('--prices');
if (pi > 0) {
  const N = +process.argv[2] || 200;
  const sets = process.argv.slice(pi + 1).map(x => x.split(',').map(Number));
  console.log('계정 ' + N + '개씩 · 무기 교체 사냥(swap) 기준 · 각 칸: 등반일 + (+99 후 모으는 날) = 그 칸까지 걸린 날\n');
  for (const prices of sets) {
    console.log('■ 가격 ' + prices.join(' → ') + '💎');
    for (const [pn, prof] of Object.entries(PROFILES)) {
      const acc = []; for (let i = 0; i < N; i++) acc.push(runTimeline(prof, true, prices));
      const m = (k, f) => acc.reduce((s, a) => s + f(a[k]), 0) / N;
      let total = 0;
      const cells = prices.map((_, k) => { const c = m(k, x => x.climb), w = m(k, x => x.wait); total += c + w;
        return (k + 2) + '번째 칸 ' + c.toFixed(1) + '+' + w.toFixed(1) + '일(+99 때 💎' + m(k, x => x.atTop).toFixed(0) + ')'; });
      console.log('  ' + pn.padEnd(7) + cells.join(' · ') + ' | 4칸까지 총 ' + total.toFixed(0) + '일');
    }
  }
  process.exit(0);
}
const N = +process.argv[2] || 300;
const res = {};
for (const [pn, prof] of Object.entries(PROFILES)) for (const swap of [true, false]) {
  const acc = [];
  for (let i = 0; i < N; i++) acc.push(runAccount(prof, swap, 3));
  const key = pn + (swap ? '+swap' : '');
  res[key] = [0, 1, 2].map(k => {
    const xs = acc.map(a => a[k]);
    const m = f => xs.reduce((s, x) => s + f(x), 0) / xs.length;
    const ps = xs.map(x => x.prism).sort((a, b) => a - b);
    return { climb: k + 1, days: +m(x => x.days).toFixed(1), hunts: Math.round(m(x => x.hunts)), keys: +m(x => x.keys).toFixed(1),
      stones: Math.round(m(x => x.stones)), alch: +m(x => x.alch).toFixed(1), left: Math.round(m(x => x.left)), prism: +m(x => x.prism).toFixed(1), p10: +ps[Math.floor(N * .1)].toFixed(0), p50: +ps[Math.floor(N * .5)].toFixed(0), p90: +ps[Math.floor(N * .9)].toFixed(0) };
  });
}
console.log('계정 ' + N + '개씩 · 상자 열쇠 1개 기대 💎 ' + BOX_EV.toFixed(3) + '\n');
console.log('유형          등반  걸린날  사냥수  열쇠  마석  연금  남은마석 |  💎평균  p10  p50  p90  → ×1.2');
for (const [k, v] of Object.entries(res)) for (const c of v) {
  console.log(k.padEnd(13) + String(c.climb).padStart(4) + String(c.days).padStart(8) + String(c.hunts).padStart(8) + String(c.keys).padStart(6) +
    String(c.stones).padStart(6) + String(c.alch).padStart(6) + String(c.left).padStart(10) + ' | ' + String(c.prism).padStart(7) +
    String(c.p10).padStart(5) + String(c.p50).padStart(5) + String(c.p90).padStart(5) + String(Math.ceil(c.prism * 1.2 / 5) * 5).padStart(8));
}
