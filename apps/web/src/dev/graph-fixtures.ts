import type { GraphSearchEntity, GraphSearchPath } from '@/lib/api';

const names = [
  'Knowbase',
  '文档服务',
  'RabbitMQ',
  'KG 消费者',
  'Neo4j',
  'Ollama',
  'qwen2.5:0.5b',
  'Elasticsearch',
  '向量索引',
  '混合检索',
  'RAG 问答',
  'Markdown 分块',
  '知识抽取',
  '结构化输出',
  '权限校验',
  '审核工作流',
  'PostgreSQL',
  'MongoDB',
  'RustFS',
  '检索排序',
  '知识来源',
  '版本清理',
  '跨部门知识共享与细粒度文档访问权限校验服务（长名称）',
  'API <gateway> & "routing"',
];
const types = [
  '系统',
  '服务',
  '消息队列',
  '服务',
  '图数据库',
  '模型',
  '模型',
  '检索',
];
const entity = (index: number): GraphSearchEntity => ({
  key: `lab:${index}`,
  name: names[index] ?? `知识实体 ${index}`,
  type: types[index % types.length],
});

function path(
  indices: number[],
  index: number,
  relation = '依赖',
): GraphSearchPath {
  const entities = indices.map(entity);
  return {
    seed: entity(0),
    entities,
    relations: entities.slice(1).map((_, hop) => ({
      key: `lab:r:${index}:${hop}`,
      type: hop === 0 ? relation : ['调用', '写入', '回溯'][hop % 3],
      documentId: `lab-doc-${index % 4}`,
      chunkId: `lab-doc-${index % 4}:c${index}`,
    })),
  };
}

export const complexPaths = Array.from({ length: 20 }, (_, i) =>
  path(
    i === 0
      ? [0, 1, 2, 0]
      : i === 1
        ? [0, 1, 1, 3]
        : i === 2
          ? [0, 2, 1, 4]
          : i === 3
            ? [0, 1, 5, 6]
            : [0, i + 1, ((i * 7) % 23) + 1, ((i * 11) % 23) + 1],
    i,
    i === 3 ? '发布（并行关系）' : '依赖',
  ),
);

export const graphScenarios = {
  complex: {
    label: '复杂网络 · 环路 / 自环 / 平行边 / 长名称',
    paths: complexPaths,
  },
  wide: {
    label: '接口上限 · 20 条三跳路径 / 61 个实体',
    paths: Array.from({ length: 20 }, (_, i) =>
      path([0, i * 3 + 1, i * 3 + 2, i * 3 + 3], i),
    ),
  },
  stress: {
    label: '额外压力 · 99 个实体 / 80 条路径（超出接口上限）',
    paths: Array.from({ length: 80 }, (_, i) =>
      path([0, i + 1, ((i * 17) % 99) + 1, ((i * 29) % 99) + 1], i),
    ),
  },
  single: { label: '单实体', paths: [path([0], 0)] },
  empty: { label: '空图', paths: [] as GraphSearchPath[] },
};

export type GraphScenario = keyof typeof graphScenarios;
