"""Write 1Ultra's own brand images at the paths Starnet's interface loads (no Starnet artwork is used)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BRAND = Path(__file__).resolve().parents[1] / 'station/frontend/assets/brand'
WORDMARK = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 54" width="320" height="54">'
            '<text x="160" y="42" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="44" '
            'font-weight="700" letter-spacing="6" fill="#000">1ULTRA</text></svg>\n')


def main():
    BRAND.mkdir(parents=True, exist_ok=True)
    (BRAND / 'starnet-wordmark.svg').write_text(WORDMARK)
    image = Image.new('RGBA', (560, 160), (0, 0, 0, 0)); draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=96)
    box = draw.textbbox((0, 0), '1ULTRA', font=font)
    x = (560 - (box[2] - box[0])) // 2 - box[0]; y = (160 - (box[3] - box[1])) // 2 - box[1]
    draw.text((x + 4, y + 4), '1ULTRA', font=font, fill=(0, 70, 90, 255))
    draw.text((x, y), '1ULTRA', font=font, fill=(90, 208, 255, 255))
    image.save(BRAND / 'starnet-logo.png')
    print(f'Wrote {BRAND}/starnet-wordmark.svg and starnet-logo.png')


if __name__ == '__main__':
    main()
