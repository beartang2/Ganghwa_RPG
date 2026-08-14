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

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method;
  const token = req.headers['x-token'] || url.searchParams.get('token') || '';
  // Vercel 이 이미 JSON 파싱했으면 그걸 쓰고, 아니면 원본 스트림에서 읽는다
  const body = (req.body && typeof req.body === 'object') ? req.body
    : (method === 'POST' ? await readRawJson(req) : {});

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const q = async (text, params) => (await client.query(text, params || [])).rows;
    const out = await handle(method, pathname, { token, body, query: url.searchParams, q });
    await client.query('COMMIT');
    res.statusCode = out.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(out.body));
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    console.error('[api]', method, pathname, e && e.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  } finally {
    client.release();
  }
};
