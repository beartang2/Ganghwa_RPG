# 강화 RPG — 웹 버전 (맥 = 서버)

카카오톡 없이, **맥을 서버로 띄우고 브라우저로 즐기는** 확률 RPG 강화게임입니다.
같은 네트워크(회사 와이파이 등)의 동료들이 맥의 로컬 IP로 접속해서 함께 플레이합니다.

- 번호·에뮬레이터·카톡 약관 문제 **전부 없음**
- **의존성 0** — Node.js만 있으면 `node server.js` 하나로 실행
- **PIN 8자리가 계정** (같은 PIN=같은 계정, 닉+PIN 일치해야 로그인, 닉네임은 프로필에서 변경)
- 직업 4종(근딜/원딜/탱커/힐러), 채굴 등 — 하나의 **공유 세계**
- 파티 **초대→수락/거절** 후 보스레이드를 **실시간 턴제로 다같이 관전**
- 등급별로 장식이 붙고 빛나는 무기 그래픽은 **SVG로 코드 생성**(이미지 파일 0개)

## 실행 방법 (맥)

1. **Node.js 설치** (한 번만): https://nodejs.org 에서 LTS 버전 설치
   - 확인: 터미널에서 `node -v` → 버전이 뜨면 OK
2. **패키지 설치** (최초 1회 — SQLite 드라이버):
   ```bash
   cd web
   npm install
   ```
3. **서버 실행**:
   ```bash
   node server.js
   ```
4. 터미널에 뜨는 **`같은 네트워크: http://192.168.x.x:3088`** 주소를 동료에게 공유
   - 본인은 `http://localhost:3088` 으로도 접속 가능
5. 브라우저에서 접속 → 닉네임 + PIN 입력 → 플레이!

> 💡 맥을 켜두는 동안만 게임이 열립니다. 끄면 접속이 끊기지만, 기록은
> **SQLite DB(`web/game.db`)** 에 저장되어 다시 켜면 그대로 이어집니다.

## 접속 범위 (회사 망에서만)

`0.0.0.0` 로 열려 있어 **같은 네트워크 안에서만** 맥의 로컬 IP(192.168.x.x)로
접속됩니다. 맥을 인터넷에 포트포워딩하지 않는 한 외부에서는 접근할 수 없어,
자연스럽게 "회사 망에서만 플레이"가 됩니다.

- 포트 변경: `PORT=8080 node server.js`
- 방화벽: 맥 시스템 설정 → 네트워크/방화벽에서 들어오는 연결 허용이 필요할 수 있음

## 보안 / 어뷰징 방지

- **서버 액션 속도제한**: 계정별 토큰버킷(버스트 8 + 초당 3회)으로 스크립트 연타·자동화를 차단.
  정상 플레이(클라 450ms 쿨다운)는 영향 없음. 초과 시 서버가 429 응답.
- **레이드 최소 인원**: 혼자서는 레이드 불가(최소 2명). `CONFIG.raidMinMembers`로 조절.
- **일일 한도·골드 소모**로 사냥/싸움/레이드/구매가 이미 제한됨.
- **클라이언트 코드 난독화(선택)**: 배포 전 아래를 실행하면 `app.js` 대신
  압축·난독화된 `app.min.js`가 서빙됩니다. (개발 중엔 원본이 서빙됨)
  ```bash
  npm run build     # public/app.min.js 생성 → 서버가 이걸 우선 서빙
  # 원본으로 되돌리려면: rm public/app.min.js
  ```

> ⚠️ 참고: 브라우저 특성상 **API 엔드포인트 주소 자체는 네트워크 탭에 노출**됩니다(숨김 불가).
> 그래서 방어는 "클라 숨김"이 아니라 **서버 검증·속도제한·한도**로 합니다. 위 조치들이 그 역할을 합니다.

## 부하 관련 설계 메모

유저가 늘 때 제곱으로 커지던 지점들을 정리해둔 상태입니다.

| 항목 | 예전 | 지금 |
| --- | --- | --- |
| SSE `refresh` | 액션마다 전원에게 → `접속자 × 액션수` 만큼 `/api/me` 재요청 | 남의 화면이 바뀌는 액션만, 최대 1초에 1회로 코얼레싱 |
| 공개 조회(`/api/rank` 등) | 호출마다 전체 정렬 `O(P log P)`, 인증·속도제한 없음 | 2초 TTL 캐시 → 접속자 수와 무관하게 상수 |
| `enhanceRank` | `/api/me` 마다 전체 정렬 | 캐시 + 레벨 변동 시 무효화 (2초 TTL 백스톱) |
| `persist()` | 액션마다 전체 플레이어 upsert, parties·logs 전체 삭제 후 재삽입 | 직렬화 결과 비교 후 **바뀐 행만** 쓰기. 로그는 append-only + 주기적 프루닝 |
| `findByNick` | 싸움·초대마다 `O(P)` 선형 탐색 | `nick → id` Map 인덱스 |
| 세션 / 속도제한 버킷 | 만료 없이 무한 증가 | 7일 TTL, 10분마다 정리 |

쓰기 증폭이 실제로 잡혔는지 확인하려면:

```bash
PERSIST_DEBUG=1 node server.js
# [persist] rows=3 players=3   ← 사냥 1회 = 플레이어 1행 + 일일 1행 + 로그 1행
# [persist] rows=1 players=3   ← 채굴 1회 = 플레이어 1행
# [persist] rows=0 players=3   ← 변경 없음 = 쓰기 없음
```

