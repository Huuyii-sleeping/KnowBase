import { Parser } from 'htmlparser2';
import { TABLE_LIMITS } from './table.types';

// Tokenize the closing tag: a literal </table> inside a comment, attribute or
// script must not terminate a source block or silently drop its later rows.
export function htmlTableEnd(source: string): number {
  let depth = 0;
  let end: number | undefined;
  const parser = new Parser({
    onopentag(name) {
      if (name === 'table') depth++;
    },
    onclosetag(name, implied) {
      if (name !== 'table') return;
      depth--;
      if (depth === 0 && !implied) {
        end = parser.endIndex + 1;
        parser.pause();
      }
    },
  });
  parser.end(source.slice(0, TABLE_LIMITS.maxCharacters));
  if (end === undefined) {
    if (source.length > TABLE_LIMITS.maxCharacters)
      throw new Error('HTML table exceeds character budget');
    throw new Error('Unclosed HTML table; review the source');
  }
  return end;
}
