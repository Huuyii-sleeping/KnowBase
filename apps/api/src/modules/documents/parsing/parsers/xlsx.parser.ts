import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { tableToMarkdown } from '../markdown-table.util';
import {
  FileParserContext,
  FormatParser,
  ParsedDocument,
} from '../file-parser.types';
import { SourceSection } from '../../../ingestion/document-structure';
import { titleFromFileName } from '../parser.utils';

@Injectable()
export class XlsxParser implements FormatParser {
  async parse(
    buffer: Buffer,
    fileName: string,
    _context: FileParserContext,
  ): Promise<ParsedDocument> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sections: SourceSection[] = [];
    let markdown = `# ${titleFromFileName(fileName)}\n\n`;
    let nonEmptySheets = 0;
    for (const sheet of workbook.worksheets) {
      const rows: string[][] = [];
      for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
        const row = sheet.getRow(rowIndex);
        const values: string[] = [];
        for (
          let columnIndex = 1;
          columnIndex <= sheet.columnCount;
          columnIndex += 1
        ) {
          values.push(this.cellToText(row.getCell(columnIndex)));
        }
        rows.push(values);
      }
      while (rows.length && !rows.at(-1)!.some(Boolean)) rows.pop();
      if (rows.some((row) => row.some(Boolean))) nonEmptySheets++;
      const start = markdown.length;
      markdown += `## ${sheet.name}\n\n${tableToMarkdown(rows) || '_Empty sheet._'}\n\n`;
      sections.push({
        start,
        end: markdown.length,
        source: {
          sheet: sheet.name,
          ...(rows.length ? { rowStart: 1, rowEnd: rows.length } : {}),
        },
      });
    }

    return {
      markdown,
      sections,
      assets: [],
      ready: nonEmptySheets > 0,
      error: nonEmptySheets
        ? undefined
        : 'Workbook contains no non-empty cells.',
      parser: 'exceljs',
      warnings: [],
    };
  }

  private cellToText(cell: ExcelJS.Cell): string {
    if (cell.text) {
      return cell.text.replace(/\r?\n/g, ' ').trim();
    }
    if (cell.value === null || cell.value === undefined) {
      return '';
    }
    return String(cell.value).replace(/\r?\n/g, ' ').trim();
  }
}
