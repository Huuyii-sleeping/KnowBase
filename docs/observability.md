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

## 请求关联与记录范围

每次进入问答控制器的请求由服务器生成 UUID，响应头 `X-Request-Id`、本地事件的 `requestId` 和 Langfuse Trace ID 使用同一编号。失败响应同样保留该头。不会使用调用方任意传入的编号覆盖服务器编号。

认证、DTO 校验等在进入控制器之前失败的请求不属于本轮问答观测范围。直接调用 `AnswerService` 时自动生成内部编号；不额外改变回答 JSON。

Langfuse 未启用时仍写本地单行 JSON 事件，保留 Nest 的日志前缀。事件包含 `schemaVersion: 1`，本地记录只含阶段、模型名、计数、状态与用量，不记录问题、Prompt、文档正文、引用原文、凭据或上游原始错误。开启 Langfuse 时，原有问题、Prompt 与回答内容的记录继续保留在其 Trace 中。

## 阶段与调用结构

```text
rag.answer（同一个 requestId）
├── retrieval.total
│   ├── recall.keyword / recall.semantic（并行）
│   │   ├── visibility
│   │   ├── embedding（仅 semantic）
│   │   ├── index
│   │   └── metadata
│   ├── recall.merge
│   ├── rerank.total
│   │   └── rerank.bge（实际调用时）
│   └── graph.retrieval（实际走图谱时）
├── context.build
├── generation.total
│   ├── model.call（每次实际传输调用，包括恢复与引用修正）
│   └── citation.validate（每次内容输出的结构与引句校验）
└── citation.build（生成最终引用结构）
```

耗时使用单调时钟。`rerank.bge` 包含请求序列化、HTTP 往返、模型评分与响应验证，不能当成纯 GPU 内核时间。父阶段包含子阶段，两条召回路径并行，不能将所有阶段耗时相加当作总耗时。

Langfuse 保留原有 `retrieval.hybrid-search`、`retrieval.grounding` 和 `generation.answer` 内容快照；查看实际模型调用时间与用量应使用新记录 `model.call`。新阶段与模型调用使用实际开始、结束时间导出。观测 SDK 的创建、记录创建、结束、刷新和关闭均隔离异常，不向业务抛出上报故障。

## 事件与统计口径

| 事件                                         | 用途                                                      |
| -------------------------------------------- | --------------------------------------------------------- |
| `rag.answer.started`                         | 标识一次问答开始；可识别截断日志中的未结束请求            |
| `rag.answer.stage`                           | 阶段耗时和 completed/error/interrupted 状态               |
| `rag.answer.rerank`                          | 最终使用 BGE 或规则，以及原因                             |
| `rag.answer.model`                           | 每次实际模型调用的耗时、结果、用途、完成原因与 Token 用量 |
| `rag.answer.retry`                           | 已安排的传输恢复及等待时间                                |
| `rag.answer.repair`                          | 开始一次引用结构修正；与传输恢复分别计数                  |
| `rag.answer.completed` / `rag.answer.failed` | 每请求唯一终态，包含各阶段统计、调用计数与用量汇总        |

终态记录后，仍在等待的阶段和模型调用记为 `interrupted`，迟到结果不修改终态或追加事件。该记录不代表基础设施已停止工作，取消边界仍见[问答可靠性](answer-reliability.md)。

BGE 路径原因：`model_selected` 表示使用模型结果；`configured_rule` 表示显式规则配置；`empty_pool` 表示没有候选；其余包括 `api_busy`、`cooldown`、`unsupported_input`、`runtime_busy`、`timeout`、`unavailable`、`invalid_response`、`request_too_large`、`unknown_error`。运行时对忙碌和推理失败都返回 503，所以只有识别到固定的 `model busy` 响应才记为 `runtime_busy`；不能仅凭 503 判断繁忙。

Token 使用 LangChain 标准 `usage_metadata`，兼容旧 Ollama 计数。缺失或无效字段记为 `null`，不会把没有上报用量当作零。只有输入、输出都已知时才可推导缺失总量。截断、空输出等响应仍保留其已上报用量，连接失败或超时的消耗通常未知。

终态中的 `usage.reported*Tokens` 只累加已知部分，必须同时查看 `completeCalls` 与 `unknownCalls`。这些统计涵盖实际传输恢复和引用修正；`modelCalls` 不等于原始用户问题数，也不是账单费用。

## 日志汇总命令

下面的路径为已有日志文件的示例，不启动或重启服务：

```bash
node tools/observability/summarize-answers.cjs /path/to/api.log
# 合并轮转日志，按 requestId 去重终态
node tools/observability/summarize-answers.cjs /path/to/api.1.log /path/to/api.2.log
# 也支持从标准输入读取
cat /path/to/api.log | node tools/observability/summarize-answers.cjs
```

输出 JSON 包含：

- 请求终态数、开始数、缺失终态数、缺失开始记录数、重复终态数与无效事件数。
- 服务成功率、回答/拒答/错误数、错误类别和业务 outcome 分布。
- 全部终态及按状态分组的 P50/P95，各阶段的 P50/P95、失败和中断数。
- BGE 与规则次数、原因分布和回退率。
- 实际模型调用、传输恢复、引用修正次数，以及已上报用量和未知用量调用数。

服务成功率为 `(正常回答 + 正常拒答) / 已记录终态`，不能当作回答正确率。`invalid-evidence` 等业务 outcome 继续单列；日志没有人工标准答案，无法独立判断引用是否语义支持、答案是否完整。缺失终态不计成功或失败，而是明确列出。

回退率为“原计划使用 BGE、实际回到规则的次数 / 使用 BGE 或发生此类回退的次数”；显式规则模式和空候选不计该分母。阶段分位数是每请求该阶段累计耗时的分布，未出现的阶段不补零；P95 使用 nearest-rank 方法。重复读取同一终态只计一次，冲突或不完整日志应结合诊断计数排查。

汇总器顺序读取文件，但为去重与精确分位数会保留本次窗口的请求统计。应按压测批次或有限时间窗口运行，不作为无限日志流的常驻聚合器。生产日志保留、告警阈值与容量承诺在后续负载验收后确定。

## 验证与边界

[阶段 1 验证记录](answer-observability-validation.md)包含单元测试、实际 SDK 的本地 HTTP 合约及三种问答路径的编译产物检查。本轮未修改模型、提示词、选块规则、并发准入或超时预算，也未部署新的指标平台。

可在已运行且已更新代码的环境中发起一次正常问答，记录 `X-Request-Id`，然后对照本地 JSON 事件与 Langfuse 同编号 Trace。SDK 使用批量上报与 `flushAsync`；服务关闭时尝试发送剩余记录，上报失败不阻断业务。Langfuse v4 API 查询可使用 `/api/public/v2/observations`。

本地日志与 SDK 上报仍有运行开销，当前不做采样；持续流量下的影响属于阶段 2。当前没有承诺日志持久化、告警送达或服务异常退出时零丢失。
