# 固定候选池的重排层对照

只比较“同一批已召回正文如何排序与选择”，不重新检索、不改模型、语料、权限、引用或问答。复用三份已完成的本地 Trace：v3 冻结候选 224 题、旧合成留出默认和候选各 80 题，共 384 份候选池。留出题已经暴露，本轮全部是合成回归，不再称盲测。

参数、来源校验值、停止条件先冻结在 [protocol.json](experiments/protocol.json)。运行器重建当前应用的合并池，并逐条校验原规则返回的候选、分数和顺序与历史结果完全一致，才允许离线排序。策略模块不读取标签；标准来源和原文证据仅在后续评分中使用。

```bash
pnpm --filter @knowbase/api build
node tools/rag-evaluation/rerank-replay.cjs \
  benchmarks/knowbase-rerank-v1/experiments/protocol.json \
  reports/retrieval-rerank-v1/<新运行目录>
```

原始 Trace 在忽略提交的 reports 中，须有协议指定的源文件才能原样重放；协议保留解压后 SHA-256、元数据与原始索引正文指纹。重新检索会产生新候选和标识，属于另一轮对照，不能绕过校验后冒充本轮复现。

本轮先诊断规则、RRF、去掉双路奖励与文本多样性；单路优先、放宽同文档上限、加大字符数或 Top K 只作诊断，不能参与同预算选型。专用重排模型尚未安装，模型对照留作后续独立实验。

## 已完成与复现

协议与实现先提交为 `0797aede`，随后在该干净提交上执行 3456 次离线选择。RRF 在开发组证据召回提升 13.19 个百分点，但开发/已暴露验证共丢失十条原先入选证据，未通过冻结门槛；其余候选未达到开发增益门槛，业务规则不变。结论、代价与停止方向见 [重排审计](experiments/audit.md)，[results.json](experiments/results.json)保存指纹、分类指标、逐题增减与基线损失。

[逐题语义复核](experiments/semantic-review.md)补充区分了这十条标注损失：4 条仍有等价依据、1 条权限依据不完整、5 条缺少撤回时长与起算点。原指标和冻结决策保留；不能把十条字面损失直接等同于十道题回答变差。

```bash
pnpm --filter @knowbase/api build
node tools/rag-evaluation/rerank-replay.cjs \
  benchmarks/knowbase-rerank-v1/experiments/protocol.json \
  reports/retrieval-rerank-v1/<新运行目录>
python tools/rag-evaluation/rerank_audit.py \
  --protocol benchmarks/knowbase-rerank-v1/experiments/protocol.json \
  --replay reports/retrieval-rerank-v1/<新运行目录>/rerank-replay.json \
  --output reports/retrieval-rerank-v1/<新运行目录>/rerank-audit.json
```

Python 使用评测环境依赖，安装方法见 `docs/evaluation.md`。本地产物未提交，复现需要协议列出的三份原始 gzip Trace、元数据和索引快照；缺失文件或指纹漂移会失败。新检索运行应另起版本协议。输出目录每轮使用新名称，避免覆盖本轮证据。
