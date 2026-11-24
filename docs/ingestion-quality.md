# 业务场景解析评测与优化

当前评测覆盖文档、表格、图片及静态网页。音视频解析与相关实验工具已移除，暂停事项见 [音视频 TODO](media-ingestion-todo.md)。解析能力和保存协议见 [多格式入库](multimodal-ingestion.md)。

## 数据集与指标

`benchmarks/ingestion-business/` 是人工编写的虚构企业档案：澄川冷链的北斗项目，覆盖立项、正式变更、未批准提案、供应商付款、季度执行、分仓上线与温度事件。公司、人员、金额和事件均为虚构，不能代表生产准确率。

- 文档共 9 份，开发集 4 份、保留集 5 份；`annotations.json` 保存关键事实、表格坐标与原生 Excel 单元格检查。
- `table-context.json` 检查同一分块里的完整表头、整行值、tableId 与来源行号，并检查分块长度预算。
- PDF 另有 6 份开发样本和后增的 2 份保留样本，包含原生/扫描对照、显式续表和独立表格。
- 清单固定每份输入 SHA-256，加载器校验唯一 ID、分组、文档类型、事实标注与目录边界。标准答案不传给解析器；保留样本参与调试后需新增未见样本。

事实按预先编写的同义写法进行字面匹配，保留小数点、负号及数值边界。表格检查行列数、表头行、锚点位置、文字和跨度；同时比较标注单元格和实际单元格数量，避免多生成内容只看召回率。Excel 另检查地址、值、合并引用、公式缓存与必要质量标记。指标衡量解析和结构保留，不等于语义推理、检索或问答正确率。

## 生成与复现

从仓库根目录执行。先构建 API，再生成新的空目录；纯文档生成无需 Python 或 macOS。输出目录已有 manifest 时拒绝覆盖。

```bash
pnpm --filter @knowbase/api build
node apps/api/test/ingestion/quality/generate.cjs /absolute/path/to/corpus
MINERU_BASE_URL=http://127.0.0.1:8000 node apps/api/test/ingestion/quality/evaluate-documents.cjs \
  /absolute/path/to/corpus /absolute/path/to/report
MINERU_BASE_URL=http://127.0.0.1:8000 node apps/api/test/ingestion/quality/evaluate-table-context.cjs \
  /absolute/path/to/corpus benchmarks/ingestion-business/table-context.json /absolute/path/to/table-report
```

PDF 夹具额外需要评测环境中的 reportlab、pypdf、pypdfium2，不加入生产依赖：

```bash
/path/to/pdf-python apps/api/test/ingestion/quality/pdf-fixtures.py /path/to/pdf-corpus
/path/to/pdf-python apps/api/test/ingestion/quality/pdf-fixtures.py /path/to/new-pdf-holdout --holdout
MINERU_BASE_URL=http://127.0.0.1:8000 node apps/api/test/ingestion/quality/evaluate-pdf-tables.cjs \
  /path/to/pdf-corpus /path/to/pdf-report
```

文档评测使用内存资源上传适配器。实际保存需独立执行下面的验证；运行器启动本次专属 MongoDB/MinIO，结束后清理自身容器和卷。可将 QUALITY_CORPUS 指向业务或 PDF 清单；旧版 Office 可通过 LEGACY_TEST_FIXTURE_DIR 提供 review.doc、slides.ppt、costs.xls，原生 XLS 配置见多格式入库指南。

```bash
MINERU_BASE_URL=http://127.0.0.1:8000 QUALITY_CORPUS=/absolute/path/to/corpus \
  node apps/api/test/ingestion/verify-evidence.cjs
```

保存验证逐项回读正文与独立证据，比较数量、页码和表头来源，下载资源核对字节、MIME、SHA-256、Range，并检查删除后无证据、对象或登记残留。保存成功与机器质量验收分开，存在质量问题仍需核对。

报告写入显式指定目录或仓库忽略的 `reports/ingestion*/`。文档对照工具拒绝不同清单摘要、重复样本或不同输入摘要：

```bash
node apps/api/test/ingestion/quality/compare-documents.cjs \
  /path/to/before/documents.json /path/to/after/documents.json
node --test apps/api/test/ingestion/quality/*.test.cjs
```

## HTML 与 Excel 对照

真实 MinerU 4.2.3 Flash 在分仓验收表中丢失 `rowspan="0"`，杭州/苏州组内第二行向左错列。修复分两层：

