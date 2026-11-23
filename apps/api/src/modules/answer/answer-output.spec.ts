import { describe, expect, it } from 'vitest';
import { parseAnswerOutput } from './answer-output';
import { ANSWER_REFUSAL } from './answer-citation-validation';
import { source } from './answer.fixture';

const items = [
  source('a', '甲组月费为310元。审批后可用。'),
  source('b', '乙组月费为430元。'),
];
const claim = {
  text: '甲组月费为310元。',
  evidence: [{ sourceId: 'S1', quote: '甲组月费为310元。' }],
};
const encode = (claims: unknown[] = [claim], status = 'answered') =>
  JSON.stringify({ status, claims });

describe('structured answer output', () => {
  it('allows distinct noncontiguous quotes from the same source for one conclusion', () => {
    const value = encode([
      {
        text: '甲组月费310元，审批后可用。',
        evidence: [
          { sourceId: 'S1', quote: '甲组月费为310元。' },
          { sourceId: 'S1', quote: '审批后可用。' },
        ],
      },
    ]);
    expect(parseAnswerOutput(value, items.slice(0, 1))).toMatchObject({
      status: 'answered',
      sourceIds: ['S1'],
    });
  });
  it('renders each claim from validated source IDs, preserving Unicode and stable numbering', () => {
    const second = {
      text: '乙组月费为430元。',
      evidence: [{ sourceId: 'S2', quote: '乙组月费为430元。' }],
    };
    expect(
      parseAnswerOutput(encode([second, claim, claim]), items),
    ).toMatchObject({
      status: 'answered',
      answer:
        '乙组月费为430元。 [S2]\n甲组月费为310元。 [S1]\n甲组月费为310元。 [S1]',
      sourceIds: ['S2', 'S1'],
    });
  });
  it.each(['insufficient', 'conflict'])(
    'keeps %s separate from an answer without inventing evidence',
    (status) => {
      expect(parseAnswerOutput(encode([], status), items)).toEqual({
        status,
        answer: ANSWER_REFUSAL,
        sourceIds: [],
        claims: [],
      });
      expect(parseAnswerOutput(encode([claim], status), items)).toBeNull();
    },
  );
  it.each([
    'not json',
    '```json\n{}\n```',
    'null',
    '[]',
    '{}',
    encode([], 'answered'),
    encode([claim], 'refusal'),
    JSON.stringify({ status: 'answered', claims: [claim], answer: 'draft' }),
  ])('rejects invalid or ambiguous contracts: %s', (value) => {
    expect(parseAnswerOutput(value, items)).toBeNull();
  });
  it.each([
    { ...claim, text: '' },
    { ...claim, text: '？？？' },
    { ...claim, text: '来源 [S1]' },
    { ...claim, evidence: [] },
    { ...claim, evidence: [{ sourceId: 'S9', quote: '甲组月费为310元。' }] },
    { ...claim, evidence: [{ sourceId: 'S01', quote: '甲组月费为310元。' }] },
    { ...claim, evidence: [{ sourceId: 'S2', quote: '甲组月费为310元。' }] },
    { ...claim, evidence: [{ sourceId: 'S1', quote: '甲组月费为…' }] },
    { ...claim, evidence: [{ sourceId: 'S1', quote: ' ' }] },
    { ...claim, evidence: [claim.evidence[0], claim.evidence[0]] },
    { ...claim, extra: 'hidden' },
    { ...claim, evidence: [{ ...claim.evidence[0], extra: 'hidden' }] },
  ])('rejects invalid evidence or unrendered claims %j', (invalid) => {
    expect(parseAnswerOutput(encode([invalid]), items)).toBeNull();
  });
  it('never treats a title or another source as the quoted body', () => {
    expect(
      parseAnswerOutput(encode(), [
        source('a', '', { title: claim.evidence[0].quote }),
      ]),
    ).toBeNull();
    expect(parseAnswerOutput(encode(), [])).toBeNull();
  });
  it('bounds the output and each claim without truncating or repairing quotes', () => {
    expect(parseAnswerOutput(' '.repeat(65537), items)).toBeNull();
    expect(
      parseAnswerOutput(encode(Array.from({ length: 13 }, () => claim)), items),
    ).toBeNull();
    expect(
      parseAnswerOutput(encode([{ ...claim, text: '中'.repeat(1501) }]), items),
    ).toBeNull();
  });
  it('does not pretend literal quotation establishes semantic support', () => {
    const changed = { ...claim, text: '甲组月费为999元。' };
    expect(parseAnswerOutput(encode([changed]), items)?.status).toBe(
      'answered',
    );
  });
});
