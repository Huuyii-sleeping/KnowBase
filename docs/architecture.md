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

- `status` 表示业务审核生命周期。
- `parse_status` 表示正文是否已经准备好，和审核状态分离。
- `content_id` 是 PostgreSQL 当前正文版本和 MongoDB 正文的关联键。
- 文档正文更新创建新的 `content_id`，历史正文暂不删除，为后续版本历史保留空间。
- 文档列表默认只查询 PostgreSQL，文档详情才读取 MongoDB 正文。
- 所有已发布文档通过 `POST /documents/:id/publish` 或审核通过入口触发三条独立的 RabbitMQ 管线。

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
   |                                                    -> OpenAI Embeddings
   |                                                    -> Elasticsearch kh_chunk
   |
   +--> RabbitMQ document.kg.rebuild --> KgConsumer ------> Neo4j Document/Chunk graph
```

Search 消息携带整篇文档元数据和 Markdown；RAG、KG 消息只携带文档 ID 和版本，消费者重新从 PostgreSQL/MongoDB 读取正文。三条队列相互独立，单条管线失败不会阻塞其他管线。

当前 KG 管线已经完成文档和 chunk 节点的幂等重建，实体/关系抽取作为下一步接入 LLM 的独立组件。
