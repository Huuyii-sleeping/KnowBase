# 发布与回退演练（6.3.1）

本轮交付固定分支版本之间的迁移、试升级和兼容回退工具，以及 [发布操作单](ingestion-release-runbook.md)。本轮没有合并 main、部署生产或迁移用户数据库。阶段 6.3 的主线组合版本验收仍待完成。

## 固定条件

- 新版：`9259982075a32a8730c5616da9e2c2caf270b627` 的 API 业务代码；新增的是演练工具与文档。
- 回退版：`d825b0f365291e48cc747f85bd51bd25f91f07c8`（阶段 4 批量升级之前，已支持证据、候选与 generation）。通过 `git archive` 提取固定源码，在报告目录独立构建，不切换用户分支、不覆盖当前 dist。
- 两版共享当前锁定 Node 依赖；这验证源码/API 数据兼容，不代表从历史依赖锁文件独立重装的发布包也已验收。Web 构建和现有测试单独运行，未做两版 Web 的浏览器切换演练。
- 分块参数：旧版 1000/20，新版 256/20；Embedding 同一 768 维模型空间。旧版代码回退后仍可读取新版完整 generation，并通过正常重建恢复旧分块参数，不直接倒写 head。
- 真实 MinerU 4.2.3 Flash，关闭图像分析；重新计算本机 Python 包/权重摘要，与历史固定运行时 `5ac1b90c8761385768caf3354d4ca7fcf8fcb1c7c98d0f71f7de0b8e292a152b` 一致。
- 实际 Ollama 模型：`nomic-embed-text:latest` digest `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`；`qwen2.5:0.5b` digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`。启动前通过 `/api/tags` 核对，不使用模型替身。此处不评分 KG 语义质量，也不形成新的模型性能结论。
- 数据：一份明确标记的合成 TXT 和一份此前 OCR 回归扫描表格 PDF，包含 `-8.75`、空白及“未测”。不是新保留集或真实业务语料。
- 基础设施：独立 PostgreSQL、MongoDB、RabbitMQ、RustFS、Elasticsearch、Neo4j；仅演练脚本发起业务写入。服务、端口、测试账号及数据与其他会话隔离。

## 验证项

| 检查                | 通过标准                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 存量迁移 | 从 001+004/005 的单独库及已发布 sentinel 记录开始，002–010 执行两次；原记录逐字段不变，catalog 一致，无新 Outbox。主 HTTP 环境另使用完整当前 schema。                                              |
| MongoDB 索引        | 原始正文及旧索引名上执行真实 002/003/004 mongosh 脚本两次；正文不变，五类唯一索引拒绝重复，缓存 TTL=0。该探针使用 `knowbase` 数据库；HTTP 主体使用 `acceptance` 库，二者分别核对，不混称同一文档。 |
| 旧版入库            | 旧 API/Worker 创建并发布 TXT，真实模型建索引，正文/原件摘要和全文查询通过。                                                                                                                        |
| 单份试升级          | 新包读取旧数据，预览并执行一份升级，三条管线真实激活且正文/版本不变。                                                                                                                              |
| OCR 交付            | 新包实际调用 MinerU 解析扫描 PDF，显式核对候选后发布；正文、原件、独立证据、附件、事实 Chunk 及索引可读。                                                                                          |
| 两份扩批            | 同样规则扩大到两份，六个任务成功、当前有效数为 2，不替换正文。                                                                                                                                     |
| 候选保留            | 再解析形成独立候选；已发布正文、版本和索引保持不变。                                                                                                                                               |
| 配置保护            | 改分块参数、改同维度模型修订分别使旧预览 start 返回 409；head 不变。                                                                                                                               |
| 回退检查            | 新消费者尚在运行时拒绝；确认投递到真实死信队列的探针消息使检查拒绝；处理探针并停消费者后所有计数归零。                                                                                             |
| 旧包回退            | 旧 API/Worker 读取新版正文、来源/附件和未采用候选，正常重建旧策略，不 DROP 表或回退版本号。                                                                                                        |
| 再升级与清理        | 切回新包，保留账本和正文读取；拒绝演练候选、删除两份文档并核对五类 Mongo 记录、两类 ES 索引、图谱、原件、tombstone 和回退检查。                                                                    |

## 最终结果

2026-11-27 最终 **11/11 场景通过，无跳过**。机器证据见 [固定发布基线](baselines/ingestion-release-2026-11-27.json)，完整本机报告与日志为 `reports/ingestion-release/fixed-pair-final`。源码、编译产物、锁文件、工具、部署脚本、运行时/模型及镜像摘要已记录；运行时工作区含未提交演练工具，报告明确标记 dirty。前后业务源码没有改动，不虚构一次生产代码修复。

回退前及最终停止后，解析活动/远端补偿/未发布 Outbox/非完成 receipt/活动计划/未结束升级与构建/队列 ready/消费者计数均为 0。最终正文、证据、缓存、附件对象及原件删除校验通过；测试容器和卷已移除。队列检查使用 AMQP ready 和 consumer 计数，在停止本演练全部消费者后复查，不声称采集了运行中 unacked 的实时指标。

API **507**、Web **256** 项测试通过；API/Web 构建通过，Web 有既有 bundle size 提示。评测工具 **13** 项、部署及隔离 Compose 配置、格式和最终 diff 检查通过。无生产服务代码变更，未对已有质量数字重新计分。

已有阶段证据继续分别维护：[解析与保存](ingestion-acceptance-report.md)、[OCR 表格事实](ocr-table-quality-report.md)、[分块质量](chunk-evidence-quality.md)、[索引恢复](index-build-recovery.md)、[故障与并发](ingestion-resilience-report.md)、[固定负载](ingestion-capacity-report.md)、[批量升级](index-upgrades-report.md)。这些来自各自固定版本/数据，本轮只补迁移和回退证据，不能把它们拼成最新 main 已运行的联合报告。

## 中间失败记录

这些失败均保留原始本机日志，不计为通过：

1. `fixed-pair-first`：独立源码构建只包含 src，TypeScript 输出 `dist/main.js`，脚本错误假定 `dist/src/main.js`，未进入业务断言。已按实际独立构建目录修正。
2. `fixed-pair-second`：脚本未声明 TEAM 可见性，默认私有文档正确地对普通 reader 隐藏。夹具改为显式 `team=quality, visibility=TEAM`，不改变生产权限。
3. `fixed-pair-third`：注入死信消息后未等待 publisher confirm 就关闭连接，消息没有可靠到达；改用确认通道。
4. `fixed-pair-fourth`：消费探针后 ACK 尚未送达即关闭连接，消息回队列，检查器按设计阻止回退；增加同通道 RPC 屏障后再关闭，不绕过检查器或清空业务队列。
5. `fixed-pair-fifth`：旧包回退、读取候选、旧策略重建均通过，但末尾拒绝候选并删除后立即停 Worker，MinerU 远端取消补偿尚未结束，检查器报 `remoteCleanupPending`。增加停止前等待补偿完成的检查；不靠清空标记绕过真实取消。

## 复现

先启动已验证的 MinerU（建议独立端口及上传目录），确认本机模型已就绪。使用同一 Python 环境生成本轮包/权重摘要文件，输出文件必须不存在，再从仓库根目录运行：

```sh
# 将运行时与模型目录替换为本机实际路径。
reports/ingestion-acceptance/mineru-venv/bin/python \
  apps/api/test/ingestion/complex-quality/snapshot_runtime.py \
  /Users/huayi/.mineru/models/MinerU-4_models_torch \
  reports/ingestion-release/runtime/your-new-mineru-snapshot.json
