#!/usr/bin/env python3
"""Deterministic native-text 16:9 PDF deck builder for VyaparVani."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

PAGE_W = 960.0
PAGE_H = 540.0
MARGIN_X = 52.0
CONTENT_W = PAGE_W - 2 * MARGIN_X
MAX_PDF_BYTES = 10 * 1024 * 1024

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
FONT_MAP = {
    "VV-Regular": FONT_DIR / "DejaVuSans.ttf",
    "VV-Bold": FONT_DIR / "DejaVuSans-Bold.ttf",
    "VV-Italic": FONT_DIR / "DejaVuSans-Oblique.ttf",
    "VV-BoldItalic": FONT_DIR / "DejaVuSans-BoldOblique.ttf",
    "VV-Mono": FONT_DIR / "DejaVuSansMono.ttf",
}

PALETTE = {
    "bg": "#FAF6EE",
    "grid": "#EFE8DA",
    "surface": "#FFFFFF",
    "surface_alt": "#F7F2E7",
    "border": "#E1D7C4",
    "text": "#1F2A24",
    "body": "#36403A",
    "muted": "#6B6455",
    "accent": "#C7660A",
    "accent_soft": "#FBF1E3",
    "accent2": "#2F6F5E",
    "accent2_soft": "#EAF2EF",
}


def c_hex(val: str) -> colors.Color:
    return colors.HexColor(val)


def ty(y_top: float, height: float = 0.0) -> float:
    """Convert top-down coordinate to ReportLab bottom-left coordinate."""
    return PAGE_H - y_top - height


def register_fonts() -> None:
    for name, path in FONT_MAP.items():
        if not path.is_file():
            raise FileNotFoundError(f"Required font missing: {path}")
        pdfmetrics.registerFont(TTFont(name, str(path)))
    pdfmetrics.registerFontFamily(
        "VV",
        normal="VV-Regular",
        bold="VV-Bold",
        italic="VV-Italic",
        boldItalic="VV-BoldItalic",
    )


def make_style(
    name: str,
    font: str = "VV-Regular",
    size: float = 12.0,
    leading: float | None = None,
    color: str = PALETTE["text"],
    align: int = TA_LEFT,
) -> ParagraphStyle:
    return ParagraphStyle(
        name=name,
        fontName=font,
        fontSize=size,
        leading=leading if leading is not None else round(size * 1.38, 1),
        textColor=c_hex(color),
        alignment=align,
    )


def draw_para(
    cv: canvas.Canvas,
    text: str,
    x: float,
    y_top: float,
    max_w: float,
    style: ParagraphStyle,
    *,
    raw_markup: bool = False,
) -> float:
    content = text if raw_markup else escape(text)
    p = Paragraph(content, style)
    _, h = p.wrap(max_w, PAGE_H)
    p.drawOn(cv, x, ty(y_top, h))
    return h


def draw_round_box(
    cv: canvas.Canvas,
    x: float,
    y_top: float,
    w: float,
    h: float,
    *,
    fill: str | None = None,
    stroke: str | None = None,
    stroke_w: float = 1.0,
    radius: float = 10.0,
) -> None:
    cv.saveState()
    if fill:
        cv.setFillColor(c_hex(fill))
    if stroke:
        cv.setStrokeColor(c_hex(stroke))
        cv.setLineWidth(stroke_w)
    cv.roundRect(
        x,
        ty(y_top, h),
        w,
        h,
        radius,
        stroke=1 if stroke else 0,
        fill=1 if fill else 0,
    )
    cv.restoreState()


def draw_chrome(cv: canvas.Canvas, idx: int, total: int, slide: dict) -> None:
    # Base background
    cv.saveState()
    cv.setFillColor(c_hex(PALETTE["bg"]))
    cv.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # Subtle 48pt architectural grid
    cv.setStrokeColor(c_hex(PALETTE["grid"]))
    cv.setLineWidth(0.6)
    step = 48.0
    gx = step
    while gx < PAGE_W:
        cv.line(gx, 0, gx, PAGE_H)
        gx += step
    gy = step
    while gy < PAGE_H:
        cv.line(0, gy, PAGE_W, gy)
        gy += step

    # Soft decorative ambient corner accents
    cv.setFillColor(colors.Color(0.78, 0.40, 0.04, alpha=0.055))
    cv.circle(PAGE_W - 60, PAGE_H - 40, 120, stroke=0, fill=1)
    cv.setFillColor(colors.Color(0.18, 0.44, 0.37, alpha=0.045))
    cv.circle(PAGE_W - 150, PAGE_H - 15, 72, stroke=0, fill=1)

    # Bottom-left accent pill
    cv.setFillColor(c_hex(PALETTE["accent"]))
    cv.roundRect(MARGIN_X, 24, 30, 5, 2.5, stroke=0, fill=1)
    cv.setFillColor(c_hex(PALETTE["accent2"]))
    cv.roundRect(MARGIN_X + 35, 24, 14, 5, 2.5, stroke=0, fill=1)

    # Bottom-right page counter
    cv.setFont("VV-Mono", 9.5)
    cv.setFillColor(c_hex(PALETTE["muted"]))
    cv.drawRightString(PAGE_W - MARGIN_X, 22.5, f"{idx:02d} / {total:02d}")
    cv.restoreState()

    # Optional bottom sources footnote
    sources = slide.get("sources") or []
    if sources:
        parts = [f"[{i}] {s['title']}" for i, s in enumerate(sources, start=1)]
        src_text = "Sources: " + "  |  ".join(parts)
        st = make_style("src", font="VV-Regular", size=7.8, leading=10.5, color=PALETTE["muted"])
        p = Paragraph(escape(src_text), st)
        _, sh = p.wrap(CONTENT_W - 120, 40)
        p.drawOn(cv, MARGIN_X, 37.0)


def draw_kicker(cv: canvas.Canvas, text: str, x: float, y_top: float) -> float:
    st = make_style("kicker", font="VV-Bold", size=9.5, leading=12.0, color=PALETTE["accent"])
    pw = pdfmetrics.stringWidth(text.upper(), "VV-Bold", 9.5) + 20
    draw_round_box(
        cv,
        x,
        y_top,
        pw,
        20,
        fill=PALETTE["accent_soft"],
        stroke="#E8C9A4",
        stroke_w=0.8,
        radius=10,
    )
    draw_para(cv, text.upper(), x + 10, y_top + 4, pw - 16, st)
    return y_top + 28


def draw_icon(cv: canvas.Canvas, name: str, cx: float, cy_top: float, size: float, color: str) -> None:
    """Crisp vector icons without relying on emoji glyphs."""
    cy = PAGE_H - cy_top
    r = size * 0.5
    cv.saveState()
    cv.setStrokeColor(c_hex(color))
    cv.setFillColor(c_hex(color))
    cv.setLineWidth(1.7)
    cv.setLineCap(1)
    cv.setLineJoin(1)

    if name == "phone":
        # Microphone capsule + stand (voice capture)
        cv.roundRect(cx - r * 0.28, cy - r * 0.05, r * 0.56, r * 0.85, r * 0.28, stroke=1, fill=0)
        cv.arc(cx - r * 0.52, cy - r * 0.35, cx + r * 0.52, cy + r * 0.45, 180, 180)
        cv.line(cx, cy - r * 0.35, cx, cy - r * 0.68)
        cv.line(cx - r * 0.35, cy - r * 0.68, cx + r * 0.35, cy - r * 0.68)
    elif name == "cpu":
        s = r * 0.55
        cv.roundRect(cx - s, cy - s, 2 * s, 2 * s, 3, stroke=1, fill=0)
        inner = s * 0.48
        cv.rect(cx - inner, cy - inner, 2 * inner, 2 * inner, stroke=1, fill=0)
        for off in (-s * 0.45, s * 0.45):
            cv.line(cx + off, cy + s, cx + off, cy + s + 4)
            cv.line(cx + off, cy - s, cx + off, cy - s - 4)
            cv.line(cx - s, cy + off, cx - s - 4, cy + off)
            cv.line(cx + s, cy + off, cx + s + 4, cy + off)
    elif name == "eye":
        p = cv.beginPath()
        p.moveTo(cx - r * 0.8, cy)
        p.curveTo(cx - r * 0.35, cy + r * 0.55, cx + r * 0.35, cy + r * 0.55, cx + r * 0.8, cy)
        p.curveTo(cx + r * 0.35, cy - r * 0.55, cx - r * 0.35, cy - r * 0.55, cx - r * 0.8, cy)
        cv.drawPath(p, stroke=1, fill=0)
        cv.circle(cx, cy, r * 0.24, stroke=1, fill=1)
    elif name == "check":
        cv.circle(cx, cy, r * 0.72, stroke=1, fill=0)
        cv.line(cx - r * 0.32, cy - r * 0.04, cx - r * 0.06, cy - r * 0.30)
        cv.line(cx - r * 0.06, cy - r * 0.30, cx + r * 0.36, cy + r * 0.26)
    elif name == "message":
        cv.roundRect(cx - r * 0.72, cy - r * 0.42, r * 1.44, r * 1.0, 4, stroke=1, fill=0)
        cv.line(cx - r * 0.35, cy + r * 0.16, cx + r * 0.35, cy + r * 0.16)
        cv.line(cx - r * 0.35, cy - r * 0.08, cx + r * 0.15, cy - r * 0.08)
        cv.line(cx - r * 0.25, cy - r * 0.42, cx - r * 0.42, cy - r * 0.72)
        cv.line(cx - r * 0.42, cy - r * 0.72, cx - r * 0.02, cy - r * 0.42)
    elif name == "shield":
        p = cv.beginPath()
        p.moveTo(cx, cy + r * 0.78)
        p.lineTo(cx + r * 0.66, cy + r * 0.48)
        p.lineTo(cx + r * 0.58, cy - r * 0.18)
        p.curveTo(cx + r * 0.45, cy - r * 0.56, cx + r * 0.12, cy - r * 0.72, cx, cy - r * 0.8)
        p.curveTo(cx - r * 0.12, cy - r * 0.72, cx - r * 0.45, cy - r * 0.56, cx - r * 0.58, cy - r * 0.18)
        p.lineTo(cx - r * 0.66, cy + r * 0.48)
        p.close()
        cv.drawPath(p, stroke=1, fill=0)
        cv.line(cx - r * 0.24, cy - r * 0.04, cx - r * 0.04, cy - r * 0.24)
        cv.line(cx - r * 0.04, cy - r * 0.24, cx + r * 0.28, cy + r * 0.18)
    elif name == "gauge":
        cv.arc(cx - r * 0.76, cy - r * 0.68, cx + r * 0.76, cy + r * 0.76, 0, 180)
        cv.line(cx - r * 0.76, cy + r * 0.04, cx + r * 0.76, cy + r * 0.04)
        cv.line(cx, cy + r * 0.04, cx + r * 0.42, cy + r * 0.46)
        cv.circle(cx, cy + r * 0.04, r * 0.12, stroke=0, fill=1)
    else:
        cv.circle(cx, cy, r * 0.55, stroke=1, fill=0)

    cv.restoreState()


def render_cover(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 104.0
    if slide.get("kicker"):
        y = draw_kicker(cv, slide["kicker"], MARGIN_X, y) + 12

    t_style = make_style("cover_t", font="VV-Bold", size=50, leading=56, color=PALETTE["text"])
    th = draw_para(cv, slide["title"], MARGIN_X, y, 760, t_style)
    y += th + 14

    # Accent bar
    draw_round_box(cv, MARGIN_X, y, 72, 5, fill=PALETTE["accent"], radius=2.5)
    y += 22

    sub_style = make_style("cover_s", font="VV-Regular", size=15.5, leading=23.5, color=PALETTE["body"])
    sh = draw_para(cv, slide.get("subtitle", ""), MARGIN_X, y, 720, sub_style)
    y += sh + 34

    # Subtle capability chips (driven by deck.json)
    tone_map = {
        "accent": (PALETTE["accent_soft"], PALETTE["accent"]),
        "accent2": (PALETTE["accent2_soft"], PALETTE["accent2"]),
        "neutral": (PALETTE["surface"], PALETTE["text"]),
    }
    default_tones = ["accent", "accent2", "neutral"]
    raw_chips = slide.get("chips") or [
        {"label": "Hinglish + Devanagari", "tone": "accent"},
        {"label": "No-key Demo Mode", "tone": "accent2"},
        {"label": "26/26 Golden Eval", "tone": "neutral"},
    ]
    cx = MARGIN_X
    for i, chip in enumerate(raw_chips):
        if isinstance(chip, str):
            label = chip
            tone = default_tones[i % len(default_tones)]
        else:
            label = chip.get("label", "")
            tone = chip.get("tone", default_tones[i % len(default_tones)])
        if not label:
            continue
        bg, fg = tone_map.get(tone, (PALETTE["surface"], PALETTE["text"]))
        w = pdfmetrics.stringWidth(label, "VV-Bold", 9.5) + 24
        draw_round_box(cv, cx, y, w, 26, fill=bg, stroke=PALETTE["border"], stroke_w=0.9, radius=13)
        st = make_style(f"chip_c_{i}", font="VV-Bold", size=9.5, leading=12, color=fg)
        draw_para(cv, label, cx + 12, y + 7, w - 20, st)
        cx += w + 12


def render_statement(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 104.0
    if slide.get("kicker"):
        y = draw_kicker(cv, slide["kicker"], MARGIN_X, y) + 14

    title = slide["title"]
    hl = slide.get("highlight", "")
    if hl and hl in title:
        escaped_title = escape(title)
        escaped_hl = escape(hl)
        markup = escaped_title.replace(
            escaped_hl, f'<font color="{PALETTE["accent"]}">{escaped_hl}</font>', 1
        )
        raw = True
    else:
        markup = title
        raw = False

    t_style = make_style("stmt_t", font="VV-Bold", size=35, leading=43, color=PALETTE["text"])
    th = draw_para(cv, markup, MARGIN_X, y, 800, t_style, raw_markup=raw)
    y += th + 20

    draw_round_box(cv, MARGIN_X, y, 56, 4, fill=PALETTE["accent2"], radius=2)
    y += 20

    b_style = make_style("stmt_b", font="VV-Regular", size=15.5, leading=23.5, color=PALETTE["body"])
    draw_para(cv, slide.get("body", ""), MARGIN_X, y, 780, b_style)


def render_stats(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 44.0
    t_style = make_style("stats_t", font="VV-Bold", size=25, leading=31, color=PALETTE["text"])
    th = draw_para(cv, slide["title"], MARGIN_X, y, CONTENT_W, t_style)
    y += th + 10

    if slide.get("body"):
        b_style = make_style("stats_b", font="VV-Regular", size=12.5, leading=18.5, color=PALETTE["body"])
        bh = draw_para(cv, slide["body"], MARGIN_X, y, CONTENT_W, b_style)
        y += bh + 18
    else:
        y += 10

    stats = slide.get("stats", [])
    cols = 2
    gap_x = 20.0
    gap_y = 18.0
    card_w = (CONTENT_W - gap_x) / cols
    avail_h = 468.0 - y
    card_h = min(132.0, (avail_h - gap_y) / 2.0)

    val_colors = [PALETTE["accent"], PALETTE["accent2"], PALETTE["text"], PALETTE["accent"]]
    for i, st_item in enumerate(stats[:4]):
        col = i % cols
        row = i // cols
        cx = MARGIN_X + col * (card_w + gap_x)
        cy = y + row * (card_h + gap_y)

        draw_round_box(
            cv, cx, cy, card_w, card_h, fill=PALETTE["surface"], stroke=PALETTE["border"], stroke_w=1.0, radius=12
        )
        # Left vertical accent strip
        draw_round_box(cv, cx + 14, cy + 18, 4, card_h - 36, fill=val_colors[i % len(val_colors)], radius=2)

        v_style = make_style("sv", font="VV-Bold", size=34, leading=38, color=val_colors[i % len(val_colors)])
        vh = draw_para(cv, st_item["value"], cx + 30, cy + 16, card_w - 46, v_style)

        l_style = make_style("sl", font="VV-Regular", size=12.0, leading=17.0, color=PALETTE["body"])
        draw_para(cv, st_item["label"], cx + 30, cy + 16 + vh + 6, card_w - 46, l_style)


def render_split(cv: canvas.Canvas, slide: dict, root: Path) -> None:
    left_w = 432.0
    right_x = MARGIN_X + left_w + 26.0
    right_w = CONTENT_W - left_w - 26.0

    y = 44.0
    t_style = make_style("split_t", font="VV-Bold", size=24, leading=30, color=PALETTE["text"])
    th = draw_para(cv, slide["title"], MARGIN_X, y, left_w, t_style)
    y += th + 14

    if slide.get("body"):
        b_style = make_style("split_b", font="VV-Regular", size=11.5, leading=17.2, color=PALETTE["body"])
        bh = draw_para(cv, slide["body"], MARGIN_X, y, left_w, b_style)
        y += bh + 18

    bullet_st = make_style("split_bl", font="VV-Bold", size=11.2, leading=16.0, color=PALETTE["text"])
    for b in slide.get("bullets", []):
        draw_round_box(
            cv, MARGIN_X, y, left_w, 34, fill=PALETTE["surface"], stroke=PALETTE["border"], stroke_w=0.8, radius=8
        )
        cv.saveState()
        cv.setFillColor(c_hex(PALETTE["accent"]))
        cv.circle(MARGIN_X + 15, ty(y + 17), 3.5, stroke=0, fill=1)
        cv.restoreState()
        bh = draw_para(cv, b, MARGIN_X + 27, y + 9, left_w - 38, bullet_st)
        y += max(34.0, bh + 16) + 8

    # Right frame: real UI screenshot (must exist)
    img_rel = slide.get("image", "")
    img_path = (root / img_rel) if img_rel else Path("")
    if not img_rel or not img_path.is_file():
        raise FileNotFoundError(f"Slide 4 UI screenshot missing: {img_path}")

    frame_top = 40.0
    frame_h = 442.0
    draw_round_box(
        cv,
        right_x,
        frame_top,
        right_w,
        frame_h,
        fill=PALETTE["surface"],
        stroke=PALETTE["border"],
        stroke_w=1.2,
        radius=12,
    )

    cap_h = 26.0
    pad = 10.0
    inner_w = right_w - 2 * pad
    inner_h = frame_h - 2 * pad - cap_h

    with Image.open(img_path) as im:
        iw, ih = im.size
        scale = min(inner_w / iw, inner_h / ih)
        draw_w = iw * scale
        draw_h = ih * scale
        ix = right_x + pad + (inner_w - draw_w) / 2.0
        iy_top = frame_top + pad + (inner_h - draw_h) / 2.0
        cv.drawImage(
            ImageReader(im),
            ix,
            ty(iy_top, draw_h),
            width=draw_w,
            height=draw_h,
            preserveAspectRatio=True,
            mask="auto",
        )
        cv.saveState()
        cv.setStrokeColor(c_hex(PALETTE["border"]))
        cv.setLineWidth(0.7)
        cv.rect(ix, ty(iy_top, draw_h), draw_w, draw_h, stroke=1, fill=0)
        cv.restoreState()

    caption = slide.get("imageCaption", "")
    if caption:
        cap_st = make_style(
            "img_cap", font="VV-Italic", size=8.8, leading=11.5, color=PALETTE["muted"], align=TA_CENTER
        )
        draw_para(cv, caption, right_x + 10, frame_top + frame_h - cap_h + 4, right_w - 20, cap_st)


def render_diagram(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 48.0
    t_style = make_style("diag_t", font="VV-Bold", size=26, leading=32, color=PALETTE["text"])
    th = draw_para(cv, slide["title"], MARGIN_X, y, CONTENT_W, t_style)
    y += th + 54

    diag = slide.get("diagram", {})
    nodes = diag.get("nodes", [])
    hl_id = diag.get("highlight", "")
    n = len(nodes)
    gap = 28.0
    card_w = (CONTENT_W - gap * (n - 1)) / n
    card_h = 216.0

    for i, node in enumerate(nodes):
        cx = MARGIN_X + i * (card_w + gap)
        is_hl = node.get("id") == hl_id
        fill = PALETTE["accent_soft"] if is_hl else PALETTE["surface"]
        stroke = PALETTE["accent"] if is_hl else PALETTE["border"]
        sw = 1.8 if is_hl else 1.0
        draw_round_box(cv, cx, y, card_w, card_h, fill=fill, stroke=stroke, stroke_w=sw, radius=12)

        # Step badge
        badge_bg = PALETTE["accent"] if is_hl else PALETTE["accent2"]
        draw_round_box(cv, cx + 16, y + 16, 32, 20, fill=badge_bg, radius=10)
        bst = make_style("step_n", font="VV-Bold", size=9.5, leading=11, color="#FFFFFF", align=TA_CENTER)
        draw_para(cv, f"0{i+1}", cx + 16, y + 20, 32, bst)

        # Icon circle
        icon_cx = cx + card_w / 2.0
        icon_cy = y + 72.0
        cv.saveState()
        cv.setFillColor(c_hex("#FFFFFF" if is_hl else PALETTE["surface_alt"]))
        cv.setStrokeColor(c_hex(PALETTE["accent"] if is_hl else PALETTE["accent2"]))
        cv.setLineWidth(1.0)
        cv.circle(icon_cx, ty(icon_cy), 24, stroke=1, fill=1)
        cv.restoreState()
        draw_icon(cv, node.get("icon", ""), icon_cx, icon_cy, 24, PALETTE["accent"] if is_hl else PALETTE["accent2"])

        lst = make_style("node_l", font="VV-Bold", size=14.5, leading=18, color=PALETTE["text"], align=TA_CENTER)
        lh = draw_para(cv, node["label"], cx + 12, y + 114, card_w - 24, lst)

        bst2 = make_style("node_b", font="VV-Regular", size=10.8, leading=15.5, color=PALETTE["body"], align=TA_CENTER)
        draw_para(cv, node["body"], cx + 12, y + 114 + lh + 8, card_w - 24, bst2)

        # Connecting arrow to next node
        if i < n - 1:
            ax1 = cx + card_w + 4
            ax2 = cx + card_w + gap - 4
            ay = ty(y + card_h / 2.0)
            cv.saveState()
            cv.setStrokeColor(c_hex(PALETTE["accent"]))
            cv.setFillColor(c_hex(PALETTE["accent"]))
            cv.setLineWidth(2.0)
            cv.line(ax1, ay, ax2 - 5, ay)
            p = cv.beginPath()
            p.moveTo(ax2, ay)
            p.lineTo(ax2 - 7, ay + 4.5)
            p.lineTo(ax2 - 7, ay - 4.5)
            p.close()
            cv.drawPath(p, stroke=0, fill=1)
            cv.restoreState()


def render_chart(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 40.0
    t_style = make_style("ch_t", font="VV-Bold", size=24.5, leading=30, color=PALETTE["text"])
    th = draw_para(cv, slide["title"], MARGIN_X, y, CONTENT_W, t_style)
    y += th + 8

    if slide.get("body"):
        b_style = make_style("ch_b", font="VV-Regular", size=11.3, leading=16.5, color=PALETTE["body"])
        bh = draw_para(cv, slide["body"], MARGIN_X, y, CONTENT_W, b_style)
        y += bh + 14

    chart = slide.get("chart", {})
    labels = chart.get("labels", [])
    series = chart.get("series", [])
    values = series[0].get("values", []) if series else []
    series_name = series[0].get("name", "Accuracy") if series else "Accuracy"
    unit = chart.get("unit", "%")
    hl_idx = chart.get("highlight", -1)

    card_h = 218.0
    draw_round_box(
        cv, MARGIN_X, y, CONTENT_W, card_h, fill=PALETTE["surface"], stroke=PALETTE["border"], stroke_w=1.0, radius=12
    )

    hdr_st = make_style("ch_hdr", font="VV-Bold", size=10.5, leading=14, color=PALETTE["muted"])
    draw_para(cv, f"{series_name} ({unit})", MARGIN_X + 20, y + 14, 400, hdr_st)

    label_x = MARGIN_X + 20
    label_w = 225.0
    bar_x = label_x + label_w + 12
    bar_max_w = 460.0
    val_x = bar_x + bar_max_w + 16

    # Percentage gridlines
    grid_top = y + 40
    grid_bot = y + card_h - 32
    cv.saveState()
    for pct in (0, 25, 50, 75, 100):
        gx = bar_x + bar_max_w * (pct / 100.0)
        cv.setStrokeColor(c_hex("#E8E0D1"))
        cv.setLineWidth(0.8)
        cv.line(gx, ty(grid_top), gx, ty(grid_bot))
        cv.setFont("VV-Mono", 8.5)
        cv.setFillColor(c_hex(PALETTE["muted"]))
        cv.drawCentredString(gx, ty(grid_bot + 14), f"{pct}%")
    cv.restoreState()

    row_area_h = grid_bot - grid_top - 10
    row_step = row_area_h / max(len(labels), 1)
    bar_h = 26.0

    for idx, (lbl, val) in enumerate(zip(labels, values)):
        ry = grid_top + 10 + idx * row_step + (row_step - bar_h) / 2.0
        is_hl = idx == hl_idx
        bar_col = PALETTE["accent"] if is_hl else PALETTE["accent2"]

        lst = make_style("bar_l", font="VV-Bold" if is_hl else "VV-Regular", size=11.0, leading=14, color=PALETTE["text"])
        draw_para(cv, lbl, label_x, ry + 5, label_w, lst)

        # Track
        draw_round_box(cv, bar_x, ry, bar_max_w, bar_h, fill="#F3EDE0", radius=6)
        # Value bar
        fill_w = max(8.0, bar_max_w * min(max(float(val), 0.0), 100.0) / 100.0)
        draw_round_box(cv, bar_x, ry, fill_w, bar_h, fill=bar_col, radius=6)

        vst = make_style("bar_v", font="VV-Bold", size=11.0, leading=14, color=bar_col)
        draw_para(cv, f"{int(val) if float(val).is_integer() else val}%", val_x, ry + 5, 95, vst)

    # Dual-eval distinction panel
    comp = chart.get("comparison", {})
    if comp:
        cy = y + card_h + 14
        panel_w = (CONTENT_W - 18) / 2.0
        panel_h = 70.0

        draw_round_box(
            cv, MARGIN_X, cy, panel_w, panel_h, fill=PALETTE["accent2_soft"], stroke=PALETTE["accent2"], stroke_w=1.0, radius=10
        )
        t1 = make_style("c1t", font="VV-Bold", size=10.5, leading=13, color=PALETTE["accent2"])
        b1 = make_style("c1b", font="VV-Regular", size=10.0, leading=14, color=PALETTE["text"])
        draw_para(cv, "Demo Regex Eval (CI-verified)", MARGIN_X + 14, cy + 11, panel_w - 28, t1)
        draw_para(cv, comp.get("demo", ""), MARGIN_X + 14, cy + 29, panel_w - 28, b1)

        px2 = MARGIN_X + panel_w + 18
        draw_round_box(
            cv, px2, cy, panel_w, panel_h, fill=PALETTE["accent_soft"], stroke=PALETTE["accent"], stroke_w=1.0, radius=10
        )
        t2 = make_style("c2t", font="VV-Bold", size=10.5, leading=13, color=PALETTE["accent"])
        b2 = make_style("c2b", font="VV-Regular", size=10.0, leading=14, color=PALETTE["text"])
        draw_para(cv, "Live gpt-4o-mini Eval", px2 + 14, cy + 11, panel_w - 28, t2)
        draw_para(cv, comp.get("live", ""), px2 + 14, cy + 29, panel_w - 28, b2)


def render_features(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 48.0
    t_style = make_style("feat_t", font="VV-Bold", size=26, leading=32, color=PALETTE["text"])
    th = draw_para(cv, slide["title"], MARGIN_X, y, CONTENT_W, t_style)
    y += th + 26

    items = slide.get("items", [])
    top_items = items[:3]
    bot_items = items[3:]

    gap = 20.0
    top_w = (CONTENT_W - 2 * gap) / 3.0
    top_h = 176.0
    for i, it in enumerate(top_items):
        cx = MARGIN_X + i * (top_w + gap)
        draw_round_box(cv, cx, y, top_w, top_h, fill=PALETTE["surface"], stroke=PALETTE["border"], stroke_w=1.0, radius=12)
        col = PALETTE["accent"] if i % 2 == 0 else PALETTE["accent2"]
        draw_round_box(cv, cx + 18, y + 18, 38, 38, fill=PALETTE["surface_alt"], stroke=PALETTE["border"], stroke_w=0.8, radius=10)
        draw_icon(cv, it.get("icon", ""), cx + 37, y + 37, 20, col)
        tt = make_style("ft_t", font="VV-Bold", size=14.0, leading=18, color=PALETTE["text"])
        bb = make_style("ft_b", font="VV-Regular", size=11.5, leading=16.5, color=PALETTE["body"])
        hth = draw_para(cv, it["title"], cx + 18, y + 70, top_w - 36, tt)
        draw_para(cv, it["body"], cx + 18, y + 70 + hth + 8, top_w - 36, bb)

    if bot_items:
        by = y + top_h + 20
        bot_w = (CONTENT_W - gap) / 2.0
        bot_h = 160.0
        for i, it in enumerate(bot_items):
            cx = MARGIN_X + i * (bot_w + gap)
            draw_round_box(cv, cx, by, bot_w, bot_h, fill=PALETTE["surface"], stroke=PALETTE["border"], stroke_w=1.0, radius=12)
            col = PALETTE["accent2"] if i % 2 == 0 else PALETTE["accent"]
            draw_round_box(cv, cx + 20, by + 20, 38, 38, fill=PALETTE["surface_alt"], stroke=PALETTE["border"], stroke_w=0.8, radius=10)
            draw_icon(cv, it.get("icon", ""), cx + 39, by + 39, 20, col)
            tt = make_style("ft_t2", font="VV-Bold", size=14.5, leading=18, color=PALETTE["text"])
            bb = make_style("ft_b2", font="VV-Regular", size=11.8, leading=17.0, color=PALETTE["body"])
            hth = draw_para(cv, it["title"], cx + 20, by + 72, bot_w - 40, tt)
            draw_para(cv, it["body"], cx + 20, by + 72 + hth + 8, bot_w - 40, bb)


def render_table(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 40.0
    t_style = make_style("tbl_t", font="VV-Bold", size=24, leading=30, color=PALETTE["text"])
    th = draw_para(cv, slide["title"], MARGIN_X, y, CONTENT_W, t_style)
    y += th + 16

    tbl = slide.get("table", {})
    cols = tbl.get("columns", [])
    rows = tbl.get("rows", [])

    if len(cols) == 4:
        col_widths = [128.0, 206.0, 306.0, 216.0]
    else:
        w = CONTENT_W / max(len(cols), 1)
        col_widths = [w] * len(cols)

    # Header
    hdr_h = 34.0
    draw_round_box(cv, MARGIN_X, y, CONTENT_W, hdr_h, fill=PALETTE["text"], radius=8)
    hdr_st = make_style("th", font="VV-Bold", size=10.2, leading=13, color="#FFFFFF")
    cx = MARGIN_X
    for col_txt, cw in zip(cols, col_widths):
        draw_para(cv, col_txt, cx + 10, y + 10, cw - 20, hdr_st)
        cx += cw
    y += hdr_h + 4

    # Rows with dynamic Paragraph height
    cell_bold = make_style("tcb", font="VV-Bold", size=10.2, leading=14.0, color=PALETTE["text"])
    cell_reg = make_style("tcr", font="VV-Regular", size=9.8, leading=13.8, color=PALETTE["body"])

    for r_idx, row in enumerate(rows):
        heights = []
        paras = []
        for c_idx, (val, cw) in enumerate(zip(row, col_widths)):
            st = cell_bold if c_idx == 0 else cell_reg
            p = Paragraph(escape(val), st)
            _, ph = p.wrap(cw - 20, 200)
            paras.append((p, ph, cw))
            heights.append(ph)
        row_h = max(heights) + 18.0
        bg = PALETTE["surface"] if r_idx % 2 == 0 else PALETTE["surface_alt"]
        draw_round_box(cv, MARGIN_X, y, CONTENT_W, row_h, fill=bg, stroke=PALETTE["border"], stroke_w=0.8, radius=6)

        cx = MARGIN_X
        for c_idx, (p, ph, cw) in enumerate(paras):
            p.drawOn(cv, cx + 10, ty(y + (row_h - ph) / 2.0, ph))
            if c_idx < len(paras) - 1:
                cv.saveState()
                cv.setStrokeColor(c_hex("#EAE2D3"))
                cv.setLineWidth(0.6)
                cv.line(cx + cw, ty(y + 6), cx + cw, ty(y + row_h - 6))
                cv.restoreState()
            cx += cw
        y += row_h + 6

    callout = slide.get("callout", "")
    if callout:
        y += 8
        st = make_style("callout", font="VV-Regular", size=10.2, leading=14.8, color=PALETTE["text"])
        p = Paragraph(f'<b>Outage &amp; Cost Safeguard:</b> {escape(callout)}', st)
        _, ch = p.wrap(CONTENT_W - 36, 120)
        box_h = ch + 22.0
        draw_round_box(
            cv,
            MARGIN_X,
            y,
            CONTENT_W,
            box_h,
            fill=PALETTE["accent_soft"],
            stroke=PALETTE["accent"],
            stroke_w=1.2,
            radius=10,
        )
        draw_round_box(cv, MARGIN_X + 10, y + 10, 4, box_h - 20, fill=PALETTE["accent"], radius=2)
        p.drawOn(cv, MARGIN_X + 24, ty(y + 11, ch))


def render_metric(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 48.0
    if slide.get("kicker"):
        y = draw_kicker(cv, slide["kicker"], MARGIN_X, y) + 10

    t_style = make_style("met_t", font="VV-Bold", size=27, leading=33, color=PALETTE["text"])
    th = draw_para(cv, slide["title"], MARGIN_X, y, CONTENT_W, t_style)
    y += th + 24

    stats = slide.get("stats", [])
    gap = 20.0
    card_w = (CONTENT_W - gap * (len(stats) - 1)) / max(len(stats), 1)
    card_h = 178.0
    colors_cycle = [PALETTE["accent"], PALETTE["accent2"], PALETTE["text"]]

    for i, st_item in enumerate(stats):
        cx = MARGIN_X + i * (card_w + gap)
        col = colors_cycle[i % len(colors_cycle)]
        draw_round_box(cv, cx, y, card_w, card_h, fill=PALETTE["surface"], stroke=PALETTE["border"], stroke_w=1.0, radius=12)
        draw_round_box(cv, cx + 20, y + 18, 44, 4, fill=col, radius=2)
        vst = make_style("mv", font="VV-Bold", size=42, leading=46, color=col)
        vh = draw_para(cv, st_item["value"], cx + 20, y + 34, card_w - 40, vst)
        lst = make_style("ml", font="VV-Regular", size=12.0, leading=17.0, color=PALETTE["body"])
        draw_para(cv, st_item["label"], cx + 20, y + 34 + vh + 10, card_w - 40, lst)

    y += card_h + 24
    if slide.get("body"):
        bst = make_style("mb", font="VV-Regular", size=13.0, leading=19.5, color=PALETTE["body"])
        draw_para(cv, slide["body"], MARGIN_X, y, CONTENT_W, bst)


def render_timeline(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 48.0
    t_style = make_style("tl_t", font="VV-Bold", size=25, leading=31, color=PALETTE["text"])
    th = draw_para(cv, slide["title"], MARGIN_X, y, CONTENT_W, t_style)
    y += th + 34

    items = slide.get("items", [])
    n = len(items)
    gap = 18.0
    card_w = (CONTENT_W - gap * (n - 1)) / max(n, 1)

    # Horizontal timeline rail
    rail_y = y + 15.0
    cv.saveState()
    cv.setStrokeColor(c_hex(PALETTE["border"]))
    cv.setLineWidth(2.5)
    cv.line(MARGIN_X + 20, ty(rail_y), PAGE_W - MARGIN_X - 20, ty(rail_y))
    cv.restoreState()

    card_top = y + 48.0
    card_h = 264.0
    for i, it in enumerate(items):
        cx = MARGIN_X + i * (card_w + gap)
        is_now = i == 0
        pill_bg = PALETTE["accent"] if is_now else PALETTE["accent2"]
        pill_w = max(72.0, pdfmetrics.stringWidth(it["tag"], "VV-Bold", 10.0) + 26)
        draw_round_box(cv, cx + 14, y + 3, pill_w, 24, fill=pill_bg, radius=12)
        pst = make_style("tl_tag", font="VV-Bold", size=10.0, leading=12, color="#FFFFFF", align=TA_CENTER)
        draw_para(cv, it["tag"], cx + 14, y + 9, pill_w, pst)

        draw_round_box(
            cv,
            cx,
            card_top,
            card_w,
            card_h,
            fill=PALETTE["accent_soft"] if is_now else PALETTE["surface"],
            stroke=PALETTE["accent"] if is_now else PALETTE["border"],
            stroke_w=1.4 if is_now else 1.0,
            radius=12,
        )
        tt = make_style("tl_ct", font="VV-Bold", size=13.5, leading=18.0, color=PALETTE["text"])
        bb = make_style("tl_cb", font="VV-Regular", size=11.2, leading=16.5, color=PALETTE["body"])
        hth = draw_para(cv, it["title"], cx + 16, card_top + 20, card_w - 32, tt)
        draw_para(cv, it["body"], cx + 16, card_top + 20 + hth + 12, card_w - 32, bb)


def render_quote(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    box_x = 86.0
    box_y = 112.0
    box_w = PAGE_W - 2 * box_x
    box_h = 290.0

    draw_round_box(
        cv, box_x, box_y, box_w, box_h, fill=PALETTE["surface"], stroke=PALETTE["border"], stroke_w=1.2, radius=16
    )
    draw_round_box(cv, box_x + 28, box_y + 28, 52, 5, fill=PALETTE["accent"], radius=2.5)

    cv.saveState()
    cv.setFont("VV-Bold", 58)
    cv.setFillColor(c_hex(PALETTE["accent"]))
    cv.drawString(box_x + 32, ty(box_y + 92), "“")
    cv.restoreState()

    q_st = make_style("q_txt", font="VV-Bold", size=27.0, leading=36.0, color=PALETTE["text"])
    qh = draw_para(cv, slide["quote"], box_x + 42, box_y + 104, box_w - 84, q_st)

    a_st = make_style("q_auth", font="VV-Regular", size=13.5, leading=18.5, color=PALETTE["accent2"])
    draw_para(cv, f"— {slide.get('author', '')}", box_x + 42, box_y + 104 + qh + 26, box_w - 84, a_st)


def render_closing(cv: canvas.Canvas, slide: dict, _root: Path) -> None:
    y = 132.0
    draw_round_box(cv, (PAGE_W - 72) / 2.0, y, 72, 5, fill=PALETTE["accent"], radius=2.5)
    y += 28

    t_st = make_style("cl_t", font="VV-Bold", size=38, leading=44, color=PALETTE["text"], align=TA_CENTER)
    th = draw_para(cv, slide["title"], MARGIN_X + 40, y, CONTENT_W - 80, t_st)
    y += th + 20

    s_st = make_style("cl_s", font="VV-Regular", size=14.5, leading=22.0, color=PALETTE["body"], align=TA_CENTER)
    sh = draw_para(cv, slide.get("subtitle", ""), MARGIN_X + 70, y, CONTENT_W - 140, s_st)
    y += sh + 34

    cmd = slide.get("command", "docker compose up")
    cmd_w = pdfmetrics.stringWidth(cmd, "VV-Mono", 12.0) + 44
    cmd_x = (PAGE_W - cmd_w) / 2.0
    draw_round_box(cv, cmd_x, y, cmd_w, 36, fill=PALETTE["text"], radius=18)
    cst = make_style("cl_cmd", font="VV-Mono", size=12.0, leading=15, color="#FAF6EE", align=TA_CENTER)
    draw_para(cv, cmd, cmd_x, y + 10, cmd_w, cst)


RENDERERS = {
    "cover": render_cover,
    "statement": render_statement,
    "stats": render_stats,
    "split": render_split,
    "diagram": render_diagram,
    "chart": render_chart,
    "features": render_features,
    "table": render_table,
    "metric": render_metric,
    "timeline": render_timeline,
    "quote": render_quote,
    "closing": render_closing,
}


def build_deck(deck_path: Path, out_path: Path) -> None:
    register_fonts()
    deck = json.loads(deck_path.read_text(encoding="utf-8"))
    slides = deck.get("slides", [])
    if len(slides) != 12:
        raise ValueError(f"Expected 12 slides in {deck_path}, got {len(slides)}")

    root = deck_path.resolve().parent.parent
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cv = canvas.Canvas(str(out_path), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    cv.setTitle(deck.get("title", "VyaparVani"))
    cv.setAuthor("VyaparVani")
    cv.setSubject("VyaparVani — Scaler x Wispr Flow Round 2 Deck")

    total = len(slides)
    for idx, slide in enumerate(slides, start=1):
        layout = slide.get("layout", "")
        renderer = RENDERERS.get(layout)
        if renderer is None:
            raise ValueError(f"Unsupported slide layout on slide {idx}: {layout!r}")
        draw_chrome(cv, idx, total, slide)
        renderer(cv, slide, root)
        cv.showPage()

    cv.save()

    size = out_path.stat().st_size
    if size > MAX_PDF_BYTES:
        raise ValueError(f"Generated PDF {out_path} exceeds 10 MB limit ({size} bytes)")
    print(f"Built {out_path} ({total} slides, {size} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build VyaparVani native-text PDF deck.")
    parser.add_argument("--deck", default="decks/vyaparvani-idea.deck.json", help="Path to deck JSON")
    parser.add_argument("--output", default="vyaparvani-idea.pdf", help="Output PDF path")
    args = parser.parse_args()
    build_deck(Path(args.deck), Path(args.output))


if __name__ == "__main__":
    main()
