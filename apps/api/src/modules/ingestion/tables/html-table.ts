import { parseDocument } from 'htmlparser2';
import { TableCell, TABLE_LIMITS } from './table.types';

type HtmlNode = ReturnType<typeof parseDocument>['children'][number];
const isElement = (
  node: HtmlNode,
): node is HtmlNode & {
  name: string;
  attribs: Record<string, string>;
  children: HtmlNode[];
} => 'name' in node;

function text(node: HtmlNode): string {
  if (isElement(node)) {
    if (['script', 'style', 'template'].includes(node.name)) return '';
    if (node.name === 'br') return '\n';
    if (node.name === 'img') return node.attribs.alt || '';
    return (
      node.children.map(text).join('') +
      (['p', 'div', 'li'].includes(node.name) ? '\n' : '')
    );
  }
  return node.type === 'text' ? node.data : '';
}

function span(value: string | undefined, maximum: number): number {
  if (value === undefined) return 1;
  // rowspan=0 means "to end of row group"; reject until that semantic is supported.
  if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum)
    throw new Error('Unsupported or oversized HTML table span');
  return Number(value);
}

/** Static DOM inspection only: no rendering, scripts, URL fetches or formula evaluation. */
export function htmlTable(textSource: string) {
  const root = parseDocument(textSource, { decodeEntities: true });
  const allTables: HtmlNode[] = [];
  const visit = (node: HtmlNode) => {
    if (!isElement(node)) return;
    if (node.name === 'table') allTables.push(node);
    node.children.forEach(visit);
  };
  root.children.forEach(visit);
  if (allTables.length !== 1 || !isElement(allTables[0]))
    throw new Error(
      'Expected a single table; nested HTML tables require review',
    );
  const table = allTables[0];
  const rows: Array<{ node: HtmlNode; head: boolean; group: number }> = [];
  let caption: string | undefined;
  let nextGroup = 0;
  const collect = (nodes: HtmlNode[], head = false, group = 0) => {
    for (const node of nodes) {
      if (!isElement(node)) {
        if (node.type === 'text' && node.data.trim())
          throw new Error('HTML table text outside a cell');
        continue;
      }
      if (node.name === 'caption') caption = text(node).trim();
      else if (node.name === 'tr') rows.push({ node, head, group });
      else if (['thead', 'tbody', 'tfoot'].includes(node.name))
        collect(node.children, node.name === 'thead', ++nextGroup);
      else if (
        !['colgroup', 'col', 'script', 'style', 'template'].includes(node.name)
      )
        throw new Error('Unsupported HTML table child');
    }
  };
  collect(table.children);
  if (!rows.length || rows.length > TABLE_LIMITS.maxRows)
    throw new Error('Empty or oversized HTML table');
  const groupEnds: number[] = [];
  for (let index = rows.length - 1; index >= 0; index--)
    groupEnds[index] =
      rows[index + 1]?.group === rows[index].group
        ? groupEnds[index + 1]
        : index + 1;
  const occupied = new Set<number>();
  const cells: TableCell[] = [];
  const headerRows: number[] = [];
  let columnCount = 0;
  for (const [index, entry] of rows.entries()) {
    if (!isElement(entry.node)) continue;
    if (
      entry.node.children.some(
        (node) => node.type === 'text' && node.data.trim(),
      )
    )
      throw new Error('HTML table row text outside a cell');
    const children = entry.node.children
      .filter(isElement)
      .filter((node) => !['script', 'style', 'template'].includes(node.name));
    if (children.some((node) => !['th', 'td'].includes(node.name)))
      throw new Error('Unsupported HTML table row child');
    if (
      entry.head ||
      (children.length > 0 &&
        children.every(
          (node) =>
            node.name === 'th' &&
            !['row', 'rowgroup'].includes(node.attribs.scope?.toLowerCase()),
        ))
    )
      headerRows.push(index + 1);
    let column = 0;
    for (const node of children) {
      while (occupied.has(index * TABLE_LIMITS.maxColumns + column)) column++;
      const rowSpan = span(node.attribs.rowspan, TABLE_LIMITS.maxRows);
      const columnSpan = span(node.attribs.colspan, TABLE_LIMITS.maxColumns);
      if (
        index + rowSpan > rows.length ||
        column + columnSpan > TABLE_LIMITS.maxColumns
      )
        throw new Error('HTML table span exceeds its row/column bounds');
      if (index + rowSpan > groupEnds[index])
        throw new Error('HTML table span crosses a row group');
      if (occupied.size + rowSpan * columnSpan > TABLE_LIMITS.maxSlots)
        throw new Error('HTML table exceeds cell budget');
      for (let r = index; r < index + rowSpan; r++) {
        for (let c = column; c < column + columnSpan; c++) {
          const key = r * TABLE_LIMITS.maxColumns + c;
          if (occupied.has(key))
            throw new Error('Overlapping HTML table cells');
          occupied.add(key);
        }
      }
      const scope = node.attribs.scope?.toLowerCase();
      cells.push({
        row: index + 1,
        column: column + 1,
        rowSpan,
        columnSpan,
        text: text(node).trim(),
        header: node.name === 'th',
        ...(['row', 'col', 'rowgroup', 'colgroup'].includes(scope)
          ? { scope: scope as TableCell['scope'] }
          : {}),
      });
      column += columnSpan;
      columnCount = Math.max(columnCount, column);
    }
  }
  if (!cells.length) throw new Error('HTML table has no cells');
  if (rows.length * columnCount > TABLE_LIMITS.maxSlots)
    throw new Error('HTML table exceeds grid budget');
  return {
    rowCount: rows.length,
    columnCount,
    headerRows,
    cells,
    ...(caption ? { caption } : {}),
  };
}
