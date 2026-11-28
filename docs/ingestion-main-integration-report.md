# main 契约整合与组合回归（6.3.2）

2026-11-28，将远端 `main` 固定提交 `b15d9380e77668a027f68c9700baff7fae52aa3b` 整合到 `codex/ingestion-optimization`。整合前入库分支为 `e7b5c622813f868eaba84b95ac5ae5310ca87dd2`。只在本分支合并，不更新用户的 main 工作区，不部署生产、不升级业务数据。

## 合并后的数据契约

```text
已保存正文 + sections
  → DocumentChunksService（持久结构分块）
  → RagChunkTextService.forChunks（检索上下文）
      content / hash / ranges / headingPath 原样保留
      retrievalText 单独补文档标题及缺少的章节标签
  → DocumentEmbeddingService（文档内缓存、逐批检查点）
  → EmbeddingService（文档前缀 → 最终输入预算 → 有界批次）
  → ES 完整 generation（content + retrieval_text + ingestion 元数据）
  → refresh 屏障 → PostgreSQL 激活
  → 主线关键词 / 语义 / 混合召回、重排及问答
```

主要整合点：

- **RAG 只分块一次。** 复用已有结构缓存，再组装主线的检索文本；不通过另一套按行切分重新猜来源。主线 `prepare` 入口继续可用，但生产管线通过 `forChunks` 传入已有分块。正文引用沿用结构块，不把额外文档标题写进证据正文。结构块已经带有的完整标题不重复添加。
- **分块策略为 `structure-v5:<size>:<overlap>`。** 在同一来源块内保留主线原有的 Setext 标题能力（`标题` 后接 `===` / `---`），同时保持 CRLF 偏移、代码隔离和页/块边界；不能跨来源拼标题。策略升级使旧结构缓存自然失效。冻结语料和历史报告不改写，主线“标题必定与答案分开”的旧分块诊断改为检查当前结构分块确实继承标题，不能再用该前提解释新结果。
- **文档和查询编码分别保留。** `embedQuery` 调用提供方查询编码，文档前缀和查询前缀各自生效；前缀进入 token/字符预算及 `task-prefix-v2` 缓存指纹。已完成批次回调移除本次添加的前缀，继续以调用方原始检索文本登记缓存键，避免重复加前缀或缓存无法命中。查询响应也校验维度、有限数值及非零向量。
- **索引兼容两方能力。** `content` / `retrieval_text` 保留 CJK 子字段，`ingestion` 保持不参与 ES 索引的来源对象；继续按条数/字节分批、全部写入后 refresh、再激活，保留旧 generation 与删除保护。
- **升级预览固定新目标。** 分块策略、前缀指纹、检索上下文模式和新 schema/context 版本共同进入目标配置；修改 `RAG_RETRIEVAL_CONTEXT` 后旧计划不能继续执行。
- **主线服务行为保持。** Answer、Search、RagQuery、Retrieval/Rerank 生产源码与固定 main 相同，没有调整召回配额、重排权重、Prompt 或回答模型默认值。合并保留 DeepSeek/BGE 配置、查询再鉴权与批量元数据读取。本分支解析任务、证据、原件授权和 Web 候选入口继续保留。

12 个冲突文件已处理，配置和 package scripts 取两方能力；RabbitMQ 测试容器沿用本分支的 `user: rabbitmq` 与同 UID 健康检查。API 测试环境显式选择 Ollama，避免不调用回答的解析/索引测试启动时依赖远端 DeepSeek 密钥；这不改变生产提供方默认值。

## 实测与检查

机器证据见 [组合基线](baselines/ingestion-main-integration-2026-11-28.json)，完整原始报告位于本机 `reports/ingestion-integration/2026-11-28/`。这些运行发生在合并提交之前，报告明确保留 dirty 状态；固定两父提交、源码/编译产物/工具/输入摘要，而不冒充在已发布提交上运行。

| 范围             | 结果与实际覆盖                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API 全量         | 720 项、121 文件通过，包含主线问答、重排、查询与本分支解析/保存/恢复。                                                                                                                      |
| Web 全量         | 256 项、28 文件通过；Web 构建通过，仍有既有包体积提示。未新增浏览器端交互验收。                                                                                                             |
| 分块质量         | 既有 8 份合成输入 × 4 档预算，32/32 配置通过；不是新增业务样本或主线 Recall/MRR 提升结论。                                                                                                  |
| 持久化/原生格式  | 15 项通过，包含真实 Mongo 缓存、逐批向量、强杀后只重算缺失批次、证据/资源回读及原生格式。                                                                                                   |
| 真实队列与数据库 | 投递 8、解析任务 10、索引一致性 25、批量升级 16，共 59 个独立场景最终通过，模型替身只用于状态断言。                                                                                         |
| HTTP/Worker 故障 | 10/10 通过，涵盖检查点后强杀、重复任务、编辑/删除竞争及激活结果不确定。                                                                                                                     |
| 真实格式链路     | 10/10 本地格式通过：扫描 PDF、文本 PDF、TXT、DOCX/XLSX/PPTX、DOC/XLS/PPT、含图片 HTML。真实 MinerU 4.2.3 Flash、nomic-embed-text 与 qwen2.5:0.5b，核对/发布/事实 Chunk/来源回读及删除通过。 |
| 组合版迁移回退   | 11/11 通过；重新运行旧库迁移、单份/两份升级、配置保护、旧包读新数据、旧策略重建和再次升级/清理。                                                                                            |
| 新增组合链路     | 两份相同正文分别 TEAM/PRIVATE，真实 768 维编码及不同任务前缀；ES 原文、hash、范围与 Mongo 结构块逐一相同，检索标题仅进 retrieval_text；重复重建缓存命中，两条查询路由均核对权限。           |
| 问答冒烟         | 本地真实 Qwen 7B 返回“审批额度为731件。 [S1]”，1 条引用、2 个上下文；无权限账户 insufficient 且无引用/上下文。只证明该合成样本的协议和事实交付，不替代 DeepSeek、BGE 或问答准确率评测。     |
| 工具与配置       | 入库工具 24 项、主线检索工具 Node 49 项与 Python 11 项通过；锁文件离线 frozen 检查、两端构建、Compose 合并配置、格式检查通过。                                                              |

