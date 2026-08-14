'use strict';
/*
 * 서버리스 라우터 — server.js 의 요청 처리 로직을 DB 비의존 형태로 옮긴 것.
 * 응답 JSON 모양은 기존 프론트(public/app.js)가 그대로 쓰도록 server.js 와 동일하게 맞춘다.
 *
 * handle(method, pathname, ctx) → { status, body }
 *   ctx = { token, body, query(URLSearchParams), q(text,params)=>rows }
 *
 * 아직 이식 안 된 것(다음 단계): 싸움/파티/레이드(멀티플레이어·실시간), 관리자 API, 속도제한.
 */
const crypto = require('crypto');
const game = require('../../game');
const store = require('./store');

const ok = (body) => ({ status: 200, body });
const bad = (body, status = 400) => ({ status, body });
function newToken() { return crypto.randomBytes(16).toString('hex'); }

// 아직 서버리스로 이식되지 않은 액션 — 명확히 알린다(조용한 오작동 방지)
//   레이드(POST /api/raid)는 3단계(결과 즉시+턴 재생)에서 이식
const NOT_YET = new Set(['/api/raid']);

async function handle(method, pathname, ctx) {
  const { q } = ctx;

  // ---- 공개 GET ----
  if (method === 'GET') {
    if (pathname === '/api/classes') return ok({ ok: true, classes: game.CLASSES });
    if (pathname === '/api/shop') return ok({ ok: true, items: game.shopItems() });
    if (pathname === '/api/bosses') return ok({ ok: true, bosses: game.BOSSES });
    if (pathname === '/api/rank') { const db = await store.readDb(q); return ok({ ok: true, list: game.ranking(db) }); }
    if (pathname === '/api/goldrank') { const db = await store.readDb(q); return ok({ ok: true, list: game.goldRanking(db) }); }
    if (pathname === '/api/hogu') { const db = await store.readDb(q); return ok({ ok: true, list: game.hogu(db) }); }
    if (pathname === '/api/players') { const db = await store.readDb(q); return ok({ ok: true, list: game.playerList(db) }); }
    if (pathname === '/api/log') { const db = await store.readDb(q, { withLogs: true }); return ok({ ok: true, list: game.recentLog(db) }); }
    if (pathname === '/api/profile') { const db = await store.readDb(q); return ok(game.profile(db, (ctx.query.get('name') || '').trim())); }
    if (pathname === '/api/parties') { const db = await store.readDb(q); return ok({ ok: true, list: game.partyList(db) }); }
  }

  // ---- 로그인(토큰 발급) ----
  if (method === 'POST' && pathname === '/api/login') {
    const b = ctx.body || {};
    const key = game.pinKey((b.pin || '').trim());
    const { r, db } = await store.runGame(q, { lockId: key }, (db) => game.login(db, b.nick, b.pin));
    if (!r.ok) return bad(r);
    const token = newToken();
    await store.putSession(q, token, r.id);
    return ok({ ok: true, token, isNew: r.isNew, needClass: r.needClass, me: game.publicView(db, r.id) });
  }

  // ---- 인증 필요 ----
  const id = await store.getSession(q, ctx.token);

  if (method === 'GET' && pathname === '/api/me') {
    if (!id) return bad({ ok: false, error: '로그인이 필요합니다.' }, 401);
    const db = await store.readDb(q);
    if (!db.players[id]) return bad({ ok: false, error: '로그인이 필요합니다.' }, 401);
    return ok({ ok: true, me: game.publicView(db, id) });
  }
  if (method === 'GET' && pathname === '/api/party/raid') {
    if (!id) return bad({ ok: false, error: '로그인이 필요합니다.' }, 401);
    const db = await store.readDb(q);
    return ok(game.raidState(db, id));
  }

  if (method === 'POST') {
    if (pathname === '/api/logout') { await store.deleteSession(q, ctx.token); return ok({ ok: true }); }
    if (!id) return bad({ ok: false, error: '로그인이 필요합니다.' }, 401);
    if (NOT_YET.has(pathname)) return bad({ ok: false, error: '이 기능은 아직 서버리스 버전으로 이식 중이에요. (곧 지원)' }, 501);

    const b = ctx.body || {};

    // ---- 멀티플레이어: 관련 행을 함께 잠근다 ----
    if (pathname === '/api/fight') {
      const rows = await q('SELECT id FROM players WHERE nick = $1', [(b.target || '').trim()]);
      const targetId = rows.length ? rows[0].id : null;
      const { r, db } = await store.runGame(q, { lockId: id, lockPlayerIds: [targetId] }, (db) => game.fight(db, id, b.target));
      return { status: r.ok ? 200 : 400, body: Object.assign(r, { me: game.publicView(db, id) }) };
    }
    if (pathname.startsWith('/api/party/')) {
      const partyId = b.id || null; // join/accept/reject 대상 파티
      let pfn = null;
      if (pathname === '/api/party/create') pfn = (db) => game.partyCreate(db, id);
      else if (pathname === '/api/party/join') pfn = (db) => game.partyJoin(db, id, b.id);
      else if (pathname === '/api/party/leave') pfn = (db) => game.partyLeave(db, id);
      else if (pathname === '/api/party/invite') pfn = (db) => game.partyInvite(db, id, b.nick);
      else if (pathname === '/api/party/accept') pfn = (db) => game.partyAccept(db, id, b.id);
      else if (pathname === '/api/party/reject') pfn = (db) => game.partyReject(db, id, b.id);
      if (!pfn) return bad({ ok: false, error: 'unknown action' }, 404);
      const { r, db } = await store.runGame(q, { lockId: id, lockPartyIds: [partyId] }, pfn);
      return { status: r.ok ? 200 : 400, body: Object.assign(r, { me: game.publicView(db, id) }) };
    }
    let fn = null;
    if (pathname === '/api/setclass') fn = (db) => game.setClass(db, id, b.class);
    else if (pathname === '/api/rename') fn = (db) => game.rename(db, id, b.nick);
    else if (pathname === '/api/enhance') fn = (db) => game.enhance(db, id);
    else if (pathname === '/api/attend') fn = (db) => game.attend(db, id);
    else if (pathname === '/api/mine') fn = (db) => game.mine(db, id);
    else if (pathname === '/api/mine/swing') fn = (db) => game.mineSwing(db, id);
    else if (pathname === '/api/hunt') fn = (db) => game.hunt(db, id);
    else if (pathname === '/api/protect') fn = (db) => game.buyProtect(db, id, b.qty);
    else if (pathname === '/api/shop/buy') {
      fn = (db) => b.item === 'protect' ? game.buyProtect(db, id, 1)
        : b.item === 'boost' ? game.buyBoost(db, id)
        : b.item === 'dye' ? game.buyDye(db, id)
        : b.item === 'classchange' ? game.buyClassChange(db, id)
        : { ok: false, error: '알 수 없는 상품' };
    }
    if (!fn) return bad({ ok: false, error: 'unknown action' }, 404);

    const { r, db } = await store.runGame(q, { lockId: id }, fn);
    return { status: r.ok ? 200 : 400, body: Object.assign(r, { me: game.publicView(db, id) }) };
  }

  return bad({ ok: false, error: 'not found' }, 404);
}

module.exports = { handle };
