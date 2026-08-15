'use strict';
/*
 * Vercel 배포용 진입점 — Postgres 전용. public/ 정적 서빙 + /api/* 를 라우터에 위임.
 * Vercel 이 이 파일을 (a) Node 서버로 실행하든 (listen), (b) 서버리스 핸들러로 호출하든
 * 둘 다 동작하도록: 요청 핸들러 함수를 export 하고, 동시에 서버로도 listen 한다.
 *
 * ⚠️ 로컬/Render 상시서버는 server.js(SQLite) — .vercelignore 로 배포 제외.
 *    이 파일은 DATABASE_URL(Supabase) 로만 동작한다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { handle } = require('./api/_lib/router');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};
function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  if (rel === '/app.js' && fs.existsSync(path.join(PUBLIC_DIR, 'app.min.js'))) rel = '/app.min.js';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// 어떤 경우에도 크래시 대신 응답을 보내도록 전체를 감싼다.
async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(res, p);
    if (!p.startsWith('/api/')) { res.writeHead(404); return res.end('not found'); }

    if (!process.env.DATABASE_URL) {
      return sendJson(res, 500, { ok: false, db: false, error: 'DATABASE_URL 환경변수가 설정되지 않았습니다.' });
    }
    const token = req.headers['x-token'] || url.searchParams.get('token') || '';
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || (req.socket && req.socket.remoteAddress) || '';
    let client;
    try {
      // Vercel 이 이미 본문을 파싱했으면 그걸 쓰고(스트림이 소진돼 readBody 가 멈추는 것 방지),
      // 아니면 원본 스트림에서 읽는다.
      const body = req.method === 'POST'
        ? ((req.body && typeof req.body === 'object') ? req.body : await readBody(req))
        : {};
      client = await getPool().connect();
      await client.query('BEGIN');
      const q = async (text, params) => (await client.query(text, params || [])).rows;
      const out = await handle(req.method, p, { token, body, query: url.searchParams, q, ip });
      await client.query('COMMIT');
      sendJson(res, out.status, out.body);
    } catch (e) {
      if (client) { try { await client.query('ROLLBACK'); } catch (_) { /* noop */ } }
      console.error('[api]', req.method, p, e && e.message);
      sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
    } finally {
      if (client) client.release();
    }
  } catch (e) {
    console.error('[handler]', e && e.message);
    try { sendJson(res, 500, { ok: false, error: String((e && e.message) || e) }); } catch (_) { /* 이미 응답됨 */ }
  }
}

// (b) 서버리스 핸들러로 호출될 때
module.exports = handler;

// (a) Node 서버로 실행될 때 (로컬 `node index.js` 포함). 포트 바인딩 실패는 무시.
const server = http.createServer(handler);
server.on('error', (e) => console.error('[listen]', e && e.message));
try { server.listen(PORT, () => console.log('ganghwa-rpg (postgres) on :' + PORT)); } catch (e) { /* serverless */ }
