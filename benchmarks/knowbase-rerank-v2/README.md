# 专用重排模型与 RRF 名额诊断

本轮在评分前冻结 [protocol.json](experiments/protocol.json)，复用 v1 的 384 份已暴露合成候选池。比较原规则、RRF、mMiniLM 多语言 Cross-Encoder、BGE v2 M3；另以 RRF 每文档上限 5 诊断排序与名额的关系，不参加默认方案选型。最终 Top 5、6000 字符保持固定，模型组与基准均为每文档最多 2 块。

模型使用相同的 512 token 问题–正文配对窗口，问题最多 128 token、标题最多 64 token、窗口重叠 128 token，保留整个片段尾部。每个窗口重复标题，取最大原始相关性 logit 作为该片段的分数，最终仍返回完整原文，不把窗口当作新增候选。它是一种固定的长正文处理策略，不宣称是各模型的最优上下文长度。

权重与分词器从 ModelScope 下载，协议固定镜像提交及逐文件 SHA-256，加载前逐个验证；不执行远程代码，只使用 safetensors。Hugging Face 下载连接不可用，因此不把镜像提交冒充为此前查到的 Hugging Face 提交。模型用于本地离线实验，不接入业务服务。

## 复现

用独立 Python 3.12 环境安装 `tools/rag-evaluation/requirements-rerank-models.txt`。按协议的 `download_source/resolve/<revision>/<file>` 下载 `files_sha256` 中各文件到 `<model-root>/<id>/`，保留两个模型各自的目录，不下载训练脚本。原始候选池必须是协议列出的本地文件，不允许重新检索后跳过指纹检查。

```bash
python tools/rag-evaluation/rerank_model_run.py \
  --protocol benchmarks/knowbase-rerank-v2/experiments/protocol.json \
  --model mminilm --model-root /path/to/models \
  --output reports/retrieval-rerank-v2/<run>
python tools/rag-evaluation/rerank_model_run.py \
  --protocol benchmarks/knowbase-rerank-v2/experiments/protocol.json \
  --model bge-m3 --model-root /path/to/models \
  --output reports/retrieval-rerank-v2/<run>
node tools/rag-evaluation/rerank-model-replay.cjs \
  benchmarks/knowbase-rerank-v2/experiments/protocol.json \
  reports/retrieval-rerank-v2/<run> \
  reports/retrieval-rerank-v2/<run>/rerank-replay.json
python tools/rag-evaluation/rerank_audit.py \
  --protocol benchmarks/knowbase-rerank-v2/experiments/protocol.json \
  --replay reports/retrieval-rerank-v2/<run>/rerank-replay.json \
  --output reports/retrieval-rerank-v2/<run>/rerank-audit.json
```

最后一步使用原有检索评测依赖环境。模型执行与证据计分分别运行，模型不接收参考答案或标注。断点只保存完整题目，重启校验协议、运行环境与候选身份；失败不会生成完整结果或偷偷回退为规则分。重复的原问题/标题/正文配对可复用推理，但保留每份池的 Chunk ID、顺序和选择约束。计时报告必须区分真实推理与缓存，不能把后者当成线上耗时。

沿用 v1 的开发组选型和零新增标注损失门槛，其他分组只审查回归；若最优开发候选失败，不利用验证分数再挑另一模型。十条已复核旧损失单独解释，不改旧金标后声称模型提升。此轮不包含新的盲测或最终答案验收，是否适合接入还需结合相关性、延迟和失败行为判断。
