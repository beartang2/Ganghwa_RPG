"""아이콘 세트 생성기 — SVG 원본 2장에서 public/ 의 아이콘 파일을 전부 만든다.

  icons/icon-full.svg  상세 버전(불티·불씨·보석)  → 홈 화면·PWA·로그인 엠블럼용 PNG
  public/icon.svg      단순 버전(탭 16~32px용)    → favicon.ico, 그리고 최신 브라우저 탭에 그대로 쓰임

실행 (web/ 에서):
  pip install resvg-py pillow
  python3 icons/build.py
"""
import io
import re
from pathlib import Path

import resvg_py
from PIL import Image

WEB = Path(__file__).resolve().parent.parent
PUB = WEB / "public"
FULL = (WEB / "icons" / "icon-full.svg").read_text(encoding="utf-8")
SMALL = (PUB / "icon.svg").read_text(encoding="utf-8")


def render(svg: str, size: int) -> Image.Image:
    png = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


def full_bleed(svg: str) -> str:
    # 둥근 모서리를 없앤 정사각형 — iOS·안드로이드가 자기 모양으로 다시 잘라내므로 모서리까지 채워 둔다
    return svg.replace('rx="112"', 'rx="0"', 1)


def maskable(svg: str) -> str:
    # 마스커블 안전영역은 가운데 지름 80% 원. 바탕은 그대로 두고 전경(#art)만 80% 로 줄인다
    svg = full_bleed(svg)
    return svg.replace('<g id="art">', '<g id="art" transform="translate(256 256) scale(.8) translate(-256 -256)">', 1)


def no_spark(svg: str) -> str:
    # 16px 에서는 불티가 회색 얼룩으로 뭉개지므로 뺀다
    return re.sub(r'<g class="spark">.*?</g>', "", svg, flags=re.S)


outputs = {
    "apple-touch-icon.png": render(full_bleed(FULL), 180),
    "icon-192.png": render(FULL, 192),
    "icon-512.png": render(FULL, 512),
    "icon-mask.png": render(maskable(FULL), 512),
}
for name, im in outputs.items():
    im.save(PUB / name, optimize=True)
    print("wrote", name, im.size)

# favicon.ico — 16·32·48 레이어를 각각 따로 렌더해서 담는다 (큰 그림을 축소한 것보다 또렷함)
ico = {16: render(no_spark(SMALL), 16), 32: render(SMALL, 32), 48: render(SMALL, 48)}
ico[48].save(PUB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=[ico[16], ico[32]])
print("wrote favicon.ico", sorted(ico))
