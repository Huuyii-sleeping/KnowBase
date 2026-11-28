# 合成冷链企业业务档案

阅读 [background.md](background.md) 了解公司、人物、项目与时间线，再按编号阅读 [立项书](documents/charter.md)、[批准变更](documents/change-approved.md)、[例会提案](documents/meeting-proposal.md)、[运行手册](documents/runbook.md) 和 [异常事件](documents/incident.md)。合同、预算与分仓验收以 HTML 表格提供，Excel 由文档生成器创建。

所有资料均为虚构。标准事实和表格坐标在 `annotations.json`，后续问答样本在 `questions.json`，均不传给解析引擎。`table-context.json` 验证分块中的表头顺序、整行数值关联和来源行号。

运行方式、评分规则、真实引擎对比数据与限制统一记录在 [业务场景解析评测](../../docs/ingestion-quality.md)。

PDF 续表由 `apps/api/test/ingestion/quality/pdf-fixtures.py` 生成到独立目录，原生/扫描对照与新增保留样本分别统计，不混入原有文档通过率。音视频实验样本与工具已移除。

分块专项标注为 `chunk-evidence.json`，新增资料在 `chunk-fixtures/`，覆盖长单元格、宽表、合并表头、空白和负数；评分与复现见 [证据片段评测](../../docs/chunk-evidence-quality.md)。
