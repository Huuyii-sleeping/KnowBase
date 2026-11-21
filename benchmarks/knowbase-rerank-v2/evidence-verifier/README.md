# 剩余重排问题复现

结论与限制见 [audit.md](audit.md)，逐组指标、原始产物及协议哈希见 [results.json](results.json)。所有试验均为隔离诊断，业务方案保持当前 BGE256/cap3/Top5，未训练模型。

## 文档分层与条件级联

```bash
node tools/rag-evaluation/rerank-followup-replay.cjs \
  benchmarks/knowbase-rerank-v2/evidence-verifier/document-protocol.json \
  /path/to/document-replay.json
node tools/rag-evaluation/rerank-followup-replay.cjs \
  benchmarks/knowbase-rerank-v2/evidence-verifier/cascade-protocol.json \
  /path/to/cascade-replay.json
python tools/rag-evaluation/rerank_trials_audit.py \
  /path/to/document-replay.json /path/to/document-audit.json
python tools/rag-evaluation/rerank_trials_audit.py \
  /path/to/cascade-replay.json /path/to/cascade-audit.json
```

复用冻结长/短模型分数，输出文件必须不存在。条件级联的新鲜配对耗时另用固定模型依赖环境执行：

```bash
python tools/rag-evaluation/rerank_cascade_timing.py \
  benchmarks/knowbase-rerank-v2/evidence-verifier/cascade-timing-protocol.json \
  /path/to/models /path/to/cascade-timing.json
```

## 独立本地 LLM 复核

本机 Ollama 必须已有协议固定 digest 的 `qwen2.5:7b`，实验不自动下载、更换模型或调整服务配置。保留完整题断点，模型只输出候选 ID，失败不生成完整结果：

```bash
python tools/rag-evaluation/rerank_verifier_run.py \
  --protocol benchmarks/knowbase-rerank-v2/evidence-verifier/protocol.json \
  --output reports/retrieval-rerank-verifier/<run>
python tools/rag-evaluation/rerank_verifier_audit.py \
  benchmarks/knowbase-rerank-v2/evidence-verifier/protocol.json \
  reports/retrieval-rerank-verifier/<run>/verdicts.json \
  reports/retrieval-rerank-verifier/<run>/audit.json
```

执行器只发送问题、候选标题和原文，不发送参考答案或证据标注。输入上限远低于固定 32768 token 上下文，输出通过 JSON schema 限制且验证候选身份，计分再应用原 cap3/Top5/UTF-16 字符预算。合成题已暴露，不称盲测；计分用原检索评测依赖环境。

## 隔离真实 HTTP 验证

在独立终端使用固定模型运行时环境启动：

```bash
PYTHONPATH=services/reranker python -m knowbase_reranker \
  --model-root /path/to/models --port 18089
npm run build --workspace apps/api
node tools/rag-evaluation/bge-runtime-check.cjs \
  benchmarks/knowbase-rerank-v2/evidence-verifier/runtime-protocol.json \
  http://127.0.0.1:18089 /path/to/runtime-result.json
```

该脚本会刻意制造忙和短超时，仅对自己启动的隔离运行时使用；不会修改业务 `.env`、默认配置或调用生成层。结束后关闭自己的隔离模型进程。验证说明不能代替实际机器、真实问题与目标负载下的生产验收。
