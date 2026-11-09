# 发布索引流水线

## 消息契约

- `document.index`：携带完整元数据和 Markdown，写入 Elasticsearch `kh_document`。
- `document.rag.rebuild`：携带 `documentId` 和 `version`，读取正文后分块、Embedding，写入 `kh_chunk`。
- `document.kg.rebuild`：携带 `documentId` 和 `version`，读取正文后分块，使用 Ollama 抽取实体和关系，写入 Neo4j 文档、Chunk、实体和关系节点。
- `document.kg.delete`：携带 `documentId`，删除该文档对应的图谱节点、Chunk、关系，并回收不再被任何 Chunk 引用的孤立实体。

RabbitMQ 使用持久化 topic exchange `knowbase.pipeline`，三个消费者使用独立 durable queue。发布可靠性、确认和重试契约见下节；旧配置 `RABBITMQ_REQUEUE_ON_ERROR` 不再使用。

## 发布与投递可靠性

采用 PostgreSQL 事务 Outbox + RabbitMQ publisher confirms + 手动消费确认，实现至少一次投递。数据库中“文档已发布”和“三条待投递任务”在同一事务提交。审核通过和显式发布复用同一入口，校验审核权限、待审核状态和 `parseStatus=READY`，锁定文档后更新状态并写入三条 Outbox 记录。读取 MongoDB 正文或任意 Outbox 插入失败会回滚该事务。

```text
发布请求
  -> PostgreSQL 事务：PUBLISHED + 三条 kh_pipeline_outbox
  -> 返回发布成功（表示任务已持久化，不表示索引全部就绪）

OutboxRelayService
  -> 查询到期的待投递记录，FOR UPDATE SKIP LOCKED
  -> 声明交换机、业务队列、死信队列和 binding
  -> persistent + mandatory + messageId + publisher confirm
  -> broker 确认且未退回消息后，记录 published_at
```

每轮最多发送 `OUTBOX_BATCH_SIZE` 条；本轮不会重入。Relay 在确认期间持有单条 Outbox 行锁，确认等待有超时，多实例通过 `SKIP LOCKED` 分摊任务。Broker 不可用、nack、无路由退回、确认超时都会保留待投递记录并指数退避，最多延迟 60 秒。投递层不会因暂时故障耗尽业务重试次数。

如果 broker 已接收，但应用在记录 `published_at` 前崩溃，Relay 会重新发送相同 `messageId`。因此该设计允许重复，不承诺端到端 exactly-once。

### 消费完成、重试与死信

每个业务队列使用独立 channel。`kh_pipeline_receipt` 按 `(consumer, event_id)` 记录完成状态和最近一次处理序号，行锁串行化同一事件的并发重复投递。重投已完成消息或旧的失败序号时直接跳过业务处理；只有数据库提交后才 `ack`。

业务处理失败时，在同一个数据库事务内：

1. 保存失败原因和本次处理序号。
2. 通过 Outbox 安排延迟重试；默认共尝试 3 次，间隔为 5 秒、10 秒。
3. 超过次数则将 receipt 标记 `DEAD`，并通过 Outbox 投递到 `<原 routing key>.dead`。

三个死信队列为 `knowbase.pipeline.search.dead`、`knowbase.pipeline.rag.dead`、`knowbase.pipeline.kg.dead`。死信保留原始消息体和稳定事件 ID，业务失败原因保存在 receipt 中；Outbox 的 `last_error` 记录待投递错误，投递确认后清空。JSON 格式错误也纳入有限次数重试。旧版无 `messageId` 的队列消息使用 routing key 与原始内容的摘要作为兼容 ID。

消费数据库不可用、写入重试失败或提交失败时，不确认原消息，而是关闭消费 channel，交给 broker 重新入队，之后按重连周期恢复。启动时 RabbitMQ 不可用不会阻止已持久化的发布请求；消费者会持续尝试连接。定时 Relay 同样会在连接恢复后重试。进程监听正常关闭信号以停止定时任务和关闭连接。

### 幂等的边界

receipt 能避免已经记录完成的重复业务处理，但不能让 PostgreSQL、Elasticsearch、Neo4j 共享事务。若索引写成功后进程在 receipt 提交前崩溃，仍会重新执行索引操作。当前全文使用文档 ID 覆盖，向量使用确定性 Chunk ID 和整文档替换，图谱在 Neo4j 事务内整文档替换，适合重做；ES bulk 的部分失败会抛错并进入重试。

receipt 记录不表示跨版本的索引一致性已经解决。旧版本任务与新版本任务并发、重建期间的可见性、删除与重建竞争、向量原子切换仍属于下一轮索引一致性加固。不要在这些消费者中加入无幂等键的付款、通知等不可重做副作用。

