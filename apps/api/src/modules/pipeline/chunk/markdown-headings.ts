export interface MarkdownHeading {
  line: number;
  path: string[];
}

/** Index source headings, excluding examples inside fenced code blocks. */
export function markdownHeadings(markdown: string): MarkdownHeading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: MarkdownHeading[] = [];
  const stack: { level: number; title: string }[] = [];
  let fence: { marker: string; length: number } | undefined;
  let previousText = false;
  const add = (level: number, title: string, line: number) => {
    while (stack.length && stack.at(-1)!.level >= level) stack.pop();
    stack.push({ level, title: title.trim() });
    headings.push({ line, path: stack.map((item) => item.title) });
  };
  lines.forEach((line, index) => {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        delimiter &&
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      )
        fence = undefined;
      previousText = false;
      return;
    }
    if (delimiter) {
      fence = { marker: delimiter[1][0], length: delimiter[1].length };
      previousText = false;
      return;
    }
    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/);
    const setext = line.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (atx) {
      add(
        atx[1].length,
        (atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/, ''),
        index + 1,
      );
    } else if (setext && previousText) {
      add(setext[1][0] === '=' ? 1 : 2, lines[index - 1], index);
    }
    previousText =
      Boolean(line.trim()) &&
      !atx &&
      !setext &&
      !/^(?: {4}|\t| {0,3}(?:>|[-+*] |\d+[.)] ))/.test(line);
  });
  return headings;
}

export function headingPathAt(
  headings: MarkdownHeading[],
  line: number,
): string[] {
  let path: string[] = [];
  for (const heading of headings) {
    if (heading.line > line) break;
    path = heading.path;
  }
  return path;
}
