import { parseDocument } from 'htmlparser2';
type Node = ReturnType<typeof parseDocument>['children'][number];
const isElement = (
  node: Node,
): node is Node & {
  name: string;
  children: Node[];
  attribs: Record<string, string>;
} => 'name' in node && 'children' in node && 'attribs' in node;
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const omitted = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'nav',
  'aside',
  'footer',
  'form',
  'iframe',
  'object',
  'embed',
]);
const allowed = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'a',
  'img',
  'br',
  'em',
  'strong',
  'span',
]);
export function staticWebBody(html: string) {
  const root = parseDocument(html);
  const stack = root.children.map((node) => ({ node, depth: 0 }));
  let visited = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++visited > 100000 || depth > 100 || stack.length > 100000)
      throw new Error('Web document exceeds DOM budget');
    if ('children' in node)
      for (const child of node.children)
        stack.push({ node: child, depth: depth + 1 });
  }
  const collect = (nodes: Node[], name: string): Node[] =>
    nodes.flatMap((node) =>
      isElement(node)
        ? node.name === name
          ? [node]
          : collect(node.children, name)
        : [],
    );
  const main = collect(root.children, 'main'),
    articles = collect(root.children, 'article');
  const selected = main.length
    ? main
    : articles.length
      ? articles
      : collect(root.children, 'body');
  let count = 0;
  const render = (node: Node, depth = 0): string => {
    if (++count > 100000 || depth > 100)
      throw new Error('Web document exceeds DOM budget');
    if (node.type === 'text') return escape(node.data);
    if (
      !isElement(node) ||
      omitted.has(node.name) ||
      node.attribs?.['aria-hidden'] === 'true' ||
      (node.attribs && 'hidden' in node.attribs)
    )
      return '';
    const children = node.children
      .map((child) => render(child, depth + 1))
      .join('');
    if (!allowed.has(node.name)) return children;
    const attributes = Object.entries(node.attribs)
      .filter(
        ([key, value]) =>
          ['colspan', 'rowspan', 'href', 'src', 'alt', 'title'].includes(key) &&
          !/^(javascript|file|vbscript):/i.test(value),
      )
      .map(([key, value]) => ` ${key}="${escape(value)}"`)
      .join('');
    return `<${node.name}${attributes}>${children}</${node.name}>`;
  };
  const titleText = (node: Node): string =>
    node.type === 'text'
      ? node.data
      : 'children' in node
        ? node.children.map(titleText).join('')
        : '';
  const title = collect(root.children, 'title').map(titleText).join(' ').trim();
  const body = (selected.length ? selected : root.children)
    .map((node) => render(node))
    .join('\n');
  return {
    html:
      (title && !/<h1(?:\s|>)/i.test(body)
        ? `<h1>${escape(title)}</h1>\n`
        : '') + body,
    selection: main.length ? 'main' : articles.length ? 'article' : 'body',
  };
}
