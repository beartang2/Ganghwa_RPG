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

  // 11) 인터랙티브 레이드 — 시작(active) → 연타로 딜 → 처치/종료 → 전원 보상·횟수 영속화
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
  // 폴링(GET 투영) 조회 가능
  const watch = await req('GET', '/api/party-raid', { token: tok2 });
  ok(watch.body.raid && typeof watch.body.raid.bossHP === 'number', '파티원 폴링(투영) 조회');
  // 연타 제출 → 딜 적용(보스 살아있음)
  let hr = await req('POST', '/api/raid-hit', { token: tok, body: { hits: 40 } });
  ok(hr.body.ok && hr.body.dmg > 0, '타격 딜 적용(dmg=' + hr.body.dmg + ')');
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
  const nPre = gd.atk.n;
  await q("UPDATE players SET data = jsonb_set(data, '{atk,ts}', '0') WHERE nick='검사'");   // 마지막 보고가 오래전인 상태
  r = await req('POST', '/api/hunt', { token: tok, body: { atk: { n: 6, s: 1 } } });
  gd = await dataOf('검사');
  ok(r.body.ok && gd.atk.n === nPre + 6 && gd.atk.s === 1 && gd.atk.w.warrior === 1, '사냥에 얹은 보고: 일반 6 · 강공격 1(검)');
  r = await req('POST', '/api/atk-report', { token: tok, body: { atk: { n: 500, s: 50 } } });
  gd = await dataOf('검사');
  ok(r.body.ok && gd.atk.n - (nPre + 6) <= 1 && gd.atk.s - 1 <= 1, '바로 이어 부풀린 보고(500·50)는 흐른 시간만큼만 인정');
  await q("UPDATE players SET data = jsonb_set(data, '{atk,ts}', '0') WHERE nick='검사'");
  r = await req('POST', '/api/atk-report', { token: tok, body: { atk: { n: 500, s: 50 } } });
  gd = await dataOf('검사');
  ok(gd.atk.n - (nPre + 6) <= 21 && gd.atk.s <= 6, '한 번에 최대 일반 20 · 강공격 4까지만');
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
  ok(hid.length === 10 && hid.every(t => !t.title && !t.color && t.grade === 'prism'), '숨은 칭호 10개 — 이름·색 비공개(❓)');
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
    Math.random = () => 0.149;   // +44 에서 성공 14.6% 다음 파괴 0.5% 구간
    r = await req('POST', '/api/enhance', { token: tokX });
    Math.random = realRandom;
    const t44 = r.body.me.titles.map(t => t.id);
    ok(r.body.result === 'destroy' && /사\(死\)/.test(r.body.msg) && t44.includes('egg_44') && t44.includes('egg_pity99'), '+44 · 기운 99.5% 에서 파괴 → 「불길한 숫자」「한 끗 차이」');
    Math.random = () => 0.9999;  // 캡슐 표의 마지막 칸 = 빈 캡슐
    r = await req('POST', '/api/capsule', { token: tokX, body: { times: 3 } });
    Math.random = realRandom;
    ok(r.body.me.titles.some(t => t.id === 'egg_air'), '빈 캡슐 3연속 → 「공기 수집가」');
  } finally { Math.random = realRandom; }
  mx = (await req('GET', '/api/me', { token: tokX })).body.me;
  ok(mx.titleRoster.filter(t => t.hidden).length === 4 && mx.titleRoster.find(t => t.id === 'egg_heart').desc.includes('하트'), '찾은 건 이름·설명 공개, 나머지 4개는 여전히 ❓');

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

  console.log('\n결과: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
