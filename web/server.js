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
const sessions = new Map(); // token -> nick
function newToken() { return crypto.randomBytes(16).toString('hex'); }

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
  if (req.method === 'GET' && p === '/api/bosses') return sendJson(res, 200, { ok: true, bosses: game.BOSSES });
  if (req.method === 'GET' && p === '/api/parties') return sendJson(res, 200, { ok: true, list: game.partyList(db) });

  // 인증 필요
  const id = authId(req);
  if (p.startsWith('/api/')) {
    if (!id) return sendJson(res, 401, { ok: false, error: '로그인이 필요합니다.' });

    if (req.method === 'GET' && p === '/api/me') return sendJson(res, 200, { ok: true, me: game.publicView(db, id) });
    if (req.method === 'GET' && p === '/api/party/raid') return sendJson(res, 200, game.raidState(db, id));

    if (req.method === 'POST') {
      let r;
      if (p === '/api/setclass') { const b = await readBody(req); r = game.setClass(db, id, b.class); }
      else if (p === '/api/rename') { const b = await readBody(req); r = game.rename(db, id, b.nick); }
      else if (p === '/api/enhance') r = game.enhance(db, id);
      else if (p === '/api/attend') r = game.attend(db, id);
      else if (p === '/api/mine') r = game.mine(db, id);
      else if (p === '/api/hunt') r = game.hunt(db, id);
      else if (p === '/api/protect') { const b = await readBody(req); r = game.buyProtect(db, id, b.qty); }
      else if (p === '/api/fight') { const b = await readBody(req); r = game.fight(db, id, b.target); }
      else if (p === '/api/party/create') r = game.partyCreate(db, id);
      else if (p === '/api/party/join') { const b = await readBody(req); r = game.partyJoin(db, id, b.id); }
      else if (p === '/api/party/leave') r = game.partyLeave(db, id);
      else if (p === '/api/party/invite') { const b = await readBody(req); r = game.partyInvite(db, id, b.nick); }
      else if (p === '/api/party/accept') { const b = await readBody(req); r = game.partyAccept(db, id, b.id); }
      else if (p === '/api/party/reject') { const b = await readBody(req); r = game.partyReject(db, id, b.id); }
      else if (p === '/api/raid') { const b = await readBody(req); r = game.raidStart(db, id, b.boss); }
      else return sendJson(res, 404, { ok: false, error: 'unknown action' });

      if (r.ok) save();
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
