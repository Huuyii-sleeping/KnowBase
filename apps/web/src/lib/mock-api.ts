/**
 * Mock 数据源：与 documentsApi 同接口的内存实现。
 * 通过 URL 参数 ?mock=1 开启（写入 sessionStorage，刷新后保持），?mock=0 关闭。
 * 仅用于无后端环境下的交互演示。
 */
import type {
  DocumentDetail,
  DocumentListResult,
  DocumentMeta,
  DocumentParseStatus,
  DocumentStatus,
  GraphSearchEntity,
  GraphSearchResult,
  GraphSearchPath,
  GraphSearchRelation,
  ListDocumentsQuery,
} from './api';

export function isMockEnabled(): boolean {
  const param = new URLSearchParams(window.location.search).get('mock');
  if (param === '1') sessionStorage.setItem('knowbase-mock', '1');
  if (param === '0') sessionStorage.removeItem('knowbase-mock');
  return sessionStorage.getItem('knowbase-mock') === '1';
}

const MARKDOWN_SAMPLE = `# 产品需求文档 v3

## 1. 背景与目标

企业知识库第一阶段聚焦**文档模块**：完成从文件上传到 \`PostgreSQL + MongoDB\` 双库分层持久化的闭环，并建立企业文档审核生命周期。

## 2. 成功标准

- 原始文件写入 RustFS，元数据写入 \`kh_document\`
- Markdown 正文写入 \`document_content\`，通过 content_id 关联
- 文档支持草稿、待审核、已发布、已驳回四种业务状态
- 只有 Markdown 解析状态为 READY 的文档才能提交审核

## 3. 解析支持矩阵

| 类型 | 主解析器 | 输出规则 |
| --- | --- | --- |
| PDF | pdf-parse | 按页输出 \`## Page N\`，提取文本与表格 |
| XLSX | exceljs | 每个 Sheet 输出 Markdown 表格 |
| DOCX | mammoth + turndown | DOCX 转 HTML 再转 Markdown |
| PPTX | jszip + XML | 按幻灯片提取文本、表格和图片 |

### 3.1 兜底策略

主解析器失败时使用 \`officeparser\` 的 AST 转 Markdown 作为兜底，并把解析器名称、警告和失败原因写入文档结果。

> 当前边界：本阶段实现文件和正文的存储、文档业务状态及 CRUD。音视频的真实解析由后续 ingestion worker 接入。
`;

const MARKDOWN_BY_TITLE: Record<string, string> = {
  '产品需求文档 v3.pdf': `# 产品需求文档 v3

## 1. 知识图谱目标

发布后的文档会进入 KG 管线，生成可回溯的文档图谱。

## 2. 图谱结构

- \`KnowledgeDocument\` 保存文档元数据和版本
- \`DocumentChunk\` 保存分块正文和 chunkId
- \`KnowledgeEntity\` 保存抽取出的实体
- \`RELATED_TO\` 保存实体间关系，并携带 documentId / chunkId 方便溯源

## 3. 验证场景

- 查询 RAG、Neo4j、RabbitMQ、Ollama
- 点击图谱关系后回看来源文档与 chunk
`,
  '后端架构评审纪要.md': `# 后端架构评审纪要

## 图谱管线

- RabbitMQ 的 \`document.kg.rebuild\` 消息触发 KG 重建
- \`KgConsumer\` 读取 Markdown 后按 Chunk 抽取实体和关系
- \`GraphExtractionService\` 负责跨 Chunk 归一化和去重
- \`GraphIndexService\` 幂等重建 Neo4j

## 风险点

- 必须保留 relation 的 \`documentId\` 和 \`chunkId\`
- 删除文档时需要回收孤立实体
`,
  '知识图谱构建说明.md': `# 知识图谱构建说明

## 抽取约束

- 实体类型保持稳定：人、组织、系统、模型、图数据库、流程
- 关系类型保持可读：依赖、调用、触发、写入、包含、使用
- 关系必须带来源：\`documentId\`、\`chunkId\`

## 三层结构

- \`KnowledgeDocument\`：文档元数据和版本
- \`DocumentChunk\`：按段落或标题切分后的文本块
- \`KnowledgeEntity\`：从 chunk 中抽取的实体
- \`HAS_CHUNK\`、\`MENTIONS\`、\`RELATED_TO\`：用于串起文档、Chunk 与实体溯源
`,
  'RAG 检索方案.md': `# RAG 检索方案

## 检索链路

1. 文档按标题和段落切分成 Markdown Chunk
2. Chunk 写入向量索引
3. 问答阶段先走混合检索，再视情况追加图谱路径

## 关键依赖

- Ollama
- \`nomic-embed-text\`
- Elasticsearch \`kh_chunk\`
- 知识图谱路径
`,
  '私有化部署手册.docx': `# 私有化部署手册

## 运行端口

- Neo4j Bolt: 17687
- Neo4j Browser: 17474
- Ollama: 11434

## 运行组件

- \`qwen2.5:0.5b\`
- \`nomic-embed-text\`
- \`Neo4j\`
- \`RabbitMQ\`
`,
};

