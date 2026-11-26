import { alignedOcrGrid } from './aligned-ocr-grid';
import { parseTable } from '../../../ingestion/tables/parse-table';

export interface NormalizedPdfTable {
  content: string;
  headerPage?: number;
  issues: Array<{ code: string; message: string }>;
}
interface Grid {
  rows: string[][];
  aligned: boolean;
  caption?: string;
}
const canonical = (text: string) =>
  text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const continued = /\s*(?:\(continued\)|（续）|\(续\)|续表)\s*$/iu;
const captionKey = (captions: string[]) =>
  canonical(captions.join(' ')).replace(continued, '').trim();
const rowText = (row: string[]) =>
  `| ${row.map((text) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`;
const renderMarkdown = (rows: string[][]) =>
  [
    rowText(rows[0]),
    rowText(rows[0].map(() => '---')),
    ...rows.slice(1).map(rowText),
  ].join('\n');

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function render(rows: string[][], caption?: string): string {
  if (!caption) return renderMarkdown(rows);
  return `<table><caption>${escapeHtml(caption)}</caption><thead><tr>${rows[0].map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows
    .slice(1)
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table>`;
}

/** Only rectangular, unmerged grids can be normalized without inventing cell spans. */
function grid(content: string): Grid | undefined {
  if (content.length > 4194304) return;
  const aligned = alignedOcrGrid(content);
  if (aligned) return { ...aligned, aligned: true };
  try {
    const table = parseTable(content);
    if (
      table.headerRows.length !== 1 ||
      table.headerRows[0] !== 1 ||
      table.rowCount < 2 ||
      table.cells.length !== table.rowCount * table.columnCount ||
      table.cells.some((cell) => cell.rowSpan !== 1 || cell.columnSpan !== 1)
    )
      return;
    const rows = Array.from({ length: table.rowCount }, () =>
      Array<string>(table.columnCount),
    );
    for (const cell of table.cells)
      rows[cell.row - 1][cell.column - 1] = cell.text;
    return { rows, aligned: false };
  } catch {
    return;
  }
}

/** Explicit continuation captions permit header carryover; pages and physical tables stay separate. */
export class PdfTableNormalizer {
  private previous?: {
    page: number;
    caption: string;
    header: string[];
    headerPage: number;
  };

  normalize(
    content: string,
    captions: string[],
    page: number,
    tablesOnPage: number,
  ): NormalizedPdfTable {
    const result: NormalizedPdfTable = { content, issues: [] };
    const parsed = grid(content);
    const key = captionKey(captions);
    const previous = this.previous;
    this.previous = undefined;
    if (!parsed) {
      result.issues.push({
        code: 'PDF_TABLE_STRUCTURE_REVIEW',
        message:
          'PDF table has no verified rectangular cell structure; compare with the original image.',
      });
      return result;
    }
    const { rows } = parsed;
    const isContinuation = continued.test(canonical(captions.join(' ')));
    const compatible =
      tablesOnPage === 1 &&
      previous?.page === page - 1 &&
      key.length > 0 &&
      key === previous.caption &&
      previous.header.length === rows[0].length;
    if (isContinuation && compatible) {
      const sameHeader = rows[0].every(
        (cell, index) => canonical(cell) === canonical(previous.header[index]),
      );
      if (!sameHeader) {
        // A numeric first row cannot safely be treated as an all-text header. Other cases remain ambiguous.
        const dataLike = rows[0].some((cell) =>
          /^[-+]?\d[\d,]*(?:\.\d+)?(?:\s*[%¥$元万]*)?$/u.test(cell.trim()),
        );
        if (dataLike) {
          rows.unshift(previous.header);
          result.headerPage = previous.headerPage;
          result.issues.push({
            code: 'PDF_TABLE_HEADER_CARRIED',
            message: `Table header copied from page ${previous.headerPage} under an explicit continuation caption; verify against both pages.`,
          });
        } else {
          result.issues.push({
            code: 'PDF_TABLE_CONTINUATION_REVIEW',
            message:
              'Continuation header differs from the previous page; no header was guessed.',
          });
        }
      }
    } else if (isContinuation) {
      result.issues.push({
        code: 'PDF_TABLE_CONTINUATION_REVIEW',
        message:
          'Continuation has no unique compatible table on the adjacent page; no header was borrowed.',
      });
    }
    if (parsed.aligned)
      result.issues.push({
        code: 'PDF_TABLE_ALIGNED_TEXT_REVIEW',
        message:
          'Aligned OCR table converted into explicit cells; verify column boundaries and values against the original.',
      });
    if (
      !result.headerPage &&
      rows[0].some((cell) => /^[-+]?\d[\d,]*(?:\.\d+)?$/u.test(cell.trim()))
    )
      result.issues.push({
        code: 'PDF_TABLE_HEADER_REVIEW',
        message:
          'The proposed table header contains standalone numeric values and may be a data row; no missing header was guessed.',
      });
    if (parsed.aligned || result.headerPage)
      result.content = render(rows, parsed.caption);
    // Do not propagate uncertain numeric headers or unresolved continuations to another page.
    if (
      tablesOnPage === 1 &&
      key &&
      !result.issues.some(
        (issue) => issue.code === 'PDF_TABLE_CONTINUATION_REVIEW',
      ) &&
      rows[0].every((cell) => !/\d/u.test(cell))
    )
      this.previous = {
        page,
        caption: key,
        header: rows[0],
        headerPage: result.headerPage ?? page,
      };
    return result;
  }
}