npm run build --workspace apps/api
node --test apps/api/test/ingestion/release/release.test.cjs
MINERU_BASE_URL=http://127.0.0.1:18081 \
QUALITY_MINERU_REVISION=mineru-4.2.3:5ac1b90c8761385768caf3354d4ca7fcf8fcb1c7c98d0f71f7de0b8e292a152b \
QUALITY_EMBEDDING_REVISION=sha256:0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f \
QUALITY_KG_REVISION=sha256:a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67 \
RELEASE_MINERU_SNAPSHOT=reports/ingestion-release/runtime/your-new-mineru-snapshot.json \
RELEASE_OUTPUT=reports/ingestion-release/your-new-run \
DELIVERY_TEST_PULL_POLICY=never \
node apps/api/test/ingestion/release/run.cjs
```

输出目录必须新建，避免覆盖旧证据。脚本依赖此前生成的扫描表格 `reports/ingestion-complex/ocr-table-new-v2/ocr-table-middle-empty.pdf`，生成入口见 [OCR 表格报告](ocr-table-quality-report.md)。不应靠关闭断言跳过未准备的输入或模型；缺失时返回失败。MinerU 运行时摘要的生成方法复用 `complex-quality/snapshot_runtime.py`。

## 发布剩余条件

2026-11-27 执行 `git fetch origin main`，远端为 `b15d9380e77668a027f68c9700baff7fae52aa3b`。`git merge-tree --write-tree --name-only` 在不更改工作区和分支引用的情况下，确认仍有 12 个冲突文件，集中在 Embedding、RAG 输入、ES schema/测试、模块注册、依赖和配置。具体清单保存在机器报告。尚未合并，也未运行组合版本，因此仍禁止把分支内验收称为主线联合验收。

下一交付是 **6.3.2 main 契约整合与组合回归**：同时保留主线查询/检索文本能力与本分支的证据来源、输入预算、批次保存和 generation 屏障，跑组合版本的权限、版本/删除、一致性、真实模型交付和 Web 回归。另有公开网页的保留网段 DNS 问题、真实 OCR/模型的生产容量、跨存储备份恢复及模型空间切换仍需在对应环境验收。