let seq = 100;
const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60000).toISOString();

function makeDoc(partial: Partial<DocumentMeta> & Pick<DocumentMeta, 'title' | 'status' | 'parseStatus'>): DocumentMeta {
  const id = `mock-${(seq++).toString(16).padStart(4, '0')}-4f2a-8b1c-9d0e-1234567890ab`;
  return {
    fileName: partial.title,
    mimeType: 'application/pdf',
    fileSize: 1024 * 1024,
    storageKey: `documents/2026/08/${id}`,
    contentId: `content-${id}`,
    uploaderId: 'huayi',
    category: null,
    team: null,
    tags: [],
    parseError: null,
    rejectionReason: null,
    version: 1,
    permissions: {},
    statistics: { viewCount: 0, queryCount: 0 },
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: minutesAgo(60 * 24 * 7),
    updatedAt: minutesAgo(30),
    ...partial,
    id,
  };
}

const docPrd = makeDoc({
  title: '产品需求文档 v3.pdf',
  status: 'PUBLISHED',
  parseStatus: 'READY',
  fileSize: 2.4 * 1024 * 1024,
  version: 3,
  category: '产品',
  team: '平台组',
  tags: ['PRD', '2026'],
  updatedAt: minutesAgo(10),
  submittedAt: minutesAgo(60 * 26),
  reviewedBy: 'admin',
  reviewedAt: minutesAgo(60 * 14),
});

const docArchitectureReview = makeDoc({
  title: '后端架构评审纪要.md',
  status: 'PUBLISHED',
  parseStatus: 'READY',
  mimeType: 'text/markdown',
  fileSize: 18 * 1024,
  category: '研发',
  team: '平台组',
  tags: ['架构', '评审'],
  updatedAt: minutesAgo(60 * 22),
  submittedAt: minutesAgo(60 * 22),
  reviewedBy: 'admin',
  reviewedAt: minutesAgo(60 * 18),
});

const docKgGuide = makeDoc({
  title: '知识图谱构建说明.md',
  status: 'PUBLISHED',
  parseStatus: 'READY',
  mimeType: 'text/markdown',
  fileSize: 26 * 1024,
  category: '研发',
  team: '平台组',
  tags: ['KG', '图谱'],
  updatedAt: minutesAgo(60 * 4),
  submittedAt: minutesAgo(60 * 5),
  reviewedBy: 'admin',
  reviewedAt: minutesAgo(60 * 3),
});

const docPipelineGuide = makeDoc({
  title: 'RAG 检索方案.md',
  status: 'PUBLISHED',
  parseStatus: 'READY',
  mimeType: 'text/markdown',
  fileSize: 18 * 1024,
  category: '研发',
  team: '平台组',
  tags: ['RAG', '向量检索'],
  updatedAt: minutesAgo(60 * 6),
  submittedAt: minutesAgo(60 * 7),
  reviewedBy: 'admin',
  reviewedAt: minutesAgo(60 * 5),
});

const docDeployGuide = makeDoc({
  title: '私有化部署手册.docx',
  status: 'PUBLISHED',
  parseStatus: 'READY',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  fileSize: 690 * 1024,
  category: '研发',
  team: '平台组',
  tags: ['部署', '运维'],
  updatedAt: minutesAgo(60 * 12),
});

