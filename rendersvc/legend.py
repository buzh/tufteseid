"""The provenance band, burnt into every frame.

A still is stamped in the browser at download time (`src/evidence/stamp.ts`),
but `createImageBitmap` throws on a WebM, so a loop is cited on the way out
instead. The client sends the lines — which facts a visualization answered to is
its rule and stays in one place — and this only typesets them. The lines arrive
with holes in them where a fact has to come off the record instead of out of the
request; `server.py`'s `legend_of` fills those, this one the resolution.

Two deliberate differences from `src/evidence/legend.ts`: the face is DejaVu
rather than Mulish, which the image has no npm build to take Mulish from; and
the layout is a stacked band rather than its two shedding columns. What matches
is what has to: the band sits over the bottom edge and never resizes the frame,
so the pixels stay registered to the bbox everywhere the band is not.
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFont

REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# legend.ts's band: near-black at 62 %, white ink.
BAND_VALUE = 10
BAND_ALPHA = 158
INK = 255

SEP = " · "

# Where the resolution lands in the line the client sent: the one fact it cannot
# know before the render, so it travels as a hole. The decimal separator travels
# with it, because the rest of the band is already in the reader's language and
# `0.50` next to `z 1,5` reads as a typo.
RESOLUTION_TOKEN = "{res}"

# Where the spot's author goes in the rights line the client worded. Filled from
# the record in `server.py`, never from the request: the band cannot be edited
# once it is in the pixels, so the name in it may not be the caller's to choose.
# Braced like the other hole for the same reason — nothing the app translates
# carries a literal brace, i18next's own placeholders are interpolated away
# before a line is sent, and substitution is one pass over the text.
CREDIT_TOKEN = "{credit}"

# Of the frame. Past it the link, then the scale bar, are dropped. The rights
# lines never are — they are the only part a licence actually requires.
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
    """Round down to 1, 2 or 5 × a power of ten."""
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
    """Four alternating segments. The dark ones are the band showing through."""
    draw.rectangle([x, y, x + bar_px, y + height], outline=INK, width=1)
    step = bar_px / 4
    for i in (0, 2):
        draw.rectangle(
            [round(x + i * step), y, round(x + (i + 1) * step), y + height], fill=INK
        )


def compose(width, height, content, metres_per_px):
    """The band as (top row, keep, add): `frame[top:] = frame[top:] * keep // 255
    + add`, one vectorised pass per frame. None when the frame is too small to
    carry a legend at all."""
    size = _font_size(width)
    pad = int(round(size * 0.7))
    line_h = int(round(size * 1.35))
    gap = int(round(size * 1.5))
    bar_h = max(4, int(round(size * 0.38)))
    content_w = width - pad * 2
    if content_w < size * 8:
        return None

    regular = ImageFont.truetype(REGULAR, size)
    semibold = ImageFont.truetype(BOLD, size)
    small = ImageFont.truetype(REGULAR, max(8, int(round(size * 0.9))))

    # A coverage mask, not a picture: `apply` blends it over each frame. Every
    # draw names INK, because PIL's default ink on an L image is 1, not white.
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)

    facts = list(content.get("facts") or [])
    resolution = content.get("resolutionFormat") or ""
    if resolution and metres_per_px > 0:
        decimal = content.get("decimal") or "."
        shown = f"{metres_per_px:.2f}".replace(".", decimal)
        facts.append(resolution.replace(RESOLUTION_TOKEN, shown))
    title = content.get("title") or ""
    head = title + (SEP + SEP.join(facts) if facts else "")

    rights = [r for r in (content.get("rights") or []) if r]
    link = content.get("link") or ""
    bar = _plan_bar(metres_per_px, width * BAR_TARGET_FRACTION)

    # Rights first: they set the floor the two optional rows are dropped against.
    body = []
    for line in rights:
        body.extend(_wrap(draw, line, regular, content_w))

    def band_height(rows, with_tail):
        return pad * 2 + line_h * (1 + rows + (1 if with_tail else 0))

    tail = bool(bar) or bool(link)
    if band_height(len(body), tail) > height * MAX_BAND_FRACTION:
        link = ""
        tail = bool(bar)
    if band_height(len(body), tail) > height * MAX_BAND_FRACTION:
        bar = None
        tail = False

    total = band_height(len(body), tail)
    if total >= height:
        return None

    top = height - total
    y = top + pad
    draw.text(
        (pad, y), _ellipsize(draw, head, semibold, content_w), font=semibold, fill=INK
    )
    y += line_h
    for line in body:
        draw.text((pad, y), line, font=regular, fill=INK)
        y += line_h
    if tail:
        x = pad
        if bar:
            bar_px, label = bar
            _draw_bar(draw, x, y + (line_h - bar_h) // 2, bar_px, bar_h)
            x += bar_px + int(round(size * 0.6))
            draw.text((x, y), label, font=small, fill=INK)
            x += int(round(_text_width(draw, label, small))) + gap
        if link:
            draw.text(
                (x, y),
                _ellipsize(draw, link, small, width - pad - x),
                font=small,
                fill=INK,
            )

    strip = np.asarray(mask, dtype=np.uint16)[top:]
    alpha = BAND_ALPHA + (255 - BAND_ALPHA) * strip // 255
    ink = (BAND_VALUE * (255 - strip) + INK * strip) // 255
    return top, (255 - alpha).astype(np.uint16), (ink * alpha // 255).astype(np.uint16)


def apply(frame, band):
    """In place, on a (H, W) uint8 frame."""
    top, keep, add = band
    region = frame[top:].astype(np.uint16)
    frame[top:] = np.minimum(region * keep // 255 + add, 255).astype(np.uint8)
