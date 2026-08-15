'use strict';
/*
 * 강화 RPG 웹 서버 (Node.js + SQLite)
 * 준비:  npm install       (better-sqlite3 설치, 최초 1회)
 * 실행:  node server.js
 * 접속:  같은 네트워크(회사 와이파이 등)에서  http://<맥 로컬IP>:3088
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const Database = require('better-sqlite3');
const game = require('./game');

const PORT = process.env.PORT || 3088;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'game.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------- SQLite 저장 계층 ----------
 * 게임 로직은 인메모리 db 객체(players/parties/log)로 동작하고,
 * 여기서 SQLite에 적재/영속화한다.
 *   players       — 캐릭터 상태 (nick/level/gold 컬럼 + 나머지는 data JSON)
 *   player_daily  — 유저×날짜 일일 카운터 (사냥/싸움/레이드/파괴/출석). 날짜별 이력 보존
 *   player_limits — 유저별 일일 상한 오버라이드. NULL = CONFIG 기본값 사용
 *
 * 규칙: 컬럼이나 전용 테이블이 소유한 필드는 data JSON 에 중복 저장하지 않는다.
 * 소유자가 하나여야 둘이 어긋날 여지가 없고, SQL로 직접 조회·수정할 수 있다.
 * 그 외 필드(스태미나·채굴 진행도·파티 등)는 data JSON 이 기본 — 게임 로직이
 * 인메모리로만 읽으므로 컬럼으로 빼도 얻는 게 없다. */
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, nick TEXT, level INTEGER, gold INTEGER, data TEXT
  );
  CREATE TABLE IF NOT EXISTS parties (id TEXT PRIMARY KEY, data TEXT);
  CREATE TABLE IF NOT EXISTS logs (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, text TEXT);
  CREATE TABLE IF NOT EXISTS player_daily (
    player_id   TEXT    NOT NULL,
    day         TEXT    NOT NULL,               -- 'YYYY-MM-DD'
    hunts_used  INTEGER NOT NULL DEFAULT 0,
    fights_used INTEGER NOT NULL DEFAULT 0,
    raids_used  INTEGER NOT NULL DEFAULT 0,
    destroys    INTEGER NOT NULL DEFAULT 0,
    attended    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, day)
  );
  CREATE INDEX IF NOT EXISTS idx_player_daily_day ON player_daily(day);
  CREATE TABLE IF NOT EXISTS player_limits (
    player_id    TEXT PRIMARY KEY,
    daily_hunts  INTEGER,                       -- NULL = CONFIG.dailyHunts
    daily_fights INTEGER,
    daily_raids  INTEGER,
    note         TEXT,
    updated_at   INTEGER
  );
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`);

/* 최초 1회: players.data JSON 안에 묻혀 있던 일일 카운터를 player_daily 로 추출.
 * 이후 persist() 가 data JSON 에서 해당 필드를 빼고 저장하므로 이 시점에 옮겨둬야 한다. */
function migrateDailyOut() {
  if (sqlite.prepare("SELECT v FROM meta WHERE k = 'daily_migrated'").get()) return;
  const rows = sqlite.prepare('SELECT id, data FROM players').all();
  if (rows.length) {
    const bak = DB_FILE + '.premigrate-' + Date.now() + '.bak';
    try { sqlite.prepare('VACUUM INTO ?').run(bak); console.log('   백업 생성: ' + path.basename(bak)); }
    catch (e) { console.error('   백업 실패(계속 진행):', e.message); }
  }
  const up = sqlite.prepare(`
    INSERT INTO player_daily (player_id, day, hunts_used, fights_used, raids_used, destroys, attended)
    VALUES (@pid, @day, @hunts, @fights, @raids, @destroys, @attended)
    ON CONFLICT(player_id, day) DO UPDATE SET
      hunts_used  = max(hunts_used,  @hunts),
      fights_used = max(fights_used, @fights),
      raids_used  = max(raids_used,  @raids),
      destroys    = max(destroys,    @destroys),
      attended    = max(attended,    @attended)`);
  let moved = 0;
  sqlite.transaction(() => {
    for (const r of rows) {
      let p;
      try { p = JSON.parse(r.data); } catch (e) { continue; }
      const put = (day, patch) => {
        if (!day) return;
        up.run(Object.assign(
          { pid: r.id, day: game.normalizeDay(day), hunts: 0, fights: 0, raids: 0, destroys: 0, attended: 0 },
          patch));
        moved++;
      };
      put(p.huntDay, { hunts: p.huntsUsed || 0 });
      put(p.fightDay, { fights: p.fightsUsed || 0 });
      put(p.raidDay, { raids: p.raidsUsed || 0 });
      put(p.destroyDay, { destroys: p.destroysToday || 0 });
      put(p.attendDay, { attended: 1 });
    }
    sqlite.prepare("INSERT INTO meta (k, v) VALUES ('daily_migrated', ?)").run(String(Date.now()));
  })();
  console.log('   일일 카운터 마이그레이션 완료 (' + moved + '건 → player_daily)');
}
migrateDailyOut();

function loadLimits() {
  const out = {};
  for (const r of sqlite.prepare('SELECT * FROM player_limits').all()) {
    const l = {};
    if (r.daily_hunts != null) l.dailyHunts = r.daily_hunts;
    if (r.daily_fights != null) l.dailyFights = r.daily_fights;
    if (r.daily_raids != null) l.dailyRaids = r.daily_raids;
    out[r.player_id] = Object.keys(l).length ? l : null;
  }
  return out;
}

// 로드한 원본 문자열 — persist 의 '바뀐 것만 쓰기' 캐시를 초기화하는 데 쓴다
const loadedRaw = { players: new Map(), parties: new Map(), daily: new Map() };

function loadAll() {
  const state = { players: {}, parties: {}, log: [], logSeq: 0 };
  const limits = loadLimits();
  const day = game.today();
  const dayRows = {};
  for (const r of sqlite.prepare('SELECT * FROM player_daily WHERE day = ?').all(day)) {
    dayRows[r.player_id] = r;
    loadedRaw.daily.set(r.player_id, day + '|' + r.hunts_used + '|' + r.fights_used + '|' + r.raids_used + '|' + r.destroys + '|' + r.attended);
  }
  for (const r of sqlite.prepare('SELECT id, nick, level, gold, data FROM players').all()) {
    const p = JSON.parse(r.data);
    // nick/level/gold 는 컬럼이 유일한 진실. 컬럼이 없는 레거시 행만 data JSON 값을 그대로 쓴다.
    if (r.nick != null) p.nick = r.nick;
    if (r.level != null) p.level = r.level;
    if (r.gold != null) p.gold = r.gold;
    game.applyDaily(p, dayRows[r.id]);   // 일일 카운터는 player_daily 가 유일한 진실
    p._lim = limits[r.id] || null;
    state.players[r.id] = p;
    loadedRaw.players.set(r.id, r.data);
  }
  for (const r of sqlite.prepare('SELECT id, data FROM parties').all()) {
    state.parties[r.id] = JSON.parse(r.data);
    loadedRaw.parties.set(r.id, r.data);
  }
  for (const r of sqlite.prepare('SELECT ts, text FROM logs ORDER BY seq ASC').all()) {
    state.log.push({ t: r.ts, n: ++state.logSeq, text: r.text });
  }
  if (state.log.length > 60) state.log = state.log.slice(-60);
  return state;
}
let db = loadAll();

/* players.data JSON 에서 제외할 키 — 다른 곳이 소유한다.
 *   nick/level/gold  → players 컬럼 (loadAll 에서 되읽는다)
 *   DAILY_FIELDS     → player_daily
 *   _lim             → player_limits
 * 기존 행의 data JSON 에는 아직 남아 있지만, 부팅 후 첫 persist 가 한 번 다시 쓰면서 사라진다. */
const OMIT_FROM_DATA = new Set(game.DAILY_FIELDS.concat(['_lim', 'nick', 'level', 'gold']));
function playerData(p) { return JSON.stringify(p, (k, v) => (OMIT_FROM_DATA.has(k) ? undefined : v)); }

const upsertPlayer = sqlite.prepare(
  `INSERT INTO players (id, nick, level, gold, data) VALUES (@id, @nick, @level, @gold, @data)
   ON CONFLICT(id) DO UPDATE SET nick=@nick, level=@level, gold=@gold, data=@data`);
const upsertDaily = sqlite.prepare(
  `INSERT INTO player_daily (player_id, day, hunts_used, fights_used, raids_used, destroys, attended)
   VALUES (@pid, @day, @hunts, @fights, @raids, @destroys, @attended)
   ON CONFLICT(player_id, day) DO UPDATE SET
     hunts_used=@hunts, fights_used=@fights, raids_used=@raids, destroys=@destroys, attended=@attended`);
const upsertParty = sqlite.prepare(
  `INSERT INTO parties (id, data) VALUES (@id, @data)
   ON CONFLICT(id) DO UPDATE SET data=@data`);
const deleteParty = sqlite.prepare('DELETE FROM parties WHERE id = ?');
const insLog = sqlite.prepare('INSERT INTO logs (ts, text) VALUES (?, ?)');
const pruneLogs = sqlite.prepare('DELETE FROM logs WHERE seq <= (SELECT max(seq) FROM logs) - ?');

/* 쓰기 증폭 방지 ----------
 * 예전 구현은 액션 한 번마다 전체 플레이어를 upsert 하고 parties/logs 를 통째로
 * 지웠다 다시 넣었다. 이제는 직렬화 결과를 캐시해두고 '실제로 바뀐 행'만 쓴다.
 * (게임 로직 곳곳에 dirty 플래그를 심는 것보다 누락 위험이 없다.) */
const writtenPlayer = new Map();  // id -> 마지막으로 DB 에 쓴 data 문자열
const writtenDaily = new Map();   // id -> 'day|h|f|r|d|a'
const writtenParty = new Map();   // id -> 마지막으로 DB 에 쓴 data 문자열
let writtenLogN = 0;              // 여기까지의 로그는 이미 append 됨
let logsSincePrune = 0;
const LOG_KEEP = 500;

// PERSIST_DEBUG=1 로 실행하면 저장마다 실제 쓰기 행 수를 찍는다 (쓰기 증폭 확인용)
const PERSIST_DEBUG = !!process.env.PERSIST_DEBUG;
let wrote = 0;

const persist = sqlite.transaction(() => {
  const day = game.today();
  wrote = 0;
  for (const id in db.players) {
    const p = db.players[id];
    const data = playerData(p);
    if (writtenPlayer.get(id) !== data) {
      upsertPlayer.run({ id, nick: p.nick || '', level: p.level || 0, gold: p.gold || 0, data });
      writtenPlayer.set(id, data);
      wrote++;
    }
    // 오늘 활동한 유저만 행을 쓴다. 날짜가 어제면 dailyUsage 가 0 을 주고 어제 행은 그대로 보존된다.
    // (0 도 기록해야 하므로 값이 아니라 '오늘 날짜를 찍었는가'로 판단 — 관리자가 0으로 리셋한 경우 포함)
    const touched = p.huntDay === day || p.fightDay === day || p.raidDay === day || p.destroyDay === day || p.attendDay === day;
    if (!touched) continue;
    const u = game.dailyUsage(p);
    const sig = day + '|' + u.hunts + '|' + u.fights + '|' + u.raids + '|' + u.destroys + '|' + u.attended;
    if (writtenDaily.get(id) === sig) continue;
    upsertDaily.run({ pid: id, day, hunts: u.hunts, fights: u.fights, raids: u.raids, destroys: u.destroys, attended: u.attended });
    writtenDaily.set(id, sig);
    wrote++;
  }

  for (const id in db.parties) {
    const data = JSON.stringify(db.parties[id]);
    if (writtenParty.get(id) === data) continue;
    upsertParty.run({ id, data });
    writtenParty.set(id, data);
    wrote++;
  }
  for (const id of writtenParty.keys()) {
    if (db.parties[id]) continue;
    deleteParty.run(id);
    writtenParty.delete(id);
    wrote++;
  }

  // 로그는 append-only. 아직 안 쓴 것만 넣고 가끔 오래된 행을 잘라낸다.
  for (const l of db.log) {
    if (!(l.n > writtenLogN)) continue;
    insLog.run(l.t, l.text);
    writtenLogN = l.n;
    logsSincePrune++;
    wrote++;
  }
  if (logsSincePrune >= 200) { pruneLogs.run(LOG_KEEP); logsSincePrune = 0; }
  if (PERSIST_DEBUG) console.log('[persist] rows=' + wrote + ' players=' + Object.keys(db.players).length);
});

/* 부팅 직후 첫 persist 가 전체를 다시 쓰지 않도록 캐시를 DB 원본으로 채운다.
 * DB 원본과 지금 직렬화 결과가 다르면(예: 마이그레이션 전 잔재) 딱 한 번만 다시 쓴다. */
for (const [id, data] of loadedRaw.players) writtenPlayer.set(id, data);
for (const [id, data] of loadedRaw.parties) writtenParty.set(id, data);
for (const [id, sig] of loadedRaw.daily) writtenDaily.set(id, sig);
writtenLogN = db.logSeq;

/* 유저별 상한 쓰기 — 메모리(p._lim)와 DB 를 함께 갱신한다 */
const upsertLimits = sqlite.prepare(
  `INSERT INTO player_limits (player_id, daily_hunts, daily_fights, daily_raids, note, updated_at)
   VALUES (@pid, @h, @f, @r, @note, @ts)
   ON CONFLICT(player_id) DO UPDATE SET
     daily_hunts=@h, daily_fights=@f, daily_raids=@r, note=@note, updated_at=@ts`);
const deleteLimits = sqlite.prepare('DELETE FROM player_limits WHERE player_id = ?');
function writeLimits(pid, lim, note) {
  if (!lim) { deleteLimits.run(pid); return; }
  upsertLimits.run({
    pid,
    h: lim.dailyHunts == null ? null : lim.dailyHunts,
    f: lim.dailyFights == null ? null : lim.dailyFights,
    r: lim.dailyRaids == null ? null : lim.dailyRaids,
    note: note == null ? null : String(note).slice(0, 200),
    ts: Date.now(),
  });
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { persist(); } catch (e) { console.error('저장 실패:', e.message); }
  }, 300);
}

/* ---------- 세션 ----------
 * token -> { id, seen }. 오래 안 쓴 토큰은 만료시켜 Map 이 무한히 자라지 않게 한다. */
const sessions = new Map();
const SESSION_TTL = 7 * 24 * 3600 * 1000;
function newToken() { return crypto.randomBytes(16).toString('hex'); }
function putSession(token, id) { sessions.set(token, { id, seen: Date.now() }); }
function getSession(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.seen > SESSION_TTL) { sessions.delete(token); return null; }
  s.seen = Date.now();
  return s.id;
}

/* ---------- 관리자 인증 ----------
 * ADMIN_TOKEN 환경변수가 설정된 경우에만 /api/admin/* 이 열린다. 미설정 = 완전 비활성. */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function isAdmin(req) { return !!ADMIN_TOKEN && safeEqual(req.headers['x-admin-token'] || '', ADMIN_TOKEN); }

/* ---------- 실시간 이벤트 (SSE) ---------- */
const clients = new Map(); // accountId -> Set<res>
function sseWrite(res, event, data) {
  try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data || {}) + '\n\n'); } catch (e) { /* 끊긴 연결 무시 */ }
}
function sseSend(id, event, data) { const set = clients.get(id); if (set) for (const res of set) sseWrite(res, event, data); }
function broadcast(event, data) { for (const set of clients.values()) for (const res of set) sseWrite(res, event, data); }

/* refresh 코얼레싱 ----------
 * 액션마다 전원에게 refresh 를 쏘면 접속자 C × 액션수 A 만큼 /api/me 재요청이 몰린다.
 * 최대 1초에 한 번으로 묶는다. (첫 신호는 즉시 — 반응성 유지) */
const REFRESH_WINDOW = 1000;
let lastRefreshAt = 0, refreshTimer = null;
function markRefresh() {
  if (refreshTimer) return;
  const wait = Math.max(0, REFRESH_WINDOW - (Date.now() - lastRefreshAt));
  if (wait === 0) { lastRefreshAt = Date.now(); return broadcast('refresh'); }
  refreshTimer = setTimeout(() => { refreshTimer = null; lastRefreshAt = Date.now(); broadcast('refresh'); }, wait);
}

/* 남의 화면까지 바뀌는 액션만 전체 알림 대상.
 * 사냥/채굴/출석/상점/강화는 본인 상태만 바뀌므로 응답에 실린 me 로 충분하다.
 * (강화는 랭킹이 흔들리므로 레벨이 실제로 변한 경우에만 아래에서 따로 처리) */
const SHARED_ACTIONS = new Set([
  '/api/fight', '/api/raid', '/api/setclass', '/api/rename',
  '/api/party/create', '/api/party/join', '/api/party/leave',
  '/api/party/invite', '/api/party/accept', '/api/party/reject',
]);

/* ---------- 공개 조회 캐시 ----------
 * /api/rank 등은 인증 없이 열려 있고 매 호출마다 전체 정렬이라 O(P log P).
 * 짧은 TTL 로 묶으면 접속자 수와 무관하게 비용이 상수로 고정된다. */
const READ_TTL = 2000;
const readCache = new Map();
function cachedRead(key, fn) {
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.t < READ_TTL) return hit.v;
  const v = fn();
  readCache.set(key, { t: Date.now(), v });
  return v;
}
function invalidateReads() { readCache.clear(); }

/* ---------- 액션 속도제한 (계정별 토큰버킷) ----------
 * 정상 플레이(클라 450ms 쿨다운 ≈ 초당 2.2회)는 통과, 스크립트 연타는 차단. */
const RL_CAP = 8;         // 최대 버스트
const RL_REFILL = 3;      // 초당 토큰 회복
const buckets = new Map(); // accountId -> { tokens, last }
function allowAction(id) {
  const now = Date.now();
  let b = buckets.get(id);
  if (!b) { b = { tokens: RL_CAP, last: now }; buckets.set(id, b); }
  b.tokens = Math.min(RL_CAP, b.tokens + (now - b.last) / 1000 * RL_REFILL);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/* 주기적 정리 — 만료 세션 / 유휴 버킷 제거 (둘 다 그냥 두면 무한히 자란다) */
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (now - s.seen > SESSION_TTL) sessions.delete(t);
  for (const [k, b] of buckets) if (now - b.last > 600000) buckets.delete(k);
}, 600000).unref();

/* ---------- HTTP 헬퍼 ---------- */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  // 빌드된 난독화 파일이 있으면 app.js 대신 서빙 (npm run build 후)
  if (rel === '/app.js' && fs.existsSync(path.join(PUBLIC_DIR, 'app.min.js'))) rel = '/app.min.js';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ---------- 인증된 액션 공통 처리 (세션 → accountId) ---------- */
function authId(req) {
  const id = getSession(req.headers['x-token']);
  return id && db.players[id] ? id : null;
}

/* ---------- 라우팅 ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  // 정적 파일
  if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(res, p);

  // 실시간 이벤트 스트림 (SSE) — 토큰은 쿼리로 전달(EventSource는 헤더 불가)
  if (req.method === 'GET' && p === '/api/events') {
    const id = getSession(u.searchParams.get('token'));
    if (!id || !db.players[id]) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    if (!clients.has(id)) clients.set(id, new Set());
    clients.get(id).add(res);
    const ping = setInterval(() => sseWrite(res, 'ping', {}), 25000);
    req.on('close', () => { clearInterval(ping); const set = clients.get(id); if (set) { set.delete(res); if (!set.size) clients.delete(id); } });
    return;
  }

  // 로그인 (토큰 불필요)
  if (req.method === 'POST' && p === '/api/login') {
    const body = await readBody(req);
    const r = game.login(db, body.nick, body.pin);
    if (!r.ok) return sendJson(res, 400, r);
    const token = newToken();
    putSession(token, r.id); // 세션은 accountId(pinKey)를 저장
    if (r.isNew) invalidateReads();
    save();
    return sendJson(res, 200, { ok: true, isNew: r.isNew, needClass: r.needClass, token, me: game.publicView(db, r.id) });
  }

  // 공개 조회 (토큰 불필요) — 전부 전체 스캔·정렬이라 짧은 TTL 캐시를 씌운다
  if (req.method === 'GET' && p === '/api/rank') return sendJson(res, 200, { ok: true, list: cachedRead('rank', () => game.ranking(db)) });
  if (req.method === 'GET' && p === '/api/goldrank') return sendJson(res, 200, { ok: true, list: cachedRead('goldrank', () => game.goldRanking(db)) });
  if (req.method === 'GET' && p === '/api/hogu') return sendJson(res, 200, { ok: true, list: cachedRead('hogu', () => game.hogu(db)) });
  if (req.method === 'GET' && p === '/api/log') return sendJson(res, 200, { ok: true, list: cachedRead('log', () => game.recentLog(db)) });
  if (req.method === 'GET' && p === '/api/players') return sendJson(res, 200, { ok: true, list: cachedRead('players', () => game.playerList(db)) });
  if (req.method === 'GET' && p === '/api/profile') {
    return sendJson(res, 200, game.profile(db, (u.searchParams.get('name') || '').trim()));
  }
  if (req.method === 'GET' && p === '/api/classes') return sendJson(res, 200, { ok: true, classes: game.CLASSES });
  if (req.method === 'GET' && p === '/api/shop') return sendJson(res, 200, { ok: true, items: game.shopItems() });
  if (req.method === 'GET' && p === '/api/bosses') return sendJson(res, 200, { ok: true, bosses: game.BOSSES });
  if (req.method === 'GET' && p === '/api/parties') return sendJson(res, 200, { ok: true, list: cachedRead('parties', () => game.partyList(db)) });

  /* ---------- 관리자 API (ADMIN_TOKEN 설정 시에만 활성) ----------
   *   GET  /api/admin/limits            현재 상한 오버라이드 목록 + 기본값
   *   POST /api/admin/limits            {nick|id, dailyHunts?, dailyFights?, dailyRaids?, note?}
   *                                     값이 null/'' 이면 해당 항목 해제(기본값 복귀)
   *   GET  /api/admin/daily?day=YYYY-MM-DD   해당 날짜 사용량 (기본: 오늘)
   *   POST /api/admin/daily             {nick|id, hunts?, fights?, raids?}  오늘 사용량 강제 설정
   *   POST /api/admin/reload            DB를 SQL로 직접 고친 뒤 메모리에 다시 읽어들이기 */
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) {
      return sendJson(res, 403, { ok: false, error: ADMIN_TOKEN ? '관리자 토큰이 올바르지 않습니다.' : 'ADMIN_TOKEN 이 설정되지 않아 관리자 API가 비활성 상태입니다.' });
    }
    const eff = (t) => ({ dailyHunts: game.limitOf(t, 'dailyHunts'), dailyFights: game.limitOf(t, 'dailyFights'), dailyRaids: game.limitOf(t, 'dailyRaids') });
    const resolve = (b) => {
      const pid = b.id || game.findByNick(db, (b.nick || '').trim());
      return pid && db.players[pid] ? pid : null;
    };

    if (req.method === 'GET' && p === '/api/admin/limits') {
      const rows = sqlite.prepare('SELECT * FROM player_limits').all();
      const list = rows.map(r => ({
        id: r.player_id,
        nick: db.players[r.player_id] ? db.players[r.player_id].nick : null,
        dailyHunts: r.daily_hunts, dailyFights: r.daily_fights, dailyRaids: r.daily_raids,
        note: r.note, updatedAt: r.updated_at,
      }));
      return sendJson(res, 200, {
        ok: true, list,
        defaults: { dailyHunts: game.CONFIG.dailyHunts, dailyFights: game.CONFIG.dailyFights, dailyRaids: game.CONFIG.dailyRaids },
      });
    }

    if (req.method === 'GET' && p === '/api/admin/daily') {
      const day = game.normalizeDay(u.searchParams.get('day') || game.today());
      const list = sqlite.prepare(
        `SELECT d.player_id AS id, p.nick, d.hunts_used, d.fights_used, d.raids_used, d.destroys, d.attended
           FROM player_daily d LEFT JOIN players p ON p.id = d.player_id
          WHERE d.day = ? ORDER BY d.hunts_used DESC, d.raids_used DESC`).all(day);
      return sendJson(res, 200, { ok: true, day, list });
    }

    if (req.method === 'POST' && p === '/api/admin/limits') {
      const b = await readBody(req);
      const pid = resolve(b);
      if (!pid) return sendJson(res, 404, { ok: false, error: '대상 유저를 찾을 수 없습니다.' });
      const t = game.norm(db.players[pid]);
      const r = game.setLimits(t, b);
      if (!r.ok) return sendJson(res, 400, r);
      writeLimits(pid, r.limits, b.note);
      invalidateReads(); markRefresh();
      return sendJson(res, 200, { ok: true, id: pid, nick: t.nick, override: r.limits, effective: eff(t) });
    }

    if (req.method === 'POST' && p === '/api/admin/daily') {
      const b = await readBody(req);
      const pid = resolve(b);
      if (!pid) return sendJson(res, 404, { ok: false, error: '대상 유저를 찾을 수 없습니다.' });
      const t = game.norm(db.players[pid]);
      const today = game.today();
      for (const [key, dayField, usedField] of [['hunts', 'huntDay', 'huntsUsed'], ['fights', 'fightDay', 'fightsUsed'], ['raids', 'raidDay', 'raidsUsed']]) {
        if (b[key] == null || b[key] === '') continue;
        const n = parseInt(b[key], 10);
        if (isNaN(n) || n < 0) return sendJson(res, 400, { ok: false, error: key + ' 은(는) 0 이상의 정수여야 합니다.' });
        t[dayField] = today; t[usedField] = n;
      }
      save();
      invalidateReads(); markRefresh();
      return sendJson(res, 200, { ok: true, id: pid, nick: t.nick, usage: game.dailyUsage(t), effective: eff(t) });
    }

    if (req.method === 'POST' && p === '/api/admin/reload') {
      const limits = loadLimits();
      for (const k in db.players) db.players[k]._lim = limits[k] || null;
      invalidateReads(); markRefresh();
      return sendJson(res, 200, { ok: true, loaded: Object.keys(limits).length });
    }
    return sendJson(res, 404, { ok: false, error: 'unknown admin action' });
  }

  // 인증 필요
  const id = authId(req);
  if (p.startsWith('/api/')) {
    if (!id) return sendJson(res, 401, { ok: false, error: '로그인이 필요합니다.' });

    if (req.method === 'GET' && p === '/api/me') return sendJson(res, 200, { ok: true, me: game.publicView(db, id) });
    if (req.method === 'GET' && p === '/api/party/raid') return sendJson(res, 200, game.raidState(db, id));

    if (req.method === 'POST') {
      if (!allowAction(id)) return sendJson(res, 429, { ok: false, error: '너무 빠릅니다. 잠시 후 다시 시도하세요.' });
      let r;
      if (p === '/api/setclass') { const b = await readBody(req); r = game.setClass(db, id, b.class); }
      else if (p === '/api/rename') { const b = await readBody(req); r = game.rename(db, id, b.nick); }
      else if (p === '/api/enhance') r = game.enhance(db, id);
      else if (p === '/api/attend') r = game.attend(db, id);
      else if (p === '/api/mine') r = game.mine(db, id);
      else if (p === '/api/mine/swing') r = game.mineSwing(db, id);
      else if (p === '/api/hunt') r = game.hunt(db, id);
      else if (p === '/api/title') { const b = await readBody(req); r = game.equipTitle(db, id, b.title || null); }
      else if (p === '/api/protect') { const b = await readBody(req); r = game.buyProtect(db, id, b.qty); }
      else if (p === '/api/shop/buy') {
        const b = await readBody(req);
        if (b.item === 'protect') r = game.buyProtect(db, id, 1);
        else if (b.item === 'boost') r = game.buyBoost(db, id);
        else if (b.item === 'dye') r = game.buyDye(db, id);
        else if (b.item === 'classchange') r = game.buyClassChange(db, id);
        else r = { ok: false, error: '알 수 없는 상품' };
      }
      else if (p === '/api/fight') { const b = await readBody(req); r = game.fight(db, id, b.target); }
      else if (p === '/api/party/create') r = game.partyCreate(db, id);
      else if (p === '/api/party/join') { const b = await readBody(req); r = game.partyJoin(db, id, b.id); }
      else if (p === '/api/party/leave') r = game.partyLeave(db, id);
      else if (p === '/api/party/invite') { const b = await readBody(req); r = game.partyInvite(db, id, b.nick); }
      else if (p === '/api/party/accept') { const b = await readBody(req); r = game.partyAccept(db, id, b.id); }
      else if (p === '/api/party/reject') { const b = await readBody(req); r = game.partyReject(db, id, b.id); }
      else if (p === '/api/raid') { const b = await readBody(req); r = game.raidStart(db, id, b.boss); }
      else return sendJson(res, 404, { ok: false, error: 'unknown action' });

      if (r.ok) {
        save();
        // 남의 화면이 실제로 바뀌는 경우에만 전체 알림.
        // 사냥/채굴/출석/상점/실패한 강화는 응답에 실린 me 로 본인 화면만 갱신되면 충분하다.
        // r.silent(예: 채굴장 곡괭이질 연타)은 어떤 경우에도 전체 알림 대상이 아니다.
        const levelMoved = r.result === 'success' || r.result === 'destroy';
        if (!r.silent && (SHARED_ACTIONS.has(p) || levelMoved)) {
          invalidateReads();  // 랭킹·파티 목록 캐시 폐기
          markRefresh();      // 최대 1초에 한 번으로 묶어서 전송
        }
        // 개인 알림(당사자에게 토스트)
        if (p === '/api/fight') {
          const tid = game.findByNick(db, r.def.nick);
          if (tid) sseSend(tid, 'notify', {
            msg: r.winner === r.def.nick
              ? '🛡️ ' + r.atk.nick + '님의 도전을 막아냈어요! (+' + r.steal + 'G)'
              : '⚔️ ' + r.atk.nick + '님에게 패해 ' + r.steal + 'G를 뺏겼어요' + (r.broke && r.broke.who === r.def.nick ? ' · 💢무기 손상' : '')
          });
        } else if (p === '/api/party/invite' && r.targetId) {
          sseSend(r.targetId, 'notify', { msg: '📨 ' + r.byNick + '님이 파티에 초대했어요!' });
        }
      }
      return sendJson(res, r.ok ? 200 : 400, Object.assign(r, { me: game.publicView(db, id) }));
    }
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name]) { if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address); }
  }
  console.log('🎮 강화 RPG 서버 실행 중  (포트 ' + PORT + ')');
  console.log('   내 컴퓨터:   http://localhost:' + PORT);
  ips.forEach(ip => console.log('   같은 네트워크: http://' + ip + ':' + PORT + '   ← 이 주소를 동료에게 공유'));
  console.log('   (종료: Ctrl+C)');
});
