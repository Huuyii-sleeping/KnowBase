"""Additional authored OCR-only scans; gold is never passed to the renderer or parser."""
import argparse
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader
from render import register_font, render


def generate(output, font):
    output.mkdir(parents=True, exist_ok=False)
    register_font(font)
    specs = json.loads((Path(__file__).resolve().parents[5] / 'benchmarks/ingestion-complex/ocr-table-cases.json').read_text())
    manifest = dict(schema='complex-corpus-v1', provenance='authored-synthetic-yuanlan-v1', supplement='ocr-tables-v1', fontSha256=hashlib.sha256(font.read_bytes()).hexdigest(), cases=[])
    gold = dict(schema='complex-gold-v1', provenance=manifest['provenance'], cases=[])
    (output / 'previews').mkdir()
    for item in specs['cases']:
        # Every row/column and blank is authored before inference. The drawn title is physically merged.
        xs = [70, 300, 530, 760]
        ops = [dict(kind='text', x=50, y=60, size=22, text='合成计量档案 / OCR-only validation'),
               dict(kind='rect', x=70, y=190, w=690, h=75, fill='#e5e9ef'),
               dict(kind='text', x=325, y=238, size=23, text=item['title'])]
        for r, row in enumerate([item['header'], *item['rows']]):
            for c, value in enumerate(row):
                ops.append(dict(kind='rect', x=xs[c], y=265+r*90, w=230, h=90, fill='#ffffff'))
                if value:
                    ops.append(dict(kind='text', x=xs[c]+15, y=320+r*90, size=22, text=value))
        ops.append(dict(kind='text', x=70, y=820, size=17, text='空白表示未提供；不得改写为0。仅用于合成评测。'))
        data, previews = render(dict(id=item['id'], file=item['id']+'.pdf', width=830, height=1000, scan=True, pages=[ops]))
        file=item['id']+'.pdf'
        (output/file).write_bytes(data)
        assert not PdfReader(output/file).pages[0].extract_text().strip()
        previews[0].save(output/'previews'/f"{item['id']}-p1.png")
        manifest['cases'].append(dict(id=item['id'], file=file, category='scanned-table', split='holdout', pages=1, sha256=hashlib.sha256(data).hexdigest()))
        cells=[[1,1,item['title'],1,3]]+[[r+2,c+1,value] for r,row in enumerate([item['header'],*item['rows']]) for c,value in enumerate(row)]
        checks=[dict(id=f'critical-{i}',aliases=[value]) for i,value in enumerate(item['critical'])]
        gold['cases'].append(dict(id=item['id'], visible=checks,critical=checks,sources=[],relations=[],unknown=[dict(id="unspecified",aliases=["未提供"])],contradictions=[],readingOrder=[],tables=[dict(id='authored-grid',page=1,rowCount=len(item['rows'])+2,columnCount=3,headerRows=[1,2],cells=cells)]))
    gold_bytes=(json.dumps(gold,ensure_ascii=False,indent=2)+'\n').encode()
    (output/'gold.json').write_bytes(gold_bytes)
    manifest['goldSha256']=hashlib.sha256(gold_bytes).hexdigest()
    manifest['specSha256']=hashlib.sha256(json.dumps(specs,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('output',type=Path)
    parser.add_argument('--font',type=Path,required=True)
    args=parser.parse_args()
    generate(args.output,args.font)
