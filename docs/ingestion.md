# 文档入库：结构、分块与构建

本文记录 `codex/ingestion-optimization` 的实现与运行约束。固定基线、验证清单及 main 衔接问题见 [ingestion-baseline.md](ingestion-baseline.md)。后续路线见 [ingestion-optimization-roadmap.md](ingestion-optimization-roadmap.md)，版本可见性与投递协议仍以 [pipeline.md](pipeline.md) 为准。

默认使用 MinerU；其质量诊断、异步解析任务及旧 generation 回收见 [mineru-ingestion.md](mineru-ingestion.md)。本文的原生解析规则适用于显式配置 `DOCUMENT_PARSER=native`。

## 数据经过哪些环节

```text
文件
  → 格式解析器：Markdown + assets + 明确的来源区段
  → 正文存储：Markdown + 有序正文块 + 解析策略
  → DocumentChunksService：可重用的结构分块产物
      ├→ DocumentEmbeddingService：向量生成/复用 → ES 分批写入 → generation 激活
      └→ 图谱抽取 → Neo4j 事务写入 → generation 激活
```

解析器负责各自格式，`markdown-blocks.ts` 读取规范化 Markdown 的标题、段落、列表、表格与代码；`structured-chunks.ts` 负责分组，`block-fragments.ts` 负责大块拆分。MongoDB 适配器独立负责分块产物和向量缓存，分块算法不访问数据库。

## 解析质量与来源

- PDF：使用独立 `Uint8Array` 兼容旧 PDF.js，避免 Node Buffer 的视图行为干扰读取；按实际文本宽度重建行，只把连续表格行组合为表格，保留前后正文位置。每一页都有来源区段；无文本或读取失败的页会产生质量错误，整份文档不会被标为 READY。空白封面也需要人工确认，当前不自动区分装饰空白页与扫描页。
- DOCX：保留标题/列表的现有转换方式，增加 Markdown 表格规则并记录实际上传的图片资源。表格使用单元格文本，不承诺还原复杂合并单元格或单元格内的富文本布局。
- PPTX：按 XML 中的文本/表格出现顺序输出，附幻灯片编号；这不是基于视觉坐标的复杂版式阅读顺序恢复。
- XLSX：保留工作表和表格行范围，中间空行继续占位，仅去掉末尾全空行；不在服务端执行公式，读取文件保存的值。
- TXT/MD：使用严格 UTF-8 或带 BOM 的 UTF-16 解码，拒绝空内容、非法编码和含 NUL 的二进制内容。文本解码失败不交给 Office fallback 掩盖错误。

每个来源区段包含规范化 Markdown 中的 `start/end`（UTF-16、左闭右开），以及 PDF 页码、幻灯片或工作表信息。页码从 1 开始。来源只接受格式解析器给出的明确区段，不从用户写的 `Page 1` 标题推测页码。手工编辑产生新正文，不继承原文件页码、幻灯片或工作表位置。

解析策略为 `structured-markdown-v1`。旧内容缺少结构信息时，仍可从 Markdown 构建正文块和 Chunk，不要求一次性迁移所有正文。存量扫描 PDF 需要从原文件重新解析后才会获得 MinerU OCR 结果；原生引擎不提供 OCR。

## 分块规则

`RAG_CHUNK_SIZE` 是最终 Chunk 的 UTF-16 字符预算，包含注入的标题、重复表头和代码围栏；它不是 token 数。标准 OpenAI Embedding 使用实际 tokenizer 检查 token 上限；Ollama 禁止静默截断，其硬限制由实际模型检查。默认 1000 字符，overlap 默认 150。

正文按标题路径和来源区段分组，不混入另一章节、页面或工作表。标题上下文最多占字符预算的一半；完整标题路径保留在元数据中。长段落先按中英文句界切分，完整句子保留末尾标点；只有单句仍然过长时才退回换行、空格和字符切分。overlap 只在同一长正文块内部使用，优先保留完整句子；表格和代码不机械增加 overlap。

HTML/Markdown 表格先提取单元格结构，再按完整行分组，每组重复完整表头路径和分隔行，合并单元格的原始值与派生检索视图分别保存（详见 [表格证据](table-ingestion.md)）；代码按行拆分，每块补齐原围栏。若“表头 + 一整行”本身超过预算，该表降为带列标题、逻辑行列及单元格文字偏移的片段；长单元格优先按句界拆开。单个列标题/caption 无法放入预算时仍明确失败，详见 [证据片段评测](chunk-evidence-quality.md)。超长代码单行允许按字符拆分，片段用于阅读，不保证各段可以独立执行。

Chunk 包含 `content`、`embeddingText`、标题路径、来源块范围、内容 SHA-256 及 `structure-v4:<size>:<overlap>` 策略。当前 `embeddingText` 与 `content` 相同。来源范围描述原始正文块，并非拆分后的字符精确引用；新增标题、重复表头及围栏没有原文件字节位置。现有检索响应字段含义保持兼容，ES 的 `ingestion` 元数据保存在 `_source`，不参与搜索映射。

