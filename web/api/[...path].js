'use strict';
/*
 * Vercel 서버리스 진입점 (catch-all) — 모든 /api/* 요청을 받아
 * Postgres 트랜잭션을 열고 라우터에 넘긴다.
 *
 * 환경변수:
 *   DATABASE_URL  Supabase 연결 문자열 (서버리스는 Transaction 풀러 권장: 포트 6543)
 *   PGSSL=disable 로컬 비-SSL Postgres 로 붙을 때만
 */
const { Pool } = require('pg');
const { handle } = require('./_lib/router');

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1, // 서버리스 인스턴스당 1 커넥션 (풀링은 Supabase 풀러가 담당)
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function readRawJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method;
  const token = req.headers['x-token'] || url.searchParams.get('token') || '';
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || '';

  // DATABASE_URL 미설정이면 연결 시도 전에 명확히 안내 (크래시 대신 진단 가능한 500)
  if (!process.env.DATABASE_URL) {
    return send(res, 500, { ok: false, db: false, error: 'DATABASE_URL 환경변수가 설정되지 않았습니다. Vercel Settings → Environment Variables 에서 추가 후 재배포하세요.' });
  }

  const write = method !== 'GET';   // 읽기 전용 GET 은 트랜잭션 없이(autocommit) — BEGIN/COMMIT 왕복 2회 절약
  let client;
  try {
    // Vercel 이 이미 JSON 파싱했으면 그걸 쓰고, 아니면 원본 스트림에서 읽는다
    const body = (req.body && typeof req.body === 'object') ? req.body
      : (method === 'POST' ? await readRawJson(req) : {});
    client = await getPool().connect();   // 연결 실패도 여기서 잡아 깔끔한 500 으로
    if (write) await client.query('BEGIN');
    const q = async (text, params) => (await client.query(text, params || [])).rows;
    const out = await handle(method, pathname, { token, body, query: url.searchParams, q, ip });
    if (write) await client.query('COMMIT');
    send(res, out.status, out.body);
  } catch (e) {
    if (client && write) { try { await client.query('ROLLBACK'); } catch (_) { /* noop */ } }
    const msg = String((e && e.message) || e);
    console.error('[api]', method, pathname, msg);
    // 진단을 위해 실제 에러 메시지를 노출 (비밀번호는 pg 에러에 포함되지 않음)
    send(res, 500, { ok: false, error: msg });
  } finally {
    if (client) client.release();
  }
};
