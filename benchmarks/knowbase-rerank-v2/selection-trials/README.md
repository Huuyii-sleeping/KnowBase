# 重排层三项独立试验

比较基准是已采用的 BGE v2 M3、FP16、256 token / 重叠 32 token、batch8；规则前两块准入锚点、每文档最多 3 块、总数最多 5 块、6000 UTF-16 字符保持不变。三类方案各自对照当前方案，不把多个改动混在一起。

- 重复抑制：正文 NFKC/小写/去空白的字符三元组 Jaccard 相似度，固定 0.95 和 0.85 两档；数字、英文标识、否定/现行/历史等标记不同时保留两块。按原准入顺序去重后补选，最终仍按 BGE 分排序。这里测试的是文本近重复过滤，不是语义 MMR。
- 弱相关过滤：原始模型 logit 阈值固定为 -3、-1、0、1，规则锚点也必须通过；低于阈值可少选或返回空结果。logit 不作为相关概率，阈值不跨模型复用。
- 现成模型：mMiniLM 多语言 Cross-Encoder 和 BGE reranker base，使用同一输入与选择约束重新计分。模型仅用于离线试验，不训练、不接入业务、不改变生成层。

[protocol.json](protocol.json) 在新增分数及策略质量结果暴露前冻结。384 份已暴露合成候选池对应 304 个不同问题 ID；两个留出来源复用同一批 80 个问题，不能算成两批新问题。开发组用于提名方案，其他分组为回归检查，不称盲测。保留所有方案结果，不按单题修改阈值或规则。

模型固定 ModelScope 镜像 revision 和逐文件 SHA-256；只加载本机 safetensors，不执行远程代码。下载方式沿用[模型评测复现说明](../README.md)，具体文件来自本协议的 `models`；权重保存在仓库外的模型目录。

```bash
python tools/rag-evaluation/rerank_model_comparison_run.py \
  --protocol benchmarks/knowbase-rerank-v2/selection-trials/protocol.json \
  --model mminilm --model-root /path/to/models \
  --output reports/retrieval-rerank-selection-trials/<run>
python tools/rag-evaluation/rerank_model_comparison_run.py \
  --protocol benchmarks/knowbase-rerank-v2/selection-trials/protocol.json \
  --model bge-base --model-root /path/to/models \
  --output reports/retrieval-rerank-selection-trials/<run>
node tools/rag-evaluation/rerank-trials-replay.cjs \
  benchmarks/knowbase-rerank-v2/selection-trials/protocol.json \
  reports/retrieval-rerank-selection-trials/<run>/replay.json \
  reports/retrieval-rerank-selection-trials/<run>/mminilm-scores.json \
  reports/retrieval-rerank-selection-trials/<run>/bge-base-scores.json
python tools/rag-evaluation/rerank_trials_audit.py \
  reports/retrieval-rerank-selection-trials/<run>/replay.json \
  reports/retrieval-rerank-selection-trials/<run>/audit.json
```

前两条使用独立的模型依赖环境，质量计分使用原检索评测环境。当前 BGE 分数复用已完成短窗口运行；新模型重新推理，只在同一模型内缓存完全相同的问题/标题/正文配对。每份池的身份、入选顺序、完整正文和缓存数分别保留。当前对照逐池匹配已验证的生产选择器回放。

质量指标包括逐题证据覆盖、首条命中、来源完整性、逐条新增/丢失证据、输出块数与字符数、无答案题返回空结果和有答案题误清空。原标注不是完整相关性标注，因此不把所有未标注片段当成无关内容，也不把它称为完整 Precision 测试。

## 配对耗时

[timing-protocol.json](timing-protocol.json) 原样使用此前冻结的 12 个性能场景，三个模型、两轮共 72 次无缓存完整池推理。每轮六种模型执行顺序各出现两次，第二轮轮换顺序。模型先全部驻留，单独加载和健康预热不计入推理耗时，不并发执行 GPU 推理。

```bash
python tools/rag-evaluation/rerank_models_timing.py \
  --protocol benchmarks/knowbase-rerank-v2/selection-trials/timing-protocol.json \
  --model-root /path/to/models \
  --output reports/retrieval-rerank-selection-trials/<run>
python tools/rag-evaluation/rerank_models_timing_audit.py \
  benchmarks/knowbase-rerank-v2/selection-trials/timing-protocol.json \
  reports/retrieval-rerank-selection-trials/<run>/timing.json \
  reports/retrieval-rerank-selection-trials/<run>/timing-audit.json \
  reports/retrieval-rerank-adoption/2026-11-19-r1/scores.json \
  reports/retrieval-rerank-selection-trials/<run>/mminilm-scores.json \
  reports/retrieval-rerank-selection-trials/<run>/bge-base-scores.json
```

全量计分存在重复配对缓存，不能据此声称模型加速；速度对比仅使用以上新鲜配对推理。没有测试 HTTP、业务请求端到端耗时、并发容量、最终答案或新真实问题。
