# 第一阶段架构

## 模块边界

```text
DocumentsController
        |
DocumentsService
   _____|____________________
  |            |             |
PostgreSQL   MongoDB       RustFS
metadata     markdown      original file
```

`DocumentsService` 负责文档业务流程，不把 PostgreSQL 和 MongoDB 的访问逻辑泄露给 Controller。后续解析、索引和审核事件可以在 Service 后面增加异步任务或领域事件。

## 关键设计

- API 使用全局 JWT 鉴权；`ADMIN` 负责用户管理、审核和发布，`MEMBER` 负责上传和管理自己提交的文档。
- 文档可见性由 `PRIVATE`、`TEAM`、`PUBLIC` 三种策略表达。统一由 `DocumentAccessService` 判断，并复用于列表、详情、对象代理、全文检索、向量检索和 AI 问答。
- 客户端不再提交 `uploaderId` 或 `reviewerId`；这些身份都从 JWT 当前用户获取。

- `status` 表示业务审核生命周期。
- `parse_status` 表示正文是否已经准备好，和审核状态分离。
- `content_id` 是 PostgreSQL 当前正文版本和 MongoDB 正文的关联键。
- 文档正文更新创建新的 `content_id`，历史正文暂不删除，为后续版本历史保留空间。
- 文档列表默认只查询 PostgreSQL，文档详情才读取 MongoDB 正文。
- `POST /documents/:id/publish` 和审核通过入口在 PostgreSQL 事务中同时保存发布状态与三条 Outbox 任务，再由 Relay 确认投递到三条独立的 RabbitMQ 管线。可靠性和恢复契约见 [pipeline.md](pipeline.md#发布与投递可靠性)。

## 解析流水线

```text
FileParserService
  -> extension dispatcher
  -> PDF / XLSX / DOCX / PPTX / TXT / MD parser
  -> Markdown + assets + warnings
  -> RustFS assets
  -> MongoDB document_content
  -> PostgreSQL kh_document
```

图片正文使用 `/api/v1/storage/object?key=...` 的稳定 API 链接，不直接暴露 RustFS 地址。后续接入认证后，可以在该对象代理接口统一增加文档权限校验。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/v1/documents` | 上传文件并创建草稿 |
| GET | `/api/v1/documents` | 分页查询文档元数据 |
| GET | `/api/v1/documents/:id` | 查询元数据和 Markdown 正文 |
| PATCH | `/api/v1/documents/:id` | 更新标题、分类、团队和标签 |
| PUT | `/api/v1/documents/:id/content` | 更新 Markdown 正文并递增版本 |
| POST | `/api/v1/documents/:id/submit-review` | 提交审核 |
| POST | `/api/v1/documents/:id/review` | 管理员通过或驳回 |
| POST | `/api/v1/documents/:id/publish` | 发布待审核文档并投递索引任务 |
| DELETE | `/api/v1/documents/:id` | 删除文档及其存储资源 |

## 发布后的异步管线

```text
PUBLISHED
   |
   +--> RabbitMQ document.index ------> SearchConsumer --> Elasticsearch kh_document
   |
   +--> RabbitMQ document.rag.rebuild -> RagConsumer ------> Markdown Chunk
   |                                                    -> Ollama Embeddings
   |                                                    -> Elasticsearch kh_chunk
   |
   +--> RabbitMQ document.kg.rebuild --> KgConsumer ------> Markdown Chunk
                                                               -> Ollama entity/relation extraction
                                                               -> Neo4j graph
```

Search 消息携带整篇文档元数据和 Markdown；RAG、KG 消息只携带文档 ID 和版本，消费者重新从 PostgreSQL/MongoDB 读取正文。三条队列相互独立，单条管线失败不会阻塞其他管线。

KG 管线通过 `OllamaGraphExtractorService` 调用模型，通过 `GraphExtractionService` 做跨 Chunk 的实体归一化和关系去重，通过 `GraphGenerationWriter` 写入独立 Neo4j 批次；`GraphIndexService` 负责可见性过滤和查询。图谱查询由独立的 `KnowledgeGraphModule` 提供，并复用文档权限过滤。

删除文档时，Documents 模块在同一 PostgreSQL 事务中保存三路删除标记、清理 Outbox 并删除元数据；全文、向量、图谱和源文件随后异步清理。三路索引按独立 generation 构建，完整写入后锁定文档复查修订号，再切换 PostgreSQL 可见指针。查询同时限制当前发布版本、文档权限和有效 generation，旧任务不能激活已过期或已删除文档。协议、升级与重建步骤见 [pipeline.md](pipeline.md#索引版本与可见批次)。
