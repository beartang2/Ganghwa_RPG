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
| `db/schema.sql` | Supabase(Postgres) 스키마 — SQLite 저장계층과 동일 소유권 규칙 |
| `api/_lib/store.js` | 로드/스냅샷/ diff 저장 / 세션 (DB 접근은 `q(text,params)` 로 추상화) |
| `api/_lib/router.js` | 요청 라우팅 — `server.js` 로직을 DB 비의존으로 이식 |
| `api/[...path].js` | Vercel 진입점 — pg 트랜잭션 열고 라우터 호출 |
| `vercel.json` | 함수/리라이트 설정 |
| `db/test-adapter.mjs` | **pglite(인메모리 PG)로 로컬 검증** — Supabase 없이 전체 파이프라인 테스트 |

## 진행 현황

### ✅ 1단계 (완료·테스트됨) — `npm run test:adapter` 20/20
- 스키마, 어댑터, 세션, 라우터
- 로그인/직업/재로그인/닉중복, 출석·사냥·채굴(곡괭이질)·강화·상점·방지권·닉변
- 랭킹/부자/호구/로그/목록/프로필 (SQL 재로드 + game.js 재사용)
- 일일 카운터 `player_daily` 영속화, `data` JSONB 소유필드 미중복 규칙 유지

### ⬜ 2단계 — 멀티플레이어
- 싸움(2인 트랜잭션·행 잠금), 파티(생성/참가/초대/수락/거절)
- 현재는 `501`(이식 예정)로 명확히 응답

### ⬜ 3단계 — 레이드 (결과 즉시 계산 + 턴 클라 재생)
- `raidStart` 가 결과·턴로그를 한 번에 반환 → 프론트가 애니메이션처럼 재생
- 서버리스에서 실시간 루프 불필요

### ⬜ 4단계 — 실시간/알림 & 마무리
- SSE(refresh·싸움/초대 알림) → **Supabase Realtime** 또는 폴링
- 속도제한(현재 인메모리 토큰버킷) → Postgres/Upstash, 관리자 API 이식

## 배포 방법 (1단계 시험 배포용)

1. **Supabase 프로젝트 생성** → SQL Editor 에서 `db/schema.sql` 실행
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