receipt 的锁会跨越索引处理过程，长时间模型调用会占用数据库连接；当前适合低并发 MVP。扩大吞吐前应评测连接池容量，并考虑带续租和 fencing 的任务租约方案。

### 配置与迁移

```dotenv
OUTBOX_RELAY_ENABLED=true
OUTBOX_POLL_INTERVAL_MS=1000
OUTBOX_BATCH_SIZE=20
RABBITMQ_CONNECT_TIMEOUT_MS=5000
RABBITMQ_CONFIRM_TIMEOUT_MS=10000
RABBITMQ_RECONNECT_INTERVAL_MS=5000
PIPELINE_MAX_ATTEMPTS=3
PIPELINE_RETRY_DELAY_MS=5000
```

首次创建数据卷会执行 `deploy/postgres/init/004_pipeline_delivery.sql`。已有数据库在启动新代码前执行（从仓库根目录）：

```bash
psql "$KNOWBASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/postgres/migrations/004_pipeline_delivery.sql
```

该迁移通过 psql 的 `\ir` 引用同一份初始化 SQL；使用 `-f` 执行以保留相对路径。SQL 编辑器可直接执行 `deploy/postgres/init/004_pipeline_delivery.sql` 内容。表结构可重复创建；Outbox/receipt 不设置关联文档的级联删除，删除文档后仍需保留未投递事件和处理记录。

运维查询示例：

```sql
SELECT id, event_id, routing_key, attempt, publish_attempts, available_at, last_error
FROM kh_pipeline_outbox WHERE published_at IS NULL ORDER BY available_at;

SELECT consumer, event_id, status, attempt, last_error, updated_at
FROM kh_pipeline_receipt WHERE status IN ('RETRY', 'DEAD') ORDER BY updated_at DESC;
```

修复失败原因后，可明确选择一个死信事件，通过创建新事件恢复处理。使用新的 event ID 保留原失败历史，不能直接在 RabbitMQ 重投原 messageId，因为 receipt 会跳过已标记 DEAD 的事件：

```sql
INSERT INTO kh_pipeline_outbox (id, event_id, routing_key, body, attempt)
SELECT gen_random_uuid(), gen_random_uuid()::text,
       regexp_replace(routing_key, '\.dead$', ''), body, 0
FROM kh_pipeline_outbox
WHERE id = '<待恢复的死信 Outbox UUID>' AND routing_key LIKE '%.dead';
```

重放前确认文档仍存在且状态与版本适用。死信队列没有自动消费者，避免持续失败形成无限循环。原死信需按运维流程处理。当前不自动清理 Outbox/receipt：完成记录必须覆盖消息可能重投的时间范围，过早清理会失去去重能力；保留周期和归档应在后续运维迭代中确定。

### 故障验收

在隔离开发环境完成迁移后：

1. 暂停 RabbitMQ，审核通过一份文档；应成功保存发布状态，出现三条待投递 Outbox，索引尚未就绪。
2. 恢复 RabbitMQ；无需重启 API，三条 Outbox 应陆续记录 `published_at`，消费者恢复连接。
3. 重投同一 `messageId` 与 attempt；已有 COMPLETED receipt 时不再调用索引服务。
4. 令 ES 或模型提供方持续失败；应先出现 RETRY，达到次数后为 DEAD，并最终投递到对应 `.dead` 队列。
5. 在重试安排后重启 API；重试时间与状态来自数据库，应继续执行。
6. 模拟消费完成但 ack 丢失，以及发送确认后 Outbox 提交失败；两种情况下均允许重复投递，重复处理受 receipt 和索引可重做语义约束。

以上验收要求实际 PostgreSQL 与 RabbitMQ 服务。单元故障测试验证确认、回滚、去重、重试和重连分支，不能替代真实 broker 重启测试。

## Search 全文检索

Search 管线消费 `document.index` 后，将已发布文档写入 Elasticsearch `kh_document`。查询接口只返回 `status=PUBLISHED` 的文档：

```http
GET /api/v1/search/documents?keyword=RabbitMQ&category=platform&page=1&pageSize=20
```

支持标题、正文、标签、分类和团队的关键词检索，以及分类、团队、标签过滤。返回文档元数据、匹配分数和正文高亮片段；不返回整篇 Markdown 正文，详情需要通过文档详情接口读取 MongoDB 内容。

## RAG 语义检索

RAG 查询接口将问题交给当前配置的 Embedding Provider，默认使用 Ollama `nomic-embed-text`，再通过 Elasticsearch `kh_chunk` 的 KNN 查询返回语义相近的 Markdown Chunk：

