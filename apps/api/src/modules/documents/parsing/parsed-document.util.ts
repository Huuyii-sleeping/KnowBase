import { markdownBlocks } from '../../ingestion/markdown-blocks';
import { PARSE_STRATEGY } from '../../ingestion/document-structure';
import { ParsedDocument } from './file-parser.types';

export function completeParsedDocument(parsed: ParsedDocument): ParsedDocument {
  const blocks = markdownBlocks(parsed.markdown, parsed.sections);
  const meaningful = blocks.some(
    (block) =>
      block.kind !== 'heading' &&
      block.text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim().length > 0,
  );
  const error =
    parsed.error ??
    (parsed.ready && !meaningful
      ? 'No meaningful text extracted; manual review required.'
      : undefined);
  return {
    ...parsed,
    blocks,
    parseStrategy: parsed.parseStrategy ?? PARSE_STRATEGY,
    ready: parsed.ready && !error,
    quality:
      parsed.quality && !(error && parsed.quality.status === 'accepted')
        ? parsed.quality
        : {
            status: error
              ? 'needs_review'
              : parsed.ready
                ? 'accepted'
                : 'failed',
            issues: error
              ? [{ code: 'CONTENT_REVIEW_REQUIRED', message: error }]
              : [],
          },
    ...(error ? { error } : {}),
  };
}
