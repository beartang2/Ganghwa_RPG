# 무기 이미지 (속성 × 등급) — 넣는 방법

이 폴더에 이미지를 규칙대로 넣으면 게임이 **SVG 대신 그 이미지**를 씁니다.
이미지가 없으면 자동으로 기존 SVG로 표시되니, 있는 것부터 하나씩 채워도 됩니다.

## 파일명 규칙 (계단식 우선순위)

게임은 아래 순서로 파일을 찾고, 없으면 다음으로 넘어갑니다:

1. `{class}_{element}_{grade}.png` — 클래스별 (예: `warrior_fire_epic.png`) — **180장**
2. `{element}_{grade}.png` — 클래스 공용 (예: `fire_epic.png`) — **45장**
3. (둘 다 없으면) 코드 생성 SVG

→ **간단히 하려면 2번(45장)만** 만들면 되고, 직업별로 다르게 하려면 1번(180장)까지.

- **class**: `warrior`(검) · `archer`(활) · `tanker`(대검) · `healer`(지팡이)
- **element**: `fire` 불 · `water` 물 · `earth` 대지 · `wind` 바람 · `thunder` 번개 · `ice` 얼음 · `light` 빛 · `dark` 어둠 · `poison` 독
- **grade**: `common` 일반 · `rare` 희귀 · `epic` 에픽 · `legend` 전설 · `transcend` 초월

## 이미지 사양
- PNG, **투명 배경**, 정사각형 권장(예: 512×512), 무기를 세로로 중앙 배치
- 등급이 오를수록 화려하게(오라·장식), 속성 색이 드러나게

## AI 생성 프롬프트 템플릿

아래 빈칸을 채워서 DALL·E / Midjourney / Stable Diffusion 등에 넣으세요.
스타일을 통일하려면 매번 같은 문장 구조 + 같은 "게임 아이콘" 키워드를 유지하세요.

```
A [GRADE_STYLE] fantasy [WEAPON] imbued with [ELEMENT_DESC], centered game item icon,
front view, transparent background, [ELEMENT_COLOR] energy glow, clean stylized digital art,
high detail, no text, no background scenery
```

- **WEAPON**: sword / bow / greatsword / staff (클래스 공용이면 그냥 "weapon" 또는 "sword")
- **GRADE_STYLE**: common=plain worn / rare=refined blue-tinted / epic=ornate glowing purple /
  legend=majestic golden engraved / transcend=divine cosmic rainbow, radiant aura
- **ELEMENT_DESC / ELEMENT_COLOR**:
  - fire = burning flames / orange-red
  - water = flowing water, droplets / blue
  - earth = rock and stone / earthy brown
  - wind = swirling wind, feathers / teal-green
  - thunder = crackling lightning / bright yellow
  - ice = frost and icicles / pale cyan
  - light = holy radiant light / warm white-gold
  - dark = shadow and dark mist / deep purple
  - poison = toxic dripping ooze / acid green

예) 에픽 불속성 검:
```
A ornate glowing purple fantasy sword imbued with burning flames, centered game item icon,
front view, transparent background, orange-red energy glow, clean stylized digital art,
high detail, no text, no background scenery
```

## 필요한 파일명 (클래스 공용 45장)

```
fire_common.png    fire_rare.png    fire_epic.png    fire_legend.png    fire_transcend.png
water_common.png   water_rare.png   water_epic.png   water_legend.png   water_transcend.png
earth_common.png   earth_rare.png   earth_epic.png   earth_legend.png   earth_transcend.png
wind_common.png    wind_rare.png    wind_epic.png    wind_legend.png    wind_transcend.png
thunder_common.png thunder_rare.png thunder_epic.png thunder_legend.png thunder_transcend.png
ice_common.png     ice_rare.png     ice_epic.png     ice_legend.png     ice_transcend.png
light_common.png   light_rare.png   light_epic.png   light_legend.png   light_transcend.png
dark_common.png    dark_rare.png    dark_epic.png    dark_legend.png    dark_transcend.png
poison_common.png  poison_rare.png  poison_epic.png  poison_legend.png  poison_transcend.png
```

클래스별(180장)까지 하려면 위 45개 각각 앞에 `warrior_` / `archer_` / `tanker_` / `healer_` 를 붙이세요.
