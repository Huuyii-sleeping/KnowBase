import { HybridSearchItem } from '../search/hybrid-search.service';
import { AnswerContextItem } from './answer-context.types';

const MAX_EXCERPT_BYTES = 14000;
const MAX_EXCERPTS = 3;

// Used only after full-source admission fails. Never rewrite text or join gaps:
// each excerpt is a contiguous original span with its own source identity.
export function excerptAnswerSource(
  question: string,
  item: HybridSearchItem,
): AnswerContextItem[] {
  const content = item.content;
  if (!content || item.sources.includes('graph')) return [];
  const terms = queryTerms(question);
  if (!terms.length) return [];
  return sourceSpans(content)
    .map(({ start, end }) => {
      const text = content.slice(start, end);
      const normalized = text.toLowerCase();
      return {
        start,
        end,
        text,
        score: terms.reduce(
          (score, term) => score + Number(normalized.includes(term)),
          0,
        ),
      };
    })
    .filter(
      (span) =>
        span.score > 0 && Buffer.byteLength(span.text) <= MAX_EXCERPT_BYTES,
    )
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, MAX_EXCERPTS)
    .sort((a, b) => a.start - b.start)
    .map((span) => ({
      ...item,
      content: span.text,
      contentRange: { start: span.start, end: span.end },
    }));
}

function sourceSpans(content: string) {
  const starts = [...content.matchAll(/^#{1,6}\s+.+$/gm)].map(
    (match) => match.index,
  );
  if (!starts.length) {
    return [...content.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
  }
  if (starts[0] !== 0) starts.unshift(0);
  return starts.map((start, index) => ({
    start,
    end: starts[index + 1] ?? content.length,
  }));
}

function queryTerms(question: string): string[] {
  const tokens =
    question.toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]{2,}/g) ?? [];
  return [
    ...new Set(
      tokens.flatMap((token) =>
        /^[\u4e00-\u9fff]+$/.test(token)
          ? Array.from({ length: token.length - 1 }, (_, i) =>
              token.slice(i, i + 2),
            )
          : [token],
      ),
    ),
  ];
}
