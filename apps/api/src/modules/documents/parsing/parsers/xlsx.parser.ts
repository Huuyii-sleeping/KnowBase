import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { tableToMarkdown } from '../markdown-table.util';
import { FileParserContext, FormatParser, ParsedDocument } from '../file-parser.types';
import { titleFromFileName } from '../parser.utils';

@Injectable()
export class XlsxParser implements FormatParser {
  async parse(buffer: Buffer, fileName: string, _context: FileParserContext): Promise<ParsedDocument> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sections = workbook.worksheets.map((sheet) => {
      const rows: string[][] = [];
      for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
        const row = sheet.getRow(rowIndex);
        const values: string[] = [];
        for (let columnIndex = 1; columnIndex <= sheet.columnCount; columnIndex += 1) {
          values.push(this.cellToText(row.getCell(columnIndex)));
        }
        if (values.some(Boolean)) {
          rows.push(values);
        }
      }
      return `# ${sheet.name}\n\n${tableToMarkdown(rows) || '_Empty sheet._'}`;
    });

    return {
      markdown: `# ${titleFromFileName(fileName)}\n\n${sections.join('\n\n')}\n`,
      assets: [],
      ready: true,
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
