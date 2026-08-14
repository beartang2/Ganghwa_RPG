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
const DB_FILE = path.join(__dirname, 'game.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------- SQLite 저장 계층 ----------
 * 게임 로직은 인메모리 db 객체(players/parties/log)로 동작하고,
 * 여기서 SQLite에 적재/영속화한다. (플레이어는 id별 행 + JSON 페이로드) */
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, nick TEXT, level INTEGER, gold INTEGER, data TEXT
  );
  CREATE TABLE IF NOT EXISTS parties (id TEXT PRIMARY KEY, data TEXT);
  CREATE TABLE IF NOT EXISTS logs (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, text TEXT);
`);

function loadAll() {
  const state = { players: {}, parties: {}, log: [] };
  for (const r of sqlite.prepare('SELECT id, data FROM players').all()) state.players[r.id] = JSON.parse(r.data);
  for (const r of sqlite.prepare('SELECT id, data FROM parties').all()) state.parties[r.id] = JSON.parse(r.data);
  for (const r of sqlite.prepare('SELECT ts, text FROM logs ORDER BY seq ASC').all()) state.log.push({ t: r.ts, text: r.text });
  return state;
}
let db = loadAll();

const upsertPlayer = sqlite.prepare(
  `INSERT INTO players (id, nick, level, gold, data) VALUES (@id, @nick, @level, @gold, @data)
   ON CONFLICT(id) DO UPDATE SET nick=@nick, level=@level, gold=@gold, data=@data`);
const insParty = sqlite.prepare('INSERT INTO parties (id, data) VALUES (?, ?)');
const insLog = sqlite.prepare('INSERT INTO logs (ts, text) VALUES (?, ?)');
const persist = sqlite.transaction(() => {
  for (const id in db.players) {
    const p = db.players[id];
    upsertPlayer.run({ id, nick: p.nick || '', level: p.level || 0, gold: p.gold || 0, data: JSON.stringify(p) });
  }
  sqlite.prepare('DELETE FROM parties').run();
  for (const id in db.parties) insParty.run(id, JSON.stringify(db.parties[id]));
  sqlite.prepare('DELETE FROM logs').run();
  for (const l of db.log) insLog.run(l.t, l.text);
});

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { persist(); } catch (e) { console.error('저장 실패:', e.message); }
  }, 300);
}

/* ---------- 세션 ---------- */
const sessions = new Map(); // token -> accountId
function newToken() { return crypto.randomBytes(16).toString('hex'); }

/* ---------- 실시간 이벤트 (SSE) ---------- */
const clients = new Map(); // accountId -> Set<res>
function sseWrite(res, event, data) {
  try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data || {}) + '\n\n'); } catch (e) { /* 끊긴 연결 무시 */ }
}
function sseSend(id, event, data) { const set = clients.get(id); if (set) for (const res of set) sseWrite(res, event, data); }
function broadcast(event, data) { for (const set of clients.values()) for (const res of set) sseWrite(res, event, data); }

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
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
  const token = req.headers['x-token'];
  const id = token && sessions.get(token);
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
    const id = sessions.get(u.searchParams.get('token'));
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
    sessions.set(token, r.id); // 세션은 accountId(pinKey)를 저장
    save();
    return sendJson(res, 200, { ok: true, isNew: r.isNew, needClass: r.needClass, token, me: game.publicView(db, r.id) });
  }

  // 공개 조회 (토큰 불필요)
  if (req.method === 'GET' && p === '/api/rank') return sendJson(res, 200, { ok: true, list: game.ranking(db) });
  if (req.method === 'GET' && p === '/api/goldrank') return sendJson(res, 200, { ok: true, list: game.goldRanking(db) });
  if (req.method === 'GET' && p === '/api/hogu') return sendJson(res, 200, { ok: true, list: game.hogu(db) });
  if (req.method === 'GET' && p === '/api/log') return sendJson(res, 200, { ok: true, list: game.recentLog(db) });
  if (req.method === 'GET' && p === '/api/players') return sendJson(res, 200, { ok: true, list: game.playerList(db) });
  if (req.method === 'GET' && p === '/api/profile') {
    return sendJson(res, 200, game.profile(db, (u.searchParams.get('name') || '').trim()));
  }
  if (req.method === 'GET' && p === '/api/classes') return sendJson(res, 200, { ok: true, classes: game.CLASSES });
  if (req.method === 'GET' && p === '/api/shop') return sendJson(res, 200, { ok: true, items: game.shopItems() });
  if (req.method === 'GET' && p === '/api/bosses') return sendJson(res, 200, { ok: true, bosses: game.BOSSES });
  if (req.method === 'GET' && p === '/api/parties') return sendJson(res, 200, { ok: true, list: game.partyList(db) });

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
        // silent 액션(예: 채굴장 곡괭이질 연타)은 전체 broadcast 생략 — 본인만 r.me로 갱신
        if (!r.silent) broadcast('refresh'); // 모든 접속자에게 "상태 바뀜" 알림 → 각자 갱신
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
