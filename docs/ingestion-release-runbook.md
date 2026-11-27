# 入库发布与回退操作单

本操作单覆盖已有 generation 协议、证据/候选保存和索引批次能力之间的兼容升级。固定版本演练见 [发布回退报告](ingestion-release-report.md)。执行到生产前必须先完成最新 main 的契约整合和组合版本回归；本分支通过不等于主线已可部署。

## 发布包与窗口

每次发布保留以下不可变清单：API/Web 提交与产物摘要、锁文件、Node/Python/依赖版本、PostgreSQL/MongoDB 脚本摘要、MinerU 包与模型权重摘要、Ollama 模型 digest、解析/分块策略、向量维度及输入预处理、ES 索引名/映射和 Neo4j 配置。服务地址进入受控配置文件，密钥使用部署密钥管理，不放报告或导出清单。模型名和 `latest` 标签本身不是不可变版本。

回退包应提前准备并检查可启动，不在故障时临时取远端最新代码。独立 MinerU 服务用已验证的运行时，不在 API 启动时安装或下载；首个 OCR 请求前预热。主应用、Worker 和查询服务应使用兼容的代码、模型空间及配置。

发布窗口先停止上传、编辑、重新解析、审核发布、手动重建及批量管理等写入入口，并等待入口中已开始的请求结束。当前没有全局维护模式开关，需要在部署入口和管理流程上关闭这些写入；只设置 `PIPELINE_WORKERS_ENABLED=false` 不能阻止 API 写入 Outbox。

暂停所有正在运行的批次，现有 Worker 继续完成已投递任务及失败补偿；需要保留未投递批次时用 pause，需要放弃时用 cancel。取消不撤销已激活的索引，也不会撤销正在执行的任务。未结束解析按原配置完成或通过原配置下的接口取消并等待清理。处理死信及结果不确定的激活，不能为通过检查而清空队列、Outbox、receipt 或任务表。

## 先备份，再迁移

在停止业务写入、任务排空、Worker 停止并确认无消费者后，建立**同一静止窗口**的数据备份：PostgreSQL、MongoDB、对象存储，以及实际使用的 ES/Neo4j 索引或可验证的重建方案。记录备份位置与恢复权限；敏感备份不得提交到 Git。PostgreSQL 与 MongoDB 单独备份不构成跨存储一致快照。

已有库按编号执行缺少的迁移，PostgreSQL 必须使用 `psql`（006–010 的 `\ir` 为 psql 相对包含），开启遇错停止。不要把 init 当作对已有库自动升级的机制。

```sh
psql "$KNOWBASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f deploy/postgres/migrations/002_add_parse_error.sql \
  -f deploy/postgres/migrations/003_add_users.sql \
  -f deploy/postgres/migrations/004_pipeline_delivery.sql \
  -f deploy/postgres/migrations/005_index_generations.sql \
  -f deploy/postgres/migrations/006_document_parse_tasks.sql \
  -f deploy/postgres/migrations/007_generation_retention.sql \
  -f deploy/postgres/migrations/008_parse_checkpoints.sql \
  -f deploy/postgres/migrations/009_index_build_progress.sql \
  -f deploy/postgres/migrations/010_index_upgrades.sql

mongosh "$KNOWBASE_MONGODB_URI" \
  --file deploy/mongodb/migrations/002_fix_document_content_indexes.js \
  --file deploy/mongodb/migrations/003_ingestion_indexes.js \
  --file deploy/mongodb/migrations/004_document_evidence.js
```

MongoDB 现有脚本显式选择数据库 `knowbase`；连接串用于同一部署的认证/连接，不能通过换 URI 数据库名假定脚本会迁移别的数据库。非默认库必须先准备并审核对应目标脚本。迁移中唯一索引出现重复键时停止发布，核对数据来源，不自动删除正文或证据。

迁移后对照实际字段、约束和索引，检查原有正文指针、版本、文档数及抽样摘要。迁移不应自动创建解析或重建任务。新应用可以保留扩展字段和表；`synchronize` 继续关闭。

## 小批发布与扩大

