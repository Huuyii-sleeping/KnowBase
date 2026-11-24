import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { EvidenceUnit } from '../../evidence/evidence.types';
import { ParseQuality } from '../file-parser.types';

/** Native workbook evidence supplements MinerU's reading view; never evaluates formulas. */
@Injectable()
export class XlsxEvidenceExtractor {
  async extract(buffer: Buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    const bytes = entries.reduce(
      (total, entry) =>
        total +
        ((entry as unknown as { _data?: { uncompressedSize?: number } })._data
          ?.uncompressedSize ?? Infinity),
      0,
    );
    if (entries.length > 5000 || bytes > 64 * 1024 * 1024)
      throw new Error('Workbook exceeds expanded byte budget');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    if (workbook.worksheets.length > 256)
      throw new Error('Workbook exceeds sheet budget');
    const evidence: EvidenceUnit[] = [];
    const issues: ParseQuality['issues'] = [];
    const originalSha256 = createHash('sha256').update(buffer).digest('hex');
    let slots = 0;
    for (const [sheetIndex, sheet] of workbook.worksheets.entries()) {
      slots += sheet.rowCount * sheet.columnCount;
      if (slots > 100000 || sheet.rowCount > 10000 || sheet.columnCount > 256)
        throw new Error('Workbook exceeds cell budget');
      const merges = sheet.model.merges ?? [];
      let firstRow = true;
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const id = `xlsx-${sheetIndex}-${rowNumber}`;
        const cells = Array.from({ length: sheet.columnCount }, (_, column) => {
          const cell = row.getCell(column + 1);
          const coveredBy =
            cell.isMerged && cell.master.address !== cell.address
              ? cell.master.address
              : undefined;
          const native = coveredBy ? null : cell.value;
          const formula =
            !coveredBy && cell.type === ExcelJS.ValueType.Formula
              ? cell.formula
              : undefined;
          const hasCachedResult = formula
            ? cell.result !== undefined && cell.result !== null
            : undefined;
          if (formula && !hasCachedResult)
            issues.push({
              code: 'XLSX_FORMULA_RESULT_MISSING',
              evidenceId: id,
              message: `Formula has no saved result: ${sheet.name}!${cell.address}`,
            });
          // JSON serialization preserves null/false/zero and makes dates explicit ISO values.
          return {
            address: cell.address,
            type: coveredBy ? 'merge_reference' : cell.type,
            value:
              native === undefined ? null : JSON.parse(JSON.stringify(native)),
            text: coveredBy ? '' : cell.text,
            numberFormat: cell.numFmt || 'General',
            ...(coveredBy ? { coveredBy } : {}),
            ...(formula
              ? {
                  formula,
                  hasCachedResult,
                  cachedResult: hasCachedResult
                    ? JSON.parse(JSON.stringify(cell.result))
                    : null,
                }
              : {}),
          };
        });
        evidence.push({
          schema: 'evidence-v1',
          id,
          kind: 'worksheet_row',
          source: {
            sheet: sheet.name,
            rowStart: rowNumber,
            rowEnd: rowNumber,
            cellRange: `A${rowNumber}:${row.getCell(sheet.columnCount).address}`,
          },
          objectKeys: [],
          text: cells.map((cell) => cell.text).join(' | '),
          producer: 'exceljs-native-v1',
          data: {
            sheetIndex,
            sheetState: sheet.state,
            date1904: Boolean(workbook.properties.date1904),
            ...(firstRow ? { merges } : {}),
            cells,
            originalSha256,
          },
        });
        firstRow = false;
      });
    }
    return { evidence, issues };
  }
}
