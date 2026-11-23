import { HybridSearchItem } from '../search/hybrid-search.service';

export const ANSWER_REFUSAL = '知识库中没有找到足够信息';
export interface ValidatedAnswer {
  answer: string;
  sourceIds: string[];
}

export function isAnswerRefusal(text: string): boolean {
  // Models may put punctuation before or after trailing source markers.
  // Normalize only the refusal suffix, never remove text from a real answer.
  return (
    text.trim().replace(/(?:\s|[。！？.!?]|\[S\d+\])+$/g, '') === ANSWER_REFUSAL
  );
}

// Membership validation only. It cannot establish that a source entails a claim.
export function validateAnswerCitations(
  output: string,
  items: HybridSearchItem[],
): ValidatedAnswer | null {
  if (!output.trim() || output.length > 65536) return null;
  // Equivalent lists are formatting, not new evidence. Validate every expanded
  // ID below; ranges, malformed IDs and foreign references remain invalid.
  output = output.replace(
    /\[S[1-9]\d*(?:\s*[,，、]\s*S[1-9]\d*)+\]/g,
    (group) =>
      (group.match(/S[1-9]\d*/g) ?? []).map((id) => `[${id}]`).join(''),
  );
  if (isAnswerRefusal(output)) return { answer: ANSWER_REFUSAL, sourceIds: [] };
  const markers = output.match(/\[S[^\]]*\]/gi) ?? [];
  if (/\[S/i.test(output.replace(/\[S[^\]]*\]/gi, ''))) return null;
  for (const marker of markers) {
    if (!/^\[S[1-9]\d*\]$/.test(marker)) return null;
    const sourceId = marker.slice(1, -1);
    const item = items[Number(sourceId.slice(1)) - 1];
    if (!item?.content?.trim()) return null;
  }
  // Repeating a template source header is not a citation of an answer claim.
  const answer = output
    .split('\n')
    .filter(
      (line) =>
        !/^\s*\[S\d+\]\s+(?:文档|图谱路径)：/.test(line) &&
        !/^\s*documentId=/.test(line),
    )
    .join('\n')
    .trim();
  if (isAnswerRefusal(answer)) return { answer: ANSWER_REFUSAL, sourceIds: [] };
  const answerMarkers = answer.match(/\[S\d+\]/g) ?? [];
  if (
    !answerMarkers.length ||
    !/[a-z0-9\u4e00-\u9fff]/i.test(answer.replace(/\[S\d+\]/g, ''))
  )
    return null;
  return {
    answer,
    sourceIds: [...new Set(answerMarkers.map((marker) => marker.slice(1, -1)))],
  };
}
