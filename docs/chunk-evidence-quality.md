# 证据片段评测与长表格分块

## 范围

本轮处理解析之后的分块可靠性，未改召回、重排、问答 Prompt 或模型选择。已有标题路径、章节/页面隔离、普通表格整行与重复表头规则继续保留。输入是人工编写的 Markdown 和其中的 HTML 表格；本评测没有调用 MinerU 或语言模型，因此不代表解析引擎、检索或回答准确率。

业务样本和标注位于 `benchmarks/ingestion-business/chunk-evidence.json`：8 份资料，4 份开发、4 份保留，含旧业务档案和 5 份新增长表格/长单元格资料。保留样本在实现前固定，但均为作者合成；读取结果后再针对样本调参时需要新增未见样本。

## 规则和来源契约

分块策略由 `structure-v3` 升至 `structure-v4`，缓存键随策略失效；存量已发布文档需要重建索引才能使用新分块，不要求从二进制重解析。Chunk 序号会变化，不能作为跨重建稳定定位。

- 表头及每行可放入预算时，保持原有整行分组与完整表头。
- 任一行或完整表头超限时，该表改为逐单元格文本片段。每片携带完整列标题路径、逻辑行列，短的首列行标识重复作为上下文；长行标识独立保留，不猜测缩写。
- 长单元格按句子/换行优先拆开，最后按字符兜底，避免拆断 UTF-16 代理对。所有片段加标题、caption 和定位文字后仍受 `RAG_CHUNK_SIZE` 限制。
- `source.tableColumn` 是表内一基列号；`tableCellStart/tableCellEnd` 是原始可见单元格文字的 UTF-16 左闭右开区间。它们不是 Excel 地址、原件字节或 PDF 像素。表格级 `ranges.start/end` 仍指整个 Markdown 表块。
- 空白保留为空白，0、负数、合并覆盖关系不改写；原始 `table-v1` 单元格不被拆分、不被重复计入计算。cell fragment 是检索派生文本，不能冒充完整表行。
- 单个列标题/caption 已占满预算时仍明确失败，不静默截断标题。逐列拆分不保证跨多列的所有答案同时出现于一个 Chunk；需要整行证据的场景仍应使用合适预算或读取 canonical table。

## 评分与可复现对照

标注只传入评分器，不传给分块器。分别统计：关键原文是否保留、同一问题所需原文是否出现在同一块、所属章节和表内行列是否匹配、每个非表头逻辑格位是否被完整覆盖。长单元格按偏移检查无缺口；普通表格要求完整表头和整行，禁止只因数字在其他位置出现就判通过。空白格也参与覆盖检查，合并单元格覆盖位置仅作为派生格位，不是唯一单元格计数。

另外记录长度 P50/P95/最大值、分块数、索引字符数和完全相同块的重复字符数。最后一项只衡量完全重复，不衡量语义冗余，也不把必要的重复表头判为无用内容。

从仓库根目录执行：

```bash
pnpm --filter @knowbase/api build
node apps/api/test/ingestion/quality/evaluate-chunks-baseline.cjs \
  e545531277454d637d040123b944623e0a88f684 \
  benchmarks/ingestion-business/chunk-evidence.json reports/ingestion-chunks/before
node apps/api/test/ingestion/quality/evaluate-chunks.cjs \
  benchmarks/ingestion-business/chunk-evidence.json reports/ingestion-chunks/after
node apps/api/test/ingestion/quality/compare-chunks.cjs \
  reports/ingestion-chunks/before/chunks.json reports/ingestion-chunks/after/chunks.json
node --test apps/api/test/ingestion/quality/*.test.cjs
```

基线工具只在独立 Node 进程中加载指定 Git 提交的两个旧分块模块，记录源码摘要；其余 block reader、输入和评分器与修改后相同。这是隔离本轮分块差异的对照，不是回放历史整套系统。对照拒绝标注摘要、文件摘要、分组、预算或样本集合变化；构建失败计为零份已交付证据，不能只报告成功子集。

2026-11-24，8 份输入 × 180/256/512/1000 字符预算、overlap 0：

| 指标                   |  修改前 |  修改后 |
| ---------------------- | ------: | ------: |
| 全部检查通过的配置     |   23/32 |   32/32 |
| 开发组通过             |   11/16 |   16/16 |
| 保留组通过             |   12/16 |   16/16 |
| 构建失败               |       9 |       0 |
| 原文片段保留           | 103/140 | 140/140 |
| 同块证据组与正确来源   |   56/76 |   76/76 |
| 非表头逻辑格位完整覆盖 | 103/148 | 148/148 |

这些是四档预算累计计数，不是 140 个独立事实。原先成功的 23 组均保持通过；输出索引字符总量从 9700 增至 16384，主要因为原先失败的文档现在能够交付内容，并重复必要定位上下文，不能解释为节省 token。小预算下逐单元格拆分会增加块数，不能声称吞吐提升。

## 模型 token 预算

字符上限仍不是模型 token 上限。已知标准 OpenAI `text-embedding-3-small`、`text-embedding-3-large`、`text-embedding-ada-002` 使用随依赖打包的 cl100k_base tokenizer，调用前检查最多 8191 token。可设置 `RAG_EMBEDDING_MAX_TOKENS` 为更小正整数；更高设置不会放宽模型上限。包括标题、表头和定位文字的最终 `embeddingText` 整体计算，缓存命中也要遵守当前上限。超限明确失败，要求减小分块预算，不静默截断或改写事实。

Ollama 显式 `truncate:false`，模型服务按实际 tokenizer 检查硬限制。任意兼容端点的自定义模型不套用 cl100k；对这些模型不能配置上述本地 token 上限。它们仍需要对应 tokenizer/服务端硬限制验证，目前不能宣称所有模型都支持本地精确计数。

## 本轮验证

API 95 个文件、416 项测试与前端 23 个文件、240 项测试通过；前后端构建通过。Node 评测工具 13 项通过，反例覆盖错列、错表、错来源块、丢失片段、非法标注、不同输入对照和配置变化。真实服务集成 45 项全部通过、无跳过：持久化 11、解析任务 10、原生格式 2、投递 8、索引一致性 14。新增持久化测试回读 cell offsets、发现被篡改产物后重算、清理文档与失败构建。

另将此前真实 MinerU 的 8 份 PDF 解析产物重新分块，32/32 个表头与整行关联检查通过；本次未重新执行 PDF 推理。原有六格式分块基线的 14/14 个事实继续保留，空白/损坏 PDF 保持非 READY。Web 仍有既有的大包体积提示。

评测输入 Markdown 属于固定夹具，保留原始排版而不进行代码格式化；生成报告、模型资源与临时环境不入源码。
