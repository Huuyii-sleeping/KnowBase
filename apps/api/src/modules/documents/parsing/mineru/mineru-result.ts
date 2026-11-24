import { extname } from 'node:path';
import { markdownBlocks } from '../../../ingestion/markdown-blocks';
import { SourceSection } from '../../../ingestion/document-structure';
import {
  FileParserContext,
  ParsedDocument,
  ParseQuality,
} from '../file-parser.types';
import { mineruImages } from './mineru-images';
import { EvidenceUnit } from '../../evidence/evidence.types';
import { PdfTableNormalizer } from '../pdf/pdf-table-normalizer';

/** Convert the v4 Structured Content contract, keeping raw output as a traceable asset. */
export async function mineruResult(
  files: Map<string, Buffer>,
  fileName: string,
  context: FileParserContext,
  maxPages: number,
): Promise<ParsedDocument> {
  const structure = JSON.parse(
    files.get('structured_content.json')!.toString('utf8'),
  );
  const middle = JSON.parse(files.get('middle_json.json')!.toString('utf8'));
  if (
    middle.schema !== 'docvortex.middle' ||
    middle.schema_version !== '2.0' ||
    !Array.isArray(structure.pages) ||
    !structure.pages.length ||
    structure.pages.length > maxPages
  )
    throw new Error('Unsupported or oversized MinerU document structure');
  const issues: ParseQuality['issues'] = [];
  if (structure.is_full_document !== true)
    issues.push({
      code: 'PARTIAL_DOCUMENT',
      message: 'Parser did not return the complete document.',
    });
  const extension = extname(fileName).toLowerCase();
  const images = await mineruImages(
    files,
    context,
    ['.html', '.htm'].includes(extension),
  );
  const { assets, rewrite } = images;
  let markdown = '';
  const sections: SourceSection[] = [];
  const evidence: EvidenceUnit[] = [];
  const pdfTables = new PdfTableNormalizer();
  const seen = new Set<number>();
  const known = new Set([
    'text',
    'doc_title',
    'paragraph_title',
    'table',
    'chart',
    'image',
    'equation',
    'code',
    'list',
    'page_footnote',
    'header',
    'footer',
    'page_number',
    'aside_text',
  ]);
  for (const page of structure.pages) {
    if (
      !Number.isSafeInteger(page.page_idx) ||
      page.page_idx < 0 ||
      seen.has(page.page_idx) ||
      !Array.isArray(page.blocks)
    )
      throw new Error('Invalid MinerU page structure');
    seen.add(page.page_idx);
    const pageNumber = page.page_idx + 1;
    let pageText = '';
    for (const [blockIndex, block] of page.blocks.entries()) {
      if (
        !block ||
        typeof block.type !== 'string' ||
        (block.content !== undefined && typeof block.content !== 'string')
      )
        throw new Error('Unsupported MinerU block structure');
      if (['header', 'footer', 'page_number'].includes(block.type)) continue;
      let text = rewrite(block.content ?? '').trim();
      if (!known.has(block.type))
        issues.push({
          code: 'UNKNOWN_BLOCK',
          message: `Unrecognized block type: ${block.type}`,
          page: pageNumber,
        });
      if (['doc_title', 'paragraph_title'].includes(block.type))
        text = `${'#'.repeat(Math.min(6, Math.max(1, Number(block.level) || 1)))} ${text}`;
      if (block.type === 'equation') {
        if (text) text = `$$\n${text}\n$$`;
        else
          issues.push({
            code: 'IMAGE_ONLY_EQUATION',
            message: 'Equation has no searchable text.',
            page: pageNumber,
          });
      }
      if (block.type === 'code') {
        const longest = Math.max(
          2,
          ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
        );
        const fence = '`'.repeat(longest + 1);
        text = `${fence}\n${text}\n${fence}`;
      }
      const annotations = (items: unknown) => {
        if (items === undefined) return [];
        if (
          !Array.isArray(items) ||
          items.some((x) => typeof x?.content !== 'string')
        )
          throw new Error('Invalid MinerU annotations');
        return items.map((x) => rewrite(x.content));
      };
      const captions = annotations(block.captions);
      const footnotes = annotations(block.footnotes);
      const preceding = page.blocks[blockIndex - 1];
      const tableCaptions = captions.length
        ? captions
        : preceding &&
            ['paragraph_title', 'text'].includes(preceding.type) &&
            typeof preceding.content === 'string' &&
            /^(?:Table\s+\d+[.:]?\s+|表\s*\d+[.:、]?)/iu.test(
              preceding.content.trim(),
            )
          ? [rewrite(preceding.content)]
          : [];
      const normalizedTable =
        extension === '.pdf' && block.type === 'table'
          ? pdfTables.normalize(
              text,
              tableCaptions,
              pageNumber,
              page.blocks.filter(
                (item: { type?: string }) => item?.type === 'table',
              ).length,
            )
          : undefined;
      if (normalizedTable) {
        text = normalizedTable.content;
        issues.push(
          ...normalizedTable.issues.map((issue) => ({
            ...issue,
            page: pageNumber,
          })),
        );
      }
      pageText += [text, ...captions, ...footnotes].join('\n');
      if (block.image_source)
        text += `\n\n${images.render(block.image_source, block.type)}`;
      const body = [...captions, text, ...footnotes]
        .filter(Boolean)
        .join('\n\n');
      if (!body) continue;
      const start = markdown.length;
      markdown += body + '\n\n';
      const source = ['.ppt', '.pptx'].includes(extension)
        ? { slide: pageNumber }
        : extension === '.pdf' ||
            ['.png', '.jpg', '.jpeg', '.webp'].includes(extension)
          ? { page: pageNumber }
          : {};
      // Office page_idx is an engine partition, not an original Word page or worksheet name.
      sections.push({
        start,
        end: markdown.length,
        source: {
          ...source,
          partition: pageNumber,
          blockIndex,
          ...(normalizedTable?.headerPage
            ? { tableHeaderPage: normalizedTable.headerPage }
            : {}),
          ...(Array.isArray(block.bbox) &&
          block.bbox.length === 4 &&
          block.bbox.every(Number.isFinite)
            ? { bbox: block.bbox }
            : {}),
        },
      });
      if (block.image_source) {
        const asset = images.asset(block.image_source);
        evidence.push({
          schema: 'evidence-v1',
          id: `image-${page.page_idx}-${blockIndex}`,
          kind: 'image',
          source: { ...sections.at(-1)!.source },
          objectKeys: asset ? [asset.objectKey] : [],
          text: [rewrite(block.content ?? ''), ...captions]
            .filter(Boolean)
            .join('\n'),
          producer: 'mineru-v4',
          data: {
            blockType: block.type,
            captions,
            footnotes,
            markdownStart: start,
            markdownEnd: markdown.length,
            imageAvailable: Boolean(asset),
            semanticAnalysis: 'not_requested',
            coordinateSpace: 'mineru_original_unspecified',
          },
        });
      }
    }
    if (!pageText.trim())
      issues.push({
        code: 'NO_PAGE_TEXT',
        message: 'Page has no searchable text; review the original.',
        page: pageNumber,
      });
  }
  if (
    ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(extension) &&
    [...seen].some((value, i) => value !== i)
  )
    issues.push({
      code: 'MISSING_PAGE',
      message: 'Parser returned non-contiguous or unordered pages.',
    });
  issues.push(...images.issues);
  if (!markdown.trim()) throw new Error('MinerU returned an empty document');
  const raw = await context.uploadAsset({
    fileName: 'mineru-structure.json',
    contentType: 'application/json',
    type: 'attachment',
    data: Buffer.from(
      JSON.stringify({
        middle,
        structuredContent: structure,
        originalMarkdown: files.get('markdown.md')!.toString('utf8'),
      }),
    ),
  });
  assets.push(raw);
  const producer = structure.metadata?.producer;
  const metadata = structure.extensions?.mineru;
  return {
    markdown,
    sections,
    blocks: markdownBlocks(markdown, sections),
    assets,
    evidence,
    parser: 'mineru',
    ready: !issues.length,
    warnings: issues.map((issue) => issue.message),
    ...(issues.length
      ? { error: 'Parsed content requires manual review.' }
      : {}),
    quality: { status: issues.length ? 'needs_review' : 'accepted', issues },
    provenance: {
      engine: 'mineru',
      version: String(producer?.version ?? 'unknown'),
      tier: String(metadata?.tier ?? 'unknown'),
      mode: String(metadata?.parse_mode ?? 'unknown'),
    },
    parseStrategy: `mineru-v4-adapter-v2:${producer?.version ?? 'unknown'}:${metadata?.tier ?? 'unknown'}${extension === '.pdf' ? ':pdf-tables-v1' : ''}`,
  };
}
