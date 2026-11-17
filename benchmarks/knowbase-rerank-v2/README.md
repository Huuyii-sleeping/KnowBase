# 专用重排模型与 RRF 名额诊断

完整结论见[实测报告](experiments/audit.md)，模型、准入组合和最终顺序分别保留[结果](experiments/results.json)、[组合结果](experiments/anchor-results.json)和[顺序结果](experiments/order-results.json)。它们复用同一批已暴露候选池，不是三份独立数据。业务默认与问答实现保持原样。

本轮在评分前冻结 [protocol.json](experiments/protocol.json)，复用 v1 的 384 份已暴露合成候选池。比较原规则、RRF、mMiniLM 多语言 Cross-Encoder、BGE v2 M3；另以 RRF 每文档上限 5 诊断排序与名额的关系，不参加默认方案选型。最终 Top 5、6000 字符保持固定，模型组与基准均为每文档最多 2 块。

模型使用相同的 512 token 问题–正文配对窗口，问题最多 128 token、标题最多 64 token、窗口重叠 128 token，保留整个片段尾部。每个窗口重复标题，取最大原始相关性 logit 作为该片段的分数，最终仍返回完整原文，不把窗口当作新增候选。它是一种固定的长正文处理策略，不宣称是各模型的最优上下文长度。

初版 FP32 协议与代码先冻结为 `a95bfe2`。轻量模型完成后，BGE 在前 32 题推理耗时 357.42 秒，尚未进行 BGE 质量计分，因此保留断点并停止该次性能不合适的运行。随后另行冻结 [precision-protocol.json](experiments/precision-protocol.json) 为 `2ecea2d`，将两款模型均改为 FP16 后完整重跑；不迁移 FP32 分数、不混合不同精度的结果。下方命令使用这份独立精度协议；如需复现初版 FP32，须使用 `a95bfe2` 的实现及原协议。

权重与分词器从 ModelScope 下载，协议固定镜像提交及逐文件 SHA-256，加载前逐个验证；不执行远程代码，只使用 safetensors。Hugging Face 下载连接不可用，因此不把镜像提交冒充为此前查到的 Hugging Face 提交。模型用于本地离线实验，不接入业务服务。

## 复现

用独立 Python 3.12 环境安装 `tools/rag-evaluation/requirements-rerank-models.txt`。按协议的 `download_source/resolve/<revision>/<file>` 下载 `files_sha256` 中各文件到 `<model-root>/<id>/`，保留两个模型各自的目录，不下载训练脚本。原始候选池必须是协议列出的本地文件，不允许重新检索后跳过指纹检查。

```bash
python tools/rag-evaluation/rerank_model_run.py \
  --protocol benchmarks/knowbase-rerank-v2/experiments/precision-protocol.json \
  --model mminilm --model-root /path/to/models \
  --output reports/retrieval-rerank-v2/<run>
python tools/rag-evaluation/rerank_model_run.py \
  --protocol benchmarks/knowbase-rerank-v2/experiments/precision-protocol.json \
  --model bge-m3 --model-root /path/to/models \
  --output reports/retrieval-rerank-v2/<run>
node tools/rag-evaluation/rerank-model-replay.cjs \
  benchmarks/knowbase-rerank-v2/experiments/precision-protocol.json \
  reports/retrieval-rerank-v2/<run> \
  reports/retrieval-rerank-v2/<run>/rerank-replay.json
python tools/rag-evaluation/rerank_audit.py \
  --protocol benchmarks/knowbase-rerank-v2/experiments/precision-protocol.json \
  --replay reports/retrieval-rerank-v2/<run>/rerank-replay.json \
  --output reports/retrieval-rerank-v2/<run>/rerank-audit.json
```

