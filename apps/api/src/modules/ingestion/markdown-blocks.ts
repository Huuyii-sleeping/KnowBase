import {
  DocumentBlock,
  SourceSection,
  validateSections,
} from './document-structure';
import { parseTable } from './tables/parse-table';
import { htmlTableEnd } from './tables/html-table-boundary';

const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/;
const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const equation = /^\s*(\$\$|\\\[)\s*$/;
const list = /^\s*(?:[-+*]|\d+[.)])\s+/;
const htmlTable = /^ {0,3}<table(?:\s|>)/i;
const tableDelimiter = (line: string) => {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return (
    cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
  );
};

/** Deterministic Markdown block reader. Format parsers provide explicit source sections. */
export function markdownBlocks(
  markdown: string,
  sections: SourceSection[] = [],
): DocumentBlock[] {
  validateSections(markdown, sections);
  const lines = [...markdown.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((match) => match[0].length)
    .map((match) => ({
      text: match[0].replace(/\r?\n$/, ''),
      start: match.index!,
    }));
  const blocks: DocumentBlock[] = [];
  const headings: Array<{ level: number; text: string }> = [];
  let sectionIndex = -1;
  const isTable = (i: number) =>
    lines[i]?.text.includes('|') && tableDelimiter(lines[i + 1]?.text ?? '');
  const setextTitle = (i: number) => {
    const text = lines[i]?.text;
    const underline = lines[i + 1]?.text.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (
      !text?.trim() ||
      !underline ||
      /^(?: {4}|\t| {0,3}(?:>|[-+*] |\d+[.)] ))/.test(text) ||
      heading.test(text) ||
      fence.test(text) ||
      isTable(i) ||
      /^ {0,3}(?:-+|=+)[ \t]*$/.test(text)
    )
      return undefined;
    // A heading cannot consume a delimiter from a different parser source block.
    const sourceAt = (line: number) =>
      sections.findIndex(
        (part) =>
          lines[line].start >= part.start && lines[line].start < part.end,
      );
    if (sourceAt(i) !== sourceAt(i + 1)) return undefined;
    return { level: underline[1][0] === '=' ? 1 : 2, text: text.trim() };
  };
  const isBoundary = (i: number) =>
    heading.test(lines[i].text) ||
    Boolean(setextTitle(i)) ||
    fence.test(lines[i].text) ||
    equation.test(lines[i].text) ||
    htmlTable.test(lines[i].text) ||
    isTable(i);

  for (let i = 0; i < lines.length;) {
    if (!lines[i].text.trim()) {
      i++;
      continue;
    }
    const start = lines[i].start;
    const section = sections.findIndex(
      (part) => start >= part.start && start < part.end,
    );
    if (section !== sectionIndex) {
      // A slide/worksheet/page is an explicit boundary even with identical headings.
      const partition = (index: number) => {
        const source = sections[index]?.source;
        return JSON.stringify([
          source?.page,
          source?.slide,
          source?.sheet,
          source?.partition,
        ]);
      };
      if (partition(section) !== partition(sectionIndex)) headings.length = 0;
      sectionIndex = section;
    }
    const sameSection = (line: number) =>
      line < lines.length &&
      (section < 0
        ? !sections.some(
            (part) =>
              lines[line].start >= part.start && lines[line].start < part.end,
          )
        : lines[line].start < sections[section].end);
    const title = lines[i].text.match(heading);
    const setext = setextTitle(i);
    const open = lines[i].text.match(fence);
    const math = lines[i].text.match(equation);
    let kind: DocumentBlock['kind'] = 'paragraph';
    let endLine = i + 1;
    if (math) {
      kind = 'equation';
      const closing = math[1] === '$$' ? '$$' : '\\]';
      while (sameSection(endLine)) {
        if (lines[endLine++].text.trim() === closing) break;
      }
    } else if (open) {
      kind = 'code';
      const close = new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}\\s*$`);
      while (sameSection(endLine)) {
        if (close.test(lines[endLine++].text)) break;
      }
    } else if (title || setext) {
      kind = 'heading';
      const level = setext?.level ?? title![1].length;
      if (setext) endLine = i + 2;
      while (headings.length && headings.at(-1)!.level >= level) headings.pop();
      headings.push({
        level,
        text: setext?.text ?? title![2].replace(/[ \t]+#+\s*$/, ''),
      });
    } else if (htmlTable.test(lines[i].text)) {
      kind = 'table';
      const tableEnd = start + htmlTableEnd(markdown.slice(start));
      if (
        (section >= 0 && tableEnd > sections[section].end) ||
        (section < 0 &&
          sections.some((part) => part.start > start && part.start < tableEnd))
      )
        throw new Error('HTML table crosses a source section');
      while (endLine < lines.length && lines[endLine].start < tableEnd)
        endLine++;
      const last = lines[endLine - 1];
      const trailing = last.text.slice(tableEnd - last.start);
      if (trailing) {
        lines.splice(endLine, 0, { text: trailing, start: tableEnd });
        last.text = last.text.slice(0, tableEnd - last.start);
      }
    } else if (isTable(i)) {
      kind = 'table';
      endLine = i + 2;
      while (
        sameSection(endLine) &&
        lines[endLine].text.trim() &&
        lines[endLine].text.includes('|')
      )
        endLine++;
    } else {
      kind = list.test(lines[i].text) ? 'list' : 'paragraph';
      while (
        sameSection(endLine) &&
        lines[endLine].text.trim() &&
        !isBoundary(endLine)
      )
        endLine++;
    }
    const end = lines[endLine - 1].start + lines[endLine - 1].text.length;
    blocks.push({
      kind,
      text: markdown.slice(start, end),
      start,
      end,
      headingPath: headings.map((entry) => entry.text),
      ...(section < 0 ? {} : { source: { ...sections[section].source } }),
      ...(kind === 'table'
        ? { table: parseTable(markdown.slice(start, end), String(start)) }
        : {}),
    });
    i = endLine;
  }
  return blocks;
}
