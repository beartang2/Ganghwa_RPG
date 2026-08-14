'use strict';
// 진단용 — 의존성 없이 함수가 도는지 + pg 설치 여부 + DATABASE_URL 존재 여부만 확인.
// /api/health(pg+DB 필요)가 크래시할 때 원인 격리용. (catch-all 보다 우선 매칭됨)
module.exports = (req, res) => {
  let hasPg = false, pgErr = null;
  try { require.resolve('pg'); hasPg = true; } catch (e) { pgErr = String(e && e.message || e); }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    pong: true,
    node: process.version,
    hasPg,
    pgErr,
    hasDatabaseUrl: !!process.env.DATABASE_URL,
  }));
};
