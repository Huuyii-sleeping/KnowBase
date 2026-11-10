# 发布索引流水线

## 消息契约

- `document.index`：携带完整元数据和 Markdown，写入 Elasticsearch `kh_document`。
- `document.rag.rebuild`：携带 `documentId` 和 `version`，读取正文后分块、Embedding，写入 `kh_chunk`。
- `document.kg.rebuild`：携带 `documentId` 和 `version`，读取正文后分块，使用 Ollama 抽取实体和关系，写入 Neo4j 文档、Chunk、实体和关系节点。
- `document.search.delete`、`document.rag.delete`、`document.kg.delete`：携带 `documentId`，只有存在已提交的删除标记且源文档已不存在时才清理对应索引。KG 消费者兼容旧的 `DOCUMENT_GRAPH_DELETE` 消息类型。
- `document.source.delete`：携带 `documentId` 和原文件 `storageKey`，通过 KG 队列重试清理 MongoDB 正文和原始文件。删除元数据、三路删除标记和四条清理任务在同一 PostgreSQL 事务提交。

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

receipt 能避免已经记录完成的重复业务处理，但不能让 PostgreSQL、Elasticsearch、Neo4j 共享事务。若索引写成功后进程在 receipt 提交前崩溃，仍会重新执行索引操作。当前三路索引按独立 generation 写入，完整构建后才切换 PostgreSQL 可见指针。重做会生成新批次，未激活的数据不可检索；ES bulk 的部分失败会抛错并进入重试。具体版本及删除保护见下节。

receipt 负责事件处理记录；索引版本与可见性由独立的 `indexing` 模块控制。不要在这些消费者中加入无幂等键的付款、通知等不可重做副作用。

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

### 自动化真实服务验收

Docker 启动后，从仓库根目录运行：

```bash
pnpm --filter @knowbase/api test:delivery
```

该命令先构建 API，再通过 Node.js 测试运行器执行 `apps/api/test/delivery/reliability.test.cjs`。测试使用 `deploy/docker-compose.delivery-test.yml` 创建带进程 ID 的独立 Compose 项目，启动 PostgreSQL 16 和 RabbitMQ 4；首次使用需要能拉取对应镜像。端口选择本机空闲端口并在本轮重启期间固定，避免影响现有开发服务。

测试通过真实 TypeORM 连接执行文档表初始化和 `004_pipeline_delivery.sql` 迁移，并重复执行迁移验证可重入性。测试结束（包括断言失败）后删除本轮容器和数据卷，不读取 API 的 `.env`，也不修改开发数据库。若测试进程本身被强制终止，需根据 `docker compose ls` 中的 `knowbase-delivery-test-<进程 ID>`，使用同一 Compose 文件执行 `down -v` 清理残留项目。

自动化覆盖以下七种情况：

| 场景 | 验证结果 |
| --- | --- |
| 第二条 Outbox 插入失败 | 文档发布状态、审核信息和已插入任务一起回滚 |
| RabbitMQ 停机时发布，随后恢复 | 发布状态和三条任务保存成功；原 Relay 和三路消费者自动恢复，无需重新创建应用服务 |
| Broker 确认后 Outbox 标记事务失败 | 待投递行保留；以相同事件 ID 重投，业务副作用只执行一次 |
| 两个 Relay 同时领取任务 | `SKIP LOCKED` 允许领取不同任务，不重复领取也不等待另一条行锁 |
| 完成记录提交后连接关闭，未发送 ACK | Broker 重投消息，消费者根据完成记录跳过副作用 |
| 消费子进程被 `SIGKILL` | 未提交 receipt 回滚，未确认消息被另一消费者接管并完成 |
| 重试期间重建 Worker 服务实例，最终持续失败 | 数据库重试时间和处理次数保留；第三次失败后进入死信；死信在 Broker 重启后仍存在 |

这套测试验证发布服务、Outbox、Relay、确认、receipt 和消费者与真实 PostgreSQL/RabbitMQ 的集成。正文适配器使用固定 Markdown，索引处理器使用独立数据库记录计数，不启动 HTTP API、MongoDB、Elasticsearch、Neo4j 或模型服务，因此不代表三路索引内容正确性或完整上传到检索流程已经验收。生产配置的重试间隔保持 5 秒、10 秒；测试缩短间隔以控制运行时间。

## 索引版本与可见批次

三路索引共用 PostgreSQL `kh_index_head`：每个 `(document_id, pipeline)` 保存唯一可见的 generation UUID、文档版本和删除标记。该表不设置文档级联删除，删除标记永久保留；文档 ID 不允许复用。业务文档的 `version` 是内容、标题、分类、标签和权限等有意义修改的统一修订号；仅修改元数据也会递增。正文未修改时沿用原 `content_id`，MongoDB 正文版本表示该正文创建时的修订号，不要求与后来仅修改元数据的版本相同。

```text
任务携带 documentId + version
  -> 检查文档仍存在、已发布且版本相同
  -> 生成唯一 generation，完成全部正文读取、分块、模型调用和索引写入
  -> PostgreSQL 短事务锁定文档，复查状态、version、content_id 和删除标记
  -> 条件成立才切换该管线的可见 generation
```

元数据修改、内容修改、提交审核、驳回、发布、删除和索引切换均使用文档行锁。切换事务不跨越模型调用或外部索引写入；delivery receipt 的处理事务仍有上文说明的连接占用限制。

