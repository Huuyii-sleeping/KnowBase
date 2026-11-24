"""Generate pinned native/scanned business-table fixtures and page previews.
Requires reportlab, pypdf and pypdfium2 in the benchmark environment.
"""
import argparse
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import pypdfium2 as pdfium
parser=argparse.ArgumentParser(description='Synthetic continuation-table PDFs; no customer data.')
parser.add_argument('directory',type=Path)
parser.add_argument('--holdout', action='store_true')
args=parser.parse_args()
out=args.directory
out.mkdir(parents=True,exist_ok=True)
if (out/'manifest.json').exists(): raise ValueError('Corpus already exists')
cases=[]
specs=[('holdout-revised',False,False)] if args.holdout else [('continued-header',True,False),('continued-no-header',False,False),('independent',True,True)]
header=['Stage','Amount (CNY)','Status']
first=[['Advance','175000','Cleared'],['Inspection','325000','Withheld']] if args.holdout else [['Deposit','360000','Approved'],['Trial acceptance','480000','Pending']]
second=[['Handover','250000','Not cleared'],['Adjustment','-3500','Recorded']] if args.holdout else [['Final acceptance','240000','Not approved'],['Refund','-22500','Confirmed']]
for name,repeat,independent in specs:
 p=out/(name+'.pdf'); c=canvas.Canvas(str(p),pagesize=(595,842),invariant=1)
 for page in [1,2]:
  c.setFont('Helvetica-Bold',18);c.drawString(45,780,'Cold-chain project - supplier payments')
  c.setFont('Helvetica-Bold',13); c.drawString(45,730,('Table 7. Revised settlement' if args.holdout else 'Table 2. Supplier schedule')+(' (continued)' if page==2 and not independent else ''))
  if page==2 and independent:
   c.setFillColorRGB(1,1,1);c.rect(40,715,500,30,fill=1,stroke=0);c.setFillColorRGB(0,0,0);c.drawString(45,730,'Table 3. Warehouse storage costs')
  rows=([header] if page==1 or repeat else [])+(first if page==1 else second)
  widths=[150,190,150] if args.holdout else [180,140,170];x=45;y=690
  for row in rows:
   x=45
   for i,value in enumerate(row):
    c.rect(x,y-40,widths[i],40);c.setFont('Helvetica',11);c.drawString(x+8,y-24,value);x+=widths[i]
   y-=40
  c.setFont('Helvetica',10);c.drawString(45,50,f'Project Beidou | Page {page} of 2');c.showPage()
 c.save()
 doc=pdfium.PdfDocument(p)
 scan=canvas.Canvas(str(out/(name+'-scanned.pdf')),pagesize=(595,842),invariant=1)
 for i,page in enumerate(doc):
  im=page.render(scale=2).to_pil();im.save(out/f'{name}-{i+1}.png');scan.drawImage(ImageReader(im),0,0,width=595,height=842);scan.showPage()
 scan.save();doc.close()
 # Gold cells come from the authored source specification, never the parser output.
 for scanned in [False, True]:
  file=name+('-scanned' if scanned else '')+'.pdf'
  path=out/file
  header=['Stage','Amount (CNY)','Status']
  tables=[]
  for rows in [[header,*first],[header,*second]]:
   tables.append({'rowCount':3,'columnCount':3,'headerRows':[1],'cells':[[r+1,c+1,value] for r,row in enumerate(rows) for c,value in enumerate(row)]})
  if scanned:
   assert not ''.join(page.extract_text() for page in PdfReader(path).pages).strip()
  required=[]
  if scanned: required.append('PDF_TABLE_ALIGNED_TEXT_REVIEW')
  if not repeat: required.append('PDF_TABLE_HEADER_CARRIED')
  cases.append({'id':file[:-4],'kind':'document','file':file,'split':'holdout' if args.holdout else 'development','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
    'facts':[[row[1]] for row in first+second]+[[second[0][2]]],
    'tables':tables,'requiredIssues':required,'expectedHeaderPage':1 if not repeat else None,
    'generation':{'engine':'reportlab; pypdfium2 rasterization','imageOnly':scanned}})
(out/'manifest.json').write_text(json.dumps({'schema':'ingestion-quality-v1','provenance':'authored-synthetic-business-v1','scope':'Explicit PDF continuation and unrelated-table controls. Synthetic, not complex-PDF accuracy.','cases':cases},indent=2)+'\n')
print(f'Generated and checked {len(cases)} PDFs, {len(cases)*2} pages')
