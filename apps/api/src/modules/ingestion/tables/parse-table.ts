import { createHash } from 'node:crypto';
import { htmlTable } from './html-table';
import { markdownTable } from './markdown-table';
import { TableData, TABLE_LIMITS } from './table.types';

export function parseTable(text: string, location = ''): TableData {
  if (text.length > TABLE_LIMITS.maxCharacters)
    throw new Error('Table exceeds character budget');
  const format = /^\s*<table\b/i.test(text) ? 'html' : 'markdown';
  return {
    schema: 'table-v1',
    id: `table-${createHash('sha256')
      .update(JSON.stringify([location, text]))
      .digest('hex')
      .slice(0, 24)}`,
    format,
    ...(format === 'html' ? htmlTable(text) : markdownTable(text)),
  };
}
