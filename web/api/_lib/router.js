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

// 속도제한 파라미터 (상시서버 server.js 와 유사: 정상 플레이 450ms 쿨다운은 통과)
const RL = {
  action: { cap: 8, refill: 3 },     // 계정별 액션: 버스트 8 + 초당 3
  loginNick: { cap: 6, refill: 0.1 }, // 닉별 로그인: 버스트 6 + 10초당 1 → PIN 무차별 대입 차단
  loginIp: { cap: 20, refill: 0.5 },  // IP별 로그인: 사무실 NAT 고려해 넉넉하게(분당 30)
};
const tooFast = (msg) => bad({ ok: false, error: msg || '너무 빠릅니다. 잠시 후 다시 시도하세요.' }, 429);

// 아직 서버리스로 이식되지 않은 액션 (관리자 API는 4단계). 없으면 아래 체크는 통과.
const NOT_YET = new Set();

async function handle(method, pathname, ctx) {
  const { q } = ctx;

  // ---- 공개 GET ----
  if (method === 'GET') {
    // 배포 직후 DB 연결 확인용 — /api/health 방문 시 Postgres 연결 + 스키마 존재 체크
    if (pathname === '/api/health') {
      try {
        // DB 왕복 1회당 실측(SELECT 1 × 5) — 리전/풀러 진단용. 자격증명은 노출하지 않는다.
        const t0 = Date.now();
        for (let i = 0; i < 5; i++) await q('SELECT 1', []);
        const perTripMs = Math.round((Date.now() - t0) / 5 * 10) / 10;
        const c = await q('SELECT count(*)::int AS players FROM players', []);
        let dbRegion = null, dbPort = null, pooler = null;
        try {
          const u = new URL(String(process.env.DATABASE_URL).replace(/^postgres(ql)?:/, 'http:'));
          dbPort = u.port || '5432';
          pooler = u.port === '6543' || /pooler/.test(u.hostname);
          const m = /(us|eu|ap|sa|ca|af|me)-[a-z]+-\d/.exec(u.hostname); // 예: ap-northeast-2 (자격증명 아님)
          dbRegion = m ? m[0] : null;
        } catch (_) { /* noop */ }
        return ok({ ok: true, db: true, players: c[0].players, perTripMs, dbRegion, dbPort, pooler, ts: Date.now() });
      } catch (e) {
        return bad({ ok: false, db: false, error: String(e && e.message || e) }, 500);
      }
    }
    // 프론트가 Realtime 붙일 때 쓰는 공개 설정 (anon 키는 공개용이라 노출 OK)
    if (pathname === '/api/config') return ok({
      ok: true,
      supabaseUrl: process.env.SUPABASE_URL || null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
      realtime: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    });
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
    if (ctx.rateLimit !== false) {
      const nick = (b.nick || '').trim();
      const okNick = await store.rateAllow(q, 'lnick:' + nick, RL.loginNick.cap, RL.loginNick.refill);
      const okIp = await store.rateAllow(q, 'lip:' + (ctx.ip || '?'), RL.loginIp.cap, RL.loginIp.refill);
      if (!okNick || !okIp) return tooFast('로그인 시도가 너무 잦아요. 잠시 후 다시 시도하세요.');
    }
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
  if (method === 'GET' && pathname === '/api/party-raid') {
    if (!id) return bad({ ok: false, error: '로그인이 필요합니다.' }, 401);
    const db = await store.readDb(q);
    return ok(game.raidState(db, id));
  }

  if (method === 'POST') {
    if (pathname === '/api/logout') { await store.deleteSession(q, ctx.token); return ok({ ok: true }); }
    if (!id) return bad({ ok: false, error: '로그인이 필요합니다.' }, 401);
    if (ctx.rateLimit !== false && !await store.rateAllow(q, 'act:' + id, RL.action.cap, RL.action.refill)) return tooFast();
    if (NOT_YET.has(pathname)) return bad({ ok: false, error: '이 기능은 아직 서버리스 버전으로 이식 중이에요. (곧 지원)' }, 501);

    const b = ctx.body || {};

    // ---- 멀티플레이어: 관련 행을 함께 잠근다 ----
    if (pathname === '/api/fight') {
      const rows = await q('SELECT id FROM players WHERE nick = $1', [(b.target || '').trim()]);
      const targetId = rows.length ? rows[0].id : null;
      const { r, db } = await store.runGame(q, { lockId: id, lockPlayerIds: [targetId] }, (db) => game.fight(db, id, b.target));
      return { status: r.ok ? 200 : 400, body: Object.assign(r, { me: game.publicView(db, id) }) };
    }
    if (pathname.startsWith('/api/party-')) {
      const partyId = b.id || null; // join/accept/reject 대상 파티
      let pfn = null;
      if (pathname === '/api/party-create') pfn = (db) => game.partyCreate(db, id);
      else if (pathname === '/api/party-join') pfn = (db) => game.partyJoin(db, id, b.id);
      else if (pathname === '/api/party-leave') pfn = (db) => game.partyLeave(db, id);
      else if (pathname === '/api/party-invite') pfn = (db) => game.partyInvite(db, id, b.nick);
      else if (pathname === '/api/party-accept') pfn = (db) => game.partyAccept(db, id, b.id);
      else if (pathname === '/api/party-reject') pfn = (db) => game.partyReject(db, id, b.id);
      if (!pfn) return bad({ ok: false, error: 'unknown action' }, 404);
      const { r, db } = await store.runGame(q, { lockId: id, lockPartyIds: [partyId] }, pfn);
      return { status: r.ok ? 200 : 400, body: Object.assign(r, { me: game.publicView(db, id) }) };
    }
    // 레이드(시작·타격·스킬·종료): 종료 시 전원 골드/방지권 변경 → 파티원 전원 + 파티 행을 함께 잠근다.
    if (pathname === '/api/raid' || pathname === '/api/raid-hit' || pathname === '/api/raid-skill' || pathname === '/api/raid-finish') {
      const prow = await q("SELECT data->>'party' AS pid FROM players WHERE id = $1", [id]);
      const pid = prow.length ? prow[0].pid : null;
      let memberIds = [];
      if (pid) {
        const prt = await q('SELECT data FROM parties WHERE id = $1', [pid]);
        if (prt.length) { const d = typeof prt[0].data === 'string' ? JSON.parse(prt[0].data) : prt[0].data; memberIds = (d && d.members) || []; }
      }
      let rfn;
      if (pathname === '/api/raid') rfn = (db) => game.raidStart(db, id, b.boss);
      else if (pathname === '/api/raid-hit') rfn = (db) => game.raidHit(db, id, b.hits);
      else if (pathname === '/api/raid-skill') rfn = (db) => game.raidSkill(db, id);
      else rfn = (db) => game.raidFinish(db, id);
      const { r, db } = await store.runGame(q, { lockId: id, lockPlayerIds: memberIds, lockPartyIds: [pid], withLogs: false }, rfn);
      return { status: r.ok ? 200 : 400, body: Object.assign(r, { me: game.publicView(db, id) }) };
    }
    let fn = null;
    if (pathname === '/api/setclass') fn = (db) => game.setClass(db, id, b.class);
    else if (pathname === '/api/rename') fn = (db) => game.rename(db, id, b.nick);
    else if (pathname === '/api/enhance') fn = (db) => game.enhance(db, id);
    else if (pathname === '/api/attend') fn = (db) => game.attend(db, id);
    else if (pathname === '/api/mine') fn = (db) => game.mine(db, id);
    else if (pathname === '/api/mine-swing') fn = (db) => game.mineSwing(db, id);
    else if (pathname === '/api/hunt') fn = (db) => game.hunt(db, id);
    else if (pathname === '/api/title') fn = (db) => game.equipTitle(db, id, b.title || null);
    else if (pathname === '/api/protect') fn = (db) => game.buyProtect(db, id, b.qty);
    else if (pathname === '/api/shop-buy') {
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
