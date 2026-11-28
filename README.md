# KnowBase

企业知识库 MVP，第一阶段聚焦文档模块：

- PostgreSQL 保存文档元数据和审核状态
- MongoDB 保存 Markdown 正文
- RustFS 保存原始二进制文件
- NestJS 提供文档上传、CRUD 和审核接口
- 默认由 MinerU 将 PDF、Word/Excel/PPT（含旧格式）、静态 HTML 和图片转为 Markdown，TXT/MD 本地读取
- 文档发布后通过 RabbitMQ 并行执行 Search、RAG、KG 三条索引管线
- RAG 默认使用本地 Ollama `nomic-embed-text`，不需要 OpenAI API Key
- 提供基于检索上下文的 AI 问答与引用来源，默认 DeepSeek，可显式选择本地 Ollama
- 支持基于 Ollama 实体关系抽取的 Neo4j 知识图谱重建、删除清理和权限过滤查询
- 支持通过 Langfuse Self-hosted 记录 RAG 问答链路

开发约定：

- 通用开发规则见 [AGENTS.md](./AGENTS.md)
- 当前项目架构和技术决策见 [docs/development-guide.md](./docs/development-guide.md)

## 启动基础设施

```bash
docker compose -f deploy/docker-compose.yml up -d
cp .env.example apps/api/.env
brew services start ollama
ollama pull nomic-embed-text
ollama pull qwen2.5:0.5b
```

启用本地 Langfuse：

```bash
docker compose -f deploy/docker-compose.yml up -d \
  langfuse-postgres langfuse-clickhouse langfuse-minio langfuse-redis \
  langfuse-web langfuse-worker
```

Langfuse 地址：`http://localhost:13000`，默认账号为 `admin@knowbase.local`，密码为 `knowbase-admin`。将 `apps/api/.env` 中的 `LANGFUSE_ENABLED` 改为 `true` 后重启 API。Compose 会自动创建 Langfuse 所需的 MinIO bucket。

Docker 初始化脚本只会在对应数据卷第一次创建时执行。修改初始化 SQL 或 Mongo 脚本后，需要手动处理现有数据卷。

已有 PostgreSQL 数据库可执行 `deploy/postgres/migrations` 下的增量 SQL。

## 启动 API

按默认配置启动前，在本机配置 `DEEPSEEK_API_KEY`。只使用本地回答时，将 `CHAT_MODEL_PROVIDER` 设为 `ollama` 并准备 `OLLAMA_CHAT_MODEL` 指定的模型（模板为 `qwen2.5:7b`）；上面的 0.5B 模型用于图谱抽取。回答提供方与文档解析服务独立，详见 [模型配置](./docs/answer-model-provider.md)。

已有库的迁移、写入窗口、批次试升级和回退步骤统一见 [发布操作单](./docs/ingestion-release-runbook.md)，合并审阅入口见 [发布准备](./docs/ingestion-release-preparation.md)。

先按 [MinerU 部署说明](./docs/mineru-ingestion.md#配置与部署) 启动固定版本的解析服务。示例配置默认连接 `http://127.0.0.1:8000` 并启用异步解析；已有数据库需先执行说明中的增量迁移。

```bash
pnpm install
pnpm --filter @knowbase/api start:dev
```

API 地址：`http://localhost:3000/api/v1`

本项目基础设施使用独立端口：PostgreSQL `15432`、MongoDB `17017`、RustFS API `19000`、RustFS Console `19001`、RabbitMQ `15672`、Elasticsearch `19200`、Neo4j Bolt `17687`，避免和本机已有容器冲突。

健康检查：`GET http://localhost:3000/api/v1/health`

文档接口：`/documents`。除健康检查和登录接口外，API 默认要求 Bearer JWT。

登录并保存 Token：

```bash
TOKEN=$(curl -s http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"knowbase-admin"}' | jq -r .accessToken)
```

RAG 问答接口：`POST /api/v1/rag/answer`

```bash
curl -X POST http://localhost:3000/api/v1/rag/answer \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"question":"RAG 的基本流程是什么？","topK":5}'
```

## 文档上传示例

```bash
curl -X POST http://localhost:3000/api/v1/documents \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./example.md" \
  -F "title=示例文档" \
  -F "category=技术" \
  -F "visibility=TEAM"
```

提交审核：

```bash
curl -X POST http://localhost:3000/api/v1/documents/<document-id>/submit-review \
  -H "Authorization: Bearer $TOKEN"
```

审核通过：

```bash
curl -X POST http://localhost:3000/api/v1/documents/<document-id>/review \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"approved":true}'
```

审核通过会自动投递三条索引消息，也可以使用显式发布接口：

```bash
curl -X POST http://localhost:3000/api/v1/documents/<document-id>/publish \
  -H "Authorization: Bearer $TOKEN"
```

管理员才能审核、发布和管理用户。普通成员只能访问自己拥有、公开或所在团队可见的已发布文档；历史文档中缺少权限配置时按 `PRIVATE` 处理。

异步管线说明见 [docs/pipeline.md](./docs/pipeline.md)。

Langfuse 观测链路说明见 [docs/observability.md](./docs/observability.md)。

知识图谱查询：

```bash
curl "http://localhost:3000/api/v1/graph/search?query=Ollama&maxHops=2&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```
