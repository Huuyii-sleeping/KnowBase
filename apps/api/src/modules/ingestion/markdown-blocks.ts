import {
  DocumentBlock,
  SourceSection,
  validateSections,
} from './document-structure';

const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/;
const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const equation = /^\s*(\$\$|\\\[)\s*$/;
const list = /^\s*(?:[-+*]|\d+[.)])\s+/;
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
  const isBoundary = (i: number) =>
    heading.test(lines[i].text) ||
    fence.test(lines[i].text) ||
    equation.test(lines[i].text) ||
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
    } else if (title) {
      kind = 'heading';
      while (headings.length && headings.at(-1)!.level >= title[1].length)
        headings.pop();
      headings.push({
        level: title[1].length,
        text: title[2].replace(/[ \t]+#+\s*$/, ''),
      });
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
    });
    i = endLine;
  }
  return blocks;
}
