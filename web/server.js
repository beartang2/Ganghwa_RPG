'use strict';
/*
 * 강화 RPG 웹 서버 (순수 Node.js, 의존성 없음)
 * 실행:  node server.js
 * 접속:  같은 네트워크(회사 와이파이 등)에서  http://<맥 로컬IP>:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const game = require('./game');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------- 데이터 로드/저장 ---------- */
let db = { players: {}, log: [] };
try {
  if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) { console.error('데이터 로드 실패, 새로 시작:', e.message); }
if (!db.players) db.players = {};
if (!db.log) db.log = [];

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db), err => { if (err) console.error('저장 실패:', err.message); });
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

/* ---------- 인증된 액션 공통 처리 ---------- */
function authNick(req) {
  const token = req.headers['x-token'];
  return token && sessions.get(token);
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
    const nick = body.nick.trim();
    const token = newToken();
    sessions.set(token, nick);
    save();
    return sendJson(res, 200, { ok: true, isNew: r.isNew, token, me: game.publicView(db, nick) });
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

  // 인증 필요
  const nick = authNick(req);
  if (p.startsWith('/api/')) {
    if (!nick) return sendJson(res, 401, { ok: false, error: '로그인이 필요합니다.' });

    if (req.method === 'GET' && p === '/api/me') return sendJson(res, 200, { ok: true, me: game.publicView(db, nick) });

    if (req.method === 'POST') {
      let r;
      if (p === '/api/enhance') r = game.enhance(db, nick);
      else if (p === '/api/attend') r = game.attend(db, nick);
      else if (p === '/api/hunt') r = game.hunt(db, nick);
      else if (p === '/api/protect') { const b = await readBody(req); r = game.buyProtect(db, nick, b.qty); }
      else if (p === '/api/fight') { const b = await readBody(req); r = game.fight(db, nick, b.target); }
      else return sendJson(res, 404, { ok: false, error: 'unknown action' });

      if (r.ok) save();
      return sendJson(res, r.ok ? 200 : 400, Object.assign(r, { me: game.publicView(db, nick) }));
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
