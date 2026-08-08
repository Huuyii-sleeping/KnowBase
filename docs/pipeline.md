# 发布索引流水线

## 消息契约

- `document.index`：携带完整元数据和 Markdown，写入 Elasticsearch `kh_document`。
- `document.rag.rebuild`：携带 `documentId` 和 `version`，读取正文后分块、Embedding，写入 `kh_chunk`。
- `document.kg.rebuild`：携带 `documentId` 和 `version`，读取正文后分块，写入 Neo4j 文档和 chunk 节点。

RabbitMQ 使用持久化 topic exchange `knowbase.pipeline`，三个消费者使用独立 durable queue。消费成功 ack，失败按 `RABBITMQ_REQUEUE_ON_ERROR` 决定是否重新入队。

## RAG 配置

```env
RAG_CHUNK_SIZE=1000
RAG_CHUNK_OVERLAP=150
RAG_EMBEDDING_DIMENSIONS=768
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

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
