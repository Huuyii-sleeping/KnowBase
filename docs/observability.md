# 可观测性

KnowBase 使用本地自托管 Langfuse 记录 RAG 问答链路。Langfuse 未启用或暂时不可用时，问答接口仍然正常工作，观测上报不会阻断业务请求。

当前 Compose 使用 Langfuse v4，并开启 `LANGFUSE_MIGRATION_V4_WRITE_MODE=dual`，兼容项目当前的 `langfuse@3` SDK。后续升级到支持 Langfuse v4 events-only ingestion 的 SDK 后，可以移除该迁移配置。

## 启动

```bash
docker compose -f deploy/docker-compose.yml up -d \
  langfuse-postgres langfuse-clickhouse langfuse-minio langfuse-redis \
  langfuse-web langfuse-worker
```

打开 `http://localhost:13000`，使用初始化账号登录：

```text
admin@knowbase.local / knowbase-admin
```

API 配置：

```dotenv
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=http://localhost:13000
LANGFUSE_PUBLIC_KEY=pk-lf-local
LANGFUSE_SECRET_KEY=sk-lf-local
LANGFUSE_ENVIRONMENT=local
LANGFUSE_RELEASE=knowbase-local
```

## Trace 结构

每次 `POST /api/v1/rag/answer` 创建一个 `rag.answer` Trace，并记录：

```text
rag.answer
├── retrieval.hybrid-search
├── retrieval.grounding
└── generation.ollama
```

Trace 输入包含问题和 `topK`；检索 Span 记录候选数量、文档/Chunk 标识和耗时；Grounding Span 记录筛选后的 Chunk；Generation 记录 Prompt、模型、输出和耗时；Trace 输出记录最终回答、引用数量和上下文数量。

## 验证

```bash
curl -X POST http://localhost:3000/api/v1/rag/answer \
  -H 'Content-Type: application/json' \
  -d '{"question":"RAG 的基本流程是什么？","topK":3}'
```

等待几秒后在 Langfuse 的 Traces 页面查看 `rag.answer`。SDK 使用批量上报和 `flushAsync`，关闭 API 时会等待队列完成发送。Langfuse v4 的 API 查询可以使用 `/api/public/v2/observations`。