const store: DocumentMeta[] = [
  docPrd,
  makeDoc({ title: 'Q3 数据复盘.xlsx', status: 'PENDING_REVIEW', parseStatus: 'READY', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: 812 * 1024, category: '运营', team: '增长组', tags: ['复盘'], uploaderId: 'lily', updatedAt: minutesAgo(120), submittedAt: minutesAgo(130) }),
  makeDoc({ title: '客户访谈录音.mp4', status: 'DRAFT', parseStatus: 'PENDING', mimeType: 'video/mp4', fileSize: 128 * 1024 * 1024, category: '用研', team: '平台组', tags: ['访谈'], updatedAt: minutesAgo(60 * 20) }),
  makeDoc({ title: '旧版报价方案.docx', status: 'REJECTED', parseStatus: 'FAILED', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSize: 356 * 1024, version: 2, category: '销售', uploaderId: 'tom', updatedAt: minutesAgo(60 * 72), submittedAt: minutesAgo(60 * 96), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 80), rejectionReason: '报价口径与最新折扣策略不一致，请更新后重新提交。', parseError: 'officeparser 兜底解析失败：文档包含损坏的嵌入对象。' }),
  docArchitectureReview,
  makeDoc({ title: '新员工入职指南.pdf', status: 'PUBLISHED', parseStatus: 'READY', fileSize: 1.1 * 1024 * 1024, category: '人事', tags: ['入职'], uploaderId: 'hr-anna', updatedAt: minutesAgo(60 * 50), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 49), submittedAt: minutesAgo(60 * 52) }),
  makeDoc({ title: '2026 年度 OKR 汇总.xlsx', status: 'PUBLISHED', parseStatus: 'READY', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: 240 * 1024, category: '管理', team: null, tags: ['OKR'], uploaderId: 'ceo-office', updatedAt: minutesAgo(60 * 100), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 99), submittedAt: minutesAgo(60 * 101) }),
  docKgGuide,
  docPipelineGuide,
  docDeployGuide,
  makeDoc({ title: '竞品分析：Notion vs 飞书.pdf', status: 'DRAFT', parseStatus: 'PENDING', fileSize: 3.2 * 1024 * 1024, category: '产品', team: '平台组', tags: ['竞品'], updatedAt: minutesAgo(45) }),
  makeDoc({ title: '客服 SOP v2.md', status: 'REJECTED', parseStatus: 'READY', mimeType: 'text/markdown', fileSize: 22 * 1024, version: 2, category: '客服', uploaderId: 'lily', updatedAt: minutesAgo(60 * 30), submittedAt: minutesAgo(60 * 40), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 32), rejectionReason: '第 3 章退款流程与财务新规冲突，请修订后重提。' }),
  makeDoc({ title: '数据字典-订单域.xlsx', status: 'PUBLISHED', parseStatus: 'READY', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: 512 * 1024, category: '研发', team: '数据组', tags: ['数据字典'], updatedAt: minutesAgo(60 * 200), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 198), submittedAt: minutesAgo(60 * 199) }),
  makeDoc({ title: '市场投放复盘.pptx', status: 'PENDING_REVIEW', parseStatus: 'READY', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fileSize: 5.6 * 1024 * 1024, category: '市场', team: '增长组', tags: ['投放', '复盘'], uploaderId: 'tom', updatedAt: minutesAgo(60 * 8), submittedAt: minutesAgo(60 * 7) }),
];

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function makeEntity(type: string, name: string): GraphSearchEntity {
  return {
    key: `${normalizeKey(type)}:${normalizeKey(name)}`,
    name,
    type,
  };
}

function makeChunkId(document: DocumentMeta, chunkIndex: number): string {
  return `${document.id}:v${document.version}:c${chunkIndex}`;
}

function makeRelation(
  document: DocumentMeta,
  chunkIndex: number,
  source: GraphSearchEntity,
  target: GraphSearchEntity,
  type: string,
): GraphSearchRelation {
  const chunkId = makeChunkId(document, chunkIndex);
  return {
    key: `${chunkId}:${source.key}:${target.key}:${normalizeKey(type)}`,
    type,
    documentId: document.id,
    chunkId,
  };
}

const entityRag = makeEntity('概念', 'RAG');
const entityHybridSearch = makeEntity('检索策略', '混合检索');
const entityGraphPath = makeEntity('能力', '知识图谱');
const entityRabbitMq = makeEntity('消息队列', 'RabbitMQ');
const entityKgConsumer = makeEntity('消费者', 'KgConsumer');
const entityGraphIndex = makeEntity('服务', 'GraphIndexService');
const entityNeo4j = makeEntity('图数据库', 'Neo4j');
const entityOllama = makeEntity('模型服务', 'Ollama');
const entityQwen = makeEntity('模型', 'qwen2.5:0.5b');
const entityStructuredOutput = makeEntity('抽取约束', 'structured output');
const entityKnowledgeDocument = makeEntity('概念', 'KnowledgeDocument');
const entityDocumentChunk = makeEntity('概念', 'DocumentChunk');
const entityKnowledgeEntity = makeEntity('概念', 'KnowledgeEntity');
const entityKnowBase = makeEntity('产品', 'KnowBase');
const entityMarkdownChunk = makeEntity('分块', 'Markdown Chunk');

