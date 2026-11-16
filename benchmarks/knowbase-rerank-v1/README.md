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
