# 강화 RPG (ganghwa-rpg) ⚔️

다같이 아무 생각 없이 **무기를 강화**하고, 깨지면 처음부터 다시 하는 **확률 RPG 웹게임**.
브라우저로 접속해서 함께 즐깁니다.

▶️ **플레이: https://ganghwa.beartanh.dev**

> 초창기엔 카카오톡 단톡방 봇이었지만 지금은 **웹 게임**으로 전환했어요.
> 옛 카톡 봇 구현은 [`legacy/`](legacy) 에 보관돼 있습니다.

## 🎮 무엇을 하나

- ⚒️ **강화** — 골드로 무기 강화(+0~99). 로스트아크식으로 고레벨일수록 성공률이 급감하고
  대부분 **실패**. 실패가 쌓이면 🔨**장인의 기운**이 차고 100%면 **확정 성공**.
  💥**파괴되면 +0으로 완전 초기화**(+속성 랜덤 재부여) — 🛡️방지권으로 결정적 순간 방어.
- ✨ **직업** — 근딜(검)·원딜(활)·탱커(대검)·힐러(지팡이). 레이드에서 역할이 다름.
- 🔥 **무기 속성** — 불·물·대지·바람·번개·얼음·빛·어둠·독 9종(랜덤). 등급·속성별 이미지.
- 💰 **골드 수급** — 출석 / 🗡️사냥(하루 20회 + 이후 ♾️무한 사냥) / ⛏️**채굴장**(기력 관리형
  곡괭이질·노다지·숙련도) / ⚔️싸움 승리(상대 골드 약탈).
- 🐲 **파티 레이드** — 파티를 만들어 초대·수락하고 보스 처치. 전투를 타임라인으로 다같이 관전.
- 🛒 **상점** — 파괴방지권 · 강화부스트권 · 닉네임 염색약(가챠) · 직업변경권.
- 🏅 랭킹 / 💰부자 / 🤡오늘의 호구 / 📜로그.

## 🚀 실행 / 배포

게임은 전부 [`web/`](web) 에 있고, **두 가지로 띄울 수 있어요**:

| 방식 | 설명 | 가이드 |
|------|------|--------|
| **로컬/상시 서버** | 맥·PC를 Node 서버로 (`node server.js`), 같은 네트워크에서 접속. SQLite 저장. | [`web/README.md`](web/README.md) |
| **Vercel + Supabase** | 서버리스 + 관리형 Postgres 로 공개 URL 호스팅. | [`web/VERCEL-MIGRATION.md`](web/VERCEL-MIGRATION.md) |

빠른 로컬 실행:
```bash
cd web
npm install
npm start        # 또는 npm run dev (nodemon)
# 터미널에 뜨는 http://<로컬IP>:3088 주소를 공유
```

## 🗂️ 구조

```
web/                 웹 게임 (프론트 public/ + 서버 server.js + 로직 game.js)
  public/fx.js       시각 효과 — React Bits 컴포넌트 바닐라 JS 이식 (MIT + Commons Clause, 파일 머리말 참고)
  public/weapon-art.js  무기 그림 생성기 — 직업 4 × 속성 9 × 등급 5 = 180종 SVG (이미지 파일 불필요)
  api/               Vercel 서버리스 어댑터 (game.js 재사용)
  db/                로컬 어댑터 테스트 (pglite)
supabase/            Supabase 마이그레이션 (GitHub 연동 자동 적용)
legacy/              초기 카카오톡 봇 (보관용)
```

## 🎨 화면 / 이펙트

대장간 테마(그을음·무쇠·놋쇠·쇳물). 빌드 없는 바닐라 JS 를 유지하려고 [React Bits](https://reactbits.dev) 컴포넌트를
`web/public/fx.js` 로 이식했다 — 원본 알고리즘·셰이더는 그대로, React 훅만 일반 객체로 바꿨다.

| 원본 (React Bits) | 쓰는 곳 |
|------|------|
| Particles | 화면 아래에서 떠오르는 화로 불씨 (`#embers`) |
| ClickSpark | 강화·사냥·채굴·레이드 탭 불꽃, 강화 결과 버스트 |
| StarBorder | 강화 버튼 테두리 빛 |
| ElectricBorder | 장인의 기운 100%(다음 강화 확정)일 때 화로 패널 |
| GradientText | 전설·초월 무기 이름 |
| ShinyText | 로그인 타이틀 |
| Counter | 상단 골드 숫자 |

`fx.js` 로드 실패나 WebGL2 미지원이면 해당 효과만 빠지고 게임은 그대로 동작한다. `prefers-reduced-motion` 을 존중한다.

### 무기 그림 (`web/public/weapon-art.js`)

180장을 그리는 대신 부품을 겹쳐 그린다 — **형태는 직업**(검·활·방패·지팡이), **금속은 등급**
(무쇠 → 푸른 강철 → 흑강+자수정 → 황금 → 결정), **빛깔·문양은 속성**(날 안쪽 처리 + 둘레의 불꽃·고드름·번개 등).
등급이 오를수록 가드가 날개·후광으로 커지고, 전설부터는 문양이 움직인다.

```js
WeaponArt.svg({ cls: 'warrior', element: 'fire', grade: 'legend' })  // → '<svg …>'
```

직접 그린 PNG 를 쓰고 싶으면 `app.js` 의 `USE_WEAPON_PNG = true` (규칙은 [`web/public/weapons/README.md`](web/public/weapons/README.md)).
일부만 있으면 화풍이 섞이니, 한 직업 분량을 다 채웠을 때 켜는 걸 권장.

## 🔧 밸런스 튜닝

`web/game.js` 상단 `CONFIG` 와 확률 앵커(`SUCC_ANCHORS`/`DESTROY_ANCHORS`),
`enhanceCost()`, `RARITIES`, `BOSSES` 를 고치면 됩니다.
