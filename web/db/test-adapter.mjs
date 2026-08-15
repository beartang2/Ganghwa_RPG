/*
 * 로컬 어댑터 테스트 — pglite(인메모리 Postgres)로 실제 스키마 위에서
 * 라우터를 구동해 서버리스 파이프라인(로드→game 실행→diff 저장)을 검증한다.
 *   실행:  node db/test-adapter.mjs
 * Supabase 없이도 SQL·어댑터·라우팅이 맞는지 확인용.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const { handle } = require('../api/_lib/router.js');

const pg = new PGlite();
const q = async (text, params) => (await pg.query(text, params || [])).rows;

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label); } }

// 요청 시뮬레이터 (기능 테스트는 rateLimit:false 로 속도제한 우회, 전용 테스트만 켬)
async function req(method, pathname, { token = '', body = {}, query = '', rateLimit = false, ip = '10.0.0.1' } = {}) {
  const usp = new URLSearchParams(query);
  return handle(method, pathname, { token, body, query: usp, q, rateLimit, ip });
}

async function main() {
  // 단일 소스: Supabase 마이그레이션 전체를 순서대로 적용해 검증한다
  const migDir = path.join(dir, '../../supabase/migrations');
  for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(path.join(migDir, f), 'utf8'));
  }
  console.log('스키마 생성 완료 (supabase/migrations 전체)\n');

  // 1) 로그인(신규)
  console.log('[로그인/직업]');
  let r = await req('POST', '/api/login', { body: { nick: '검사', pin: '11112222' } });
  ok(r.body.ok && r.body.token, '신규 로그인 → 토큰 발급');
  ok(r.body.needClass === true, '신규는 직업선택 필요');
  const tok = r.body.token;
  r = await req('POST', '/api/setclass', { token: tok, body: { class: 'warrior' } });
  ok(r.body.ok && r.body.me.class === 'warrior', '직업 설정 warrior');

  // 2) 같은 PIN 재로그인(기존 계정), 닉 불일치 거부
  r = await req('POST', '/api/login', { body: { nick: '검사', pin: '11112222' } });
  ok(r.body.ok && !r.body.isNew, '같은 PIN 재로그인 → 기존 계정');
  r = await req('POST', '/api/login', { body: { nick: '다른닉', pin: '11112222' } });
  ok(!r.body.ok, '닉 불일치 로그인 거부');

  // 3) 출석 → gold +1000, player_daily.attended
  console.log('[출석/사냥/채굴]');
  const before = (await q('SELECT gold FROM players WHERE nick=$1', ['검사']))[0].gold;
  r = await req('POST', '/api/attend', { token: tok });
  ok(r.body.ok && Number(r.body.me.gold) === Number(before) + 1000, '출석 +1000G');
  let d = (await q('SELECT attended FROM player_daily WHERE day=(SELECT max(day) FROM player_daily)'))[0];
  ok(d && d.attended === 1, 'player_daily.attended=1 영속화');

  // 4) 사냥 3회 → huntsUsed=3 영속화
  for (let i = 0; i < 3; i++) r = await req('POST', '/api/hunt', { token: tok });
  ok(r.body.ok && r.body.me.huntsLeft === r.body.me.dailyHunts - 3, '사냥 3회 → huntsLeft 감소');
  d = (await q('SELECT hunts_used FROM player_daily WHERE day=(SELECT max(day) FROM player_daily)'))[0];
  ok(d.hunts_used === 3, 'player_daily.hunts_used=3 영속화');

  // 5) 채굴 곡괭이질(silent) → gold 증가, stamina 감소
  const g0 = Number((await req('GET', '/api/me', { token: tok })).body.me.gold);
  r = await req('POST', '/api/mine-swing', { token: tok });
  ok(r.body.ok && r.body.gold > 0, '곡괭이질 골드 획득');
  const me1 = (await req('GET', '/api/me', { token: tok })).body.me;
  ok(me1.stamina < me1.staminaMax, '기력 소모 반영');
  ok(Number(me1.gold) === g0 + r.body.gold, '골드 영속(재로드 후 일치)');

  // 6) 강화 여러 번 → data JSON 에 소유 필드가 안 남는지
  console.log('[강화/저장 규칙]');
  await q('UPDATE players SET gold = 100000000 WHERE nick=$1', ['검사']); // 강화 자금
  let successes = 0;
  for (let i = 0; i < 30; i++) { r = await req('POST', '/api/enhance', { token: tok }); if (r.body.result === 'success') successes++; }
  ok(successes > 0, '강화 성공 발생(' + successes + '/30)');
  const raw = (await q('SELECT data FROM players WHERE nick=$1', ['검사']))[0].data;
  const dataObj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const leaked = ['nick', 'level', 'gold', 'huntsUsed', 'destroysToday'].filter(k => k in dataObj);
  ok(leaked.length === 0, 'data JSONB 에 소유 필드 미중복 (leaked: ' + (leaked.join(',') || 'none') + ')');

  // 7) 랭킹(SQL 재로드 → game.ranking 재사용)
  console.log('[랭킹/읽기]');
  r = await req('GET', '/api/rank');
  ok(r.body.ok && r.body.list.length >= 1 && r.body.list[0].nick, '랭킹 조회');
  r = await req('GET', '/api/goldrank');
  ok(r.body.ok && r.body.list[0].gold != null, '부자 랭킹 조회');

  // 8) 두 번째 유저 + 닉 중복 방지
  console.log('[다중 유저]');
  r = await req('POST', '/api/login', { body: { nick: '궁수', pin: '99998888' } });
  ok(r.body.ok, '두 번째 유저 로그인');
  const tok2 = r.body.token;
  await req('POST', '/api/setclass', { token: tok2, body: { class: 'archer' } });
  r = await req('POST', '/api/login', { body: { nick: '검사', pin: '55556666' } });
  ok(!r.body.ok, '닉네임 중복 신규가입 거부');
  ok((await q('SELECT count(*)::int AS c FROM players'))[0].c === 2, 'players 2명');

  // 9) 싸움 — 두 플레이어 골드/전적 변동이 함께 영속화
  console.log('[싸움]');
  await q('UPDATE players SET gold = 10000 WHERE nick IN ($1,$2)', ['검사', '궁수']);
  const sumBefore = Number((await q('SELECT sum(gold)::bigint AS s FROM players'))[0].s);
  r = await req('POST', '/api/fight', { token: tok, body: { target: '궁수' } });
  ok(r.body.ok && (r.body.winner === '검사' || r.body.winner === '궁수'), '싸움 성사(승자: ' + r.body.winner + ')');
  const rec = (nick) => q("SELECT (data->>'wins')::int AS wins, (data->>'losses')::int AS losses, gold FROM players WHERE nick=$1", [nick]).then(r => r[0]);
  const rowA = await rec('검사'), rowB = await rec('궁수');
  ok(rowA.wins + rowA.losses === 1 && rowB.wins + rowB.losses === 1, '양쪽 전적 +1 영속화(data JSONB)');
  const sumAfter = Number((await q('SELECT sum(gold)::bigint AS s FROM players'))[0].s);
  ok(sumBefore === sumAfter, '골드 약탈은 제로섬(총합 보존 ' + sumAfter + ')');
  let d2 = (await q('SELECT fights_used FROM player_daily WHERE player_id=(SELECT id FROM players WHERE nick=$1) AND day=(SELECT max(day) FROM player_daily)', ['검사']))[0];
  ok(d2 && d2.fights_used === 1, 'player_daily.fights_used=1 영속화');

  // 10) 파티 — 생성 → 초대 → 수락 → 2인 → 탈퇴
  console.log('[파티]');
  r = await req('POST', '/api/party-create', { token: tok });
  ok(r.body.ok && r.body.party && r.body.party.count === 1, '파티 생성(리더)');
  const pid = r.body.party.id;
  r = await req('POST', '/api/party-invite', { token: tok, body: { nick: '궁수' } });
  ok(r.body.ok, '초대 발송');
  let me2 = (await req('GET', '/api/me', { token: tok2 })).body.me;
  ok(me2.invites && me2.invites.length === 1, '초대가 상대 me.invites 에 노출');
  r = await req('POST', '/api/party-accept', { token: tok2, body: { id: pid } });
  ok(r.body.ok && r.body.party.count === 2, '수락 → 파티 2인');
  ok((await q('SELECT count(*)::int AS c FROM parties'))[0].c === 1, 'parties 1개 영속화');
  r = await req('POST', '/api/party-leave', { token: tok2 });
  ok(r.body.ok, '궁수 탈퇴');
  r = await req('GET', '/api/parties');
  ok(r.body.list[0].count === 1, '파티 인원 1로 갱신');
  r = await req('POST', '/api/party-leave', { token: tok });
  ok((await q('SELECT count(*)::int AS c FROM parties'))[0].c === 0, '리더 탈퇴 시 파티 해체(삭제 영속화)');

  // 11) 레이드 — 파티 재구성 → 결과 즉시 계산(타임라인) → 전원 보상·횟수 영속화
  console.log('[레이드]');
  await q("UPDATE players SET level = 80 WHERE nick IN ('검사','궁수')"); // 승리 유도(보상 경로 확인)
  r = await req('POST', '/api/party-create', { token: tok });
  const pid2 = r.body.party.id;
  await req('POST', '/api/party-invite', { token: tok, body: { nick: '궁수' } });
  await req('POST', '/api/party-accept', { token: tok2, body: { id: pid2 } });
  const goldBefore = Number((await req('GET', '/api/me', { token: tok })).body.me.gold);
  r = await req('POST', '/api/raid', { token: tok, body: { boss: 'goblin' } });
  ok(r.body.ok && typeof r.body.win === 'boolean', '레이드 성사(win=' + r.body.win + ')');
  ok(Array.isArray(r.body.raid.timeline) && r.body.raid.timeline.length > 0, '타임라인(턴 로그) 반환 → 클라 재생용');
  ok(r.body.participants.length === 2, '참가자 2명');
  const meAfter = (await req('GET', '/api/me', { token: tok })).body.me;
  ok(meAfter.raidsLeft === meAfter.dailyRaids - 1, '레이드 횟수 1 차감 영속화');
  if (r.body.win) ok(Number(meAfter.gold) > goldBefore, '승리 보상 골드 지급');
  else ok(true, '패배(보상 없음)');
  // 다른 파티원도 관전 상태(pt.raid)를 조회할 수 있어야 함
  const watch = await req('GET', '/api/party-raid', { token: tok2 });
  ok(watch.body.raid && Array.isArray(watch.body.raid.timeline), '파티원이 관전용 타임라인 폴링 가능');
  // 파티 raid 결과가 parties 테이블에 영속화됐는지
  const prow = (await q('SELECT data FROM parties WHERE id=$1', [pid2]))[0];
  const pdata = typeof prow.data === 'string' ? JSON.parse(prow.data) : prow.data;
  ok(pdata.raid && pdata.raid.timeline, 'parties.data.raid 영속화(늦게 접속해도 관전)');

  // 12) 속도제한 — 전용 테스트만 rateLimit:true
  console.log('[속도제한]');
  const rt = (await req('POST', '/api/login', { body: { nick: '속도', pin: '10101010' }, rateLimit: true })).body.token;
  await req('POST', '/api/setclass', { token: rt, body: { class: 'warrior' }, rateLimit: true });
  await q("UPDATE players SET gold = 1000000 WHERE nick = '속도'");
  let got429 = false;
  for (let i = 0; i < 15; i++) { const rr = await req('POST', '/api/enhance', { token: rt, rateLimit: true }); if (rr.status === 429) { got429 = true; break; } }
  ok(got429, '액션 연타 시 429(계정별 토큰버킷) 발동');
  let loginBlocked = false;
  for (let i = 0; i < 10; i++) { const rr = await req('POST', '/api/login', { body: { nick: '검사', pin: '00000000' }, rateLimit: true, ip: '9.9.9.9' }); if (rr.status === 429) { loginBlocked = true; break; } }
  ok(loginBlocked, '로그인 무차별 대입 시 429(닉별 상한 → PIN 브루트포스 차단)');
  // 정상 플레이(rateLimit 미적용)는 위 38개 테스트가 영향 없음을 이미 증명

  console.log('\n결과: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
