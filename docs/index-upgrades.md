# 存量文档受控索引升级

阶段 4 首版从**当前已保存的 Markdown**重建全文、向量和图谱索引。管理员在“内容管理 → 存量索引升级”生成预览，再启动批次。演示模式明确提示不可执行，避免向真实服务发送演示操作。此入口不重新解析原件，不自动采用候选，不改变审核状态。

## 部署与配置

先运行 PostgreSQL 迁移（004–009 必须已安装）：

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/postgres/migrations/010_index_upgrades.sql
```

空库初始化包含 `init/010_index_upgrades.sql`；迁移可重复执行。增加的四张表保存计划、逐文档快照、三条管线任务和构建尝试。快照没有到原文档的外键，删除文档后仍能核对跳过原因；不保存正文、原始模型错误或凭证。

预览要求显式设置 `EMBEDDING_MODEL_REVISION` 和 `OLLAMA_KG_MODEL_REVISION`。填写实际部署模型的不可变修订或摘要，不要填写任意日期冒充模型修订。目标固定分块策略（含大小与重叠）、Embedding 空间与任务前缀、检索上下文模式、图谱模型/提示规则、输入批次预算和目标索引配置。端点只进入摘要，不向页面返回地址或密钥。配置变化后原计划不能继续投递；恢复原配置或新建预览。

`INDEX_UPGRADE_MAX_IN_FLIGHT=6` 控制整个数据库内的批量任务准入上限，单位是**管线任务**。每份文档最多产生全文、向量、图谱三个任务。已提交、正在处理及尚未结束自动重试的失败任务占用名额。此上限与 `RABBITMQ_PREFETCH`、`RAG_EMBEDDING_CONCURRENCY` 各自独立，不限制正常发布产生的任务。

每个计划的 `intervalMs`（100–3600000，默认 1000）是新管线任务之间的最小投递间隔。Worker 每 250ms 检查一次，一次最多投递一个任务；重启不积累历史配额。多个进程通过数据库事务锁共享准入控制。不同批次各自计时，仍受总在途上限约束。设置 `PIPELINE_WORKERS_ENABLED=false` 的 API 进程不会启动调度器。

API、Worker 使用同一代码与配置，启用 Outbox Relay 和三条现有消费者；旧 Worker 不认识新命令，必须先停旧 Worker 再升级，不能混跑。回滚前先暂停全部批次并等待已提交任务终止；尚有升级消息时不要切回旧消费者。暂停/取消不会撤销已激活索引。不要直接删表清空批次作为回滚手段。

固定版本的小批发布、排空检查和回退操作见 [发布操作单](ingestion-release-runbook.md)，真实模型演练见 [回退报告](ingestion-release-report.md)。

2026-11-28 已在本分支整合固定 main 并完成 [组合回归](ingestion-main-integration-report.md)；尚未将分支合入 main 或部署生产。后续 main 变更需重新核对契约。更换向量空间需要独立的查询侧/索引空间切换方案，不能作为普通分块升级直接运行。

## 预览规则与操作

按文档 ID 范围（最多 1000 个，可留空扫描文档库）和发布状态选择。服务以 UUID 游标每页扫描 50 份元数据，正文逐份读取；记录扫描时间上界，扫描不是跨存储的全库瞬时快照。每一项以读取到的 `documentId/version/contentId` 为准，实际执行再检查。

| 分类              | 判定                             | 是否生成索引任务       |
| ----------------- | -------------------------------- | ---------------------- |
| `rebuild`         | 已发布、解析 READY、存在非空正文 | 是，三条管线           |
| `unpublished`     | 当前未发布                       | 否                     |
| `missing_content` | 已发布但正文记录缺失             | 否                     |
| `needs_reparse`   | 已发布但解析未就绪或正文为空     | 否，另走解析与核对流程 |

原分块策略只有在当前 RAG generation 能关联到本机制的成功计划时才展示确定值，其他旧产物显示 `unknown`，不通过文件名或策略默认值猜测。

预览阶段只保存计划及清单，不投递、不调用模型、不写索引。预览失败的部分清单保持 `preview_failed`，不能启动。预览进程强杀留下 `preparing` 时重新生成预览，该未完成清单也不能启动；已启动批次的调度和任务可自动恢复。

- **启动**：只有完成预览的批次可启动；重复启动运行中的批次不会重复创建任务。
- **暂停 / 继续**：暂停阻止新投递，已提交任务和其自动重试继续完成；继续前核对配置。
- **取消未投递项**：仅将 pending 任务标记跳过；不撤销已提交任务和已生效索引。
- **仅重试失败项**：将 failed / activation_unknown 重新排队，生成新的投递标识；成功、跳过项不重做。暂停中的批次只重新排队，点击“继续投递”后执行。文档已改变时会跳过，请新建预览。
- **导出清单**：逐页读取元数据，下载 JSONL；首行是计划与汇总，其余行为逐文档管线清单。不导出正文。导出期间状态可能继续变化，跨页导出不是静态数据库快照。

## 状态的含义

任务 `pending → dispatched → running → succeeded / failed / skipped / activation_unknown`。错误仅返回固定维护分类。队列协议继续负责有界自动重试和死信；管理员也可以在本轮结束后单独重试失败项。点击管线状态可查看 generation 尝试历史；失败管线旁提供单项重试按钮。

任务成功由 generation 激活事务中的持久成功记录确定。构建进度表仍是辅助观察信息，不作为成功依据。激活提交响应丢失时不会删除可能已生效的数据；成功账本若已经提交，不会被后续错误改成失败。其他结果不确定的尝试单列 `activation_unknown`，重投使用新的 generation，旧 generation 不继续写入。

旧事件由现有 receipt 锁串行处理；进程强杀后未提交 receipt 会回滚，消息重投可重新进入 running 项。被中断尝试记为 `interrupted`，保留事件和 generation 的关联。人工重试更新 dispatch token，旧轮次的延迟消息不能领取新轮次任务。成功项即使再收到重复消息也不再调用模型。

每次执行在读取正文前核对配置、发布状态、version 和 contentId；管线再次捕获快照并检查 contentId，最终激活仍锁定原文档并核对版本。删除或编辑不会由旧计划复活或覆盖。

文档汇总需要三条管线全部成功才记成功，部分完成单列；`completed` 仅表示本轮没有待处理任务，可能仍有失败。汇总内各计数使用同一个数据库快照。`activeDocuments` 进一步核对现在的文档版本、contentId、发布状态及三条当前 generation，避免旧成功结果冒充当前可用。普通详情页的“索引构建状态”读取原有维护接口，展示最近尝试和历史版本，不能据此推断完整检索质量。

## 管理接口

均在 `/api/v1/index-upgrades`，要求 ADMIN；应用服务也做管理员校验。

| 方法与路径                                      | 作用                                                     |
| ----------------------------------------------- | -------------------------------------------------------- |
| `POST /`                                        | `{documentIds?, status?, intervalMs?}` 同步生成预览，201 |
| `GET /`                                         | 最近 50 个计划                                           |
| `GET /:id`                                      | 目标配置、分类、文档汇总、管线汇总、当前有效数           |
| `GET /:id/items?after=UUID&limit=50`            | UUID 游标分页，limit 1–100                               |
| `GET /:id/tasks/:taskId/attempts`               | 最近 100 次尝试，含实际事件与 generation                 |
| `POST /:id/start\|pause\|resume\|cancel\|retry` | 202 表示操作已接受，不表示已完成索引                     |
| `POST /:id/tasks/:taskId/retry`                 | 只重试指定失败管线，202；成功项不重做                    |

## 验证入口

```sh
pnpm --filter @knowbase/api build
DELIVERY_TEST_PULL_POLICY=never node --test --test-concurrency=1 apps/api/test/indexing/upgrades.test.cjs
```

演练只创建带 PID 的隔离 Compose 项目，使用真实 PostgreSQL、MongoDB、RabbitMQ、ES、Neo4j；退出清理自己的容器和卷。模型为明确标记的确定性替身，不将替身耗时解释为真实模型性能。用例与结果见 [阶段 4 演练报告](index-upgrades-report.md)。
