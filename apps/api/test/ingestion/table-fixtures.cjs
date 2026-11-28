const tableFixtures = () => [
  {
    name: 'merged-budget.html',
    title: '季度预算（万元）',
    table:
      '<table><thead><tr><th rowspan="2">部门</th><th colspan="2">预算（万元）</th></tr><tr><th>一季度</th><th>二季度</th></tr></thead><tbody><tr><td rowspan="2">研发</td><td>100</td><td>120</td></tr><tr><td>50</td><td>-5</td></tr><tr><td>运营</td><td>30</td><td>40</td></tr></tbody></table>',
    headers: ['部门', '预算（万元）', '一季度', '二季度'],
    rows: [
      ['研发', '100', '120'],
      ['研发', '50', '-5'],
      ['运营', '30', '40'],
    ],
    canonicalCells: 12,
    sum: {
      cells: [3, 4, 5].flatMap((row) =>
        [2, 3].map((column) => ({ row, column })),
      ),
      value: '335',
    },
  },
  {
    name: 'merged-decimals.html',
    title: '费用核对',
    table:
      '<table><thead><tr><th>项目</th><th>金额</th></tr></thead><tbody><tr><td>共享费用甲</td><td rowspan="2">12.50</td></tr><tr><td>共享费用乙</td></tr><tr><td>退款</td><td>-2.25</td></tr><tr><td>免费</td><td>0</td></tr><tr><td>未填</td><td></td></tr></tbody></table>',
    headers: ['项目', '金额'],
    rows: [
      ['共享费用甲', '12.50'],
      ['共享费用乙', '12.50'],
      ['退款', '-2.25'],
      ['免费', '0'],
      ['未填'],
    ],
    canonicalCells: 11,
    sum: {
      cells: [2, 4, 5].map((row) => ({ row, column: 2 })),
      value: '10.25',
    },
    rejectSum: [[{ row: 3, column: 2 }], [{ row: 6, column: 2 }]],
  },
  {
    name: 'long-budget.html',
    title: '部门预算',
    table:
      '<table><thead><tr><th>部门名称</th><th>预算万元</th></tr></thead><tbody>' +
      Array.from(
        { length: 24 },
        (_, i) =>
          `<tr><td>部门编号${String(i + 1).padStart(2, '0')}</td><td>${1001 + i}</td></tr>`,
      ).join('') +
      '</tbody></table>',
    headers: ['部门名称', '预算万元'],
    rows: Array.from({ length: 24 }, (_, i) => [
      `部门编号${String(i + 1).padStart(2, '0')}`,
      String(1001 + i),
    ]),
    canonicalCells: 50,
    sum: {
      cells: Array.from({ length: 24 }, (_, i) => ({ row: i + 2, column: 2 })),
      value: '24300',
    },
  },
  {
    name: 'long-merged-budget.html',
    title: '分组季度预算',
    table:
      '<table><thead><tr><th rowspan="2">部门</th><th colspan="2">预算（万元）</th></tr><tr><th>一季度</th><th>二季度</th></tr></thead><tbody>' +
      Array.from(
        { length: 24 },
        (_, i) =>
          `<tr>${i % 2 === 0 ? `<td rowspan="2">分组${String(i / 2 + 1).padStart(2, '0')}</td>` : ''}<td>${1001 + i}</td><td>${2001 + i}</td></tr>`,
      ).join('') +
      '</tbody></table>',
    headers: ['部门', '预算（万元）', '一季度', '二季度'],
    rows: Array.from({ length: 24 }, (_, i) => [
      `分组${String(Math.floor(i / 2) + 1).padStart(2, '0')}`,
      String(1001 + i),
      String(2001 + i),
    ]),
    canonicalCells: 64,
    sum: {
      cells: Array.from({ length: 24 }, (_, i) =>
        [2, 3].map((column) => ({ row: i + 3, column })),
      ).flat(),
      value: '72600',
    },
  },
];

module.exports = { tableFixtures };
