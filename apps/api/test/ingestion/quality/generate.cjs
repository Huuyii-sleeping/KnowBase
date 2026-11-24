const {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  access,
} = require('node:fs/promises');
const path = require('node:path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { digest } = require('./corpus.cjs');
async function workbook() {
  const book = new ExcelJS.Workbook();
  book.creator = 'KnowBase synthetic benchmark';
  book.created = book.modified = new Date('2026-11-23T00:00:00Z');
  const sheet = book.addWorksheet('预算执行');
  sheet.addRows([
    ['部门', '科目', '第一季度', null, '第二季度'],
    [null, null, '预算', '实际', '预算', '实际'],
    ['研发', '平台', 60, 58.25, 40, 39.5],
    [null, '离线缓存', 0, 0, 18, 17.8],
    ['质量', '校准', 12, 11.2, 8, null],
    ['运营', '退款冲减', 0, -2.25, 0, 0],
    [
      '合计',
      '选定科目',
      null,
      { formula: 'SUM(D3:D6)', result: 67.2 },
      null,
      { formula: 'SUM(F3:F6)' },
    ],
  ]);
  for (const range of ['A1:A2', 'B1:B2', 'C1:D1', 'E1:F1', 'A3:A4'])
    sheet.mergeCells(range);
  for (let row = 3; row <= 7; row++)
    for (let col = 3; col <= 6; col++) sheet.getCell(row, col).numFmt = '0.00';
  const payment = book.addWorksheet('付款');
  payment.addRows([
    ['阶段', '比例', '金额万元'],
    ['预付款', 0.3, 36],
    ['试运行', 0.4, 48],
    ['终验', 0.3, 36],
  ]);
  payment.getCell('B2').numFmt = '0%';
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  for (const entry of Object.values(zip.files))
    entry.date = new Date('2026-11-23T00:00:00Z');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
async function generate(output) {
  await mkdir(output, { recursive: true });
  // Never leave a previous successful manifest after an interrupted regeneration.
  try {
    await access(path.join(output, 'manifest.json'));
    throw new Error('Output already contains a corpus; choose a new directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const source = path.resolve(
    __dirname,
    '../../../../../benchmarks/ingestion-business',
  );
  const annotations = JSON.parse(
    await readFile(path.join(source, 'annotations.json'), 'utf8'),
  );
  const cases = [];
  await copyFile(
    path.join(source, 'background.md'),
    path.join(output, 'background.md'),
  );
  for (const item of annotations.documents) {
    const data =
      item.file === 'budget.xlsx'
        ? await workbook()
        : await readFile(path.join(source, 'documents', item.file));
    await writeFile(path.join(output, item.file), data);
    cases.push({ ...item, kind: 'document', sha256: digest(data) });
  }
  const manifest = {
    schema: annotations.schema,
    provenance: annotations.provenance,
    scope: 'Fictional authored document corpus; no production accuracy claim.',
    cases,
  };
  await writeFile(
    path.join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return manifest;
}
if (require.main === module)
  generate(
    path.resolve(
      process.argv[2] ||
        path.resolve(
          __dirname,
          '../../../../../reports/ingestion-quality/corpus',
        ),
    ),
  )
    .then((x) => console.log(`Generated ${x.cases.length} cases`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
module.exports = { generate, workbook };
