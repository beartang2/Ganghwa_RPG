/*
 * 로컬 어댑터 테스트 — pglite(인메모리 Postgres)로 실제 스키마 위에서
 * 라우터를 구동해 서버리스 파이프라인(로드→game 실행→diff 저장)을 검증한다.
 *   실행:  node db/test-adapter.mjs
 * Supabase 없이도 SQL·어댑터·라우팅이 맞는지 확인용.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
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

// 요청 시뮬레이터
async function req(method, pathname, { token = '', body = {}, query = '' } = {}) {
  const usp = new URLSearchParams(query);
  return handle(method, pathname, { token, body, query: usp, q });
}

async function main() {
  await pg.exec(readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
  console.log('스키마 생성 완료\n');

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
  r = await req('POST', '/api/mine/swing', { token: tok });
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
  r = await req('POST', '/api/login', { body: { nick: '검사', pin: '55556666' } });
  ok(!r.body.ok, '닉네임 중복 신규가입 거부');
  ok((await q('SELECT count(*)::int AS c FROM players'))[0].c === 2, 'players 2명');

  // 9) 미이식 액션은 501 로 명확히
  r = await req('POST', '/api/fight', { token: tok, body: { target: '궁수' } });
  ok(r.status === 501, '싸움은 501(이식 예정)로 안내');

  console.log('\n결과: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
