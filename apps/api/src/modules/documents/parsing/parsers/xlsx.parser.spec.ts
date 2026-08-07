import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { XlsxParser } from './xlsx.parser';

describe('XlsxParser', () => {
  it('renders each worksheet as a Markdown table section', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sales');
    sheet.addRow(['Name', 'Amount']);
    sheet.addRow(['Alice', 10]);

    const result = await new XlsxParser().parse(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'sales.xlsx',
      { documentId: 'test', uploadAsset: async () => { throw new Error('not expected'); } },
    );

    expect(result.parser).toBe('exceljs');
    expect(result.markdown).toContain('# Sales');
    expect(result.markdown).toContain('| Name');
    expect(result.markdown).toContain('| Alice');
  });
});