MinerU 包/权重运行时摘要重新计算为 `5ac1b90c8761385768caf3354d4ca7fcf8fcb1c7c98d0f71f7de0b8e292a152b`；Ollama 使用真实已安装模型，修订与前阶段相同。问答冒烟额外使用 Qwen2.5 7B，digest 记录在机器报告，重排显式选择 rule。没有读取或复制主线工作区的外部模型密钥，也没有将本地模型表现写成 DeepSeek/BGE 的新质量结果。

## 中间失败与修正

- 首轮定向单元测试 189/191：主线的“答案块不含章节”诊断不再适用于结构分块；ES mapping 测试尚未包含 `ingestion`。按整合后的契约更新测试，同时增加来源、去重、前缀 token/字符预算、回调键和策略指纹回归。最终 API 全量通过。
- 首轮真实服务 57/59：新增退休 generation 用例使用 `Replacement`，而主线通用可见性测试只查询旧固定标签；另一个断言写死 `structure-v4`。补全测试标签、更新策略预期后重跑索引/批次全套 41/41；首轮投递/解析 18 项已通过，未把失败删掉或以跳过代替。
- 系统 Python 3.15 缺少 requests，主线 Python 工具测试未能导入。改用已有 MinerU Python 环境后 11/11 通过，不更改系统 Python 或业务依赖。
- 格式首次调用提供了不存在的 `acceptance-legacy-*` 选择项，脚本正确拒绝且未执行业务样本；改用真实 case ID 后 10/10 通过。
- 初轮本地 0.5B 回答拒答，权限与证据交付检查通过，但不计为回答成功。7B 冒烟实际回答并引用；最终脚本要求 answered 和已知 731 事实，不以“可拒答”替代该样本成功。

main 带入的冻结语料有既有尾部空行，保持其字节与摘要，不为了 whitespace 检查改写语料。新增/修改的整合文件和相对于 main 的 diff 检查通过；不把冻结文件的既有空行描述为本轮引入的质量缺陷。

## 升级与剩余边界

合并代码没有自动重建任何业务文档。部署前仍按 [操作单](ingestion-release-runbook.md) 关闭写入、排空任务并执行迁移；先单份再扩批。升级到新分块与 CJK 多字段后，需要通过正常完整 generation 重建才能使用新策略；旧 ES 文本不会因加 mapping 自动补 CJK 内容。

本轮保持模型/前缀组合在隔离环境内一致。生产修改前缀或模型仍需独立索引/查询协调切换，即使维度相同也不能混查；默认空前缀没有被自动改成测试使用的 nomic-task 前缀。

公开网页在正常公网 DNS 环境的最终复测、生产真实 OCR/模型容量、跨存储备份恢复，以及 DeepSeek/BGE 的组合版本业务质量复评仍是独立未验收项。既有 6.3.1 固定回退报告不能冒充组合版本回退；本轮重新执行的 11 项回退已通过，结果随机器基线记录。完成本分支整合不表示代码已合并进 main 或上线。

## 复现入口

先安装锁定依赖并构建 API。组合冒烟需要本机 Ollama 的 nomic-embed-text、Qwen2.5 0.5B 和 7B，真实格式与回退另外需要已预热的 MinerU；固定样本使用既有生成夹具。只清理脚本自身的 Compose 项目，不复用业务数据库。

```sh
npm run build --workspace apps/api
npm test --workspace apps/api
npm test --workspace apps/web
COMBINED_OUTPUT=reports/ingestion-integration/your-new-combined \
  DELIVERY_TEST_PULL_POLICY=never \
  node apps/api/test/ingestion/integration/combined.cjs
```

故障、格式、回退的入口分别见 [故障报告](ingestion-resilience-report.md)、[完整链路](ingestion-acceptance-report.md)、[回退报告](ingestion-release-report.md)。运行时要选择真实存在的格式 case ID；公开网页 DNS 阻断保持单列，不通过关闭地址校验绕过。
