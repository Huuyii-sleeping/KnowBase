"""Deterministic layout primitives; no access to gold annotations."""

from io import BytesIO

import pypdfium2 as pdfium
from PIL import Image, ImageFilter
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


def register_font(path):
    pdfmetrics.registerFont(TTFont("Corpus", str(path)))


def draw(c, op, height):
    kind = op["kind"]
    x, y = op["x"], height - op["y"]
    c.setStrokeColor(HexColor("#354557"))
    c.setFillColor(HexColor("#172b42"))
    if kind == "text":
        c.setFont("Corpus", op["size"])
        c.drawString(x, y, op["text"])
    elif kind == "rect":
        c.setFillColor(HexColor(op["fill"]))
        c.rect(x, y - op["h"], op["w"], op["h"], fill=1)
    elif kind in ("line", "arrow"):
        from math import atan2, cos, sin

        x2, y2 = op["x2"], height - op["y2"]
        c.line(x, y, x2, y2)
        if kind == "arrow":
            angle = atan2(y2 - y, x2 - x)
            for sign in (-1, 1):
                c.line(x2, y2, x2 - 14 * cos(angle + sign * 0.4), y2 - 14 * sin(angle + sign * 0.4))
    elif kind == "diagram":
        # A real raster image inside a text PDF, rather than searchable diagram text.
        stream = BytesIO()
        inner = canvas.Canvas(stream, pagesize=(op["w"], op["h"]), invariant=1)
        for label, xpos in [(op["label1"], 15), (op["label2"], 390)]:
            draw(inner, dict(kind="text", x=xpos, y=70, text=label, size=22), op["h"])
        draw(inner, dict(kind="line", x=80, y=100, x2=490, y2=100), op["h"])
        inner.showPage()
        inner.save()
        image = render_pages(stream.getvalue())[0]
        c.drawImage(ImageReader(image), x, y - op["h"], op["w"], op["h"])
    else:
        raise ValueError(f"Unknown layout primitive: {kind}")


def render_pages(pdf):
    doc = pdfium.PdfDocument(pdf)
    images = []
    try:
        for page in doc:
            bitmap = page.render(scale=1.5)
            images.append(bitmap.to_pil().convert("RGB"))
            bitmap.close()
            page.close()
    finally:
        doc.close()
    return images


def render(item):
    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=(item["width"], item["height"]), invariant=1)
    c.setTitle(item["id"] + " / synthetic benchmark")
    for page in item["pages"]:
        # Layout specs keep labels separate from cell geometry. Paint labels last
        # so a reordered holdout column cannot be hidden by the next white cell.
        for op in sorted(page, key=lambda op: op["kind"] == "text"):
            draw(c, op, item["height"])
        c.showPage()
    c.save()
    pdf = stream.getvalue()
    images = render_pages(pdf)
    if item["scan"]:
        images = [im.convert("L").filter(ImageFilter.GaussianBlur(0.35)).rotate(0.6, fillcolor=255).convert("RGB") for im in images]
        stream = BytesIO()
        c = canvas.Canvas(stream, pagesize=(item["width"], item["height"]), invariant=1)
        for image in images:
            c.drawImage(ImageReader(image), 0, 0, item["width"], item["height"])
            c.showPage()
        c.save()
        pdf = stream.getvalue()
        images = render_pages(pdf)
    if item["file"].endswith(".png"):
        stream = BytesIO()
        images[0].save(stream, format="PNG")
        return stream.getvalue(), images
    return pdf, images
