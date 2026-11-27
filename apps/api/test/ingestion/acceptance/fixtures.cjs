const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { PNG } = require('pngjs');
const { root } = require('./environment.cjs');
async function acceptanceFixtures() {
  const initial = await require('../fixtures.cjs').fixtures();
  const legacy = await require('../extended-fixtures.cjs').extendedFixtures();
  const pixel = new PNG({ width: 30, height: 20 });
  pixel.data.fill(255);
  const cases = [
    {
      id: 'acceptance-scan-middle',
      name: 'scan.pdf',
      data: await readFile(
        path.join(
          root,
          'reports/ingestion-complex/ocr-table-new-v2/ocr-table-middle-empty.pdf',
        ),
      ),
      facts: ['-8.75', '0.00', '未测'],
      scan: { caption: '位移计复检', blankColumn: 2 },
    },
    ...initial
      .filter((x) =>
        [
          'pages.pdf',
          'costs.xlsx',
          'review.docx',
          'slides.pptx',
          'notes.txt',
        ].includes(x.name),
      )
      .map((x) => ({ ...x, id: 'acceptance-' + x.name.replace('.', '-') })),
    ...legacy.fixtures
      .filter((x) => /\.(doc|xls|ppt)$/.test(x.name) && !x.invalid)
      .map((x) => ({ ...x, id: 'acceptance-' + x.name.replace('.', '-') })),
    {
      id: 'acceptance-static-html-image',
      name: 'snapshot.html',
      data: Buffer.from(
        `<html><head><meta charset="utf-8"></head><body><h1>Release evidence</h1><p>Storage cost is 100.</p><table><tr><th>Team</th><th>Cost</th></tr><tr><td rowspan="2">Research</td><td>100</td></tr><tr><td>200</td></tr></table><img alt="source" src="data:image/png;base64,${PNG.sync.write(pixel).toString('base64')}"></body></html>`,
      ),
      facts: ['Storage cost is 100.', 'Research'],
    },
    {
      id: 'acceptance-public-web',
      url: 'https://example.com/',
      name: 'example.websnapshot',
      facts: ['Example Domain'],
    },
  ];
  return { cases, converterVersion: legacy.converterVersion };
}
module.exports = { acceptanceFixtures };
