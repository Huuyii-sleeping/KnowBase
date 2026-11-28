import { describe, expect, it } from 'vitest';
import { AnswerContextService } from './answer-context.service';
import { AnswerPromptService } from './answer-prompt.service';
import { source } from './answer.fixture';

const prompts = new AnswerPromptService();
const builder = new AnswerContextService(prompts);

describe('AnswerContextService', () => {
  it('keeps current rules alongside literal old-rule matches, including numeric query terms', () => {
    const old = source('a', '旧版押金300元，已停用。');
    const current = source('b', '现行标准450元。');
    const result = builder.build('旧版押金300元还能用吗，现行标准多少？', [
      old,
      current,
    ]);
    expect(result.items).toEqual([old, current]);
    expect(result.selectionPolicy).toBe('upstream-ranked');
    expect(result.prompt).toContain('[S2]');
  });

  it.each([
    ['能否居家履职？', '允许远程办公。'],
    ['报销？', '报销须附原始凭证。'],
    ['报销 500 元需要审批吗？', '报销应经主管审批。'],
  ])(
    'preserves reranked candidates regardless of literal overlap: %s',
    (question, content) => {
      expect(
        builder.build(question, [source('a', content)]).items,
      ).toHaveLength(1);
    },
  );

  it('removes empty sources before assigning source IDs even if their titles match', () => {
    const result = builder.build('报销审批需要什么？', [
      source('empty', ' ', { title: '报销审批' }),
      source('body', '须主管同意后提交。'),
    ]);
    expect(result.items.map((item) => item.documentId)).toEqual(['doc-body']);
    expect(result.prompt).toContain('[S1]');
    expect(result.prompt).not.toContain('[S2]');
  });

  it('keeps complementary passages and upstream document order without comparing scores again', () => {
    const items = [
      source('a', '先提交申请。', { rerankScore: 0.2 }),
      source('b', '额度上限为五千元。', { rerankScore: 1 }),
      source('c', '紧急情况可以补交材料。'),
    ];
    const before = structuredClone(items);
    const result = builder.build('申请流程、额度及例外是什么？', items);
    expect(result.items).toEqual(items);
    expect(result.prompt).toContain('[S3] 文档：');
    expect(items).toEqual(before);
  });

  it('defaults to at most five items without inventing evidence when fewer exist', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      source(String(i), `正文${i}`),
    );
    expect(builder.build('问题', items).items).toEqual(items.slice(0, 5));
    expect(builder.build('问题', items, { maxItems: 3 }).items).toEqual(
      items.slice(0, 3),
    );
    expect(builder.build('问题', []).items).toEqual([]);
  });

  it('reserves one graph path while retaining document order despite a constant graph score', () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      source(String(i), `文档${i}`),
    );
    const graph = source('g', '实体路径：A -> B', {
      sources: ['graph'],
      rerankScore: 1,
    });
    expect(builder.build('关系', [...docs, graph]).items).toEqual([
      ...docs.slice(0, 4),
      graph,
    ]);
  });

  it('bounds complete UTF8 prompts including repair and metadata; skips whole oversized blocks', () => {
    const large = source('large', '😀'.repeat(5000));
    const small = source('small', '短证据。', { title: '标题😀' });
    const limit = Buffer.byteLength(
      prompts.repair(prompts.build('问题', [small])),
    );
    const result = builder.build('问题', [large, small], {
      maxPromptBytes: limit,
    });
    expect(result.items).toEqual([small]);
    expect(result.items[0].content).toBe('短证据。');
    expect(
      Buffer.byteLength(prompts.repair(result.prompt)),
    ).toBeLessThanOrEqual(limit);
    expect(result.promptBytes).toBe(Buffer.byteLength(result.prompt));
    expect(result.prompt).toContain('[S1] 文档：标题😀');
    expect(
      builder.build('问题', [small], { maxPromptBytes: limit - 1 }).items,
    ).toEqual([]);
  });

  it('drops empty and exact duplicate sources, but keeps distinct document and graph evidence', () => {
    const item = source('a', '正文');
    const other = source('b', '正文');
    const graph = { ...item, sources: ['graph'] as ['graph'] };
    expect(
      builder.build('问题', [
        item,
        item,
        { ...item },
        other,
        graph,
        source('empty', '  '),
      ]).items,
    ).toEqual([item, other, graph]);
  });

  it('retains a near-budget complete source alongside the task review instructions', () => {
    const item = source(
      'long',
      `${'背景说明。'.repeat(1400)}末尾领取上限27份。`,
    );
    const result = builder.build('领取上限是多少？', [item]);
    expect(result.items).toEqual([item]);
    expect(result.prompt).toContain('末尾领取上限27份。');
    expect(
      Buffer.byteLength(prompts.repair(result.prompt)),
    ).toBeLessThanOrEqual(26000);
  });

  it.each([
    { maxItems: 0 },
    { maxItems: 11 },
    { maxItems: 1.5 },
    { maxPromptBytes: 0 },
    { maxPromptBytes: 26001 },
  ])('rejects invalid budgets %j', (options) => {
    expect(() => builder.build('问题', [], options)).toThrow();
  });

  it('supplements oversized sources after full evidence without consuming their slots', () => {
    const large = source(
      'large',
      '# 背景\n' +
        '背景。'.repeat(4000) +
        '\n# 预约要求\n预约须有回执。\n# 预约附加要求\n预约还须交接表。',
    );
    const small = source('small', '预约须主管批准。');
    const result = builder.build('预约要求是什么？', [large, small]);
    expect(result.items[0]).toEqual(small);
    expect(result.items.slice(1).map((item) => item.content)).toEqual([
      '# 预约要求\n预约须有回执。\n',
      '# 预约附加要求\n预约还须交接表。',
    ]);
    expect(result.omittedCount).toBe(0);
    expect(
      builder.build('预约要求是什么？', [large, large, small]).omittedCount,
    ).toBe(1);
    expect(
      Buffer.byteLength(prompts.repair(result.prompt)),
    ).toBeLessThanOrEqual(26000);
    const five = Array.from({ length: 5 }, (_, i) =>
      source(String(i), `预约要求${i}。`),
    );
    expect(builder.build('预约要求是什么？', [large, ...five]).items).toEqual(
      five,
    );
  });

  it('does not crop a normal source to fill a slot when the remaining byte budget is small', () => {
    const first = source('a', '预约。'.repeat(1800));
    const second = source(
      'b',
      '# 预约条件\n预约须提供凭证。\n\n' + '其他。'.repeat(1200),
    );
    expect(builder.build('预约', [second]).items).toEqual([second]);
    expect(builder.build('预约', [first, second]).items).toEqual([first]);
  });

  it('checks excerpt metadata and repair within a custom aggregate byte budget', () => {
    const item = source(
      'large',
      '# 背景\n' + '背景。'.repeat(4000) + '\n# 预约\n预约上限27份。',
    );
    const limit = Buffer.byteLength(
      prompts.repair(
        prompts.build('预约', [source('large', '# 预约\n预约上限27份。')]),
      ),
    );
    expect(
      builder.build('预约', [item], { maxPromptBytes: limit }).items,
    ).toHaveLength(1);
    expect(
      builder.build('预约', [item], { maxPromptBytes: limit - 1 }).items,
    ).toEqual([]);
  });
});