1. HTML 原生表格读取支持零跨度，严格截止于当前 thead/tbody/tfoot 或连续隐式行组；不能延伸到下一组，仍执行跨度重叠和格位预算校验。
2. HTML MinerU 适配器读取原件表格。仅当原件与引擎结果有唯一、完全对应的锚点文字序列时，以原件结构重建表格，并重新定位后续正文和证据偏移。序列不一致、重复表格、数量不符、含链接/媒体或不支持结构时，保留引擎正文并进入人工核对。重建只序列化文字、跨度和表头，不继承可执行属性。

不能把这个修复推广为 PDF 跨页续表关联。它利用的是 HTML 原件明确存在的结构，不猜测扫描图或 PDF 中的合并关系。任务配置指纹已更新，历史正文需重新解析才能使用修复。

2026-11-23，同一清单、同一输入摘要、同版本真实 MinerU：

| 样本/指标                            | 修改前 | 修改后 |
| ------------------------------------ | -----: | -----: |
| 9份文档全部标注检查通过              |    8/9 |    9/9 |
| 分仓表锚点单元格（位置、内容、跨度） |   9/15 |  15/15 |
| 合同表锚点单元格                     |  16/16 |  16/16 |
| 预算表锚点单元格                     |  31/31 |  31/31 |
| 原生Excel关键单元格检查              |    9/9 |    9/9 |

9份文档的31个关键事实均保留。真实 MongoDB/MinIO 保存验证运行原有7样本加9份新文档，共16样本通过，24条证据、10个派生资源，摘要、MIME、字节、Range与清理断言通过。缺少公式缓存的Excel仍按设计进入核对，不能为了通过评测将它改为READY。

## PDF 表格对照

评测先生成原生 PDF 和纯扫描 PDF 的对照，再新增改变表名、金额和列宽的保留样本。独立表格对照使用相同列数，防止仅凭列数借用另一张表的表头。扫描件通过 pypdf 验证没有文字层，并渲染检查页图。第二轮基础集的 HTML/Excel 指标不能替代这一轮 PDF 检查。

发现并修复三种实际问题：

- MinerU Flash 将扫描表格识别为对齐文本代码块，原来仍可标记为 READY。现在仅对列数完整、列起点一致、无合并/不安全标记的矩形文本重建显式单元格；其他情况保留原件并标记结构核对。
- 缺少重复表头的续表会把第一行数据当表头。只有明确的续表标记、相同表名、相邻页、每页唯一表格及兼容列数同时满足时，才保留首行数据并补入上一页表头。每页仍是独立表，不拼接物理页；补入表头的来源通过 `tableHeaderPage` 保存到正文、分块和证据，必须人工核对。
- 表名有时位于紧邻表格的独立编号标题中，而不是 captions 中。首轮保留集暴露了这个分支，补充对应测试后重新运行；任意段落不会被当作表名。

| PDF 检查                 | 修改前 |  修改后 |
| ------------------------ | -----: | ------: |
| 开发样本全部标注通过     |    2/6 |     6/6 |
| 新增保留样本全部标注通过 |    0/2 |     2/2 |
| 单元格位置、文字及跨度   | 54/144 | 144/144 |
| 分块完整表头与整行关联   |  12/32 |   32/32 |

基线在独立测试进程中禁用本轮 normalizer，前后均调用真实 MinerU、使用同一文件摘要与当前相同的其他适配器。它是本轮改动隔离对照，不是历史整个版本回放。开发/保留集均检查数据页码与借用表头页码，核对状态也纳入通过条件。保留集最初失败结果保存在 `pdf-heading-failure/`，没有删除后只报告成功。完成补丁后该保留集已参与调试，后续调参还需新保留样本。

## 运行资源与边界

排队解析收到取消信号后立即退出等待队列，不释放仍被占用的并发槽；后续调用保持顺序。相同图片按 MIME 与字节 SHA-256 在单次文档尝试内复用模型调用：测试中两份相同图片由 2 次调用减少到 1 次，页码与权限仍独立，失败不重复请求，唯一图片预算继续生效。没有跨文档缓存，也没有真实视觉模型准确率结论。

仍需完善跨页合并单元格、断裂行、多栏阅读顺序、动态图表理解、动态网页、旧 XLS 公式恢复和提取中途的持久恢复。当前 PDF 借用表头有严格前提并强制核对，不能推广为任意跨页表格恢复。本轮未修改召回、重排或问答 Prompt。