> 골드 랭킹처럼 본인만 바뀌는 액션의 결과는 최대 2초(캐시) + 클라 5초 폴링만큼 늦게 보입니다.
> 즉시 반영이 필요하면 해당 액션을 `server.js` 의 `SHARED_ACTIONS` 에 추가하세요.

## 유저별 일일 한도 · 사용량 관리 (DB)

일일 카운터와 상한은 `players.data` JSON 안이 아니라 **전용 테이블**로 분리되어 있어
SQL로 직접 조회·수정할 수 있습니다.

| 테이블 | 내용 |
| --- | --- |
| `player_daily(player_id, day, hunts_used, fights_used, raids_used, destroys, attended)` | 유저×날짜 사용량. 날짜별 이력이 계속 쌓임 |
| `player_limits(player_id, daily_hunts, daily_fights, daily_raids, note, updated_at)` | 유저별 상한 오버라이드. `NULL` = `CONFIG` 기본값 사용 |

기본 상한은 `game.js` 의 `CONFIG.dailyHunts / dailyFights / dailyRaids`,
유저별 예외만 `player_limits` 에 넣습니다. 일일 리셋은 크론 없이
`day` 값이 오늘과 다르면 자동으로 초기화되는 방식입니다.

> 최초 실행 시 기존 `players.data` 안의 카운터를 `player_daily` 로 한 번 옮기고
> `game.db.premigrate-<타임스탬프>.bak` 백업을 남깁니다. 이후엔 재실행돼도 다시 마이그레이션하지 않습니다.

### 조회 (SQL)

```sql
-- 오늘 누가 얼마나 썼나
SELECT p.nick, d.hunts_used, d.fights_used, d.raids_used, d.destroys
  FROM player_daily d JOIN players p ON p.id = d.player_id
 WHERE d.day = date('now','localtime')
 ORDER BY d.hunts_used DESC;

-- 최근 7일 사냥 추이
SELECT day, sum(hunts_used) AS hunts, count(*) AS active_users
  FROM player_daily GROUP BY day ORDER BY day DESC LIMIT 7;
```

### 관리자 API

`ADMIN_TOKEN` 환경변수를 준 채로 서버를 띄우면 활성화됩니다. **설정하지 않으면 관리자 API는 완전히 닫힙니다.**

```bash
ADMIN_TOKEN=원하는긴토큰 node server.js
```

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/api/admin/limits` | 상한 오버라이드 목록 + 기본값 |
| `POST` | `/api/admin/limits` | `{nick, dailyHunts?, dailyFights?, dailyRaids?, note?}` — 값이 `null`이면 해제 |
| `GET` | `/api/admin/daily?day=YYYY-MM-DD` | 해당 날짜 사용량 (기본: 오늘) |
| `POST` | `/api/admin/daily` | `{nick, hunts?, fights?, raids?}` — 오늘 사용량 강제 설정 |
| `POST` | `/api/admin/reload` | DB를 SQL로 직접 고친 뒤 메모리에 다시 읽어들이기 |

```bash
# 특정 유저만 사냥 50회 / 레이드 9회
curl -H "x-admin-token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
     -X POST http://localhost:3088/api/admin/limits \
     -d '{"nick":"다히","dailyHunts":50,"dailyRaids":9,"note":"이벤트 보상"}'

# 오늘 사냥 횟수만 리셋
curl -H "x-admin-token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
     -X POST http://localhost:3088/api/admin/daily -d '{"nick":"다히","hunts":0}'

# 상한 해제(기본값 복귀)
curl -H "x-admin-token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
     -X POST http://localhost:3088/api/admin/limits -d '{"nick":"다히","dailyHunts":null,"dailyRaids":null}'
```

> 서버는 상한을 메모리에 캐시합니다. `sqlite3` 로 `player_limits` 를 직접 고쳤다면
> `POST /api/admin/reload` 를 호출하거나 서버를 재시작해야 반영됩니다.

## 명령/기능

| 기능 | 설명 |
|------|------|
| 강화 | 골드 소모, 실패 시 파괴(+0 리셋). 방지권 보유 시 파괴 1회 방어 |
| 출석 | 하루 1회 +1,000G |
| 사냥 | 랜덤 몬스터, 무기 강할수록 데미지·골드↑, 레어 드랍(방지권/골드뭉치) |
| 방지권 구매 | 개당 3,000G, 파괴 자동 방어 |
| 싸움 | 상대 선택 결투, 승리 시 골드 20% 약탈, 패자 15% 무기 손상. 하루 5회 |
| 랭킹/부자/오늘의호구/로그 | 공유 세계의 순위·기록 |
| 프로필 | 목록에서 이름을 누르면 상대 정보 조회 |

## 데이터 (SQLite)

- 저장: **`web/game.db`** (SQLite). 테이블: `players`(id=PIN해시, nick·level·gold·data),
  `parties`, `logs`
- 조회(예): `sqlite3 web/game.db "SELECT nick, level, gold FROM players ORDER BY level DESC;"`
  (또는 `node -e "const D=require('better-sqlite3');new D('game.db',{readonly:true}).prepare('SELECT nick,level,gold FROM players').all().forEach(r=>console.log(r))"`)
- 백업: `cp web/game.db web/game.backup.db`
- 초기화: 서버를 끄고 `rm web/game.db web/game.db-wal web/game.db-shm` 후 다시 실행

## 밸런스 튜닝

`web/game.js` 상단 `CONFIG` 와 `odds()` / `enhanceCost()` / `RARITIES` / `BOSSES` 를
수정하면 됩니다.
