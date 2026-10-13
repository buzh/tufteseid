
import numpy as np
from PIL import Image, ImageDraw, ImageFont

REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

BAND_VALUE = 10
INK = 255

SEP = " · "

RESOLUTION_TOKEN = "{res}"

CREDIT_TOKEN = "{credit}"

MAX_BAND_FRACTION = 0.4

BAR_TARGET_FRACTION = 0.18
MIN_BAR_PX = 24

def _font_size(width):
    return int(min(26, max(11, round(width / 70))))

def _text_width(draw, text, font):
    return draw.textlength(text, font=font)

def _ellipsize(draw, text, font, max_width):
    if _text_width(draw, text, font) <= max_width:
        return text
    cut = text
    while len(cut) > 1 and _text_width(draw, cut + "…", font) > max_width:
        cut = cut[:-1]
    return cut + "…"

def _wrap(draw, text, font, max_width):
    words = [w for w in text.split(" ") if w]
    if not words:
        return []
    lines, line = [], words[0]
    for word in words[1:]:
        nxt = f"{line} {word}"
        if _text_width(draw, nxt, font) <= max_width:
            line = nxt
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines

def _nice_metres(raw):
    power = 10 ** int(np.floor(np.log10(raw)))
    n = raw / power
    return (5 if n >= 5 else 2 if n >= 2 else 1) * power

def _plan_bar(metres_per_px, target_px):
    if not metres_per_px > 0 or not target_px > 0:
        return None
    metres = _nice_metres(target_px * metres_per_px)
    bar_px = metres / metres_per_px
    if bar_px < MIN_BAR_PX:
        return None
    return int(round(bar_px)), f"{int(round(metres))} m"

def _draw_bar(draw, x, y, bar_px, height):
    draw.rectangle([x, y, x + bar_px, y + height], outline=INK, width=1)
    step = bar_px / 4
    for i in (0, 2):
        draw.rectangle(
            [round(x + i * step), y, round(x + (i + 1) * step), y + height], fill=INK
        )

def compose(width, height, content, metres_per_px):