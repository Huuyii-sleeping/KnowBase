import { describe, expect, it } from 'vitest';
import { excerptAnswerSource } from './answer-source-excerpts';
import { source } from './answer.fixture';

describe('excerptAnswerSource', () => {
  it('preserves exact contiguous originals and UTF-16 offsets without mutating metadata', () => {
    const text = '😀前言\n\n# 预约\n预约须提供回执。\n\n# 其他\n无关内容。';
    const item = source('a', text);
    const before = structuredClone(item);
    const excerpts = excerptAnswerSource('预约需要什么？', item);
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]).toEqual({
      ...item,
      content: '# 预约\n预约须提供回执。\n\n',
      contentRange: {
        start: text.indexOf('# 预约'),
        end: text.indexOf('# 其他'),
      },
    });
    for (const excerpt of excerpts) {
      expect(
        text.slice(excerpt.contentRange!.start, excerpt.contentRange!.end),
      ).toBe(excerpt.content);
    }
    expect(item).toEqual(before);
  });

  it('keeps separate evidence sections in source order rather than joining across missing text', () => {
    const text =
      '# 样本送达\n样本送达须附回执。\n# 无关\n无关内容。\n# 样本送达附加条件\n还须纸质交接表。';
    const excerpts = excerptAnswerSource(
      '样本送达需要什么？',
      source('a', text),
    );
    expect(excerpts).toHaveLength(2);
    expect(excerpts[0].content).toContain('须附回执');
    expect(excerpts[1].content).toContain('还须纸质交接表');
    expect(excerpts.every((item) => !item.content!.includes('# 无关'))).toBe(
      true,
    );
    expect(excerpts[0].contentRange!.end).toBeLessThan(
      excerpts[1].contentRange!.start,
    );
  });

  it('keeps table rows, units and same-section exceptions together', () => {
    const text =
      '# 预约\n| 类型 | 天数 |\n| --- | --- |\n| 个人 | 3 |\n| 单位 | 8 |\n\n周末不计入工作日。\n# 附录\n其他说明。';
    expect(
      excerptAnswerSource('预约期限？', source('a', text))[0].content,
    ).toBe(text.slice(0, text.indexOf('# 附录')));
  });

  it('uses complete paragraphs when headings are absent', () => {
    const text =
      '无关背景。\n\n远程值守允许每周两天。\n须取得负责人同意。\n\n其他内容。';
    const [excerpt] = excerptAnswerSource(
      '远程值守允许吗？',
      source('a', text),
    );
    expect(excerpt.content).toBe('远程值守允许每周两天。\n须取得负责人同意。');
    expect(
      text.slice(excerpt.contentRange!.start, excerpt.contentRange!.end),
    ).toBe(excerpt.content);
  });

  it('bounds the number and bytes without cutting a long indivisible section', () => {
    const text =
      '# 预约超长章节\n' +
      '预约'.repeat(3000) +
      '\n' +
      Array.from({ length: 5 }, (_, i) => `# 预约${i}\n允许预约${i}。\n`).join(
        '',
      );
    const excerpts = excerptAnswerSource('预约', source('a', text));
    expect(excerpts).toHaveLength(3);
    expect(
      excerpts.every((item) => Buffer.byteLength(item.content!) <= 14000),
    ).toBe(true);
    expect(excerpts[0].content).toContain('# 预约0');
  });

  it.each([
    ['', '申请', ['semantic']],
    ['完全无关', '???', ['semantic']],
    ['完全无关', '预约', ['semantic']],
    ['预约'.repeat(5000), '预约', ['semantic']],
    ['预约信息', '预约', ['graph']],
  ] as const)(
    'does not invent a fallback for unusable text, queries or graph paths',
    (content, question, sources) => {
      expect(
        excerptAnswerSource(question, source('a', content, { sources })),
      ).toEqual([]);
    },
  );
});