1. 停旧 API/Worker，部署固定的新包，先验证服务连接、登录/权限、模型 digest、MinerU Tasks API 及输出协议。`/health` 成功不代表 OCR 模型已预热或数据链路已验收。
2. 保持批量业务写入关闭，开启单实例 Worker 和 Outbox，先验证一份已有文档的正文/原件读取、权限及正常查询。当前查询和索引必须使用同一模型空间。先保持 generation GC 关闭，宽限时间另按最长在途请求确定。
3. 管理员用明确的 `documentIds` 建一份升级预览。确认分类、version/contentId、策略、模型和索引目标，启动后等待三条管线实际成功且 `activeDocuments=1`。202 只代表接收操作。
4. 抽样比对原件摘要、当前正文与关键事实、Chunk 来源和真实索引结果，再扩展到下一小批。每批检查失败/未知激活、连接等待、内存、Outbox 和消息积压；阈值使用该部署的实测基线，不把开发机每秒份数设为生产 SLA。
5. 资料需重新解析时另走候选流程，不与索引重建混同：保留原已发布正文，核对候选后采用会形成新修订并回到草稿，再审核发布。逐步恢复写入入口。

目标策略、模型修订或索引配置变化后，旧预览应返回 `UPGRADE_CONFIG_MISMATCH`（409）；恢复原配置才能继续，或者重新生成预览。维度相同的不同模型也可能属于不同空间，不允许混查。

## 回退顺序与检查

回退同样先关闭写入入口并暂停/取消批次，让新 Worker 在**原新配置**下完成任务及远端清理。确认所有业务任务和消息已结束后停新 API/Worker，检查以下项为 0：

- `kh_document_parse_task` 的 queued/running；failed/stale/canceled 中仍待远端取消的任务。
- `kh_pipeline_outbox` 未发布记录；`kh_pipeline_receipt` 非 COMPLETED 记录。
- preparing/running 批次；dispatched/running/failed/activation_unknown 升级任务。
- running/activation_unknown 构建观察记录。若为崩溃留下的观察项，先结合实际 receipt/head 排查，不仅凭时间修改终态。
- 四条业务队列及其 `.dead` 队列中的消息数；全部消费者数。停止消费者后未确认消息会回到队列，需再次检查，不能只看运行中 ready=0。

本仓库 [演练检查器](../apps/api/test/ingestion/release/rollback-gate.cjs) 记录上述数据库/队列数并拒绝未知计数。它验证的是隔离环境中的排空条件，不是生产全局写锁；检查后仍允许新写入就存在竞态，因此关闭写入窗口是必要前提。暂停批次中未投递的 pending 项及 needs_review 候选可保留，前提是回退包已经实测兼容其保存格式，且不由旧消费者执行新命令。

分别处理四类回退：

| 对象          | 操作与限制                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 应用代码      | 切换到已验证的兼容包和配套 Web。保留新增表/列、证据和资源；不执行 DROP/DOWN 迁移。本轮仅验证指定的两个 API 源码版本共享当前锁定依赖，不推广到任意旧版本。                   |
| 分块/索引策略 | 恢复已验证参数，同一正文和版本通过正常完整 generation 重建。旧完整 generation 在新批次激活前继续可见。回退代码不会自动把现有指针倒回旧 generation，也不直接 SQL 修改 head。 |
| 正文/候选     | 未采用候选保持独立，可继续核对或拒绝；回退代码不自动采用旧正文或抹掉审核记录。已采用的新版本不能靠回退包变回旧修订，应另走受审核的内容修订流程。                            |
| 模型/向量空间 | 保持本次实测同一模型 digest。更换空间必须使用独立索引/查询切换方案并另行演练；不能只改 revision 字符串、维度或部分重建后混查。                                              |

回退后核对原件、当前与候选正文摘要、来源、权限和三条索引。必要时按正常重建接口恢复旧策略，再恢复写入。要重新升级时再次排空并切回新包，确认批次账本仍可读。新旧 Worker 不混跑。

数据库损坏或需要恢复旧数据快照属于灾难恢复，需要跨存储一致备份的独立恢复演练。本轮没有测试把备份还原到生产，也没有用代码回退代替数据恢复验证。
