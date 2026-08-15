'use strict';
/*
 * 로컬 game.db(SQLite)에서 "지정한 닉네임" 유저만 Supabase(Postgres)로 이전한다.
 *
 * 실행 (web/ 에서, game.db 가 web/game.db 에 있어야 함):
 *   cd web
 *   DATABASE_URL="postgresql://postgres.xxxx:비번@...pooler.supabase.com:6543/postgres" \
 *     node db/migrate-users.js 다히 Uknown
 *
 * - 계정 id 는 pinKey(sha256(pin)) 라 로컬/Supabase 가 동일하다. 원래 PIN 그대로면 그 계정에 붙는다.
 * - 대상 유저의 players + player_daily(오늘자) + player_limits 를 upsert(있으면 덮어씀).
 * - 안전: 삭제는 안 한다. 같은 닉이 '다른 PIN'으로 Supabase 에 이미 있으면 경고만 하고 진행.
 */
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const NICKS = process.argv.slice(2);
if (!NICKS.length) { console.error('사용법: node db/migrate-users.js <닉1> <닉2> ...'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL 환경변수가 필요해요 (Supabase 연결 문자열).'); process.exit(1); }
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'game.db');

(async () => {
  const sq = new Database(DB_FILE, { readonly: true, fileMustExist: true });
  const inParams = NICKS.map(() => '?').join(',');
  const players = sq.prepare(`SELECT id, nick, level, gold, data FROM players WHERE nick IN (${inParams})`).all(...NICKS);
  const found = players.map(p => p.nick);
  const missing = NICKS.filter(n => !found.includes(n));
  if (missing.length) console.warn('⚠️  game.db 에서 못 찾은 닉:', missing.join(', '));
  if (!players.length) { console.error('❌ 이전할 유저가 없어요.'); process.exit(1); }
  console.log('이전 대상:', players.map(p => `${p.nick}(+${p.level}, ${p.gold}G)`).join(' · '));

  const ids = players.map(p => p.id);
  const idParams = ids.map(() => '?').join(',');
  const dailies = sq.prepare(`SELECT * FROM player_daily WHERE player_id IN (${idParams})`).all(...ids);
  const limits = sq.prepare(`SELECT * FROM player_limits WHERE player_id IN (${idParams})`).all(...ids);
  sq.close();

  const pg = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  await pg.connect();
  try {
    // 같은 닉이 '다른 계정(id)'으로 이미 있으면 경고 (덮어쓰지 않음 — 사용자가 판단)
    for (const p of players) {
      const dup = await pg.query('SELECT id FROM players WHERE nick=$1 AND id<>$2', [p.nick, p.id]);
      if (dup.rowCount) console.warn(`⚠️  "${p.nick}" 이 다른 PIN 으로 이미 Supabase 에 있어요. 원래 PIN 으로 로그인해야 이전 데이터가 보여요. (중복 닉 주의)`);
    }

    await pg.query('BEGIN');
    for (const p of players) {
      await pg.query(
        `INSERT INTO players (id, nick, level, gold, data) VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (id) DO UPDATE SET nick=$2, level=$3, gold=$4, data=$5::jsonb`,
        [p.id, p.nick, p.level, p.gold, typeof p.data === 'string' ? p.data : JSON.stringify(p.data)]);
    }
    for (const d of dailies) {
      await pg.query(
        `INSERT INTO player_daily (player_id, day, hunts_used, fights_used, raids_used, destroys, attended)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (player_id, day) DO UPDATE SET
           hunts_used=$3, fights_used=$4, raids_used=$5, destroys=$6, attended=$7`,
        [d.player_id, d.day, d.hunts_used, d.fights_used, d.raids_used, d.destroys, d.attended]);
    }
    for (const l of limits) {
      await pg.query(
        `INSERT INTO player_limits (player_id, daily_hunts, daily_fights, daily_raids, note, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (player_id) DO UPDATE SET
           daily_hunts=$2, daily_fights=$3, daily_raids=$4, note=$5, updated_at=$6`,
        [l.player_id, l.daily_hunts, l.daily_fights, l.daily_raids, l.note, l.updated_at]);
    }
    await pg.query('COMMIT');
    console.log(`✅ 이전 완료 — 플레이어 ${players.length}명, 일일 ${dailies.length}행, 상한 ${limits.length}행`);
    console.log('   각 유저는 "원래 닉네임 + 원래 PIN" 으로 로그인하면 그 데이터가 보여요.');
  } catch (e) {
    try { await pg.query('ROLLBACK'); } catch (_) { /* noop */ }
    console.error('❌ 실패(롤백):', e.message); process.exit(1);
  } finally { await pg.end(); }
})();
