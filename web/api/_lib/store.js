'use strict';
/*
 * 서버리스 저장 어댑터 (Vercel + Supabase/Postgres)
 * ------------------------------------------------------------
 * 핵심 아이디어: game.js(인메모리 db 를 변경하는 순수 동기 함수)를 그대로 재사용한다.
 * 요청마다 Postgres 에서 세계(players/parties/일일카운터/상한)를 인메모리 db 슬라이스로
 * 로드 → 기존 game.js 함수 실행 → 바뀐 행만 diff 저장. 전부 하나의 트랜잭션 안에서.
 *
 * 동시성: 액션 주체 플레이어 행을 FOR UPDATE 로 먼저 잠근 뒤 로드하므로,
 * 같은 유저의 동시 요청(더블클릭·다중 기기)에서 lost update 가 없다.
 *
 * DB 접근은 q(text, params) => Promise<rows> 한 함수로 추상화한다.
 * 운영은 node-postgres, 로컬 테스트는 pglite 가 같은 시그니처를 제공한다.
 */
const game = require('../../game');

// players.data JSONB 에서 제외 — 컬럼/전용 테이블이 소유 (server.js 의 OMIT_FROM_DATA 와 동일)
const OMIT = new Set(game.DAILY_FIELDS.concat(['_lim', 'nick', 'level', 'gold']));
function playerData(p) { return JSON.stringify(p, (k, v) => (OMIT.has(k) ? undefined : v)); }
function asObj(d) { return d == null ? {} : (typeof d === 'string' ? JSON.parse(d) : d); }
function dailySig(p) { const u = game.dailyUsage(p); return [u.hunts, u.fights, u.raids, u.destroys, u.attended].join('|'); }

/* ---------- 로드 ---------- */
async function loadAllDb(q, { withLogs = false } = {}) {
  const day = game.today();
  const db = { players: {}, parties: {}, log: [], logSeq: 0 };

  const dailies = {};
  for (const r of await q('SELECT * FROM player_daily WHERE day = $1', [day])) dailies[r.player_id] = r;

  const limits = {};
  for (const r of await q('SELECT * FROM player_limits', [])) {
    const l = {};
    if (r.daily_hunts != null) l.dailyHunts = r.daily_hunts;
    if (r.daily_fights != null) l.dailyFights = r.daily_fights;
    if (r.daily_raids != null) l.dailyRaids = r.daily_raids;
    limits[r.player_id] = Object.keys(l).length ? l : null;
  }

  for (const r of await q('SELECT id, nick, level, gold, data FROM players', [])) {
    const p = asObj(r.data);
    if (r.nick != null) p.nick = r.nick;
    if (r.level != null) p.level = r.level;
    if (r.gold != null) p.gold = Number(r.gold);
    game.applyDaily(p, dailies[r.id]);   // 일일 카운터는 player_daily 가 유일한 진실
    p._lim = limits[r.id] || null;
    db.players[r.id] = p;
  }
  for (const r of await q('SELECT id, data FROM parties', [])) db.parties[r.id] = asObj(r.data);

  if (withLogs) {
    for (const r of await q('SELECT ts, text FROM logs ORDER BY seq ASC', [])) db.log.push({ t: Number(r.ts), n: ++db.logSeq, text: r.text });
    if (db.log.length > 60) db.log = db.log.slice(-60);
  }
  return db;
}

// 행 잠금 — 같은 대상 동시 요청 직렬화. 전역 일관 순서(정렬)로 잠가 데드락 방지.
// table 은 내부 리터럴('players'|'parties')만 — 사용자 입력 아님.
async function lockRows(q, table, ids) {
  const uniq = [...new Set(ids.filter(Boolean))].sort();
  for (const id of uniq) await q('SELECT id FROM ' + table + ' WHERE id = $1 FOR UPDATE', [id]);
}
async function lockPlayer(q, id) { await lockRows(q, 'players', [id]); }

/* ---------- 스냅샷 & diff 저장 ---------- */
function snapshot(db) {
  const s = { players: {}, parties: {} };
  for (const id in db.players) {
    const p = db.players[id];
    s.players[id] = { data: playerData(p), nick: p.nick || '', level: p.level || 0, gold: p.gold || 0, daily: dailySig(p) };
  }
  for (const id in db.parties) s.parties[id] = JSON.stringify(db.parties[id]);
  return s;
}

