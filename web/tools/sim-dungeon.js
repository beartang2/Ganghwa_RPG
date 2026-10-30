#!/usr/bin/env node
'use strict';
/* 🌌 초월 던전 몬테카를로 — 실제 game.js 전투 함수(dunStart/dunHit/dunSkill/dunSwap/dunFinish)를
 * 가짜 시계로 돌려서 '이 장비면 보통 몇 층까지 가나' 를 본다(층 HP·위험도 튜닝용).
 *   사용법: node tools/sim-dungeon.js [주 수=60] [초당 연타=7]
 * 플레이 방식(가정): 단계가 바뀌면 상성이 가장 좋은 무기로 교체(같으면 공격력 높은 쪽) →
 *   피해형 스킬(직업·속성)은 바로 사용, 회복·방어형은 HP 50% 아래에서 사용. 한 층에 최대 3번 도전. */
const path = require('path');
let NOW = Date.UTC(2026, 0, 5, 15);   // KST 월요일 00:00 근처
Date.now = () => NOW;
const G = require(path.join(__dirname, '..', 'game.js'));
const WEEKS = +process.argv[2] || 60, TPS = +process.argv[3] || 7;
const C = G.CONFIG;
const KEYS = G.ELEMENTS.map(e => e.key);
const pick = a => a[Math.floor(Math.random() * a.length)];

