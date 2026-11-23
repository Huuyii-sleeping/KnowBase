// Generated, synthetic fixtures keep binary test files reproducible and small.
const JSZip = require('jszip');
const ExcelJS = require('exceljs');

async function stableZip(zip) {
  for (const entry of Object.values(zip.files))
    entry.date = new Date('2026-01-01T00:00:00Z');
  return zip.generateAsync({ type: 'nodebuffer' });
}

function pdf(pages) {
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const kids = [];
  for (const lines of pages) {
    const id = objects.length;
    kids.push(`${id} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    const stream = `BT /F1 12 Tf ${lines.map((line, i) => `1 0 0 1 40 ${740 - i * 24} Tm (${line.replace(/[\\()]/g, '\\$&')}) Tj`).join('\n')} ET`;
    objects.push(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[2] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  return Buffer.from(
    `${body}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}

async function fixtures() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KnowBase fixtures';
  workbook.created = workbook.modified = new Date('2026-01-01T00:00:00Z');
  workbook.addWorksheet('费用').addRows([
    ['项目', '金额'],
    ['存储', 100],
    ['模型', 200],
  ]);
  const docx = new JSZip();
  docx.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  docx.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  docx.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>审核通过后建立索引。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>状态</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>索引</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>就绪</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  );
  const pptx = new JSZip();
  const pns = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const ans = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const rns =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relns = 'http://schemas.openxmlformats.org/package/2006/relationships';
  pptx.file(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${[1, 2].map((i) => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`,
  );
  pptx.file(
    '_rels/.rels',
    `<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="${rns}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  pptx.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="${pns}" xmlns:r="${rns}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  pptx.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="${relns}">${[1, 2].map((i) => `<Relationship Id="rId${i}" Type="${rns}/slide" Target="slides/slide${i}.xml"/>`).join('')}</Relationships>`,
  );
  for (let i = 1; i <= 2; i++)
    pptx.file(
      `ppt/slides/slide${i}.xml`,
      `<p:sld xmlns:p="${pns}" xmlns:a="${ans}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="8000000" cy="500000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>第${i}页：审核后发布。</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  const table =
    '| 项目 | 金额 |\n| --- | --- |\n' +
    Array.from({ length: 30 }, (_, i) => `| 项目${i} | ${i * 10} |`).join('\n');
  const markdown =
    '# 运维指南\n\n## 发布流程\n\n' +
    '审核通过后建立索引。重试不会发布旧版本。'.repeat(70) +
    '\n\n## 费用\n\n' +
    table +
    '\n\n## 配置\n\n```ts\n' +
    Array.from({ length: 30 }, (_, i) => `const value${i} = ${i};`).join('\n') +
    '\n```\n';
  return [
    {
      name: 'guide.md',
      data: Buffer.from(markdown),
      facts: [
        '审核通过后建立索引。',
        '重试不会发布旧版本。',
        '项目29',
        'const value29 = 29;',
      ],
    },
    {
      name: 'notes.txt',
      data: Buffer.from('审核通过后建立索引。\n\n失败后允许重试。'),
      facts: ['失败后允许重试。'],
    },
    {
      name: 'costs.xlsx',
      data: await stableZip(
        await JSZip.loadAsync(await workbook.xlsx.writeBuffer()),
      ),
      facts: ['存储', '模型'],
    },
    {
      name: 'review.docx',
      data: await stableZip(docx),
      facts: ['审核通过后建立索引。', '项目', '就绪'],
    },
    {
      name: 'slides.pptx',
      data: await stableZip(pptx),
      facts: ['第1页', '第2页'],
    },
    {
      name: 'pages.pdf',
      data: pdf([
        ['Review before publishing.'],
        ['Retry preserves the active index.'],
      ]),
      facts: ['Review before publishing.', 'Retry preserves the active index.'],
    },
    { name: 'blank.pdf', data: pdf([[]]), facts: [], invalid: true },
    {
      name: 'broken.pdf',
      data: Buffer.from('not a PDF'),
      facts: [],
      invalid: true,
    },
  ];
}
module.exports = { fixtures, pdf };
