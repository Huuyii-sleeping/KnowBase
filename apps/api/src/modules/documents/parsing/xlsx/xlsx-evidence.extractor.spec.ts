import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { XlsxEvidenceExtractor } from './xlsx-evidence.extractor';

describe('native XLSX evidence', () => {
  it('preserves addresses, types, merges, raw formulas, cached values and zero', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.properties.date1904 = true;
    const sheet = workbook.addWorksheet('预算');
    sheet.addRow(['项目', '金额', '比例']);
    sheet.addRow(['研发', 0, 0.25]);
    sheet.getCell('C2').numFmt = '0.00%';
    sheet.addRow(['运营', -5, { formula: 'B2+B3', result: -5 }]);
    sheet.getCell('D3').value = { formula: '1+2' };
    sheet.mergeCells('A4:A5');
    sheet.getCell('A4').value = '共享';
    const result = await new XlsxEvidenceExtractor().extract(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    const row = (number: number) =>
      result.evidence.find((unit) => unit.source.rowStart === number)!;
    expect(row(2).source.sheet).toBe('预算');
    expect(row(2).data.date1904).toBe(true);
    expect((row(2).data.cells as any[])[1]).toMatchObject({
      address: 'B2',
      value: 0,
    });
    expect((row(2).data.cells as any[])[2]).toMatchObject({
      value: 0.25,
      numberFormat: '0.00%',
    });
    expect((row(3).data.cells as any[])[2]).toMatchObject({
      formula: 'B2+B3',
      cachedResult: -5,
      hasCachedResult: true,
    });
    expect((row(3).data.cells as any[])[3]).toMatchObject({
      formula: '1+2',
      cachedResult: null,
      hasCachedResult: false,
    });
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'XLSX_FORMULA_RESULT_MISSING',
        evidenceId: row(3).id,
      }),
    ]);
    expect(result.evidence[0].data.merges).toEqual(['A4:A5']);
    expect((row(5).data.cells as any[])[0]).toMatchObject({
      value: null,
      coveredBy: 'A4',
    });
  });
  it('rejects invalid workbooks and oversized sparse ranges', async () => {
    const reader = new XlsxEvidenceExtractor();
    await expect(reader.extract(Buffer.from('not zip'))).rejects.toThrow();
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Huge').getCell('A10001').value = 'x';
    await expect(
      reader.extract(Buffer.from(await workbook.xlsx.writeBuffer())),
    ).rejects.toThrow('budget');
  });
});
