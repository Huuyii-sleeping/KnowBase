import { describe, expect, it } from 'vitest';
import {
  ANSWER_REFUSAL,
  validateAnswerCitations,
} from './answer-citation-validation';
import { source } from './answer.fixture';

const items = [
  source('a', '申请必须经主管审批。'),
  source('b', '额度上限为五千元。'),
];

describe('answer citation membership validation', () => {
  it('accepts valid source IDs in first occurrence order and preserves the answer', () => {
    expect(
      validateAnswerCitations('需审批 [S1]。额度五千 [S2][S1]。', items),
    ).toEqual({
      answer: '需审批 [S1]。额度五千 [S2][S1]。',
      sourceIds: ['S1', 'S2'],
    });
  });
  it.each(['[S1, S2]', '[S1,S2]', '[S1，S2]', '[S1、S2]'])(
    'normalizes explicit citation lists without inventing IDs: %s',
    (group) => {
      expect(
        validateAnswerCitations(`需审批且额度五千 ${group}。`, items),
      ).toEqual({
        answer: '需审批且额度五千 [S1][S2]。',
        sourceIds: ['S1', 'S2'],
      });
    },
  );
  it.each(['[S1, S9]', '[S1-S2]', '[S1, 2]', '[S1, S02]', '[S1, s2]'])(
    'does not infer missing IDs, expand ranges or accept foreign list entries: %s',
    (group) =>
      expect(validateAnswerCitations(`需审批 ${group}`, items)).toBeNull(),
  );
  it('normalizes a refusal containing an explicit citation list', () => {
    expect(
      validateAnswerCitations(ANSWER_REFUSAL + ' [S1, S2]。', items),
    ).toEqual({
      answer: ANSWER_REFUSAL,
      sourceIds: [],
    });
  });
  it.each([
    '没有引用的回答',
    '',
    '  ',
    '[S1]',
    '错误 [S9]',
    '混合 [S1][S9]',
    '错误 [S0]',
    '错误 [S01]',
    '错误 [s1]',
    '错误 [S 1]',
    '错误 [SNaN]',
    '错误 [S1',
    '[S1] 文档：知识条目',
    '[S1] 文档：知识条目\ndocumentId=doc-a\n需要审批。',
  ])('rejects missing or invalid references: %s', (answer) => {
    expect(validateAnswerCitations(answer, items)).toBeNull();
  });
  it('does not normalize a substantive answer containing the refusal phrase', () => {
    const answer = '知识库中没有找到足够信息，但仍须主管审批 [S1]。';
    expect(validateAnswerCitations(answer, items)).toEqual({
      answer,
      sourceIds: ['S1'],
    });
  });
  it('rejects references to unavailable or empty context', () => {
    expect(validateAnswerCitations('答案 [S1]', [])).toBeNull();
    expect(validateAnswerCitations('答案 [S1]', [source('a', ' ')])).toBeNull();
  });
  it('removes copied source metadata without assigning its citation to an uncited conclusion', () => {
    expect(
      validateAnswerCitations(
        '[S1] 文档：知识条目\ndocumentId=doc-a\n需要审批 [S1]。',
        items,
      ),
    ).toEqual({ answer: '需要审批 [S1]。', sourceIds: ['S1'] });
    expect(
      validateAnswerCitations(
        '[S1] 文档：知识条目\n知识库中没有找到足够信息。',
        items,
      ),
    ).toEqual({ answer: ANSWER_REFUSAL, sourceIds: [] });
  });
  it.each([
    ANSWER_REFUSAL,
    ANSWER_REFUSAL + '。 [S1]',
    ANSWER_REFUSAL + ' [S1]。',
    ANSWER_REFUSAL + ' [S1][S2]。',
    ANSWER_REFUSAL + '。 [S1]！ [S2]？',
  ])('normalizes refusal without retaining references: %s', (answer) => {
    expect(validateAnswerCitations(answer, items)).toEqual({
      answer: ANSWER_REFUSAL,
      sourceIds: [],
    });
  });
});
