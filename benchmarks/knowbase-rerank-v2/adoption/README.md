# 已确认的候选上限与短窗口验证

用户接受 BGE 每文档候选上限 2→3 的覆盖收益，即使首条命中略降；后续计划单独改为消费多条证据，本轮不修改问答代码。选择器的默认上限已改为 3，显式调用参数仍优先，Top 5 和 6000 UTF-16 字符不变，原规则回退不变。

短窗口按 256 token / 重叠 32 token 执行原有完整正文滑窗，不丢正文尾部，窗口取最高原始 logit。与 512 / 重叠128 的对照共用已经批准的每文档 3 块，因此不会把候选上限收益混算成窗口收益。

[protocol.json](protocol.json)在新窗口全量计分前冻结。384 份固定池、304 个不同问题 ID，长窗口复用原完整分数，短窗口新推理；完全相同的问题/标题/正文配对仅复用短窗口内部缓存，单列新配对和缓存配对。耗时收益依据原 12 场景两轮无缓存配对（约 19.5%），不把全量重复题的缓存耗时当作加速。

原先“至少快 20%、零新增损失”等整体切换门槛不适用于本次局部优化。完整质量结果按分组和证据实例报告；明显或集中退步交给用户判断，小幅质量代价与稳定速度收益按用户授权取舍。模型对比仅记录 TODO。

```bash
python tools/rag-evaluation/rerank_short_window_run.py \
  --protocol benchmarks/knowbase-rerank-v2/adoption/protocol.json \
  --model-root /path/to/models --output reports/retrieval-rerank-adoption/<run>
npm run build --workspace apps/api
node tools/rag-evaluation/rerank-short-window.cjs \
  benchmarks/knowbase-rerank-v2/adoption/protocol.json \
  reports/retrieval-rerank-adoption/<run>/scores.json \
  reports/retrieval-rerank-adoption/<run>/replay.json
```

计分使用 `rerank_refinement_audit.grade_replay` 的原标注指标，不调用其历史整体切换决策。回放同时逐池验证真实编译后的 BGE 选择器与独立离线选择器的入选集合、顺序、正文一致。真实推理过程只保存完整题断点，协议或权重变化拒绝恢复。
