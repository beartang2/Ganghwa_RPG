#!/usr/bin/env node
'use strict';
/* 🐲 레이드 처치 시간 시뮬 — 실제 game.js 레이드 함수(partyCreate/raidStart/raidHit/raidStrong/raidSkill)를
 * 가짜 시계로 돌려 '혼자서 이 보스를 몇 초 만에 잡나' 를 본다(보스 HP·전투 시간 튜닝용).
 *   사용법: node tools/sim-raid.js [초당 연타=7] [레벨=보스 입장 레벨|숫자] [★=입장 조건]
 * 플레이 방식(가정, 사람 기준):
 *   tap    — 연타만
 *   strong — 강공격만 계속(그리는 시간: 검 0.5초 · 활 0.7초 · 방패 0.85초 · 별 1.8초)
 *   mix    — 힐러: 별 → 공명(5초) 동안 연타 → 공명이 끝날 즈음 다시 별 / 그 외: 강공격 1번 + 연타 1초 반복
 * 딜 스킬(전사·궁수)은 시작하자마자 쓴다. 보스 반격으로 인한 패배는 보지 않는다(처치 시간만 잰다).
 *   REAL=200 node tools/sim-raid.js 7 99 0 → 실제 전투 시간·보스 반격까지 넣어 mix 방식 200판 승률(힐러는 HP 50% 아래에서 치유 스킬). */
const path = require('path');
let NOW = Date.UTC(2026, 0, 5, 3);
Date.now = () => NOW;
const G = require(path.join(__dirname, '..', 'game.js'));
const C = G.CONFIG;
const TPS = +process.argv[2] || 7;
const LV_ARG = process.argv[3], ASC_ARG = process.argv[4];
const DRAW = { warrior: 500, archer: 700, tanker: 850, healer: 1800 };
const LIMIT = 60000;   // 처치 시간 측정용 상한(실제 전투 시간과 무관)
const REAL = +process.env.REAL || 0;

function ttk(cls, level, ascend, bossId, mode) {
  const db = { players: {}, parties: {}, log: [] };
  const p = G.makePlayer('sim'); G.norm(p);
  Object.assign(p, { class: cls, level, ascend, ascendMax: ascend });
  db.players.x = p;
  const real = [C.raidDuration, C.raidSoloDuration];
  if (!REAL) C.raidDuration = C.raidSoloDuration = LIMIT;
  G.partyCreate(db, 'x');
  const st = G.raidStart(db, 'x', bossId);
  [C.raidDuration, C.raidSoloDuration] = real;
  if (!st.ok) return { err: st.error };
  const pt = db.parties[p.party], raid = pt.raid;
  const t0 = NOW;
  if (cls === 'warrior' || cls === 'archer') G.raidSkill(db, 'x');
  const tapGap = 1000 / TPS;
  let next = 0, phase = 'strong', phaseEnd = 0, resUntil = 0;
  while (raid.status === 'active' && NOW - t0 < LIMIT) {
    const t = NOW - t0;
    if (REAL) { G.raidFinish(db, 'x'); if (raid.status !== 'active') break;
      if (cls === 'tanker' || (cls === 'healer' && raid.partyHP < 50)) { if (!raid.skillUsed[p.nick]) G.raidSkill(db, 'x'); } }
    if (mode === 'tap') { G.raidHit(db, 'x', 1); NOW += tapGap; continue; }
    if (mode === 'strong') {
      NOW += Math.max(DRAW[cls], G.STRONG_ATTACKS[cls].gapMs);
      G.raidStrong(db, 'x', 1);
      continue;
    }
    // mix
    if (cls === 'healer') {
      if (t >= resUntil - DRAW.healer) { NOW += DRAW.healer; const r = G.raidStrong(db, 'x', 1); if (r.ok) resUntil = NOW - t0 + 5000; }
      else { G.raidHit(db, 'x', 1); NOW += tapGap; }
    } else {
      if (phase === 'strong') { NOW += Math.max(DRAW[cls], G.STRONG_ATTACKS[cls].gapMs); G.raidStrong(db, 'x', 1); phase = 'tap'; phaseEnd = NOW - t0 + 1000; }
      else { G.raidHit(db, 'x', 1); NOW += tapGap; if (NOW - t0 >= phaseEnd) phase = 'strong'; }
    }
  }
  if (REAL) { G.raidFinish(db, 'x'); return { win: !!raid.win }; }
  return { sec: raid.status === 'done' && raid.bossHP <= 0 ? (NOW - t0) / 1000 : null, hp: raid.boss.hp };
}

const CLS = ['warrior', 'archer', 'tanker', 'healer'];
if (REAL) {
  console.log('실제 전투(혼자 ' + C.raidSoloDuration / 1000 + '초 · 보스 반격 포함) mix 방식 ' + REAL + '판 승률 · 초당 연타 ' + TPS);
  for (const b of G.BOSSES) {
    const lv = LV_ARG ? +LV_ARG : b.reqLevel, asc = ASC_ARG != null ? +ASC_ARG : b.reqAscend;
    const row = CLS.map(c => { let w = 0, err = null; for (let i = 0; i < REAL; i++) { const r = ttk(c, lv, asc, b.id, 'mix'); if (r.err) { err = r.err; break; } if (r.win) w++; }
      return c.padEnd(7) + (err ? ' 입장 불가' : String(Math.round(w / REAL * 100)).padStart(4) + '%'); });
    console.log(b.emoji + ' ' + b.name.padEnd(6) + ' +' + lv + (asc ? '★' + asc : '') + '  ' + row.join('  '));
  }
  process.exit(0);
}
const SOLO = C.raidSoloDuration / 1000;
console.log('초당 연타 ' + TPS + ' · 혼자 전투 시간 ' + SOLO + '초 · 혼자(1인) 기준 처치 시간(초) — tap / strong / mix  (✗ = 시간 안에 못 잡음)');
for (const b of G.BOSSES) {
  const lv = LV_ARG ? +LV_ARG : b.reqLevel, asc = ASC_ARG != null ? +ASC_ARG : b.reqAscend;
  const row = CLS.map(c => {
    const r = ['tap', 'strong', 'mix'].map(m => ttk(c, lv, asc, b.id, m));
    if (r[0].err) return c + ' ' + r[0].err;
    return c.padEnd(7) + r.map(x => x.sec == null ? '   -  ' : x.sec.toFixed(1).padStart(5) + (x.sec > SOLO ? '✗' : ' ')).join(' ');
  });
  console.log('\n' + b.emoji + ' ' + b.name + ' (HP ' + b.hp.toLocaleString() + ', +' + lv + (asc ? ' ★' + asc : '') + ')');
  row.forEach(r => console.log('  ' + r));
}
