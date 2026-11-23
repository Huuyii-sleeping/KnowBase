"""Generate public synthetic OCR fixtures; assert PDF contains no text layer.

Requires Pillow, reportlab, pypdf and pypdfium2. Pass a readable CJK font path.
Output is ignored benchmark data, never user documents.
"""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader
import pypdfium2

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--font', required=True)
args = parser.parse_args()
args.directory.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype(args.font, 42)
heading = ImageFont.truetype(args.font, 58)
samples = [
    ('scanned-en.pdf', 'SERVICE AGREEMENT', [
        'Payment is due within 30 days.',
        'The penalty rate is 5%.',
        'Storage costs 100 dollars.',
        'Support is available for 12 months.',
    ]),
    ('scanned-zh.pdf', '服务合同', [
        '付款期限为30天。',
        '违约金为合同金额的5%。',
        '存储费用为100元。',
        '服务期限为12个月。',
    ]),
]
manifest = []
for name, title, lines in samples:
    image = Image.new('RGB', (1654, 2339), 'white')
    draw = ImageDraw.Draw(image)
    draw.text((140, 180), title, font=heading, fill='black')
    for index, line in enumerate(lines):
        draw.text((140, 400 + index * 150), line, font=font, fill='black')
    pdf_path = args.directory / name
    pdf = canvas.Canvas(str(pdf_path), pagesize=(595.28, 841.89), invariant=1)
    pdf.drawImage(ImageReader(image), 0, 0, width=595.28, height=841.89)
    pdf.showPage()
    pdf.save()
    assert not ''.join(page.extract_text() for page in PdfReader(pdf_path).pages).strip()
    document = pypdfium2.PdfDocument(pdf_path)
    document[0].render(scale=1.25).to_pil().save(args.directory / name.replace('.pdf', '-preview.png'))
    document.close()
    manifest.append({'path': name, 'facts': lines, 'order': lines,
                     'expectedReady': True, 'imageOnlyVerified': True})
(args.directory / 'corpus.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print('Generated and verified image-only PDFs:', len(manifest))
