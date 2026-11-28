import { OcrReviewNotice } from './ocr-review-notice';
import { DocumentResource } from './document-resource';
import { Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DocumentContent, DocumentTableEvidence } from '@/lib/api';

function canonicalHtmlTables(content: DocumentContent) {
  const candidates = (content.tables ?? [])
    .filter((table) => {
      const positive = (value: number, max: number) =>
        Number.isSafeInteger(value) && value > 0 && value <= max;
      return (
        table.format === 'html' &&
        Number.isSafeInteger(table.start) &&
        Number.isSafeInteger(table.end) &&
        table.start >= 0 &&
        table.end > table.start &&
        table.end <= content.markdown.length &&
        /^<table(?:\s|>)/i.test(
          content.markdown.slice(table.start, table.end),
        ) &&
        /<\/table>\s*$/i.test(content.markdown.slice(table.start, table.end)) &&
        positive(table.rowCount, 10000) &&
        positive(table.columnCount, 256) &&
        table.rowCount * table.columnCount <= 100000 &&
        table.cells.length <= 100000 &&
        table.cells.every(
          (cell) =>
            positive(cell.row, table.rowCount) &&
            positive(cell.column, table.columnCount) &&
            positive(cell.rowSpan, table.rowCount - cell.row + 1) &&
            positive(cell.columnSpan, table.columnCount - cell.column + 1),
        )
      );
    })
    .sort((a, b) => a.start - b.start);
  // Corrupt or stale overlapping metadata must not consume unrelated Markdown.
  return candidates.filter(
    (table, i) =>
      (i === 0 || candidates[i - 1].end <= table.start) &&
      (i === candidates.length - 1 || table.end <= candidates[i + 1].start),
  );
}

function CanonicalTable({ table }: { table: DocumentTableEvidence }) {
  const rows = Array.from(
    { length: table.rowCount },
    () => [] as DocumentTableEvidence['cells'],
  );
  for (const cell of table.cells) rows[cell.row - 1].push(cell);
  return (
    <div className="my-4 overflow-x-auto">
      <table>
        {table.caption && <caption>{table.caption}</caption>}
        <tbody>
          {rows.map((cells, row) => (
            <tr key={row}>
              {cells
                .sort((a, b) => a.column - b.column)
                .map((cell) => {
                  const Cell = cell.header ? 'th' : 'td';
                  return (
                    <Cell
                      key={cell.column}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.columnSpan}
                      scope={cell.scope}
                      className="whitespace-pre-wrap"
                    >
                      {cell.text}
                    </Cell>
                  );
                })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Render canonical cells as React text; never enable arbitrary extracted HTML. */
export function DocumentBody({ content }: { content: DocumentContent }) {
  const components = {
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      const asset = content.assets.find(
        (value): value is { objectKey: string; url: string } =>
          typeof value === 'object' &&
          value !== null &&
          'url' in value &&
          value.url === src &&
          'objectKey' in value &&
          typeof value.objectKey === 'string',
      );
      return asset ? (
        <DocumentResource
          objectKey={asset.objectKey}
          mimeType="image/*"
          label={alt || '文档图片'}
        />
      ) : (
        <img src={src} alt={alt} />
      );
    },
  };
  const tables = canonicalHtmlTables(content);
  let start = 0;
  const parts = tables.map((table) => {
    const text = content.markdown.slice(start, table.start);
    start = table.end;
    return (
      <Fragment key={`${table.id}:${table.start}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {text}
        </ReactMarkdown>
        <CanonicalTable table={table} />
      </Fragment>
    );
  });
  return (
    <>
      {content.provenance?.mode === 'ocr' && <OcrReviewNotice />}
      {parts}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content.markdown.slice(start)}
      </ReactMarkdown>
    </>
  );
}
