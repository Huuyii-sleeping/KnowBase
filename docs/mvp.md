# 第一阶段：文档模块

## 目标

完成文档从文件上传到双库分层持久化的闭环，并建立企业文档审核生命周期。

## 成功标准

- 原始 PDF、TXT、Markdown、音频或视频文件可以写入 RustFS。
- 文档元数据写入 PostgreSQL 的 `kh_document`。
- Markdown 正文独立写入 MongoDB 的 `document_content`。
- PostgreSQL 和 MongoDB 通过 `content_id` 关联。
- 文档支持草稿、待审核、已发布、已驳回四种业务状态。
- 只有 Markdown 解析状态为 `READY` 的文档才能提交审核。
- 只有已发布文档才允许进入后续 Chunk、图谱、全文和向量索引流程。
- 文档元数据和正文均具备 CRUD 接口。

## 解析支持

| 类型 | 主解析器 | 输出规则 |
| --- | --- | --- |
| PDF | `pdf-parse` | 按页输出 `## Page N`，提取文本、表格和可解码图片 |
| XLSX | `exceljs` | 每个 Sheet 输出 `# SheetName`，数据输出 Markdown 表格 |
| DOCX | `mammoth` + `turndown` | DOCX 转 HTML，再转 Markdown，图片上传 RustFS |
| PPTX | `jszip` + XML | 按幻灯片提取文本、表格和图片 |
| TXT | Node Buffer | 添加文档标题后输出 Markdown |
| MD | Node Buffer | 保留 Markdown 正文 |

主解析器失败时使用 `officeparser` 的 AST 转 Markdown 作为兜底，并把解析器名称、警告和失败原因写入文档结果。

## 当前边界

本阶段实现文件和正文的存储、文档业务状态及 CRUD。PDF、音频、视频的真实解析器由后续 ingestion worker 接入；当前接口支持解析服务通过 `markdown` 字段回传标准化正文，并对尚未解析的媒体文件标记 `parseStatus=PENDING`。

## 生命周期

```text
DRAFT -> PENDING_REVIEW -> PUBLISHED
                    \-> REJECTED -> PENDING_REVIEW
```

文档内容更新会生成新的 `content_id`，版本号递增，并回到 `DRAFT`，避免已发布内容被静默替换。

## 存储职责

| 存储 | 内容 |
| --- | --- |
| RustFS | 原始二进制文件和后续图片资源 |
| PostgreSQL | 元数据、状态、权限、统计、版本和审核信息 |
| MongoDB | 当前版本的完整 Markdown 正文和正文资源引用 |