const graphPaths: GraphSearchPath[] = [
  {
    seed: entityRag,
    entities: [entityRag, entityHybridSearch],
    relations: [makeRelation(docPipelineGuide, 0, entityRag, entityHybridSearch, '依赖')],
  },
  {
    seed: entityRag,
    entities: [entityRag, entityHybridSearch, entityGraphPath],
    relations: [
      makeRelation(docPipelineGuide, 1, entityRag, entityHybridSearch, '依赖'),
      makeRelation(docPipelineGuide, 1, entityHybridSearch, entityGraphPath, '追加'),
    ],
  },
  {
    seed: entityRabbitMq,
    entities: [entityRabbitMq, entityGraphIndex],
    relations: [makeRelation(docArchitectureReview, 0, entityRabbitMq, entityGraphIndex, '投递')],
  },
  {
    seed: entityRabbitMq,
    entities: [entityRabbitMq, entityKgConsumer, entityNeo4j],
    relations: [
      makeRelation(docArchitectureReview, 1, entityRabbitMq, entityKgConsumer, '触发'),
      makeRelation(docArchitectureReview, 1, entityKgConsumer, entityNeo4j, '写入'),
    ],
  },
  {
    seed: entityRabbitMq,
    entities: [entityRabbitMq, entityKgConsumer, entityNeo4j, entityKnowledgeEntity],
    relations: [
      makeRelation(docArchitectureReview, 2, entityRabbitMq, entityKgConsumer, '触发'),
      makeRelation(docArchitectureReview, 2, entityKgConsumer, entityNeo4j, '写入'),
      makeRelation(docArchitectureReview, 2, entityNeo4j, entityKnowledgeEntity, '管理'),
    ],
  },
  {
    seed: entityNeo4j,
    entities: [entityNeo4j, entityGraphIndex, entityKnowledgeEntity],
    relations: [
      makeRelation(docKgGuide, 0, entityNeo4j, entityGraphIndex, '承载'),
      makeRelation(docKgGuide, 0, entityGraphIndex, entityKnowledgeEntity, '写入'),
    ],
  },
  {
    seed: entityOllama,
    entities: [entityOllama, entityQwen],
    relations: [makeRelation(docDeployGuide, 0, entityOllama, entityQwen, '运行')],
  },
  {
    seed: entityOllama,
    entities: [entityOllama, entityQwen, entityStructuredOutput],
    relations: [
      makeRelation(docDeployGuide, 1, entityOllama, entityQwen, '调用'),
      makeRelation(docDeployGuide, 1, entityQwen, entityStructuredOutput, '约束'),
    ],
  },
  {
    seed: entityKnowBase,
    entities: [entityKnowBase, entityGraphPath],
    relations: [makeRelation(docPrd, 0, entityKnowBase, entityGraphPath, '包含')],
  },
  {
    seed: entityKnowBase,
    entities: [entityKnowBase, entityGraphPath, entityNeo4j],
    relations: [
      makeRelation(docPrd, 1, entityKnowBase, entityGraphPath, '包含'),
      makeRelation(docPrd, 1, entityGraphPath, entityNeo4j, '依赖'),
    ],
  },
  {
    seed: entityKnowledgeDocument,
    entities: [entityKnowledgeDocument, entityDocumentChunk],
    relations: [makeRelation(docKgGuide, 1, entityKnowledgeDocument, entityDocumentChunk, '包含')],
  },
  {
    seed: entityKnowledgeDocument,
    entities: [entityKnowledgeDocument, entityDocumentChunk, entityKnowledgeEntity],
    relations: [
      makeRelation(docKgGuide, 2, entityKnowledgeDocument, entityDocumentChunk, '包含'),
      makeRelation(docKgGuide, 2, entityDocumentChunk, entityKnowledgeEntity, '提及'),
    ],
  },
  {
    seed: entityMarkdownChunk,
    entities: [entityMarkdownChunk, entityKnowledgeEntity],
    relations: [makeRelation(docKgGuide, 3, entityMarkdownChunk, entityKnowledgeEntity, '抽取')],
  },
];

function latency(ms = 220) {
  return new Promise((r) => setTimeout(r, ms));
}

