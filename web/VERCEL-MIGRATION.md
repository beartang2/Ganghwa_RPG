# Vercel + Supabase 이전 (진행 중)

맥/상시서버(`server.js`, SQLite, SSE) 버전은 **그대로 유지**하고, 그 옆에
서버리스(Vercel) + 관리형 Postgres(Supabase) 버전을 **단계적으로** 얹는다.
게임 로직(`game.js`)과 프론트(`public/`)는 양쪽이 공유한다.

## 설계 — game.js 를 그대로 재사용

`game.js` 는 인메모리 `db` 를 변경하는 순수 동기 함수 모음이다. 서버리스는 상시
프로세스·공유 메모리가 없으므로, **요청마다** 얇은 어댑터가 이렇게 감싼다:

```
요청 → 트랜잭션 시작
     → 주체 플레이어 행 FOR UPDATE 잠금 (같은 유저 동시요청 직렬화)
     → Postgres 에서 세계를 인메모리 db 슬라이스로 로드
     → 기존 game.js 함수 실행 (변경 없음)
     → 바뀐 행만 diff 저장
     → 커밋 → 응답(JSON, 기존 프론트와 동일 모양)
```

| 파일 | 역할 |
|------|------|
| `../supabase/migrations/*.sql` | Supabase(Postgres) 스키마 — GitHub 연동이 자동 적용(단일 소스) |
| `api/_lib/store.js` | 로드/스냅샷/ diff 저장 / 세션 (DB 접근은 `q(text,params)` 로 추상화) |
| `api/_lib/router.js` | 요청 라우팅 — `server.js` 로직을 DB 비의존으로 이식 |
| `index.js` | Vercel 진입점(Node 서버 모드) — public/ 정적 서빙 + /api/* 를 pg 트랜잭션으로 라우터에 위임 |
| `vercel.json` | 함수/리라이트 설정 |
| `db/test-adapter.mjs` | **pglite(인메모리 PG)로 로컬 검증** — Supabase 없이 전체 파이프라인 테스트 |

## 진행 현황

### ✅ 1단계 (완료·테스트됨) — `npm run test:adapter` 20/20
- 스키마, 어댑터, 세션, 라우터
- 로그인/직업/재로그인/닉중복, 출석·사냥·채굴(곡괭이질)·강화·상점·방지권·닉변
- 랭킹/부자/호구/로그/목록/프로필 (SQL 재로드 + game.js 재사용)
- 일일 카운터 `player_daily` 영속화, `data` JSONB 소유필드 미중복 규칙 유지

### ✅ 2단계 (완료·테스트됨) — `npm run test:adapter` 32/32
- 싸움: 공격자+방어자 행을 함께 `FOR UPDATE`(정렬 순서로 데드락 방지). 골드 약탈 제로섬,
  양쪽 전적·`player_daily.fights_used` 영속화 검증
- 파티: 생성/초대/수락/탈퇴, `me.invites` 노출, 리더 탈퇴 시 해체(삭제) 영속화
- 파티 참가/수락은 대상 파티 행도 함께 잠금(동시 참가 레이스 방지)

### ✅ 3단계 (완료·테스트됨) — `npm run test:adapter` 38/38
- 알고 보니 레이드는 **이미** "결과 즉시 계산 + 턴 클라 재생" 구조였다: `raidStart` 가
  `simulateRaid` 로 전체 타임라인을 한 번에 만들어 `pt.raid` 에 저장하고, 프론트가
  `startTs` 기준으로 타임라인을 700ms/스텝 재생(폴링으로 다같이 관전). 게임 로직·프론트
  변경 없이 라우팅만 이식.
- 레이드는 전원의 골드/방지권/횟수를 바꾸므로 **파티원 전원 + 파티 행을 함께 잠금**.
- 검증: 결과·타임라인 반환, 전원 보상·횟수 영속화, 다른 파티원 관전 폴링, `parties.data.raid` 영속화.

### 🟡 4단계 — 실시간/마무리 (부분 완료)
- ✅ **SSE→폴링 우아한 폴백**: 프론트가 `/api/events` 를 못 열면(서버리스) 재시도 폭주 없이
  SSE 를 끄고 5초 폴링에 맡긴다. 상시서버에선 SSE 그대로. → **서버리스에서 전 기능 동작**.
- ✅ **속도제한(Postgres 토큰버킷)**: `rate_buckets` 테이블 + `store.rateAllow()`.
  계정별 액션(버스트8+초당3), 로그인 닉별(버스트6+10초당1)·IP별(분당30) → 스크립트 파밍·
  PIN 무차별 대입 차단. 정상 플레이(450ms 쿨다운)는 통과. test 40/40.
- ✅ **Supabase Realtime**: logs INSERT 구독 → 즉시 갱신. 안 되면 폴링 폴백(무중단).
  필요 env: SUPABASE_URL, SUPABASE_ANON_KEY. 마이그레이션이 RLS+퍼블리케이션 처리.
- ⬜ (선택) 관리자 API(`/api/admin/*`) 이식

## 배포 방법 (1단계 시험 배포용)

1. **Supabase 프로젝트 생성** → 스키마 적용 (둘 중 하나)
   - **GitHub 연동(권장)**: 레포 루트의 `supabase/` 폴더를 연결하면 `supabase/migrations/*.sql`
     이 자동 적용됨. Working directory 는 레포 루트(빈칸/`.`).
   - **수동**: SQL Editor 에 `supabase/migrations/20260814000000_init.sql` 붙여넣고 Run
2. **연결 문자열** 확보: Supabase → Project Settings → Database →
   *Connection string* 의 **Transaction 풀러(포트 6543)** 권장 (서버리스용)
3. **Vercel 프로젝트** 생성 후 이 저장소 연결
   - **Root Directory 를 `web/` 로 설정** (프론트 `public/`, 함수 `api/` 가 여기 있음)
   - 환경변수 `DATABASE_URL` 에 2번 문자열 입력
4. 배포 → `https://<프로젝트>.vercel.app` 접속. 1단계 기능(로그인·강화·사냥·채굴·
   상점·랭킹)이 동작. 싸움/파티/레이드는 아직 안내 메시지(501).

> 로컬 검증: `cd web && npm install && npm run test:adapter` — Supabase 없이 pglite 로
> 전체 파이프라인을 돌려본다.

## 참고 / 주의
- **로드-올 방식**: 현재 어댑터는 요청마다 전체 플레이어를 로드한다(사내 소규모 P 기준
  충분). P 가 커지면 단일 플레이어 로드로 최적화 여지. 저장은 항상 diff(바뀐 행만).
- **Vercel Hobby 는 비상업용** 조건. 사내용이면 회색지대 — 필요 시 Pro.
- **Supabase Free 는 7일 미활동 시 일시정지**(데이터 보존, 수동 재개).
- 상시서버가 더 간단한 선택이면 `README.md` 의 로컬/Render 방식을 그대로 쓰면 된다.
