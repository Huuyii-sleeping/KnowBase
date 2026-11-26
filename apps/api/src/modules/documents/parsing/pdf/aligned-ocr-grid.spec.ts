import { describe, expect, it } from 'vitest';
import { alignedOcrGrid } from './aligned-ocr-grid';
const scan =
  '```\n         校准复核\n设备        偏差（mm）   状态\n探头甲       -1.25     待复核\n探头乙       0.00      合格\n 探头丙                未测\n```';

describe('aligned OCR table grid', () => {
  it('recovers only anchored columns, preserving an empty middle cell and a separate title', () => {
    expect(alignedOcrGrid(scan)).toEqual({
      caption: '校准复核',
      rows: [
        ['设备', '偏差（mm）', '状态'],
        ['探头甲', '-1.25', '待复核'],
        ['探头乙', '0.00', '合格'],
        ['探头丙', '', '未测'],
      ],
    });
  });
  it('keeps reordered columns and a trailing empty cell without shifting later values', () => {
    expect(
      alignedOcrGrid(
        '```\n         校准复核\n设备        状态        偏差（mm）\n探头甲       待复核      -3.40\n 探头乙      合格        0.00\n 探头丙      未测\n```',
      )?.rows,
    ).toEqual([
      ['设备', '状态', '偏差（mm）'],
      ['探头甲', '待复核', '-3.40'],
      ['探头乙', '合格', '0.00'],
      ['探头丙', '未测', ''],
    ]);
  });
  it('preserves identifiers, signs, units, escaped markup and single-space phrases literally', () => {
    expect(
      alignedOcrGrid(
        '```\nItem        Value       State\nBatch A     -001.20元    A&B\nBatch B     +0.00元      Not approved\n```',
      )?.rows[1],
    ).toEqual(['Batch A', '-001.20元', 'A&B']);
  });
  it('separates single-character labels and values while preserving phrases', () => {
    expect(
      alignedOcrGrid(
        '```\n       A&B\nName      Value       State\nA         -001.20元    Not approved\nB         +0.00元      Y\nC                     N\n```',
      ),
    ).toEqual({
      caption: 'A&B',
      rows: [
        ['Name', 'Value', 'State'],
        ['A', '-001.20元', 'Not approved'],
        ['B', '+0.00元', 'Y'],
        ['C', '', 'N'],
      ],
    });
  });
  it.each([
    '```\nStage Amount Status\nDeposit 360000 Approved\n```',
    '```\nStage       Amount  Status\nDeposit     360000\n```',
    '```\nStage       Amount  Status\nDeposit  360000  Approved\n```',
    '```\nTitle one\nTitle two\nName      Value\nA         1\nB         2\n```',
    '```\nName      Value\nA         1\nB         2\n     drift\n```',
    '```\nName      Value\nA         1\nB         2\n          3\n```',
    '```\nName      Value\nA\t1\nB\t2\n```',
    '```js\nName      Value\nA         1\n```',
    '```\nName      Value\nA         <1\nB         2\n```',
  ])(
    'refuses ambiguous, missing-row-label, code or misaligned input: %s',
    (content) => {
      expect(alignedOcrGrid(content)).toBeUndefined();
    },
  );
  it('bounds input and row work before trying alignment', () => {
    expect(alignedOcrGrid('a'.repeat(4194305))).toBeUndefined();
    expect(
      alignedOcrGrid('```\n' + 'A         1\n'.repeat(10001) + '```'),
    ).toBeUndefined();
  });
});