function toDetail(meta: DocumentMeta): DocumentDetail {
  const markdown = MARKDOWN_BY_TITLE[meta.title] ?? MARKDOWN_SAMPLE;
  return {
    ...meta,
    content:
      meta.parseStatus === 'READY'
        ? {
            contentId: meta.contentId,
            markdown,
            parser: 'provided-markdown',
            warnings: [],
            version: meta.version,
            assets: [],
            characterCount: markdown.length,
          }
        : undefined,
  };
}

export const mockDocumentsApi = {
  async list(query: ListDocumentsQuery = {}): Promise<DocumentListResult> {
    await latency();
    let items = [...store].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.status) items = items.filter((d) => d.status === query.status);
    if (query.category) items = items.filter((d) => d.category === query.category);
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      items = items.filter(
        (d) => d.title.toLowerCase().includes(kw) || d.tags.some((t) => t.toLowerCase().includes(kw)),
      );
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const total = items.length;
    return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total };
  },

  async detail(id: string): Promise<DocumentDetail> {
    await latency();
    const meta = store.find((d) => d.id === id);
    if (!meta) throw new Error('文档不存在（mock）');
    return toDetail(meta);
  },

  async create(file: File, meta: { title?: string; category?: string; team?: string; tags?: string[] }): Promise<DocumentDetail> {
    await latency(500);
    const doc = makeDoc({
      title: meta.title || file.name,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      status: 'DRAFT',
      parseStatus: 'PENDING',
      category: meta.category ?? null,
      team: meta.team ?? null,
      tags: meta.tags ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.unshift(doc);
    return toDetail(doc);
  },

  async update(id: string, meta: { title?: string; category?: string; team?: string; tags?: string[] }): Promise<DocumentDetail> {
    await latency();
    const doc = store.find((d) => d.id === id);
    if (!doc) throw new Error('文档不存在（mock）');
    if (meta.title !== undefined) doc.title = meta.title;
    if (meta.category !== undefined) doc.category = meta.category;
    if (meta.team !== undefined) doc.team = meta.team;
    if (meta.tags !== undefined) doc.tags = meta.tags;
    doc.updatedAt = new Date().toISOString();
    return toDetail(doc);
  },

  async updateContent(id: string, _markdown: string): Promise<DocumentDetail> {
    await latency(400);
    const doc = store.find((d) => d.id === id);
    if (!doc) throw new Error('文档不存在（mock）');
    doc.version += 1;
    doc.status = 'DRAFT';
    doc.parseStatus = 'READY';
    doc.updatedAt = new Date().toISOString();
    return toDetail(doc);
  },

  async submitReview(id: string): Promise<DocumentDetail> {
    await latency();
    const doc = store.find((d) => d.id === id);
    if (!doc) throw new Error('文档不存在（mock）');
    if (doc.parseStatus !== 'READY') throw new Error('仅解析状态为「就绪」的文档可提交审核');
    doc.status = 'PENDING_REVIEW';
    doc.submittedAt = new Date().toISOString();
    doc.updatedAt = new Date().toISOString();
    return toDetail(doc);
  },

  async review(id: string, approved: boolean, reason?: string): Promise<DocumentDetail> {
    await latency();
    const doc = store.find((d) => d.id === id);
    if (!doc) throw new Error('文档不存在（mock）');
    doc.status = approved ? 'PUBLISHED' : 'REJECTED';
    doc.reviewedBy = 'huayi';
    doc.reviewedAt = new Date().toISOString();
    doc.rejectionReason = approved ? null : reason ?? null;
    doc.updatedAt = new Date().toISOString();
    return toDetail(doc);
  },

  async remove(id: string): Promise<void> {
    await latency();
    const index = store.findIndex((d) => d.id === id);
    if (index >= 0) store.splice(index, 1);
  },
};

function matchesGraphPath(path: GraphSearchPath, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    path.seed.name,
    path.seed.type,
    ...path.entities.map((entity) => `${entity.name} ${entity.type}`),
    ...path.relations.map((relation) => relation.type),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

export const mockGraphApi = {
  async search(query: string, maxHops: number, limit: number): Promise<GraphSearchResult> {
    await latency(180);
    const normalizedMaxHops = Number.isFinite(maxHops) ? Math.max(1, Math.trunc(maxHops)) : 1;
    const items = graphPaths
      .filter((path) => path.relations.length <= normalizedMaxHops)
      .filter((path) => matchesGraphPath(path, query))
      .sort((a, b) => a.relations.length - b.relations.length)
      .slice(0, limit);
    return {
      query,
      maxHops,
      items,
    };
  },
};
