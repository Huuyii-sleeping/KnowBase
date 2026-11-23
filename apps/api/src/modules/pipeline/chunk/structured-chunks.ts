import { createHash } from 'node:crypto';
import { DocumentBlock } from '../../ingestion/document-structure';
import { blockFragments } from './block-fragments';
import { ChunkOptions, StructuredChunk } from './chunk.types';
import { structuredTableFragments } from './table-fragments';

export const CHUNK_STRATEGY = 'structure-v3';

export async function structuredChunks(
  blocks: DocumentBlock[],
  options: ChunkOptions,
): Promise<StructuredChunk[]> {
  const output: StructuredChunk[] = [];
  let pending:
    | {
        scope: string;
        prefix: string;
        path: string[];
        body: string;
        ranges: StructuredChunk['ranges'];
      }
    | undefined;
  const strategy = `${CHUNK_STRATEGY}:${options.size}:${options.overlap}`;
  const flush = () => {
    if (!pending) return;
    const content = pending.prefix + pending.body;
    output.push({
      content,
      embeddingText: content,
      headingPath: pending.path,
      ranges: pending.ranges,
      contentHash: createHash('sha256').update(content).digest('hex'),
      strategy,
    });
    pending = undefined;
  };
  for (const block of blocks) {
    if (block.kind === 'heading') {
      flush();
      continue;
    }
    const source = block.source;
    const scope = JSON.stringify([
      block.headingPath,
      source
        ? [source.page, source.slide, source.sheet, source.partition]
        : null,
    ]);
    // Prefer the closest heading when a long ancestor would exhaust the context.
    const titles: string[] = [];
    let remaining = Math.floor(options.size / 2) - 2;
    for (let i = block.headingPath.length - 1; i >= 0 && remaining > 0; i--) {
      const title = `${'#'.repeat(i + 1)} ${block.headingPath[i]}`;
      if (title.length > remaining && titles.length) break;
      titles.unshift(title.slice(0, remaining));
      remaining -= title.length + 1;
    }
    let prefix = titles.join('\n');
    if (prefix) prefix += '\n\n';
    const budget = options.size - prefix.length;
    const fragments = block.table
      ? structuredTableFragments(block.table, budget)
      : (await blockFragments(block, budget, options.overlap)).map((text) => ({
          text,
          rowStart: undefined,
          rowEnd: undefined,
        }));
    for (const fragment of fragments) {
      const body = fragment.text;
      const range = {
        start: block.start,
        end: block.end,
        ...(block.source ? { source: block.source } : {}),
        ...(block.table
          ? {
              source: {
                ...block.source,
                tableId: block.table.id,
                tableRowStart: fragment.rowStart,
                tableRowEnd: fragment.rowEnd,
              },
            }
          : {}),
      };
      if (
        block.kind === 'table' ||
        block.kind === 'code' ||
        block.kind === 'equation'
      ) {
        flush();
        pending = {
          scope,
          prefix,
          path: block.headingPath,
          body,
          ranges: [range],
        };
        flush();
        continue;
      }
      if (
        pending &&
        (pending.scope !== scope ||
          pending.body.length + body.length + 2 > budget)
      )
        flush();
      if (!pending)
        pending = {
          scope,
          prefix,
          path: block.headingPath,
          body,
          ranges: [range],
        };
      else {
        pending.body += '\n\n' + body;
        pending.ranges.push(range);
      }
    }
  }
  flush();
  return output;
}