最后一步使用原有检索评测依赖环境。模型执行与证据计分分别运行，模型不接收参考答案或标注。断点只保存完整题目，重启校验协议、运行环境与候选身份；失败不会生成完整结果或偷偷回退为规则分。重复的原问题/标题/正文配对可复用推理，但保留每份池的 Chunk ID、顺序和选择约束。计时报告必须区分真实推理与缓存，不能把后者当成线上耗时。

重新回放的选择耗时会变化，结果应比较协议指纹、入选 ID/顺序和证据指标；结果摘要中的原始产物哈希用于识别这一次运行，不要求另一次运行的计时字节相同。三个选择实验共享模型推理结果，不能把重复对照算成新增独立样本或累加为模型推理成本。

沿用 v1 的开发组选型和零新增标注损失门槛，其他分组只审查回归；若最优开发候选失败，不利用验证分数再挑另一模型。十条已复核旧损失单独解释，不改旧金标后声称模型提升。此轮不包含新的盲测或最终答案验收，是否适合接入还需结合相关性、延迟和失败行为判断。

## 固定规则锚点实验

轻量模型结果暴露后，另行在 `06e3722` 冻结 [anchor-protocol.json](experiments/anchor-protocol.json)，只测试一个组合：原规则实际选出的前 2 个片段保持原顺序，再按模型分数补齐，其间仍执行相同 Top 5、每文档 2 块及 6000 字符限制。不重复锚点、不调比例、不按题目加回退条件；原规则第 3–5 位可能落选，因此它不是“全部旧证据保底”。规则不足 2 条或约束限制时，实际名额也可能少于 2+3。

两款模型的完整 FP16 分数由父实验验证器检查协议、模型、候选顺序与身份后复用，不重复推理。原模型与 RRF 在此组只作诊断，只按开发组选择两个锚点方案之一，再执行原有回归门槛。这是已知轻量模型结果后提出的独立实验，不把它写回先前协议，也不称为新的盲测。

```bash
node tools/rag-evaluation/rerank-anchor-replay.cjs \
  benchmarks/knowbase-rerank-v2/experiments/anchor-protocol.json \
  reports/retrieval-rerank-v2/<run> \
  reports/retrieval-rerank-v2/<run>/anchor-replay.json
python tools/rag-evaluation/rerank_audit.py \
  --protocol benchmarks/knowbase-rerank-v2/experiments/anchor-protocol.json \
  --replay reports/retrieval-rerank-v2/<run>/anchor-replay.json \
  --output reports/retrieval-rerank-v2/<run>/anchor-audit.json
```

## 候选名额与最终顺序分开

固定规则锚点会把原规则前 2 条始终排在前面，因此新增证据进入 Top 5 后仍可能排在后面。另在 `721c84f` 冻结 [order-protocol.json](experiments/order-protocol.json)：完全复用锚点组已选的片段集合，再仅按模型分排序，同分保留原顺序。准入时的文档/数量/字符约束和首个超长候选例外只计算一次，不因最终展示顺序重新选择。输出同时保存准入决策与准入顺序，不把它们误当成最终排名。

这组只检验排序，证据覆盖与逐条证据损失必须和锚点组完全一致；额外报告证据 MRR、首条命中标注证据比例及其逐题增减。首条标注命中不是完整 Precision 或答案准确率。当前问答端还会按 `rerankScore` 再排并默认只取一条，实际接入必须另验输出分数/顺序合约及消费者行为；此轮仍只跑离线对照。

```bash
node tools/rag-evaluation/rerank-order-replay.cjs \
  benchmarks/knowbase-rerank-v2/experiments/order-protocol.json \
  reports/retrieval-rerank-v2/<run> \
  reports/retrieval-rerank-v2/<run>/order-replay.json
python tools/rag-evaluation/rerank_audit.py \
  --protocol benchmarks/knowbase-rerank-v2/experiments/order-protocol.json \
  --replay reports/retrieval-rerank-v2/<run>/order-replay.json \
  --output reports/retrieval-rerank-v2/<run>/order-audit.json
```