async function persistDiff(q, db, before) {
  const day = game.today();
  for (const id in db.players) {
    const p = db.players[id];
    const data = playerData(p);
    const b = before.players[id];
    if (!b || b.data !== data || b.nick !== (p.nick || '') || b.level !== (p.level || 0) || b.gold !== (p.gold || 0)) {
      await q(`INSERT INTO players (id, nick, level, gold, data) VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (id) DO UPDATE SET nick=$2, level=$3, gold=$4, data=$5`,
        [id, p.nick || '', p.level || 0, p.gold || 0, data]);
    }
    const touched = p.huntDay === day || p.fightDay === day || p.raidDay === day || p.destroyDay === day || p.attendDay === day;
    if (touched && (!b || b.daily !== dailySig(p))) {
      const u = game.dailyUsage(p);
      await q(`INSERT INTO player_daily (player_id, day, hunts_used, fights_used, raids_used, destroys, attended)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (player_id, day) DO UPDATE SET
                 hunts_used=$3, fights_used=$4, raids_used=$5, destroys=$6, attended=$7`,
        [id, day, u.hunts, u.fights, u.raids, u.destroys, u.attended]);
    }
  }
  for (const id in db.parties) {
    const data = JSON.stringify(db.parties[id]);
    if (before.parties[id] !== data) await q('INSERT INTO parties (id, data) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET data=$2', [id, data]);
  }
  for (const id in before.parties) if (!db.parties[id]) await q('DELETE FROM parties WHERE id = $1', [id]);

  // 로그: 변경 컨텍스트는 빈 배열로 로드하므로 db.log 에 남은 건 전부 이번에 새로 쌓인 것
  let logged = 0;
  for (const l of db.log) { await q('INSERT INTO logs (ts, text) VALUES ($1,$2)', [l.t, l.text]); logged++; }
  if (logged) await q('DELETE FROM logs WHERE seq <= (SELECT COALESCE(MAX(seq),0) - 500 FROM logs)', []);
}

/* ---------- 고수준 실행 ---------- */
// 변경 액션: 대상 잠금 → 로드 → game 함수 실행 → 성공 시 diff 저장. { r, db } 반환.
//   lockId          단일 주체(하위호환)
//   lockPlayerIds   추가로 잠글 플레이어(예: 싸움 상대)
//   lockPartyIds    잠글 파티(예: 참가/수락 대상 파티)
async function runGame(q, { lockId, lockPlayerIds = [], lockPartyIds = [], withLogs = false }, fn) {
  await lockRows(q, 'players', [lockId, ...lockPlayerIds]);   // 플레이어 먼저(정렬), 그 다음 파티 — 항상 같은 순서
  await lockRows(q, 'parties', lockPartyIds);
  const db = await loadAllDb(q, { withLogs });
  const before = snapshot(db);
  const r = fn(db);
  if (r && r.ok) await persistDiff(q, db, before);
  return { r, db };
}
// 읽기 전용: 저장 없이 db 만 로드.
async function readDb(q, opts = {}) { return loadAllDb(q, opts); }

/* ---------- 세션 ---------- */
const SESSION_TTL = 7 * 24 * 3600 * 1000;
async function getSession(q, token) {
  if (!token) return null;
  const rows = await q('SELECT player_id, seen FROM sessions WHERE token = $1', [token]);
  if (!rows.length) return null;
  if (Date.now() - Number(rows[0].seen) > SESSION_TTL) { await q('DELETE FROM sessions WHERE token = $1', [token]); return null; }
  await q('UPDATE sessions SET seen = $2 WHERE token = $1', [token, Date.now()]);
  return rows[0].player_id;
}
async function putSession(q, token, id) {
  await q('INSERT INTO sessions (token, player_id, seen) VALUES ($1,$2,$3) ON CONFLICT (token) DO UPDATE SET player_id=$2, seen=$3', [token, id, Date.now()]);
}
async function deleteSession(q, token) { if (token) await q('DELETE FROM sessions WHERE token = $1', [token]); }

module.exports = { loadAllDb, readDb, runGame, snapshot, persistDiff, lockPlayer, getSession, putSession, deleteSession, playerData };
