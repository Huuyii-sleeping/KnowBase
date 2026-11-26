# OCR 扫描表格恢复与保存报告

2026-11-26，阶段 **5.3.1 完成**。按用户决定继续使用 MinerU OCR，暂停额外视觉模型优化。此次解决“表格文字识别出来，但带标题或空白格时无法保存为结构化单元格”的问题。所有恢复结果保持 `needs_review`，不能直接发布。

## 实现及适用边界

MinerU 4.2.3 Flash 会把部分扫描表格返回为带空格对齐的代码块。旧版只接受完整矩形：标题只有一列、中间/末尾存在空格，都会使整表被拒绝。新版 `pdf-tables-v2` 使用表头字符起点建立列锚点，每个数据单元格起点允许 ±1 个 UTF-16 字符偏差；不根据设备名称、金额或业务词猜列。

- 一行独立标题保存为 HTML caption，表头与正文成为明确单元格；不把标题猜成 `colspan` 合并单元格。
- 有标题或稀疏行时，至少需要两条完整数据行佐证列位置。空白保持空白，负号、前导零、单位、否定词保留原字符串；单字符标签和单空格短语均有回归测试。
- 无行标签、列漂移、单元格越界、制表符、多行歧义或代码语言标记等不满足规则时，保持原 OCR 文本并要求核对。保留已有行列/字符预算。
- 原件、表格图片、页码/bbox、MinerU 原始 JSON 和 OCR 文字继续保存。派生表格、表头行视图和 Chunk 使用现有契约。
- 解析策略及任务配置摘要同步升级，使新任务不复用旧表格策略检查点；不会自动改写已采用或发布的正文。

列起点只是结构候选证据，不能证明字符识别正确。任意表格、数据区合并、多层表头和跨行文字均不在本轮自动恢复承诺内。

## 同输入前后对比

冻结旧版 Git `62c0529` 的真实 normalizer 源码，临时转译加载，分别将**同一份实际 MinerU structuredContent**输入旧版与新版。两边共用未改变的表格解析器与评分器，未向推理传标准答案。回放工具检查共享表格解析代码相对旧提交未变更，不切换或写入工作区源码。

原 14 份独立复杂资料保持不变；追加两份先绘制并标注、再推理的图像型 PDF，含 0.6° 倾斜、不同设备及单位、列顺序交换和空白位置变化。原保留集只作回归；追加样本首次推理后也已暴露，后续不能继续称为未见样本。PDF 均无可抽取文本层，生成预览已人工查看。

| 样本           | 旧版表头及正文单元格 | 新版表头及正文单元格 | 新版标题文本 | 主要核对点                   |
| -------------- | -------------------: | -------------------: | -----------: | ---------------------------- |
| 原开发扫描表   |                 0/12 |                12/12 |          1/1 | -1.25、中间空白              |
| 原保留扫描表   |                 0/12 |                12/12 |          1/1 | 列序交换、-3.40、末列空白    |
| 新增位移计复检 |                 0/12 |                12/12 |          1/1 | -8.75、mm、中间空白          |
| 新增压力计复检 |                 0/12 |                12/12 |          1/1 | -6.80、kPa、不通过、末列空白 |

**完整结构评分仍为每表 0/13。** 原标注包含第一行跨三列标题，当前结果是 caption + 4 行矩形表，不具备原合并拓扑。原评分器和标准答案没有降低门槛；另加的正文诊断指标仅去掉标注中明确的整行合并标题，比较剩下 12 格的坐标、跨度、表头和文字，标题文字单独评分，合并关系明确记录为 `not_verified`。不能将 12/12 表述为原表完整恢复。

最终代码重新调用真实 MinerU，原 14 份资料与新增 2 份均完成解析，额外视觉模型调用为 0。原 14 份中，除两份扫描表增加结构对象并消除表格数量错误外，其余 12 份的全部原评分字段不变；扫描表关键事实依旧各 3/3，没有声称字符准确率得到提高。流程图、统计图和混排图像的文字/关系缺失仍存在，解析状态 accepted 也不代表语义完整。

## 保存、分块与暂存索引

16 份实际解析结果通过生产正文存储、证据存储、分块器及 ES generation writer，在隔离的 MongoDB、S3 兼容 Minio 和 Elasticsearch 中回放；向量使用真实本地 `nomic-embed-text` 768 维。测试比较保存前后的 Markdown、质量状态、原始证据、资源字节摘要及规范表格的坐标、caption、空白和来源。

