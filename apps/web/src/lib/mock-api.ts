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

const store: DocumentMeta[] = [
  makeDoc({ title: '产品需求文档 v3.pdf', status: 'PUBLISHED', parseStatus: 'READY', fileSize: 2.4 * 1024 * 1024, version: 3, category: '产品', team: '平台组', tags: ['PRD', '2026'], updatedAt: minutesAgo(10), submittedAt: minutesAgo(60 * 26), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 14) }),
  makeDoc({ title: 'Q3 数据复盘.xlsx', status: 'PENDING_REVIEW', parseStatus: 'READY', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: 812 * 1024, category: '运营', team: '增长组', tags: ['复盘'], uploaderId: 'lily', updatedAt: minutesAgo(120), submittedAt: minutesAgo(130) }),
  makeDoc({ title: '客户访谈录音.mp4', status: 'DRAFT', parseStatus: 'PENDING', mimeType: 'video/mp4', fileSize: 128 * 1024 * 1024, category: '用研', team: '平台组', tags: ['访谈'], updatedAt: minutesAgo(60 * 20) }),
  makeDoc({ title: '旧版报价方案.docx', status: 'REJECTED', parseStatus: 'FAILED', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSize: 356 * 1024, version: 2, category: '销售', uploaderId: 'tom', updatedAt: minutesAgo(60 * 72), submittedAt: minutesAgo(60 * 96), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 80), rejectionReason: '报价口径与最新折扣策略不一致，请更新后重新提交。', parseError: 'officeparser 兜底解析失败：文档包含损坏的嵌入对象。' }),
  makeDoc({ title: '后端架构评审纪要.md', status: 'PENDING_REVIEW', parseStatus: 'READY', mimeType: 'text/markdown', fileSize: 18 * 1024, category: '研发', team: '平台组', tags: ['架构', '评审'], updatedAt: minutesAgo(60 * 22), submittedAt: minutesAgo(60 * 22) }),
  makeDoc({ title: '新员工入职指南.pdf', status: 'PUBLISHED', parseStatus: 'READY', fileSize: 1.1 * 1024 * 1024, category: '人事', tags: ['入职'], uploaderId: 'hr-anna', updatedAt: minutesAgo(60 * 50), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 49), submittedAt: minutesAgo(60 * 52) }),
  makeDoc({ title: '2026 年度 OKR 汇总.xlsx', status: 'PUBLISHED', parseStatus: 'READY', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: 240 * 1024, category: '管理', team: null, tags: ['OKR'], uploaderId: 'ceo-office', updatedAt: minutesAgo(60 * 100), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 99), submittedAt: minutesAgo(60 * 101) }),
  makeDoc({ title: '私有化部署手册.docx', status: 'DRAFT', parseStatus: 'READY', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSize: 690 * 1024, category: '研发', team: '平台组', tags: ['部署', '运维'], updatedAt: minutesAgo(60 * 5) }),
  makeDoc({ title: '竞品分析：Notion vs 飞书.pdf', status: 'DRAFT', parseStatus: 'PENDING', fileSize: 3.2 * 1024 * 1024, category: '产品', team: '平台组', tags: ['竞品'], updatedAt: minutesAgo(45) }),
  makeDoc({ title: '客服 SOP v2.md', status: 'REJECTED', parseStatus: 'READY', mimeType: 'text/markdown', fileSize: 22 * 1024, version: 2, category: '客服', uploaderId: 'lily', updatedAt: minutesAgo(60 * 30), submittedAt: minutesAgo(60 * 40), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 32), rejectionReason: '第 3 章退款流程与财务新规冲突，请修订后重提。' }),
  makeDoc({ title: '数据字典-订单域.xlsx', status: 'PUBLISHED', parseStatus: 'READY', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: 512 * 1024, category: '研发', team: '数据组', tags: ['数据字典'], updatedAt: minutesAgo(60 * 200), reviewedBy: 'admin', reviewedAt: minutesAgo(60 * 198), submittedAt: minutesAgo(60 * 199) }),
  makeDoc({ title: '市场投放复盘.pptx', status: 'PENDING_REVIEW', parseStatus: 'READY', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fileSize: 5.6 * 1024 * 1024, category: '市场', team: '增长组', tags: ['投放', '复盘'], uploaderId: 'tom', updatedAt: minutesAgo(60 * 8), submittedAt: minutesAgo(60 * 7) }),
];

function latency(ms = 220) {
  return new Promise((r) => setTimeout(r, ms));
}

function toDetail(meta: DocumentMeta): DocumentDetail {
  return {
    ...meta,
    content:
      meta.parseStatus === 'READY'
        ? {
            contentId: meta.contentId,
            markdown: MARKDOWN_SAMPLE,
            parser: 'provided-markdown',
            warnings: [],
            version: meta.version,
            assets: [],
            characterCount: MARKDOWN_SAMPLE.length,
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