function makeAccount(weapons) {
  const db = { players: {}, parties: {}, log: [] };
  const p = G.makePlayer('d' + Math.random()); G.norm(p); db.players.x = p;
  const [w0, ...rest] = weapons;
  Object.assign(p, { class: w0.cls, level: w0.lv, ascend: w0.asc, element: w0.el || pick(KEYS), ascendMax: Math.max(...weapons.map(w => w.asc)) });
  p.armory = rest.map(w => ({ cls: w.cls, lv: w.lv, asc: w.asc, el: w.el || pick(KEYS), pity: 0 }));
  return { db, p };
}
const ATK = { archer: 1.35, warrior: 1.2, tanker: 0.6, healer: 0.5 };
// 무기 한 자루의 공격력(전투 레벨 = 강화 + 100×★, ★ 보너스 8%)
const pow = w => ATK[w.cls] * (12 + ((w.lv || 0) + (C.maxLevel + 1) * (w.asc || 0)) * 8) * (1 + (w.asc || 0) * C.ascendAtkBonus);
function bestFor(p, el) {
  const ws = G.dungeonView({ players: { x: p }, parties: {} }, 'x').weapons;
  return ws.map(w => ({ w, s: G.elemMult(w.el, el) * pow(w) }))
    .sort((a, b) => b.s - a.s)[0].w;
}
// ideal: 단계마다 아직 안 쓴 무기 중 가장 센 것을 약점 속성으로 '재련해 둔' 것처럼 맞춘다(재련을 다 한 상한선)
function tuneIdeal(p, phases) {
  const ws = [{ ref: p, cls: p.class, lv: p.level, asc: p.ascend }].concat(p.armory.map(w => ({ ref: w, cls: w.cls, lv: w.lv, asc: w.asc })))
    .sort((a, b) => pow(b) - pow(a));
  phases.forEach((ph, i) => { const w = ws[i % ws.length]; const el = ph.weakTo[0]; if (w.ref === p) p.element = el; else w.ref.el = el; });
}
function fight(db, p, ideal) {
  if (ideal) { const fl = G.dungeonView(db, 'x').next; if (fl) tuneIdeal(p, fl.phases); }
  let r = G.dunStart(db, 'x'); if (!r.ok) return { err: r.error };
  let f = r.fight, lastPhase = -1, t0 = NOW;
  while (f.status === 'active') {
    NOW += 700;
    const ph = f.phases[f.phase];
    if (f.phase !== lastPhase) {
      lastPhase = f.phase;
      const b = bestFor(p, ph.el);
      if (b.cls !== p.class) { const s = G.dunSwap(db, 'x', b.cls); if (s.fight) f = s.fight; }
      const me = f.weapons.find(w => w.equipped);
      const sk = G.CONFIG && me;  // 피해형 스킬 즉시
      if (me && !me.usedC && (me.cls === 'warrior' || me.cls === 'archer')) { const s = G.dunSkill(db, 'x', 'class'); if (s.fight) f = s.fight; }
      if (me && me.elemSkill && !me.usedE && !['water', 'earth', 'light', 'dark'].includes(me.el)) { const s = G.dunSkill(db, 'x', 'elem'); if (s.fight) f = s.fight; }
    }
    if (f.status !== 'active') break;
    if (f.hp < 50) {   // 위급: 들고 있는 무기의 회복·방어 스킬
      const me = f.weapons.find(w => w.equipped);
      if (me && !me.usedC && (me.cls === 'tanker' || me.cls === 'healer')) { const s = G.dunSkill(db, 'x', 'class'); if (s.fight) f = s.fight; }
      else if (me && me.elemSkill && !me.usedE) { const s = G.dunSkill(db, 'x', 'elem'); if (s.fight) f = s.fight; }
    }
    const h = G.dunHit(db, 'x', Math.round(TPS * 0.7)); if (h.fight) f = h.fight;
    if (NOW - t0 > f.duration + 1500) { f = G.dunFinish(db, 'x').fight; }
  }
  G.dunLeave(db, 'x');
  return { win: f.win };
}
function runWeek(weapons, ideal) {
  NOW += 7 * 86400000;
  const { db, p } = makeAccount(weapons.map(w => Object.assign({}, w)));
  let fl = 0;
  for (;;) {
    let won = false;
    for (let a = 0; a < 3 && !won; a++) { const r = fight(db, p, ideal); if (r.err) return { fl, stop: r.err }; won = r.win; NOW += 5000; }
    if (!won) return { fl };
    fl++; if (fl >= G.DUNGEON.floors) return { fl };
  }
}
const W = (cls, lv, asc, el) => ({ cls, lv, asc, el });
const LOADOUTS = {
  '검 +99★1 한 자루': [W('warrior', 99, 1)],
  '검 +60★1 한 자루': [W('warrior', 60, 1)],
  '검★1 + 활 (+99 둘)': [W('warrior', 99, 1), W('archer', 99, 0)],
  '+99 셋(★1·0·0)': [W('warrior', 99, 1), W('archer', 99, 0), W('tanker', 99, 0)],
  '+99 넷(★1·0·0·0)': [W('warrior', 99, 1), W('archer', 99, 0), W('tanker', 99, 0), W('healer', 99, 0)],
  '+99 넷(★2·2·1·1)': [W('warrior', 99, 2), W('archer', 99, 2), W('tanker', 99, 1), W('healer', 99, 1)],
  '+99 넷(★3 전부)': [W('warrior', 99, 3), W('archer', 99, 3), W('tanker', 99, 3), W('healer', 99, 3)],
  '+99 넷(★5 전부)': [W('warrior', 99, 5), W('archer', 99, 5), W('tanker', 99, 5), W('healer', 99, 5)],
};
console.log('주 ' + WEEKS + '번 · 초당 연타 ' + TPS + '\n무작위 = 무기 속성이 그냥 운(재련 없음) · 최적 = 단계마다 약점 무기를 재련해 맞춘 상한선\n');
for (const [name, ws] of Object.entries(LOADOUTS)) {
  const line = [false, true].map(ideal => {
    const xs = [];
    for (let i = 0; i < WEEKS; i++) xs.push(runWeek(ws, ideal).fl);
    xs.sort((a, b) => a - b);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return (ideal ? '최적 ' : '무작위 ') + m.toFixed(1) + '층(' + xs[Math.floor(WEEKS * .1)] + '~' + xs[Math.floor(WEEKS * .9)] + ')';
  });
  console.log(name.padEnd(20) + ' ' + line.join(' · '));
}
