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
const GAME = require('../game.js');
GAME.CONFIG.huntMinGapMs = 0;   // 기능 테스트는 연달아 사냥한다 — 간격 하한은 전용 테스트에서 켠다

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
  const fls = (await req('GET', '/api/fight-list', { token: tok })).body;
  ok(fls.ok && fls.list.some(x => x.nick === '궁수' && typeof x.odds === 'number'), '싸움 목록 API — 상대별 내 승률(' + (fls.list.find(x => x.nick === '궁수') || {}).odds + '%)');
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

  // 11) 인터랙티브 레이드 — 시작(active) → 연타로 딜 → 처치/종료 → 전원 보상·횟수 영속화
  // 💥 치명타가 터지면 보스가 일찍 쓰러져 뒤 단계(예산·스킬) 검증이 흔들린다 — 이 구간은 난수를 0.25 이상으로만 굴려 치명타(최대 22%)를 끈다
  const realRandomRaid = Math.random; Math.random = () => 0.25 + 0.75 * realRandomRaid();
  console.log('[레이드]');
  await q("UPDATE players SET level = 90 WHERE nick IN ('검사','궁수')"); // 마계 군주 입장 조건(+85) 이상
  r = await req('POST', '/api/party-create', { token: tok });
  const pid2 = r.body.party.id;
  await req('POST', '/api/party-invite', { token: tok, body: { nick: '궁수' } });
  await req('POST', '/api/party-accept', { token: tok2, body: { id: pid2 } });
  const goldBefore = Number((await req('GET', '/api/me', { token: tok })).body.me.gold);
  r = await req('POST', '/api/raid', { token: tok, body: { boss: 'golem' } }); // 연타 한 번엔 안 죽고 스킬까지 맞으면 쓰러지는 보스(2인 스케일 HP)
  ok(r.body.ok && r.body.raid.status === 'active', '레이드 시작(active)');
  ok(r.body.raid.bossHP === r.body.raid.bossMax && r.body.raid.partyHP === 100, '보스 풀피·파티 HP 100 시작');
  ok(r.body.raid.participants.length === 2, '참가자 2명');
  ok(r.body.raid.duration === GAME.CONFIG.raidDuration && r.body.raid.atkBuff === 0 && r.body.raid.soloMult === 1, '2인 파티는 기본 전투 시간 · 힐러 없으면 공격력 업 없음 · 솔로 보정 없음');
  // 폴링(GET 투영) 조회 가능
  const watch = await req('GET', '/api/party-raid', { token: tok2 });
  ok(watch.body.raid && typeof watch.body.raid.bossHP === 'number', '파티원 폴링(투영) 조회');
  // 연타 제출 → 딜 적용(보스 살아있음)
  let hr = await req('POST', '/api/raid-hit', { token: tok, body: { hits: 40 } });
  ok(hr.body.ok && hr.body.dmg > 0, '타격 딜 적용(dmg=' + hr.body.dmg + ')');
  // ⚡ 레이드 강공격 — 서버가 위력(연타 n회분)·쿨타임을 판정. 연타와 같은 예산이라 시작 직후엔 여유가 없으니 3초 전 시작으로 당긴다
  await q("UPDATE parties SET data = jsonb_set(data, '{raid,startTs}', to_jsonb(((data->'raid'->>'startTs')::bigint) - 3000)) WHERE id=$1", [pid2]);
  let st = await req('POST', '/api/raid-strong', { token: tok, body: { power: 1 } });
  ok(st.body.ok && st.body.units === 6 && st.body.dmg > 0 && /베어 가르기/.test(st.body.strongText), '검 강공격 = 연타 6회분(dmg=' + st.body.dmg + ')');
  st = await req('POST', '/api/raid-strong', { token: tok, body: { power: 1 } });
  ok(!st.body.ok && /준비/.test(st.body.error), '바로 또 쓰면 쿨타임으로 거부(0.35초)');
  st = await req('POST', '/api/raid-strong', { token: tok2, body: { power: 0.2 } });
  ok(st.body.ok && st.body.units === 3, '활은 당긴 만큼 — power 0.2 는 최소 40% 로(8×0.4≈3회분)');
  ok(st.body.raid.events.some(e => /관통 사격/.test(e.text)), '파티 전투 기록에 강공격 표시');
  await new Promise(res => setTimeout(res, 400));                                   // 강공격 쿨타임은 지나게
  await req('POST', '/api/raid-hit', { token: tok, body: { hits: 40 } });            // 경과시간 예산을 연타로 꽉 채움
  st = await req('POST', '/api/raid-strong', { token: tok, body: { power: 1 } });
  ok(!st.body.ok && /숨 고르는/.test(st.body.error), '연타로 예산을 다 쓰면 강공격도 거절(매크로가 둘 다 얹지 못함)');
  // 스킬(궁수 난사) → 큰 피해로 처치
  const sk = await req('POST', '/api/raid-skill', { token: tok2 });
  ok(sk.body.ok && sk.body.skillText, '스킬 발동(' + (sk.body.skillText || '') + ')');
  if (sk.body.raid.status !== 'done') await req('POST', '/api/raid-hit', { token: tok2, body: { hits: 40 } });
  const fin = await req('POST', '/api/raid-finish', { token: tok });
  ok(fin.body.raid.status === 'done' && typeof fin.body.raid.win === 'boolean', '전투 종료·승패 결정(win=' + fin.body.raid.win + ')');
  const meAfter = (await req('GET', '/api/me', { token: tok })).body.me;
  // 설계: 성공했을 때만 횟수 차감(실패는 보상도 차감도 없음)
  ok(meAfter.raidsLeft === meAfter.dailyRaids - (fin.body.raid.win ? 1 : 0), '레이드 횟수 영속화(성공 시에만 차감)');
  if (fin.body.raid.win) ok(Number(meAfter.gold) > goldBefore, '승리 보상 골드 지급');
  else ok(true, '패배(보상 없음)');
  // parties.data.raid 영속화(늦게 접속해도 결과 관전)
  const prow = (await q('SELECT data FROM parties WHERE id=$1', [pid2]))[0];
  const pdata = typeof prow.data === 'string' ? JSON.parse(prow.data) : prow.data;
  ok(pdata.raid && pdata.raid.status === 'done', 'parties.data.raid 종료상태 영속화');
  // 끝난 지 1분 지난 결과는 다시 안 보여준다(레이드 탭 들어갈 때마다 지난 보스 화면이 뜨던 버그)
  ok((await req('GET', '/api/party-raid', { token: tok2 })).body.raid, '막 끝난 결과는 관전 가능');
  pdata.raid.endTs = Date.now() - 61000;
  await q('UPDATE parties SET data=$2 WHERE id=$1', [pid2, JSON.stringify(pdata)]);
  ok((await req('GET', '/api/party-raid', { token: tok2 })).body.raid === null, '1분 지난 결과는 숨김(로비로)');
  Math.random = realRandomRaid;

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

  // 미션 & 배틀패스 (저장 왕복·라우팅·클레임 게이팅)
  console.log('\n[미션/배틀패스]');
  await q("UPDATE players SET gold = 1000000, level = 0 WHERE nick = '검사'");
  for (let i = 0; i < 6; i++) await req('POST', '/api/enhance', { token: tok });
  const enhProg = Number((await q("SELECT data->'mstat'->'d'->>'enh' AS enh FROM players WHERE nick='검사'"))[0].enh);
  ok(enhProg >= 6, 'mstat.enh 저장 왕복(강화 진행 ' + enhProg + ')');

  let mv = (await req('GET', '/api/missions', { token: tok })).body;
  ok(mv.ok && mv.daily.length === 4 && mv.weekly.length === 4, '미션 조회(일일 4·주간 4)');
  ok(mv.bp && typeof mv.bp.level === 'number', '미션 응답에 배틀패스 요약 포함');
  ok(!(await req('POST', '/api/mission-claim', { token: tok, body: { id: 'nope' } })).body.ok, '없는 미션 클레임 거부');

  let bpv = (await req('GET', '/api/battlepass', { token: tok })).body;
  ok(bpv.ok && bpv.track.length === 30, '배틀패스 트랙 30레벨');
  await q("UPDATE players SET data = jsonb_set(data, '{bp}', $1::jsonb) WHERE nick='검사'",
    [JSON.stringify({ season: bpv.season, xp: 550, free: [], paid: [], premium: false })]);
  bpv = (await req('GET', '/api/battlepass', { token: tok })).body;
  ok(bpv.level === 5, 'xp 550 → 배틀패스 Lv5');
  const prBefore = Number((await q("SELECT COALESCE((data->'inv'->'items'->>'protect')::int,0) AS p FROM players WHERE nick='검사'"))[0].p);
  ok((await req('POST', '/api/bp-claim', { token: tok, body: { level: 5, track: 'free' } })).body.ok, 'BP Lv5 무료 보상 수령');
  const prAfter = Number((await q("SELECT COALESCE((data->'inv'->'items'->>'protect')::int,0) AS p FROM players WHERE nick='검사'"))[0].p);
  ok(prAfter > prBefore, '무료 보상(방지권 → 가방) 지급·저장 (' + prBefore + '→' + prAfter + ')');
  ok(!(await req('POST', '/api/bp-claim', { token: tok, body: { level: 5, track: 'free' } })).body.ok, '중복 수령 거부');
  ok(!(await req('POST', '/api/bp-claim', { token: tok, body: { level: 5, track: 'paid' } })).body.ok, '프리미엄 없이 유료 트랙 거부');
  ok(!(await req('POST', '/api/bp-premium', { token: tok })).body.ok, '시즌 패스 구매 준비중');
  const t10 = bpv.track.find(t => t.level === 10).free;
  ok(t10.essence > 0 && t10.hammer > 0 && t10.prism > 0 && t10.gold > 0, '패스 Lv10 무료 보상에 🌟·🔨·💎·골드');

  // 미션 보상 꾸러미 — 새 재화 지급·골드는 최고 기록 기준 '강화 n회분'·가방이 모자라면 수령 막기
  {
    const mdb = { players: {}, parties: {}, log: [] };
    const mp = GAME.makePlayer('미션러'); GAME.norm(mp); Object.assign(mp, { level: 0, best: 99 }); mdb.players.m = mp;
    const v0 = GAME.missionView(mdb, 'm');
    for (const k of Object.keys(mp.mstat.d)) { mp.mstat.d[k] = 999; mp.mstat.w[k] = 999; }
    const m0 = v0.daily[0];
    ok(m0.reward.gold > 5000, '초월 직후(+0)여도 최고 기록(+99) 기준 골드(+0 기준이면 ~2천) (' + m0.reward.gold.toLocaleString() + ')');
    const before = Object.assign({}, mp.inv.items), prBefore = mp.prism || 0;
    const r0 = GAME.missionClaim(mdb, 'm', m0.id);
    const itemsOk = Object.keys(m0.reward).filter(k => k !== 'gold').every(k => k === 'prism'
      ? (mp.prism || 0) - prBefore === m0.reward.prism : (mp.inv.items[k] || 0) - (before[k] || 0) === m0.reward[k]);
    ok(r0.ok && itemsOk, '일일 미션 보상 꾸러미 지급 (' + r0.msg + ')');
    for (const k of ['protect', 'boost', 'dye', 'eltkt', 'shard', 'essence', 'boxkey', 'stone', 'hammer', 'prismdye']) mp.inv.items[k] = 999;
    const m1 = v0.daily[1];
    const r1 = GAME.missionClaim(mdb, 'm', m1.id);
    ok(!r1.ok && /가방/.test(r1.error) && !GAME.missionView(mdb, 'm').daily[1].claimed, '가방이 모자라면 수령을 막고 미수령으로 남긴다');
  }

  // 장비 칸(무기 여러 자루) + 💎 프리즘 — 저장 왕복(보관 무기의 레벨이 저장 때 사라지지 않는지)
  console.log('\n[장비 칸/프리즘]');
  await q("UPDATE players SET level = 70, gold = 3000000, data = jsonb_set(jsonb_set(data, '{prism}', '600'), '{inv,items}', $1::jsonb) WHERE nick='검사'",
    [JSON.stringify({ boxkey: 2, stone: 30 })]);
  let me = (await req('GET', '/api/me', { token: tok })).body.me;
  ok(me.weapons && me.weapons.slots === 1 && me.weapons.canNew === false, '기본 장비 칸 1 · 새 무기 불가');
  ok(!(await req('POST', '/api/weapon-new', { token: tok, body: { class: 'archer' } })).body.ok, '칸 없으면 새 무기 거부');
  ok(me.weapons.nextSlot && me.weapons.nextSlot.ok === false && me.weapons.nextSlot.need === 1 && me.weapons.nextSlot.have === 0, '+70 무기뿐 → 다음 칸 잠김(+99 1자루 필요)');
  r = await req('POST', '/api/prism-buy', { token: tok, body: { item: 'slot' } });
  ok(!r.body.ok && /\+99/.test(r.body.error), '+99 무기 없으면 장비 칸 구매 거부');
  await q("UPDATE players SET level = 99 WHERE nick='검사'");
  r = await req('POST', '/api/prism-buy', { token: tok, body: { item: 'slot' } });
  ok(r.body.ok && r.body.me.weapons.slots === 2 && r.body.me.prism === 530, '+99 달성 → 💎70 으로 장비 칸 +1 (2칸)');
  r = await req('POST', '/api/weapon-new', { token: tok, body: { class: 'archer' } });
  ok(r.body.ok && r.body.me.class === 'archer' && r.body.me.level === 0, '새 활 제작 → 원딜 +0 장착');
  const arm = (await q("SELECT data->'armory' AS a FROM players WHERE nick='검사'"))[0].a;
  ok(Array.isArray(arm) && arm[0].cls === 'warrior' && arm[0].lv === 99, '보관 검 +99 저장 왕복(lv 키 보존)');
  ok(!(await req('POST', '/api/weapon-new', { token: tok, body: { class: 'archer' } })).body.ok, '같은 직업 무기 중복 거부');
  r = await req('POST', '/api/weapon-equip', { token: tok, body: { class: 'warrior' } });
  ok(r.body.ok && r.body.me.class === 'warrior' && r.body.me.level === 99, '검으로 바꿔 들기 → +99 복원');
  const rk = (await req('GET', '/api/rank')).body.list.find(x => x.nick === '검사');
  ok(rk && rk.level === 99 && rk.weaponCount === 2, '랭킹은 가장 좋은 무기 기준');
  r = await req('POST', '/api/box-open', { token: tok, body: { pick: 2 } });
  ok(r.body.ok && r.body.boxes.length === 3 && r.body.keysLeft === 1, '상자 열기(3개 중 택1, 열쇠 1 소모)');
  // 상자에서 마석 ×3 이 나올 수 있으므로(확률표) 연금 직전 개수 기준으로 본다
  const stoneOf = m => m.inv.items.filter(i => i.id === 'stone').reduce((a, i) => a + i.count, 0);
  const stonePre = stoneOf(r.body.me);
  r = await req('POST', '/api/alchemy', { token: tok, body: { tier: 'mid' } });
  ok(r.body.ok && stoneOf(r.body.me) === stonePre - 15, '연금 중불(마석 15 + 10만G)');
  const goldPreCap = Number(r.body.me.gold);
  r = await req('POST', '/api/capsule', { token: tok, body: { times: 10 } });
  ok(r.body.ok && r.body.results.length === 10 && Number(r.body.me.gold) === goldPreCap - 300000 + r.body.gold, '캡슐 10회(30만G) 결과·골드 정산');
  const pv = (await req('GET', '/api/prism', { token: tok })).body;
  const slotItem = pv.shop.find(x => x.id === 'slot');
  ok(pv.ok && pv.info.capsule.price === 30000 && slotItem.price === 140 && slotItem.locked === true, '프리즘 탭 정보(확률표·다음 칸 💎140 · +99 2자루 전까지 잠김)');
  ok(!(await req('POST', '/api/prism-buy', { token: tok, body: { item: 'slot' } })).body.ok, '+99 무기 1자루로는 3번째 칸 거부');
  // ★ 초월한 무기도 +99 를 찍은 무기로 친다(초월하면 +0 으로 돌아가므로 ★ 로 센다) — 보관 중인 활에 ★1
  await q("UPDATE players SET data = jsonb_set(data, '{armory,0,asc}', '1') WHERE nick='검사'");
  r = await req('POST', '/api/prism-buy', { token: tok, body: { item: 'slot' } });
  ok(r.body.ok && r.body.me.weapons.slots === 3 && r.body.me.prism === pv.prism - 140, '★1 무기 + +99 무기 → 3번째 칸 구매(💎140)');   // 상자·연금·캡슐에서 💎 가 나왔을 수 있어 상대값으로 본다
  ok(!(await req('POST', '/api/shop-buy', { token: tok, body: { item: 'classchange' } })).body.ok, '직업 변경권 판매 종료');


  // 🌌 초월 던전 · 속성 상성 · 🔁 속성 재련권
  console.log('\n[초월 던전/재련]');
  const G = require('../game.js');
  ok(G.elemMult('water', 'fire') === 2 && G.elemMult('fire', 'water') === 0.5 && G.elemMult('light', 'dark') === 2 && G.elemMult('dark', 'light') === 2 && G.elemMult('fire', 'wind') === 1, '상성: 물→불 ×2 · 불→물 ×0.5 · 빛⇄어둠 ×2 · 무관 ×1');
  r = await req('POST', '/api/login', { body: { nick: '던전러', pin: '24682468' } });
  const tok3 = r.body.token;
  await req('POST', '/api/setclass', { token: tok3, body: { class: 'warrior' } });
  let dv = (await req('GET', '/api/dungeon', { token: tok3 })).body;
  ok(dv.ok && dv.unlocked === false && dv.next && dv.next.floor === 1, '★ 없으면 던전 잠김(다음 층 정보는 보임)');
  ok(!(await req('POST', '/api/dun-start', { token: tok3 })).body.ok, '★ 없으면 도전 거부');
  // ★1 +99 검, 속성은 이번 주 1층 보스의 약점으로 맞춘다(결과가 운에 안 흔들리게)
  const f1 = G.dunFloor(1, G.weekKey()), counter = dv.next.phases[0].weakTo[0];
  ok(f1.phases[0].el === dv.next.phases[0].el, '층 속성은 주차 시드로 고정(서버·화면 일치)');
  await q("UPDATE players SET level = 99, gold = 500000, data = data || $1::jsonb WHERE nick='던전러'", [JSON.stringify({ ascend: 1, ascendMax: 1, element: counter, prism: 0 })]);
  r = await req('POST', '/api/dun-start', { token: tok3 });
  ok(r.body.ok && r.body.fight.status === 'active' && r.body.fight.floor === 1 && r.body.fight.phases.length === 1, '1층 전투 시작(단계 1개)');
  ok(!(await req('POST', '/api/enhance', { token: tok3 })).body.ok, '전투 중 강화 거부');
  r = await req('POST', '/api/dun-skill', { token: tok3, body: { kind: 'class' } });
  ok(r.body.ok && /강타/.test(r.body.skillText), '직업 스킬(강타) — 약점 속성이라 효과 굉장');
  ok(r.body.fight.status === 'active' && r.body.fight.bossHP === Math.round(r.body.fight.bossMax * 0.6) && /보호막/.test(r.body.skillText), '🛡️ 보스 보호막 — 스킬 한 번에 최대 체력의 40%까지만');
  r = await req('POST', '/api/dun-hit', { token: tok3, body: { hits: 12 } });   // 약점 연타 12번으로 마무리
  const fv = r.body.fight;
  ok(fv.status === 'done' && fv.win === true && fv.reward && fv.reward.prism === 3 && fv.reward.shard === 3 && fv.reward.first === true, '1층 돌파 → 첫 돌파 💎3 · 파편 3');
  let dme = (await req('GET', '/api/me', { token: tok3 })).body.me;
  ok(dme.prism === 3 && dme.dunBest === 1, '💎·최고층 저장');
  ok((await req('GET', '/api/dungeon', { token: tok3 })).body.fight.status === 'done', '막 끝난 던전 결과는 다시 볼 수 있음');
  await q("UPDATE players SET data = jsonb_set(data, '{dun,fight,endTs}', to_jsonb($1::bigint)) WHERE nick='던전러'", [Date.now() - 61000]);
  ok((await req('GET', '/api/dungeon', { token: tok3 })).body.fight === null, '1분 지난 던전 결과는 숨김(로비로)');
  r = await req('POST', '/api/dun-leave', { token: tok3 });
  dv = (await req('GET', '/api/dungeon', { token: tok3 })).body;
  ok(dv.fight === null && dv.floor === 1 && dv.next.floor === 2 && dv.rank.some(x => x.nick === '던전러' && x.floor === 1), '결과 닫기 → 다음 층 2 · 주간 랭킹 반영');
  // 속성 스킬(★1) — 2층에서 사용
  r = await req('POST', '/api/dun-start', { token: tok3 });
  r = await req('POST', '/api/dun-skill', { token: tok3, body: { kind: 'elem' } });
  ok(r.body.ok && r.body.skillText, '★1 무기 속성 스킬 사용');
  // 같은 무기 스킬은 전투당 1회 — 보스가 한 방에 안 죽는 15층에서 확인
  await q("UPDATE players SET data = jsonb_set(data, '{dun}', (data->'dun') || '{\"fl\":14,\"fight\":null}'::jsonb) WHERE nick='던전러'");
  r = await req('POST', '/api/dun-start', { token: tok3 });
  ok(r.body.ok && r.body.fight.floor === 15, '15층 전투 시작');
  // ⚡ 던전 강공격 — 지금 단계 상성 배율이 곱해진다(연타와 같은 예산이라 3초 전 시작으로 당긴다)
  await q("UPDATE players SET data = jsonb_set(data, '{dun,fight,startTs}', to_jsonb(((data->'dun'->'fight'->>'startTs')::bigint) - 3000)) WHERE nick='던전러'");
  r = await req('POST', '/api/dun-strong', { token: tok3, body: { power: 1 } });
  ok(r.body.ok && r.body.dmg > 0 && typeof r.body.mult === 'number', '던전 강공격(dmg=' + r.body.dmg + ' · 상성 ×' + r.body.mult + ')');
  ok(!(await req('POST', '/api/dun-strong', { token: tok3 })).body.ok, '던전 강공격 쿨타임');
  await req('POST', '/api/dun-skill', { token: tok3, body: { kind: 'class' } });
  r = await req('POST', '/api/dun-skill', { token: tok3, body: { kind: 'class' } });
  ok(!r.body.ok && /이미/.test(r.body.error), '같은 무기 직업 스킬 두 번 거부');
  ok(!(await req('POST', '/api/weapon-equip', { token: tok3, body: { class: 'archer' } })).body.ok, '전투 중 장비 칸 교체 대신 전투 교체 버튼 사용');
  // 깊은 층 조건: 16층부터 무기 2자루
  await q("UPDATE players SET data = jsonb_set(data, '{dun}', (data->'dun') || '{\"fl\":15,\"fight\":null}'::jsonb) WHERE nick='던전러'");
  r = await req('POST', '/api/dun-start', { token: tok3 });
  ok(!r.body.ok && /2자루/.test(r.body.error), '16층(중층)은 무기 2자루 이상 필요');
  // 주간 초기화: 지난주 12층 → 이번 주 7층까지 자동 소탕(보상 지급)
  const shardOf = m => m.inv.items.filter(i => i.id === 'shard').reduce((a, i) => a + i.count, 0);
  const sh0 = shardOf((await req('GET', '/api/me', { token: tok3 })).body.me);
  await q("UPDATE players SET data = jsonb_set(data, '{dun}', (data->'dun') || '{\"wk\":\"2000-01-03\",\"fl\":12,\"fight\":null}'::jsonb) WHERE nick='던전러'");
  dv = (await req('GET', '/api/dungeon', { token: tok3 })).body;
  ok(dv.floor === 7 && dv.sweep && dv.sweep.pending, '새 주 → 화면에 소탕 예정 7층 표시(읽기 전용)');
  r = await req('POST', '/api/dun-start', { token: tok3 });
  ok(r.body.ok && r.body.fight.floor === 8, '첫 도전 때 소탕 확정 → 8층부터');
  const sweepShard = [1, 2, 3, 4, 5, 6, 7].reduce((a, f) => a + Math.ceil(f / 3) + 2, 0);
  ok(shardOf(r.body.me) === sh0 + sweepShard, '소탕 보상(1~7층 파편 ' + sweepShard + ')');
  // 🔁 속성 재련권
  await q("UPDATE players SET data = jsonb_set(data, '{dun,fight}', 'null'::jsonb) WHERE nick='던전러'");
  r = await req('POST', '/api/shop-buy', { token: tok3, body: { item: 'eltkt' } });
  ok(r.body.ok && r.body.me.inv.items.some(i => i.id === 'eltkt'), '상점에서 🔁 속성 재련권 구매(10만G)');
  const el0 = r.body.me.element;
  r = await req('POST', '/api/use-item', { token: tok3, body: { item: 'eltkt' } });
  ok(r.body.ok && r.body.me.level === 90 && r.body.me.element !== el0, '재련: +99 → +90(10%) · 속성 바뀜');
  await q("UPDATE players SET level = 20, data = jsonb_set(data, '{inv,items,eltkt}', '1') WHERE nick='던전러'");
  ok(!(await req('POST', '/api/use-item', { token: tok3, body: { item: 'eltkt' } })).body.ok, '에픽(+25) 미만 무기는 재련 거부');
  // 직업 변경권 → 속성 재련권 1:1 이관
  await q("UPDATE players SET data = jsonb_set(data, '{inv,items,classtkt}', '2') WHERE nick='던전러'");
  dme = (await req('GET', '/api/me', { token: tok3 })).body.me;
  ok(dme.inv.items.find(i => i.id === 'eltkt').count === 3 && !dme.inv.items.some(i => i.id === 'classtkt'), '남은 직업 변경권 2장 → 재련권으로 이관(1+2=3)');

  // 🏷️ 칭호용 누적 기록 — 일반·강공격(사냥 보고는 상한), 레이드·던전 연타, 던전·프리즘 도박
  console.log('\n[칭호 기록]');
  const dataOf = async nick => { const d = (await q('SELECT data FROM players WHERE nick=$1', [nick]))[0].data; return typeof d === 'string' ? JSON.parse(d) : d; };
  const titlesOf = async t => (await req('GET', '/api/me', { token: t })).body.me.titles.map(x => x.id);
  let gd = await dataOf('검사');
  ok(gd.atk && gd.atk.n > 0, '레이드 연타(서버가 시간으로 깎은 실제 타수)가 일반 공격으로 쌓임(' + (gd.atk && gd.atk.n) + ')');
  ok(gd.gs && gd.gs.box === 1 && gd.gs.alch === 1 && gd.gs.cap === 10, '상자 1 · 연금 1 · 캡슐 10회 기록');
  const nPre = gd.atk.n, sPre = gd.atk.s || 0, wPre = (gd.atk.w && gd.atk.w.warrior) || 0;
  ok(sPre >= 1 && wPre >= 1, '레이드 강공격도 강공격 기록에 쌓임(서버 판정)');
  await q("UPDATE players SET data = jsonb_set(data, '{atk,ts}', '0') WHERE nick='검사'");   // 마지막 보고가 오래전인 상태
  r = await req('POST', '/api/hunt', { token: tok, body: { atk: { n: 6, s: 1 } } });
  gd = await dataOf('검사');
  ok(r.body.ok && gd.atk.n === nPre + 6 && gd.atk.s === sPre + 1 && gd.atk.w.warrior === wPre + 1, '사냥에 얹은 보고: 일반 6 · 강공격 1(검)');
  r = await req('POST', '/api/atk-report', { token: tok, body: { atk: { n: 500, s: 50 } } });
  gd = await dataOf('검사');
  ok(r.body.ok && gd.atk.n - (nPre + 6) <= 1 && gd.atk.s - (sPre + 1) <= 1, '바로 이어 부풀린 보고(500·50)는 흐른 시간만큼만 인정');
  await q("UPDATE players SET data = jsonb_set(data, '{atk,ts}', '0') WHERE nick='검사'");
  r = await req('POST', '/api/atk-report', { token: tok, body: { atk: { n: 500, s: 50 } } });
  gd = await dataOf('검사');
  ok(gd.atk.n - (nPre + 6) <= 21 && gd.atk.s - sPre <= 6, '한 번에 최대 일반 20 · 강공격 4까지만');
  // 던전 기록 — 앞 테스트에서 던전러가 1·2·15층… 돌파·교체·스킬을 했다
  const dd = await dataOf('던전러');
  ok(dd.ds && dd.ds.clear >= 1 && dd.ds.elem >= 1 && dd.atk.n > 0, '던전 돌파 ' + (dd.ds && dd.ds.clear) + ' · 속성 스킬 ' + (dd.ds && dd.ds.elem) + ' · 연타 기록');
  // 칭호 조건
  await q("UPDATE players SET data = data || '{\"atk\":{\"n\":1000,\"s\":30,\"w\":{\"healer\":500}},\"ds\":{\"flaw\":1},\"gs\":{\"boxJ\":1,\"capJ\":1}}'::jsonb WHERE nick='검사'");
  const tl = await titlesOf(tok);
  ok(['tap1k', 'str30', 'str_healer', 'dflawless', 'boxjack', 'capjack'].every(id => tl.includes(id)), '칭호: 연타 입문 · 한 방의 맛 · 별을 그리는 자 · 무결의 정복자 · 황금 열쇠 · 천운');
  ok(!tl.includes('tap10k') && !tl.includes('alch100'), '조건 미달 칭호는 없음');

  // 🥚 이스터에그 — 1회 bool, 🌈 프리즘 등급 숨은 칭호
  console.log('\n[이스터에그]');
  r = await req('POST', '/api/login', { body: { nick: '이스터', pin: '31313131' } });
  const tokX = r.body.token;
  await req('POST', '/api/setclass', { token: tokX, body: { class: 'healer' } });
  let mx = (await req('GET', '/api/me', { token: tokX })).body.me;
  const hid = mx.titleRoster.filter(t => t.hidden);
  ok(hid.length === 14 && hid.every(t => !t.title && !t.color && t.grade === 'prism'), '숨은 칭호 14개 — 이름·색 비공개(❓)');
  ok(!(await req('POST', '/api/egg', { token: tokX, body: { id: 'heart' } })).body.ok, '사냥 안 하고 사냥터 이스터에그 → 거부');
  await req('POST', '/api/hunt', { token: tokX });
  r = await req('POST', '/api/egg', { token: tokX, body: { id: 'heart' } });
  ok(r.body.ok && r.body.found === 'heart' && r.body.me.titles.some(t => t.id === 'egg_heart' && t.grade === 'prism'), '사냥 직후 ❤️ 하트 → 「사랑의 사냥꾼」(프리즘 등급)');
  r = await req('POST', '/api/egg', { token: tokX, body: { id: 'heart' } });
  ok(r.body.ok && r.body.found === null, '두 번째는 이미 찾음(1회)');
  ok(!(await req('POST', '/api/egg', { token: tokX, body: { id: 'gold9999' } })).body.ok, '없는 이스터에그 거부');
  ok((await req('POST', '/api/egg', { token: tokX, body: { id: 'forge' } })).body.found === 'forge', '대장간 두드리기는 어디서나');
  // 서버 판정 — 확률을 고정해서 확인
  const realRandom = Math.random;
  try {
    await q("UPDATE players SET level = 76, gold = 100000000, data = jsonb_set(jsonb_set(data, '{pity}', '1'), '{inv,items}', '{}'::jsonb) WHERE nick='이스터'");
    r = await req('POST', '/api/enhance', { token: tokX });
    ok(r.body.result === 'success' && r.body.me.level === 77 && r.body.egg === 'l77' && r.body.me.titles.some(t => t.id === 'egg_77'), '딱 +77 도착 → 「럭키 세븐」');
    await q("UPDATE players SET level = 44, data = jsonb_set(data, '{pity}', '0.995') WHERE nick='이스터'");
    { const o44 = GAME.odds(44, 0), s44 = o44.success + 0.995 * GAME.CONFIG.pityLuckMax;   // 🔥 기운 보정까지 넣은 성공 구간 바로 다음 = 파괴 구간
      Math.random = () => s44 + o44.destroy / 2; }
    r = await req('POST', '/api/enhance', { token: tokX });
    Math.random = realRandom;
    const t44 = r.body.me.titles.map(t => t.id);
    ok(r.body.result === 'destroy' && /사\(死\)/.test(r.body.msg) && t44.includes('egg_44') && t44.includes('egg_pity99'), '+44 · 기운 99.5% 에서 파괴 → 「불길한 숫자」「한 끗 차이」');
    // 두 번째 +44 파괴는 평범한 파괴(특별 문구 없음 — 1회 트리거)
    await q("UPDATE players SET level = 44 WHERE nick='이스터'");
    Math.random = () => 0.149;
    r = await req('POST', '/api/enhance', { token: tokX });
    Math.random = realRandom;
    ok(r.body.result === 'destroy' && !/사\(死\)/.test(r.body.msg) && !r.body.egg, '두 번째 +44 파괴는 특별 문구 없음(1회)');
    Math.random = () => 0.9999;  // 캡슐 표의 마지막 칸 = 빈 캡슐
    r = await req('POST', '/api/capsule', { token: tokX, body: { times: 3 } });
    Math.random = realRandom;
    ok(r.body.me.titles.some(t => t.id === 'egg_air'), '빈 캡슐 3연속 → 「공기 수집가」');
  } finally { Math.random = realRandom; }
  mx = (await req('GET', '/api/me', { token: tokX })).body.me;
  const halToday = mx.titles.some(t => t.id === 'egg_halloween') ? 1 : 0;   // 10/31(KST)에 돌리면 사냥에서 🎃 할로윈 칭호도 열린다
  ok(mx.titleRoster.filter(t => t.hidden).length === 8 - halToday && mx.titleRoster.find(t => t.id === 'egg_heart').desc.includes('하트'), '찾은 건 이름·설명 공개, 나머지 ' + (8 - halToday) + '개는 여전히 ❓');
  // 🔨 개발자 이스터에그 — 콘솔·sudo 는 /api/egg, 헤더 탐정·찻주전자는 서버 주소로만
  ok((await req('POST', '/api/egg', { token: tokX, body: { id: 'console' } })).body.found === 'console', '콘솔 강화(forge.enhance) → 「콘솔 강화」');
  ok((await req('POST', '/api/egg', { token: tokX, body: { id: 'sudo' } })).body.found === 'sudo', '키보드 sudo → 「sudo 초월」');
  ok(!(await req('POST', '/api/egg', { token: tokX, body: { id: 'header' } })).body.ok && !(await req('POST', '/api/egg', { token: tokX, body: { id: 'teapot' } })).body.ok, '헤더 탐정·찻주전자는 /api/egg 로 못 연다');
  ok((await req('GET', '/api/anvil', { token: tokX })).status === 405, '모루는 GET 이 아니라 POST(405)');
  ok((await req('POST', '/api/anvil')).status === 401, '로그인 없이 모루 → 401');
  r = await req('POST', '/api/anvil', { token: tokX });
  ok(r.status === 200 && r.body.found === 'header' && /coffee/.test(r.body.next) && r.body.me.titles.some(t => t.id === 'egg_header'), '모루를 두드림 → 「헤더 탐정」 + 다음 단서(커피)');
  r = await req('GET', '/api/coffee');
  ok(r.status === 418 && r.body.teapot && r.body.found === null, '로그인 없이 커피 → 418 찻주전자(칭호 없음)');
  r = await req('POST', '/api/coffee', { token: tokX });
  const tc = (await req('GET', '/api/me', { token: tokX })).body.me.titles.map(t => t.id);
  ok(r.status === 418 && r.body.found === 'teapot' && tc.includes('egg_teapot'), '로그인한 채 커피 → 418 + 「찻주전자」');
  ok((await req('POST', '/api/coffee', { token: tokX })).body.found === null, '두 번째 커피는 칭호 없음(1회)');

  // 🛡️ 매크로 방지 — 사람 최고 속도보다 빠른 연속 사냥·연타+강공격 초과는 거절
  console.log('\n[매크로 방지]');
  GAME.CONFIG.huntMinGapMs = 750;
  await q("UPDATE players SET data = jsonb_set(data, '{huntTs}', '0') WHERE nick='이스터'");   // 직전 사냥은 오래전
  r = await req('POST', '/api/hunt', { token: tokX });
  const r2 = await req('POST', '/api/hunt', { token: tokX });
  ok(r.body.ok && !r2.body.ok && r2.body.tooFast, '0.75초 안에 다시 사냥 → 거절(보상 없음)');
  await q("UPDATE players SET data = jsonb_set(data, '{huntTs}', to_jsonb(((data->>'huntTs')::bigint) - 800)) WHERE nick='이스터'");
  ok((await req('POST', '/api/hunt', { token: tokX })).body.ok, '0.8초 뒤엔 정상');
  GAME.CONFIG.huntMinGapMs = 0;

  // 🔒 남의 프로필(로그인 없이) — 화면에 필요한 것만, 이메일·가방·칭호 얻는 법은 안 나간다
  console.log('\n[공개 프로필]');
  await q("UPDATE players SET data = jsonb_set(data, '{email}', '\"secret@example.com\"') WHERE nick='이스터'");
  const pub = (await req('GET', '/api/profile', { query: 'name=' + encodeURIComponent('이스터') })).body;
  const pj = JSON.stringify(pub);
  ok(pub.ok && pub.profile.nick === '이스터' && Array.isArray(pub.profile.titles) && pub.profile.weapon, '공개 프로필 기본 정보');
  ok(!pj.includes('secret@example.com') && !('email' in pub.profile) && !('inv' in pub.profile) && !('titleRoster' in pub.profile), '이메일·가방·칭호 진열장 없음');
  ok(!pj.includes('하트') && pub.profile.titles.every(t => !('desc' in t)) && pub.profile.titles.some(t => t.grade === 'prism'), '이스터에그 칭호는 이름만(얻는 법 비공개)');

  // 🗑️ 회원 탈퇴 — 파티장 탈퇴 시 해산, 모든 세션 무효, 소유 행 삭제, 닉네임 재사용 가능
  console.log('\n[회원 탈퇴]');
  r = await req('POST', '/api/login', { body: { nick: '탈퇴러', pin: '13579135' } });
  const tokD = r.body.token;
  await req('POST', '/api/setclass', { token: tokD, body: { class: 'warrior' } });
  const tokD2 = (await req('POST', '/api/login', { body: { nick: '탈퇴러', pin: '13579135' } })).body.token;   // 다른 기기 세션
  r = await req('POST', '/api/login', { body: { nick: '파티원', pin: '24680246' } });
  const tokE = r.body.token;
  await req('POST', '/api/setclass', { token: tokE, body: { class: 'archer' } });
  r = await req('POST', '/api/party-create', { token: tokD });
  const dParty = r.body.party && r.body.party.id;
  await req('POST', '/api/party-invite', { token: tokD, body: { nick: '파티원' } });
  r = await req('POST', '/api/party-accept', { token: tokE, body: { id: dParty } });
  ok(r.body.ok && r.body.me.party && r.body.me.party.id === dParty, '탈퇴러 파티에 파티원 합류');
  await req('POST', '/api/hunt', { token: tokD });   // 일일 기록 행 생성
  const dId = (await q("SELECT id FROM players WHERE nick='탈퇴러'"))[0].id;
  ok((await q('SELECT count(*)::int n FROM player_daily WHERE player_id=$1', [dId]))[0].n === 1, '탈퇴 전 일일 기록 있음');
  r = await req('POST', '/api/delete-account', { token: tokD, body: { nick: '틀린닉' } });
  ok(!r.body.ok && /닉네임/.test(r.body.error), '닉네임이 다르면 탈퇴 거부');
  r = await req('POST', '/api/delete-account', { token: tokD, body: { nick: '탈퇴러' } });
  ok(r.body.ok && r.body.msg, '닉네임 확인 후 탈퇴 성공');
  ok((await req('GET', '/api/me', { token: tokD })).status === 401 && (await req('GET', '/api/me', { token: tokD2 })).status === 401, '모든 기기 세션 무효(401)');
  const left = await q(`SELECT (SELECT count(*)::int FROM players WHERE id=$1) p, (SELECT count(*)::int FROM sessions WHERE player_id=$1) s,
                               (SELECT count(*)::int FROM player_daily WHERE player_id=$1) d, (SELECT count(*)::int FROM parties WHERE id=$2) pt`, [dId, dParty]);
  ok(left[0].p === 0 && left[0].s === 0 && left[0].d === 0, '플레이어·세션·일일 기록 행 삭제');
  ok(left[0].pt === 0, '파티장이 탈퇴하면 파티 해산');
  const meE = (await req('GET', '/api/me', { token: tokE })).body.me;
  ok(meE && !meE.party, '남은 파티원은 파티에서 풀림');
  ok(!(await req('GET', '/api/rank')).body.list.some(x => x.nick === '탈퇴러'), '랭킹에서 사라짐');
  r = await req('POST', '/api/login', { body: { nick: '탈퇴러', pin: '97531975' } });
  ok(r.body.ok && r.body.isNew, '탈퇴한 닉네임은 다시 쓸 수 있음');

  // 혼자 레이드 — 전투 시간 +5초, 힐러의 파티 공격력 업(자신 포함) — game.js 를 직접 돌린다
  console.log('[혼자 레이드 · 힐러 공격력 업]');
  {
    const sdb = { players: {}, parties: {}, log: [] };
    const sp = GAME.makePlayer('솔로힐러'); GAME.norm(sp);
    Object.assign(sp, { class: 'healer', level: 99 });
    sdb.players.s = sp;
    GAME.partyCreate(sdb, 's');
    const sr = GAME.raidStart(sdb, 's', 'dragon');
    ok(sr.ok && sr.raid.duration === GAME.CONFIG.raidSoloDuration && sr.raid.duration > GAME.CONFIG.raidDuration, '혼자 도전 → 전투 시간이 더 길다(' + sr.raid.duration / 1000 + '초)');
    ok(sr.raid.atkBuff === Math.round(GAME.CONFIG.raidAtkBuffCap * 100), '힐러 +99 → 파티 공격력 업은 상한(+' + sr.raid.atkBuff + '%)');
    ok(Math.abs(sr.raid.soloMult - 1.6) < 1e-9, '혼자 싸우는 힐러는 공격에 전념(×' + sr.raid.soloMult + ')');
    ok(sdb.parties[sp.party].raid.attacks.every(a => a.t <= sr.raid.duration - 600), '보스 반격도 늘어난 시간 안에 나뉜다');
    ok(sr.raid.events.some(e => /혼자 도전/.test(e.text)) && sr.raid.events.some(e => /힐러의 축복/.test(e.text)), '전투 기록에 혼자 도전·공격력 업 표시');
    const realRandom = Math.random;
    Math.random = () => 0.999;   // 💥 치명타 없이 정확한 값을 본다
    const h = GAME.raidHit(sdb, 's', 10);
    const plain = (12 + 99 * 8) * 0.8 * GAME.CONFIG.raidHitDmgMult * 10;   // 힐러 계수 0.5 → 혼자면 0.8
    ok(h.dmg === Math.round(plain * (1 + GAME.CONFIG.raidAtkBuffCap)) && h.crits === 0, '연타 피해에 공격력 업 반영(' + h.dmg + ')');
    sdb.parties[sp.party].raid.startTs -= 3000;   // 경과시간 예산(연타+강공격)을 채워 둔다
    const before = h.raid.bossHP;
    const sk = GAME.raidStrong(sdb, 's', 1);
    ok(sk.ok && before - sk.raid.bossHP === Math.round((12 + 99 * 8) * 0.8 * GAME.CONFIG.raidHitDmgMult * 22 * (1 + GAME.CONFIG.raidAtkBuffCap)), '별빛 폭발 피해에도 공격력 업 반영(' + (sk.dmg || 0) + ')');
    // 💥 치명타 — 전부 터지게 굴리면 연타·강공격 모두 직업 배율(힐러 ×1.7)만큼
    Math.random = () => 0;
    const hc = GAME.raidHit(sdb, 's', 10);
    const resM = GAME.STRONG_ATTACKS.healer.buff.mult;   // 방금 별빛 폭발로 마력 공명(연타 ×1.5) 중
    ok(hc.crits === 10 && hc.dmg === Math.round(plain * (1 + GAME.CONFIG.raidAtkBuffCap) * GAME.CLASS_CRIT.healer.m * resM), '연타 치명타 10/10 → 피해 ×' + GAME.CLASS_CRIT.healer.m + ' (' + hc.dmg + ')');
    sdb.parties[sp.party].raid.strongAt = {}; sdb.parties[sp.party].raid.startTs -= 3000;   // 쿨타임·예산 비우기
    const skc = GAME.raidStrong(sdb, 's', 1);   // (보스가 여기서 쓰러질 수 있어 남은 HP 대신 이번 피해량을 본다)
    ok(skc.ok && skc.crit && skc.dmg === Math.round((12 + 99 * 8) * 0.8 * GAME.CONFIG.raidHitDmgMult * 22 * (1 + GAME.CONFIG.raidAtkBuffCap) * GAME.CLASS_CRIT.healer.m) && /치명타/.test(skc.strongText), '강공격 치명타 → 피해 ×배율 · 기록에 💥치명타');
    Math.random = realRandom;
  }
  // 🕯️ 싸움에서 손상된 무기도 추모(오늘 파괴 수)에 들어간다 — 진 쪽이 공격자든 방어자든
  {
    const fdb = { players: {}, parties: {}, log: [] };
    const A = GAME.makePlayer('공격러'), D = GAME.makePlayer('방어러'); GAME.norm(A); GAME.norm(D);
    Object.assign(A, { class: 'warrior', level: 44 }); Object.assign(D, { class: 'healer', level: 99 });
    fdb.players.a = A; fdb.players.d = D;
    const realRandom = Math.random; Math.random = () => 0;   // 공격자 승리(0 < pWin) · 손상 발동(0 < 10%)
    const fr = GAME.fight(fdb, 'a', '방어러'); Math.random = realRandom;
    ok(fr.ok && fr.iWon && fr.broke && fr.broke.who === '방어러' && D.level === 98, '싸움 패배 손상: 방어자 +99 → +98');
    const hl = GAME.hogu(fdb);
    ok(hl.some(x => x.nick === '방어러' && x.c === 1), '싸움 손상도 추모 목록에 1번 파괴로 올라감');
    // 먼저 건 사람이 지면 골드만 잃고 무기는 안전 — 손상 판정이 '터지는' 난수(0)를 줘도 그대로
    A.fightsUsed = 0; const seq = [0.95, 0]; Math.random = () => (seq.length ? seq.shift() : 0.5);
    const fl = GAME.fight(fdb, 'a', '방어러'); Math.random = realRandom;
    ok(fl.ok && !fl.iWon && !fl.broke && A.level === 44, '건 사람이 지면 무기 손상 없음(골드만)');
    // 🛡️ 방어자에게 방지권이 있으면 손상을 1장으로 막는다(추모에도 안 올라감)
    A.fightsUsed = 0; GAME.norm(D); D.inv.items.protect = 2; const lvB = D.level, cB = D.destroysToday;
    Math.random = () => 0; const fg = GAME.fight(fdb, 'a', '방어러'); Math.random = realRandom;
    ok(fg.ok && fg.iWon && !fg.broke && fg.guarded && D.level === lvB && D.inv.items.protect === 1 && D.destroysToday === cB, '방어자 방지권 → 손상 막음 · 방지권 −1 · 추모 그대로');
    D.ascend = 1; A.fightsUsed = 0; Math.random = () => 0; const fs = GAME.fight(fdb, 'a', '방어러'); Math.random = realRandom;
    ok(fs.ok && fs.broke && !fs.guarded && D.inv.items.protect === 1, '★1+ 무기는 방지권 무효(강화와 같은 규칙) → 손상');
  }
  // ⚔️ 싸움 승률 — 전투력(강화·★) 비율: 같으면 50% · 차이가 클수록 이긴다 · ★ 반영 · 2~98%
  {
    const o = (a, as, d, ds) => GAME.fightOdds({ level: a, ascend: as }, { level: d, ascend: ds });
    ok(Math.abs(o(99, 0, 99, 0) - 0.5) < 1e-9, '같은 전투력 → 50%');
    ok(o(99, 0, 44, 0) === 0.98 && o(44, 0, 99, 0) === 0.02, '+99 vs +44 → 98% (예전 90%) · 반대로 2%');
    ok(o(99, 0, 95, 0) < o(99, 0, 90, 0) && o(99, 0, 90, 0) < o(99, 0, 80, 0), '강화 차이가 클수록 승률↑ (' + [95, 90, 80].map(d => Math.round(o(99, 0, d, 0) * 100) + '%').join(' · ') + ')');
    ok(o(0, 1, 99, 0) > 0.6 && o(0, 3, 99, 0) > o(0, 1, 99, 0), '★ 은 전투 레벨 100씩 — ★1 +0 이 +99 를 이긴다 (★1 +0 ' + Math.round(o(0, 1, 99, 0) * 100) + '% · ★3 +0 ' + Math.round(o(0, 3, 99, 0) * 100) + '%)');
    const ldb = { players: {}, parties: {}, log: [] };
    [['나', 99, 0], ['약한이', 44, 0], ['동급', 99, 0], ['초월자', 99, 2]].forEach(([n, l, a], i) => { const q = GAME.makePlayer(n); GAME.norm(q); Object.assign(q, { class: 'warrior', level: l, ascend: a }); ldb.players['k' + i] = q; });
    const fl = GAME.fightList(ldb, 'k0');
    ok(fl.ok && fl.list.length === 3 && fl.list[0].nick === '초월자' && fl.list.find(x => x.nick === '약한이').odds === 98 && fl.list.find(x => x.nick === '동급').odds === 50, '싸움 목록: 전투력 높은 순 + 상대별 내 승률');
  }
  // 🔥 기운 보정 — 장인의 기운이 찰수록 성공률 + 기운 × pityLuckMax (보정분 안에서 붙으면 luckHit)
  {
    const edb = { players: {}, parties: {}, log: [] }, ep = GAME.makePlayer('강화러'); GAME.norm(ep);
    Object.assign(ep, { class: 'warrior', level: 98, ascend: 1, ascendMax: 1, gold: 1e9, pity: 0.5 }); edb.players.e = ep;
    const base = GAME.odds(98, 1).success, bonus = 0.5 * GAME.CONFIG.pityLuckMax;
    const pv = GAME.publicView(edb, 'e');
    ok(Math.abs(pv.odds.success - (base + bonus)) < 1e-12 && Math.abs(pv.luck - bonus) < 1e-12, '화면 성공률에 기운 보정 포함 (' + (base * 100).toFixed(2) + '% → ' + (pv.odds.success * 100).toFixed(2) + '%)');
    const realRandom = Math.random; Math.random = () => base + bonus / 2;   // 원래라면 실패, 보정분 안
    const er = GAME.enhance(edb, 'e'); Math.random = realRandom;
    ok(er.ok && er.result === 'success' && er.luckHit && ep.level === 99 && /기운이 밀어줬다/.test(er.msg), '보정분 덕에 성공 → luckHit · +98 → +99');
    Object.assign(ep, { level: 98, pity: 0 }); Math.random = () => base + bonus / 2;
    const er0 = GAME.enhance(edb, 'e'); Math.random = realRandom;
    ok(er0.ok && er0.result !== 'success', '기운 0 이면 보정 없음(같은 난수로 실패)');
  }
  // 💎 프리즘(★) 무기 — 등급·전투 레벨·고정 성공률·금 감(−1)·속성 유지
  {
    const pdb = { players: {}, parties: {}, log: [] }, pp = GAME.makePlayer('프리즘러'); GAME.norm(pp);
    Object.assign(pp, { class: 'warrior', level: 99, best: 99, element: 'water', gold: 1e9 }); pp.inv.items = { shard: 200, essence: 20 }; pdb.players.p = pp;
    const ar = GAME.ascend(pdb, 'p');
    ok(ar.ok && pp.ascend === 1 && pp.level === 0 && pp.element === 'water', '초월해도 속성 유지(💧) · ★1 +0');
    const v = GAME.publicView(pdb, 'p');
    ok(v.grade.key === 'prism' && /프리즘/.test(v.weapon) && v.combatLevel === 100, '★1 +0 = 💎 프리즘 등급 · 전투 레벨 100 (' + v.weapon + ')');
    const r99 = GAME.makePlayer('99강'); GAME.norm(r99); Object.assign(r99, { class: 'warrior', level: 99 }); pdb.players.q = r99;
    ok(GAME.fightPower(pp) > GAME.fightPower(r99), '★1 +0 전투력이 +99 보다 크다(힘이 이어진다)');
    ok(GAME.enhanceCost(99, 0) === 1010 && GAME.enhanceCost(0, 1) === 1020 && GAME.enhanceCost(99, 1) === 2010 && GAME.enhanceCost(0, 2) === 2020, '강화 비용도 전투 레벨: +99 1,010G · ★1 +0 1,020G · ★1 +99 2,010G');
    ok(GAME.odds(0, 1).success === GAME.CONFIG.prismSucc && GAME.odds(80, 3).success === GAME.CONFIG.prismSucc && GAME.CONFIG.prismSucc > GAME.odds(99, 0).success, '프리즘 무기 성공률 고정(+99 보다 조금 높고 ★ 로 안 낮아짐)');
    Object.assign(pp, { level: 60, pity: 0.4 });
    const sP = GAME.CONFIG.prismSucc + 0.4 * GAME.CONFIG.pityLuckMax, d60 = GAME.odds(60, 1).destroy;
    const realRandom = Math.random; Math.random = () => sP + d60 / 2;   // 파괴 구간
    const er = GAME.enhance(pdb, 'p'); Math.random = realRandom;
    ok(er.ok && er.result === 'destroy' && pp.level === 59 && pp.pity > 0.4 && pp.element === 'water', '프리즘 무기 파괴 구간 = 금 감(−1강) · 기운 유지·상승 · 속성 유지');
  }
  // ⚗️ 연금술 확률표 — 합이 1 · 꽝은 불이 셀수록 낮다
  {
    const A = GAME.ALCHEMY, sum = t => t.reduce((x, e) => x + e.p, 0), fail = a => a.table.find(e => e.n === 0).p;
    ok(A.every(a => Math.abs(sum(a.table) - 1) < 1e-9), '연금술 확률표 합 = 100%');
    ok(fail(A[0]) > fail(A[1]) && fail(A[1]) > fail(A[2]) && fail(A[0]) <= 0.4, '꽝: 약불 > 중불 > 강불 (' + A.map(a => Math.round(fail(a) * 100) + '%').join(' · ') + ')');
  }
  // 💥 직업별 치명타 표 — 순위(확률: 전사>힐러>궁수>탱커 · 피해: 궁수>전사>힐러>탱커)와 화면 표가 같은지
  {
    const K = GAME.CLASS_CRIT;
    ok(K.warrior.p > K.healer.p && K.healer.p > K.archer.p && K.archer.p > K.tanker.p, '치명 확률 순위 전사 > 힐러 > 궁수 > 탱커');
    ok(K.archer.m > K.warrior.m && K.warrior.m > K.healer.m && K.healer.m > K.tanker.m, '치명 피해 순위 궁수 > 전사 > 힐러 > 탱커');
    const src = readFileSync(path.join(dir, '..', 'public', 'app.js'), 'utf8');
    const mm = src.match(/const CRIT = (\{[^;]+\});/);
    const client = mm && Function('return ' + mm[1])();
    ok(client && Object.keys(K).every(c => client[c].p === K[c].p && client[c].m === K[c].m), '화면(app.js CRIT)과 서버(CLASS_CRIT) 치명타 값이 같다');
    const hdb = { players: {}, parties: {}, log: [] }, hp = GAME.makePlayer('치명러'); GAME.norm(hp); Object.assign(hp, { class: 'archer', level: 50 }); hdb.players.h = hp;
    const realRandom = Math.random; Math.random = () => 0;
    const hr = GAME.hunt(hdb, 'h'); Math.random = realRandom;
    ok(hr.ok && hr.crit && hr.critMult === K.archer.m, '사냥 치명타도 직업 배율(궁수 ×' + hr.critMult + ')');
  }

  // 정수 페이스 — ★3 까지는 그 ★ 로 들어갈 수 있는 가장 정수 많은 보스를 하루 레이드 횟수만큼 깨면 다음 ★ 정수가 모인다
  console.log('[정수 페이스]');
  for (let n = 0; n < 3; n++) {
    const best = Math.max(...GAME.BOSSES.filter(b => b.reqAscend <= n).map(b => b.essence));
    const need = GAME.ascendReq(n + 1).essence;
    ok(best * GAME.CONFIG.dailyRaids >= need, '★' + n + ' → ★' + (n + 1) + ': 하루 ' + GAME.CONFIG.dailyRaids + '회 × 🌟' + best + ' = ' + best * GAME.CONFIG.dailyRaids + ' ≥ ' + need);
  }

  console.log('\n결과: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
