# 发布索引流水线

## 消息契约

- `document.index`：携带完整元数据和 Markdown，写入 Elasticsearch `kh_document`。
- `document.rag.rebuild`：携带 `documentId` 和 `version`，读取正文后分块、Embedding，写入 `kh_chunk`。
- `document.kg.rebuild`：携带 `documentId` 和 `version`，读取正文后分块，写入 Neo4j 文档和 chunk 节点。

RabbitMQ 使用持久化 topic exchange `knowbase.pipeline`，三个消费者使用独立 durable queue。消费成功 ack，失败按 `RABBITMQ_REQUEUE_ON_ERROR` 决定是否重新入队。

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
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

## AI 问答

AI 问答在混合检索之上调用 Ollama 对话模型。问答模块只把带有正文的 Chunk 作为上下文，关键词检索返回的纯文档元数据不会直接交给模型，避免模型根据标题猜测答案。

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
