# 入库解析与分块实测对比（2026-11-22）

本页记录当前工作区实际运行结果。旧版取自提交 `955f1e17a0717cc13eb538f7062544444c70f220`，在临时目录加载其真实解析和分块源码；当前版本使用已编译工作区。两者使用相同 Node 依赖、相同文件字节和配置，不通过重新实现旧算法构造基线。

样本为六格式合成文档加空白/损坏 PDF，共 8 份。每份预热 2 轮后测量 20 轮，交替执行新旧路径；输入重新复制，避免解析器修改共享缓冲区。耗时包括解析和 fallback，资源上传使用内存替身，不包含实际对象存储、数据库、Embedding 或检索。Node v24.16.0，darwin/arm64，Apple M4。

## 优化前后

分块配置固定为 300 字符、40 字符 overlap。关键片段覆盖使用字面子串匹配；不是语义准确率、OCR 字符准确率或检索 Recall。Word 表格另校验完整 Markdown 行中各单元格关系。

| 指标                              | 优化前 | 优化后 |
| --------------------------------- | ------ | ------ |
| 六格式关键片段覆盖                | 14/14  | 14/14  |
| DOCX 预期表格行（含表头）         | 0/2    | 2/2    |
| 长表格片段保留表头                | 1/2    | 2/2    |
| 代码片段保留完整围栏              | 0/3    | 3/3    |
| 合成指南 Chunk 数量               | 15     | 11     |
| 空白 PDF 被判为 READY（20 轮）    | 20/20  | 0/20   |
| 有文本 PDF 触发 fallback（20 轮） | 8/20   | 0/20   |

| 文件        | 旧解析中位数 / P95（ms） | 新解析中位数 / P95（ms） |
| ----------- | ------------------------ | ------------------------ |
| guide.md    | 0.009 / 0.016            | 0.081 / 0.149            |
| notes.txt   | 0.003 / 0.006            | 0.026 / 0.034            |
| costs.xlsx  | 1.764 / 3.311            | 2.101 / 3.162            |
| review.docx | 1.985 / 2.475            | 2.172 / 5.333            |
| slides.pptx | 0.174 / 0.358            | 0.218 / 0.326            |
| pages.pdf   | 3.645 / 1013.484         | 1.994 / 4.524            |
| blank.pdf   | 0.299 / 503.653          | 0.328 / 0.703            |
| broken.pdf  | 0.425 / 0.632            | 0.457 / 0.842            |

新版本增加结构、质量和预算检查，小文件部分场景更慢。文本 PDF 的主要收益是消除本轮小缓冲区触发的 fallback 长尾；20 轮中的 P95 只描述此次本机测量。不能把这些结果表述成全格式提速，也不能从 Chunk 数变化直接推导模型费用下降比例。

## 当前原生解析与真实 MinerU

MinerU 为本机自托管 4.2.3 Flash，关闭图像分析，PDF 模型已缓存；服务真实运行，输出经过任务 API 上传、轮询、下载、结构转换，轮询间隔 1 秒。每份样本 3 次；表中为中位数，3 次不计算 P95。所有 Office/文本 PDF 每轮均保留所列片段。

| 样本           | 当前原生片段覆盖 | MinerU 片段覆盖 | 原生中位数（ms） | MinerU 中位数（ms） |
| -------------- | ---------------- | --------------- | ---------------- | ------------------- |
| costs.xlsx     | 2/2              | 2/2             | 16.53            | 1042.75             |
| review.docx    | 3/3              | 3/3             | 16.26            | 1030.52             |
| slides.pptx    | 2/2              | 2/2             | 1.77             | 1036.37             |
| pages.pdf      | 2/2              | 2/2             | 6.10             | 3458.35             |
| scanned-en.pdf | 0/4              | 4/4             | 3.83             | 3332.10             |
| scanned-zh.pdf | 0/4              | 4/4             | 6.94             | 3368.66             |

两份扫描件是 Pillow 绘制文字、ReportLab 仅嵌入图片生成的单页 PDF；用 pypdf 校验文字层为空，并渲染核对。中英文各有 4 条预先标注的完整句子，MinerU 三轮均恢复 4/4，顺序正确。它们是清晰、无噪声、简单单栏合成扫描件，不覆盖真实拍照、印章、跨页表格、多栏或数学公式。

英文扫描件三次耗时为 21.05s, 3.33s, 3.29s；第一轮明显更慢，不能只展示后续热运行。中文扫描件三次为 4.84s, 3.37s, 2.02s。之前未备齐模型时还发生过 60 秒超时，初次下载和服务就绪需要独立治理。

数据显示 MinerU 为扫描件补充 OCR 能力，同时付出秒级延迟；简单 Office 和正常文本 PDF 没有测得速度收益，复杂版式收益仍需真实标注语料验证。产品选择统一二进制解析能力后，默认引擎已改为 MinerU Flash，TXT/MD 继续本地读取，原生引擎保留为显式回滚选项；未实现按文档质量自动路由。部署步骤见 [MinerU 配置](mineru-ingestion.md#配置与部署)。

## 报告与复现

- [旧版/新版逐轮报告](../reports/ingestion-comparison/native-before-after.json)：包含样本 SHA-256、版本、20 轮耗时与 parser/READY 结果。
- [真实 MinerU 综合报告](../reports/ingestion-mineru/comparison.json)：48 次格式/扫描件比较记录。
- [格式单独报告](../reports/ingestion-mineru/comparison-formats.json)与[扫描件单独报告](../reports/ingestion-mineru/comparison-scans.json)。
- 报告和生成扫描件目录被 Git 忽略；样本生成器、比较工具入库。报告存在于当前工作区；其他 checkout 需运行命令生成。

```bash
pnpm --filter @knowbase/api benchmark:before-after
MINERU_BASE_URL=http://127.0.0.1:8000 MINERU_TIER=flash MINERU_BENCHMARK_REPEATS=3 pnpm --filter @knowbase/api benchmark:mineru
python apps/api/test/ingestion/scanned-fixtures.py reports/ingestion-comparison/scans --font /absolute/path/cjk-font.ttf
MINERU_BASE_URL=http://127.0.0.1:8000 MINERU_TIER=flash MINERU_BENCHMARK_REPEATS=3 node apps/api/test/ingestion/compare-mineru.cjs reports/ingestion-comparison/scans/corpus.json
```

原生对比默认固定旧版 `955f1e1`；可向脚本传入其他已存在 Git ref。Python 生成器依赖见文件说明，字体需显式指定。`compare-mineru` 每次覆盖 comparison.json，若运行多个 corpus 应分别保存报告。扫描件对比会因原生无法达到 expectedReady/事实覆盖目标返回非零；完整报告仍输出，这个差距是评测结果。任何引擎失败也保留报告，不用删掉失败样本的方式提高覆盖率。