```http
POST /api/v1/search/semantic
Content-Type: application/json

{"query":"What port is Elasticsearch running on?","topK":3}
```

查询结果会回查 PostgreSQL，只保留当前仍为 `PUBLISHED` 的文档，并返回 Chunk 内容、相似度、文档标题、分类、团队和标签。

## 混合检索

混合检索接口并行执行关键词检索和向量检索，再按文档/Chunk 合并结果。当前使用简单加权：关键词得分占 40%，语义得分占 60%，用于后续接入更复杂的重排模型：

```http
POST /api/v1/search/hybrid
Content-Type: application/json

{"query":"How do I search the knowledge base?","topK":5}
```

## 知识图谱管线

KG 管线和 Search、RAG 一样由 RabbitMQ 异步触发。消费者收到文档 ID 后执行固定步骤：

```text
读取已发布文档
  -> MongoDB 读取 Markdown
  -> RecursiveCharacterTextSplitter 分块
  -> OllamaGraphExtractorService 逐 Chunk 抽取 JSON
  -> GraphExtractionService 归一化、去重、生成 mentions
  -> GraphIndexService 在 Neo4j 中幂等重建
```

Neo4j 中的核心结构是：

```text
(KnowledgeDocument)-[:HAS_CHUNK]->(DocumentChunk)-[:MENTIONS]->(KnowledgeEntity)
(KnowledgeEntity)-[:RELATED_TO {type, documentId, chunkId}]->(KnowledgeEntity)
```

同一文档重建时会先删除该文档的旧关系和 Chunk，再删除不再被 Chunk 引用的孤立实体，最后重新写入。删除文档时也走同一套清理规则。实体使用 `type:normalizedName` 作为 key，跨文档共享；关系保留来源文档和 Chunk，便于溯源和权限过滤。

图谱查询接口：

```http
GET /api/v1/graph/search?query=Ollama&maxHops=2&limit=20
Authorization: Bearer <token>
```

查询前先通过 PostgreSQL 计算当前用户可见的已发布文档 ID，Neo4j 查询会限制种子实体和路径关系必须来自这些文档，避免图谱查询绕过文档权限。

前端知识图谱页面使用 AntV G6 渲染，保留左侧路径列表和右侧来源面板。图谱区域使用左到右层级布局展示实体路径，节点通过实体类型上色，边通过关系类型标注，并高亮当前路径，便于直接查看实体、关系和溯源。

## RAG 配置

```env
RAG_CHUNK_SIZE=1000
RAG_CHUNK_OVERLAP=150
RAG_EMBEDDING_DIMENSIONS=768
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_CHAT_MODEL=qwen2.5:0.5b
OLLAMA_CHAT_TEMPERATURE=0
OLLAMA_CHAT_SEED=42
OLLAMA_KG_MODEL=qwen2.5:0.5b
OLLAMA_KG_TEMPERATURE=0
OLLAMA_KG_SEED=42
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Langfuse 配置和问答链路观测见 [docs/observability.md](observability.md)。

## AI 问答

AI 问答默认在混合检索之上调用 Ollama 对话模型。问题包含关系、依赖、上下游、多跳、影响等意图时，会追加图谱路径检索；图谱不可用时自动降级为混合检索。问答模块只把带有正文的 Chunk 或图谱路径作为上下文，关键词检索返回的纯文档元数据不会直接交给模型。

```http
POST /api/v1/rag/answer
Content-Type: application/json

{"question":"RAG 的基本流程是什么？","topK":5}
```

返回结构包含 `answer`、`citations` 和 `contexts`。回答中的 `[S1]` 等来源标记会被转换为结构化引用；没有可用 Chunk 时，接口直接返回“知识库中没有找到足够信息”，不会调用模型。

Markdown 使用 `RecursiveCharacterTextSplitter`，优先按标题和段落边界切分。默认使用本地 Ollama `nomic-embed-text` 生成 768 维向量，也可以将 `EMBEDDING_PROVIDER` 改为 `openai`。ES `kh_chunk.embedding` 使用 `dense_vector` 并启用 cosine 相似度。

如果之前已经使用其他维度创建过 `kh_chunk`，需要先删除旧索引再重新构建：

```bash
curl -X DELETE http://localhost:19200/kh_chunk
```

## 本地运行

```bash
docker compose -f deploy/docker-compose.yml up -d
cp .env.example apps/api/.env
brew services start ollama
ollama pull nomic-embed-text
pnpm --filter @knowbase/api start:dev
```

RabbitMQ AMQP 端口为 `15672`，管理界面为 `15673`；Elasticsearch 为 `19200`；Neo4j Bolt 为 `17687`，浏览器界面为 `17474`。
