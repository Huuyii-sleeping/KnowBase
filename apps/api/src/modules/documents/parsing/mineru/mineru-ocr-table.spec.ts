import { describe, expect, it, vi } from 'vitest';
import { mineruResult } from './mineru-result';
const inputs = [
  {
    text: '         校准复核\n设备        偏差（mm）   状态\n探头甲       -1.25     待复核\n探头乙       0.00      合格\n 探头丙                未测',
    header: ['设备', '偏差（mm）', '状态'],
    last: ['探头丙', '', '未测'],
  },
  {
    text: '         校准复核\n设备        状态        偏差（mm）\n探头甲       待复核      -3.40\n 探头乙      合格        0.00\n 探头丙      未测',
    header: ['设备', '状态', '偏差（mm）'],
    last: ['探头丙', '未测', ''],
  },
];
async function parse(text: string) {
  const structure = {
    is_full_document: true,
    metadata: { producer: { version: '4.2.3' } },
    pages: [
      {
        page_idx: 0,
        blocks: [
          {
            type: 'table',
            content: '```\n' + text + '\n```',
            image_source: 'images/table.jpg',
            bbox: [0.1, 0.2, 0.9, 0.8],
          },
        ],
      },
    ],
  };
  const uploadAsset = vi.fn(async (input) => ({
    type: input.type,
    objectKey: 'assets/' + input.fileName,
    url: '/asset/' + input.fileName,
  }));
  const result = await mineruResult(
    new Map([
      ['structured_content.json', Buffer.from(JSON.stringify(structure))],
      [
        'middle_json.json',
        Buffer.from(
          JSON.stringify({ schema: 'docvortex.middle', schema_version: '2.0' }),
        ),
      ],
      ['markdown.md', Buffer.from('original')],
      ['images/table.jpg', Buffer.from('pixels')],
    ]),
    'scan.pdf',
    { documentId: 'doc', uploadAsset },
    10,
  );
  return { result, uploadAsset, structure };
}
describe('MinerU scanned table candidate delivery', () => {
  it.each(inputs)(
    'preserves column order and blank cells with source and review protection',
    async ({ text, header, last }) => {
      const { result, uploadAsset, structure } = await parse(text);
      const table = result.blocks?.find((x) => x.table)!;
      expect(table.table).toMatchObject({
        caption: '校准复核',
        rowCount: 4,
        columnCount: 3,
        headerRows: [1],
      });
      expect(
        table.table!.cells.filter((x) => x.row === 1).map((x) => x.text),
      ).toEqual(header);
      expect(
        table.table!.cells.filter((x) => x.row === 4).map((x) => x.text),
      ).toEqual(last);
      expect(table.table!.cells).toHaveLength(12);
      expect(
        table.table!.cells.every((x) => x.columnSpan === 1 && x.rowSpan === 1),
      ).toBe(true);
      expect(table.source).toMatchObject({
        page: 1,
        blockIndex: 0,
        bbox: [0.1, 0.2, 0.9, 0.8],
      });
      expect(result.ready).toBe(false);
      expect(result.quality?.issues).toContainEqual(
        expect.objectContaining({
          code: 'PDF_TABLE_ALIGNED_TEXT_REVIEW',
          page: 1,
        }),
      );
      expect(result.parseStrategy).toContain('pdf-tables-v2');
      expect(result.evidence?.[0].text).toContain(text);
      const raw = uploadAsset.mock.calls.find(
        ([input]) => input.fileName === 'mineru-structure.json',
      )![0];
      expect(JSON.parse(raw.data.toString()).structuredContent).toEqual(
        structure,
      );
    },
  );
  it('retains ambiguous OCR unchanged and requests review instead of inventing cells', async () => {
    const text =
      '设备        偏差       状态\n探头甲  -1.25  待复核\n探头乙       0.00     合格';
    const { result } = await parse(text);
    expect(result.blocks?.some((x) => x.table)).toBe(false);
    expect(result.markdown).toContain(text);
    expect(result.ready).toBe(false);
    expect(result.quality?.issues[0].code).toBe('PDF_TABLE_STRUCTURE_REVIEW');
  });
});
