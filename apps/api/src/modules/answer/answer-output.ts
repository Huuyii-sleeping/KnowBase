import { HybridSearchItem } from '../search/hybrid-search.service';
import { ANSWER_REFUSAL } from './answer-citation-validation';

export type AnswerStatus = 'answered' | 'insufficient' | 'conflict';

export interface AnswerEvidence {
  sourceId: string;
  quote: string;
}

export interface AnswerClaim {
  text: string;
  evidence: AnswerEvidence[];
}

export interface ParsedAnswer {
  status: AnswerStatus;
  answer: string;
  sourceIds: string[];
  claims: AnswerClaim[];
}

// Local checks establish membership and literal provenance, not entailment.
export function parseAnswerOutput(
  output: string,
  items: HybridSearchItem[],
): ParsedAnswer | null {
  if (!output.trim() || output.length > 65536) return null;
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  if (!record(value, ['status', 'claims']) || !Array.isArray(value.claims))
    return null;
  const status = value.status;
  if (status === 'insufficient' || status === 'conflict') {
    return value.claims.length === 0
      ? { status, answer: ANSWER_REFUSAL, sourceIds: [], claims: [] }
      : null;
  }
  if (status !== 'answered' || !value.claims.length || value.claims.length > 12)
    return null;
  const claims: AnswerClaim[] = [];
  for (const claim of value.claims) {
    if (
      !record(claim, ['text', 'evidence']) ||
      !text(claim.text, 1500) ||
      /\[S/i.test(claim.text) ||
      !Array.isArray(claim.evidence) ||
      !claim.evidence.length ||
      claim.evidence.length > 12
    )
      return null;
    const evidence: AnswerEvidence[] = [];
    const seen = new Set<string>();
    for (const reference of claim.evidence) {
      if (
        !record(reference, ['sourceId', 'quote']) ||
        typeof reference.sourceId !== 'string' ||
        !/^S[1-9]\d*$/.test(reference.sourceId) ||
        !text(reference.quote, 2000)
      )
        return null;
      const item = items[Number(reference.sourceId.slice(1)) - 1];
      const quote = reference.quote.trim();
      if (!item?.content?.includes(quote)) return null;
      const key = JSON.stringify([reference.sourceId, quote]);
      if (seen.has(key)) return null;
      seen.add(key);
      evidence.push({ sourceId: reference.sourceId, quote });
    }
    claims.push({ text: claim.text.trim(), evidence });
  }
  const sourceIds = [
    ...new Set(
      claims.flatMap((claim) =>
        claim.evidence.map((reference) => reference.sourceId),
      ),
    ),
  ];
  const answer = claims
    .map((claim) => {
      const ids = [
        ...new Set(claim.evidence.map((reference) => reference.sourceId)),
      ];
      return `${claim.text} ${ids.map((id) => `[${id}]`).join('')}`;
    })
    .join('\n');
  return { status, answer, sourceIds, claims };
}

function record(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    /[\p{L}\p{N}]/u.test(value) &&
    value.length <= max
  );
}