RAG 和 KG 通过同一服务复用 MongoDB `ingestion_chunks` 中的有序产物。键包括 documentId、contentId、正文摘要、来源区段、解析策略和分块策略。每个 Chunk 独立一条记录，最后写清单、数量及摘要；缺清单、缺项或摘要错误都按未命中重算，避免把半成品作为完整产物使用。策略变化必须变更版本常量；同一版本下不能改变规则后继续复用旧缓存。

## 向量与写入预算

| 配置                             | 默认值  | 含义                                     |
| -------------------------------- | ------- | ---------------------------------------- |
| `RAG_EMBEDDING_BATCH_SIZE`       | 32      | 每批不同输入的最多条数                   |
| `RAG_EMBEDDING_BATCH_CHARACTERS` | 24000   | 每批字符总量；单条超过此值会失败         |
| `RAG_EMBEDDING_CONCURRENCY`      | 2       | 同一进程 Embedding 实例跨文档的并发上限  |
| `RAG_EMBEDDING_TIMEOUT_MS`       | 60000   | 单次提供方请求超时                       |
| `RAG_EMBEDDING_DIMENSIONS`       | 768     | 写入与查询预期向量维度，必须匹配所用模型 |
| `ES_BULK_MAX_CHUNKS`             | 200     | 单次 bulk 最多 Chunk 数                  |
| `ES_BULK_MAX_BYTES`              | 5242880 | 单次 NDJSON 请求的 UTF-8 字节预算        |
| `INGESTION_CACHE_TTL_DAYS`       | 30      | 分块产物和向量缓存保留天数               |
| `EMBEDDING_MODEL_REVISION`       | 空      | 不可变模型修订标识，空值禁用持久向量缓存 |

数值配置要求正整数；overlap 可以为 0，必须小于 size。分块预算至少为 16。字符预算和条数预算一起生效，不能替代模型的 token 限制。标准 OpenAI Embedding 额外支持 `RAG_EMBEDDING_MAX_TOKENS` 下调 token 上限，精确支持范围见 [证据片段评测](chunk-evidence-quality.md)。提供方适配器不额外自动重试，把业务重试交给已有 Outbox/receipt，避免乘法重试。Ollama 的请求通过 AbortSignal 限时；OpenAI 使用 SDK 请求超时。生产并发仍需按 Worker 数、模型容量和数据库连接池评测。

一次调用中的相同输入先去重并保持输出顺序；每个批次校验向量数量、维度、有限数值和非零模长后立即保存缓存，后续批次失败或进程重启时可复用已保存结果。实现、故障恢复对比和边界见 [索引构建恢复](index-build-recovery.md)。

跨重建复用的缓存键包含 documentId、实际模型输入文本和模型指纹。模型指纹由提供方、端点、模型名、显式模型修订、维度及输入预处理版本计算。只填模型别名不启用持久缓存；配置修订应使用实际部署模型的 digest/版本，模型权重变化后必须更新。缓存不跨文档共用，权限变更仍通过当前修订与 generation 激活控制可见性。

分块和向量缓存失败会退回重算，并记录不含正文的日志；不将缓存服务可用性变成索引成功的前置条件。TTL 通过 MongoDB TTL 索引回收，读取时也检查过期日期。旧任务与删除竞争后留下的不可见缓存最多保留到 TTL；这些缓存不是检索入口。

ES 按条数及 NDJSON 字节数分批；所有请求成功后执行一次 refresh 屏障，再调用既有激活协议。任一批次、refresh 或最终版本检查失败，都不能激活半成品。单条请求项超预算会明确报错。激活 COMMIT 结果不确定时继续保留暂存数据，不能误删潜在的活动 generation。

## 资源与阶段观测

提取资源使用 UUID 对象键，避免同毫秒同名图片覆盖。主解析失败后，当前尝试的资源通过 `document.assets.delete` Outbox 任务清理；fallback 成功的资源单独归属。正文或元数据持久化失败时，同样保存资源清理任务。该消息复用 KG 队列和已有重试/死信机制，消费者只接受指定文档的 `assets/<documentId>/` 路径。

删除文档时，先清理已记录的提取资源及计算缓存，再删除正文，保留资源引用直到资源删除成功，保证存储故障后可重试。旧版本没有记录到 MongoDB 的资源无法凭空找回；不扫描并删除其他目录。上传失败时若 PostgreSQL 同时不可用，清理任务也可能无法保存，服务会显式记录失败，仍需要运维补偿。

`IngestionStage` 记录 parse、chunk、embedding、graph.extract、index.write 和 index.activate 的阶段耗时及成功/失败；缓存另记输入与未命中数量。日志不包含正文、向量、凭证或提供方错误响应。解析阶段成功表示解析调用完成，不代表质量检查为 READY；激活调用完成也可能因过期版本返回 false，最终可见性仍以 generation 指针为准。