- **全文**：ES `_id` 为 `documentId:generation`，业务 `id` 字段仍为文档 UUID；`generation_id` 为 keyword。
- **向量**：ES Chunk ID 在原文档版本与 Chunk 序号后增加 generation；写新批次前不删除旧 Chunk，所有 bulk 项成功且 refresh 完成后才允许激活。空正文可以激活空批次，旧 Chunk 不会继续可见。
- **图谱**：Neo4j 文档、Chunk、关系按 generation 隔离，整个批次在一个 Neo4j 事务内写入；最终可见性仍取决于 PostgreSQL 指针。
- **查询**：先从 PostgreSQL 取得当前用户可见、仍发布且版本匹配的有效 generation，再在 ES 全文、KNN 和 Neo4j 路径查询中强制过滤，暂存和旧批次不能占用 TopK。RAG 返回前再校验候选版本与源文档版本一致。

同一版本重新构建期间，原有完整批次继续可见；失败只清理本次 generation。新修订进入草稿后，旧版索引立即失去查询资格；新版本重新发布后，各管线构建完成才分别可见，不会回退查询上一修订。三路指针独立切换，不承诺全文、向量和图谱同时就绪。单次查询使用读取指针时的快照，已经开始的请求不提供跨数据库的线性一致性保证。

删除在同一事务内清空三路可见指针、写入三个永久删除标记、保存三路索引清理及一条源文件清理 Outbox、删除文档元数据。HTTP 删除成功表示文档已不可见且清理任务已持久化，物理清理异步完成。旧任务即使在清理之后才写入，也无法激活，并会尝试清理自己的批次。原始文件和 MongoDB 清理失败会按 Outbox 消费规则重试，不会静默丢失。当前源文件清理范围为正文和原始 `storageKey`，提取资源的回收策略仍需单独完善。

若激活事务 COMMIT 的结果不明确，保留本次批次，不能立即删除，因为数据库可能已成功提交指针。已被替换的完整批次也暂时保留，以支持读取旧指针的在途查询。进程崩溃、清理服务不可用可能留下不可见批次；当前不自动回收，后续需加入带宽限期、任务状态核对和激活互斥的回收机制，不能只按“当前未引用”立即删除，否则会误删正在构建或查询中的批次。当前查询把可见 generation 列表作为过滤条件，适用于 MVP；文档规模增大后需要评估过滤列表长度、ES terms 限制与查询成本。

### 升级和重建

首次初始化自动执行 `005_index_generations.sql`。已有数据库需在停止旧版本 API/Worker 后，先完成 004，再执行：

```bash
psql "$KNOWBASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/postgres/migrations/005_index_generations.sql
```

**旧索引没有 generation，也没有可见指针，升级后不会自动作为回退结果返回。** 在维护窗口部署新代码后，管理员对现有每个已发布文档调用：

```http
POST /api/v1/documents/<document-uuid>/rebuild-indexes
Authorization: Bearer <admin-token>
```

接口返回 HTTP 202 和 `{"queued":true}`，表示当前版本三路重建任务已保存到 Outbox，不表示索引全部就绪；非管理员、草稿和不存在的文档会被拒绝。该入口也支持同一版本人工重建。新旧 Worker 不支持混合运行：旧 Worker 会绕过 generation 协议，必须先停止再升级。ES 现有索引会补充 `generation_id` keyword 映射；如已有同名但类型不兼容的字段，应创建新的索引名并完整重建。

### 自动化版本一致性验收

```bash
pnpm --filter @knowbase/api test:index-consistency
```

已有全部镜像但镜像仓库暂不可访问时，可使用 `DELIVERY_TEST_PULL_POLICY=never` 前缀运行上述命令或 `test:delivery`，只使用本机缓存。

测试将索引专用 Compose 文件叠加到隔离投递环境，使用真实 PostgreSQL、Elasticsearch 8 和 Neo4j 5，自动执行迁移并在完成后清理容器与数据卷。对全文、向量、图谱分别验证乱序完成、暂存不可见、失败保留原批次、删除后旧任务无法恢复索引；另外验证真实 ES bulk 部分失败、空批次切换、并发元数据修订和删除事务回滚。正文与模型使用小型固定数据，不调用真实模型或上传接口；验证的是版本、持久化和可见性，不是模型生成质量。

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
  -> GraphGenerationWriter 在 Neo4j 中写入独立批次
  -> PostgreSQL 复查版本并切换 kg 可见批次
```

Neo4j 中的核心结构是：

```text
(KnowledgeDocument)-[:HAS_CHUNK]->(DocumentChunk)-[:MENTIONS]->(KnowledgeEntity)
(KnowledgeEntity)-[:RELATED_TO {type, documentId, chunkId}]->(KnowledgeEntity)
```

同一文档重建会创建独立的 Document、Chunk 和关系批次，完整写入后才切换可见指针。实体使用 `type:normalizedName` 作为 key 跨文档共享，名称和类型只在首次创建时设置，避免暂存批次修改当前批次的展示；关系与 Chunk 都带 `generationId`，查询种子和每条路径关系同时限制可见文档及已激活批次。首次写入前创建实体 key、Chunk ID 和文档批次的唯一约束；已有重复实体时需先修复重复数据再重建。

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