- 保存与交付 **16/16** 通过：36 个资源、28 个证据单元、38 个 Chunk 和对应真实向量回读一致。
- 4 张扫描表共 **12/12 数据行**，每行在同一个 Chunk 中包含完整表头、原值、逻辑行范围和原始来源；另有跨页表格回归检查。
- 各案例对象、正文、证据及暂存 generation 清理通过；隔离服务与卷移除通过。

这是存储与暂存索引验证，未绕过产品发布核对规则；测试直接暂存，尚未验收 HTTP 上传、候选采用、审核发布、generation 激活、权限页面、检索及来源回看，也未替代生产 RustFS 的部署验收。

## 版本、检查及失败记录

固定输入、输出、评分、源码/编译产物/工具/锁文件摘要、同输入回放和交付明细见 [机器基线](baselines/ocr-table-quality-2026-11-26.json)。MinerU 为 4.2.3 Flash OCR，沿用 [5.2 已冻结运行时](baselines/complex-document-model-quality-2026-11-25.json)，部署标识为 `mineru-4.2.3:5ac1b90c8761385768caf3354d4ca7fcf8fcb1c7c98d0f71f7de0b8e292a152b`；该标识不是远程服务权重的独立证明。真实 embedding 修订为 `sha256:0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`。

最终 API **507**、Web **248**、质量工具 **35**、Python **7** 项通过；真实持久化及异步任务 **23** 项通过，覆盖失败补偿、候选拒绝/替换及修订保护。API/Web 构建、变更文件格式、Compose 配置和 diff 检查通过；Web 保留已有大包体积警告。解析锚点、PDF 渲染、持久化比较和诊断评分分别在独立模块，未把数据库或索引逻辑加入解析器。

首次保存验证因 Docker Registry 超时未启动；使用本机已有镜像后发现验证工具错误：资源 URL 迁移改变了表 ID/偏移，比较仍用了旧 blocks；正文诊断还未兼容固定标注中的标题表头行。已修正为从迁移后的 Markdown/sections 重建期望表，并严格校验标题投影后重跑，最终 16/16 通过。单字符标签回归还发现旧分词表达式跨列吞字，已修复。最后一次解析重跑曾因上一轮本地服务已退出记录为 unavailable，启动独立 OCR 服务后在新目录重跑成功；所有失败记录保留，没有覆盖成成功。

## 复现与下一项

先构建 API，使用固定 OCR 服务；每次输出目录必须不存在。生成器字体与依赖摘要需与基线核对，新增语料清单已有 spec/font/input/gold 摘要，生成器及绘图代码版本由本提交和工具摘要固定，不追写旧清单。

```bash
pnpm --filter @knowbase/api build
python3 apps/api/test/ingestion/complex-quality/generate_ocr_tables.py \
  reports/ingestion-complex/new-scans \
  --font '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
MINERU_BASE_URL=http://127.0.0.1:18080 \
QUALITY_MINERU_REVISION=mineru-4.2.3:5ac1b90c8761385768caf3354d4ca7fcf8fcb1c7c98d0f71f7de0b8e292a152b \
node apps/api/test/ingestion/complex-quality/evaluate.cjs \
  reports/ingestion-complex/new-scans reports/ingestion-complex/new-run mineru-ocr all
node apps/api/test/ingestion/complex-quality/replay-ocr-tables.cjs \
  reports/ingestion-complex/new-scans reports/ingestion-complex/new-run \
  62c0529 reports/ingestion-complex/new-replay.json
DELIVERY_TEST_PULL_POLICY=never \
QUALITY_EMBEDDING_REVISION=sha256:0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f \
node apps/api/test/ingestion/complex-quality/verify-delivery.cjs \
  reports/ingestion-complex/new-scans reports/ingestion-complex/new-run \
  reports/ingestion-complex/new-delivery
```

`never` 需要本机已有测试镜像，否则使用默认 `missing`。真实向量验证需要已启动的固定修订 Ollama embedding 服务。二进制、原始结果、日志及完整本地运行目录都留在忽略的 reports/，不提交模型或临时产物。

下一项是 **5.3.2 与 6.1 衔接**：明确 OCR 图像语义边界，验收待核对候选的采用、审核发布、索引激活、来源回看及删除清理；沿用当前 OCR，不调整另一分支的召回、重排和 Prompt。