这些阶段日志另有持久状态：异步解析、任务租约、解析阶段界面和可选 generation 回收见 [mineru-ingestion.md](mineru-ingestion.md)；索引构建阶段、失败状态和维护查询接口见 [index-build-recovery.md](index-build-recovery.md)。

## 升级与回滚

先执行 [索引构建进度迁移 009](index-build-recovery.md#升级与回滚)。停止旧 Worker 后部署新 API/Worker，避免旧 Worker 将新增资源清理消息误当成重建任务。解析任务和 generation 回收的 PostgreSQL 迁移见 [mineru-ingestion.md](mineru-ingestion.md)；正文结构为可选新增字段。MongoDB 新增 `ingestion_chunks` 与 `ingestion_embeddings` 两个可丢弃集合，要求唯一键、documentId 和 TTL 索引；应用默认由 Mongoose 创建。若部署禁用了自动建索引，先执行 [ingestion_indexes.js](../deploy/mongodb/migrations/003_ingestion_indexes.js)。ES 会补充不参与索引的 `ingestion` 对象映射。

已有已发布文档可通过原有管理员 `rebuild-indexes` 接口使用新分块规则构建。该接口只读取已保存 Markdown，不会重新解析原文件；PDF/DOCX 解析修复对存量文件生效，可启用异步功能后从原文件重新解析，或重新上传、人工修订正文。分块改变会改变 Chunk 序号和 ID，不能将旧 Chunk 序号作为跨重建永久定位。

切换 Embedding 模型时必须协调查询侧模型配置，使用新向量索引完成重建后再切换查询；即使维度相同也不能混查不同模型空间。本分支不自动迁移模型或清空现有索引。

回滚前停用新 Worker，处理或隔离 `document.assets.delete` 待投递消息后再运行旧 Worker；不要让旧代码消费它不能识别的消息。可保留 MongoDB 新字段/集合及 ES 对象映射，旧代码会忽略它们；需要恢复旧分块时使用旧代码和原配置重建 generation。缓存可以删除重算，但活动索引不能直接删除。

## 验证命令

```bash
pnpm --filter @knowbase/api test
pnpm --filter @knowbase/api test:ingestion-quality
pnpm --filter @knowbase/api benchmark:ingestion
pnpm --filter @knowbase/api test:ingestion
pnpm --filter @knowbase/api test:index-consistency
pnpm --filter @knowbase/api test:delivery
```

`test:ingestion-quality` 在真实格式解析器上运行合成的六格式、空白与损坏样本，不调用外部服务。`benchmark:ingestion` 输出忽略的 `reports/ingestion/baseline.json`，记录解析/分块耗时、输入大小、峰值进程内存、关键事实覆盖和表格/代码结构指标；同时在相同解析结果上运行旧分块规则以比较结构。这里的结构指标针对合成指南中的特定表格与代码，不能外推到所有文档。

`test:ingestion` 使用进程专属的临时 MongoDB 与 MinIO，验证来源/证据序列化、分块清单、TTL、向量复用、对象摘要/范围读取、失败补偿与清理；结束后移除本次容器。解析证据、候选采用及扩展解析配置以 [多模态入库](multimodal-ingestion.md) 为准。索引一致性测试强制每批仅一个 Chunk，验证后续批次失败时旧 generation 仍可见。建议串行运行 Docker 集成套件，避免同时启动多组模型/数据库基础设施导致资源争用。镜像已缓存时可以设置 `DELIVERY_TEST_PULL_POLICY=never`。

合成基线证明格式与分块规则是否满足可检验的约束，不证明生产吞吐、真实模型效果或检索 Recall/MRR 已经提升。检索质量复测应固定另一分支的召回、重排与 Prompt 版本，在真实标注语料上独立执行。

## 本分支的合成语料结果

固定六格式样本中，解析与分块后均保留了 14/14 个标注事实；空白和损坏 PDF 均为非 READY。DOCX 的正文和表格共 3/3 个当前标注事实均保留。在相同解析后的指南正文上，旧分块器的表格组有完整表头为 1/2，新规则为 2/2；代码组有完整围栏从 0/3 变为 3/3。这些比例仅描述当前固定样本。

报告含样本 SHA-256、Git revision、工作区是否存在未提交修改、配置及运行环境，生成目录不入库。上述合成格式基线不包含模型耗时；真实模型与数据库的其他构建评测见 [ingestion-performance.md](ingestion-performance.md)。生产语料及检索质量尚未评测。

原生解析优化前后和真实 MinerU 的量化比较、方法与限制见 [ingestion-comparison.md](ingestion-comparison.md)。

当前不支持音频、视频上传与解析；前后端均拒绝这些格式，旧媒体配置不会开启入口。未完成事项暂停，见 [音视频 TODO](media-ingestion-todo.md)。
