# KnowBase

企业知识库 MVP，第一阶段聚焦文档模块：

- PostgreSQL 保存文档元数据和审核状态
- MongoDB 保存 Markdown 正文
- RustFS 保存原始二进制文件
- NestJS 提供文档上传、CRUD 和审核接口
- FileParserService 将 PDF、XLSX、DOCX、PPTX、TXT、MD 统一转换为 Markdown
- 文档发布后通过 RabbitMQ 并行执行 Search、RAG、KG 三条索引管线
- RAG 默认使用本地 Ollama `nomic-embed-text`，不需要 OpenAI API Key

开发约定：

- 通用开发规则见 [AGENTS.md](./AGENTS.md)
- 当前项目架构和技术决策见 [docs/development-guide.md](./docs/development-guide.md)

## 启动基础设施

```bash
docker compose -f deploy/docker-compose.yml up -d
cp .env.example apps/api/.env
brew services start ollama
ollama pull nomic-embed-text
```

Docker 初始化脚本只会在对应数据卷第一次创建时执行。修改初始化 SQL 或 Mongo 脚本后，需要手动处理现有数据卷。

已有 PostgreSQL 数据库可执行 `deploy/postgres/migrations` 下的增量 SQL。

## 启动 API

```bash
pnpm install
pnpm --filter @knowbase/api start:dev
```

API 地址：`http://localhost:3000/api/v1`

本项目基础设施使用独立端口：PostgreSQL `15432`、MongoDB `17017`、RustFS API `19000`、RustFS Console `19001`、RabbitMQ `15672`、Elasticsearch `19200`、Neo4j Bolt `17687`，避免和本机已有容器冲突。

健康检查：`GET http://localhost:3000/api/v1/health`

文档接口：`/documents`

## 文档上传示例

```bash
curl -X POST http://localhost:3000/api/v1/documents \
  -F "file=@./example.md" \
  -F "uploaderId=user-001" \
  -F "title=示例文档" \
  -F "category=技术"
```

提交审核：

```bash
curl -X POST http://localhost:3000/api/v1/documents/<document-id>/submit-review
```

审核通过：

```bash
curl -X POST http://localhost:3000/api/v1/documents/<document-id>/review \
  -H 'Content-Type: application/json' \
  -d '{"approved":true,"reviewerId":"admin-001"}'
```

审核通过会自动投递三条索引消息，也可以使用显式发布接口：

```bash
curl -X POST http://localhost:3000/api/v1/documents/<document-id>/publish \
  -H 'Content-Type: application/json' \
  -d '{"reviewerId":"admin-001"}'
```

异步管线说明见 [docs/pipeline.md](./docs/pipeline.md)。
