# 检索评测

当前阶段先评测 `Search/RAG` 的检索结果，不评测大模型回答。数据集采用 [RAGBench-CN](https://github.com/Ace-teng/ragbench-cn) 的中文问题集格式，指标由成熟的 [`ir_measures`](https://github.com/terrierteam/ir_measures) 计算。仓库中的示例问题和文档来自 RAGBench-CN 的 MIT 许可示例。

## 目录

- `benchmarks/ragbench-cn/questions/questions_zh.json`：中文问题集、关键词和标准来源文档。
- `benchmarks/ragbench-cn/docs/`：可复现实验的 RAG 文档和相似噪声文档。
- `tools/rag-evaluation/evaluate_retrieval.py`：KnowBase 检索适配器和评测命令。
- `reports/retrieval/`：运行后生成的 JSON、Markdown、TREC qrels 和 run 文件，不提交到 Git。

当前 qrels 是文档级标注：问题对应 `gold_doc`，运行器从已发布文档的 `fileName` 映射到内部 `documentId`。当前混合检索接口返回的是文档/Chunk 混合结果，因此先按文档去重后评测。后续固定 chunk 级标注后，可以把 qrels 直接切换为 Chunk ID。

## 安装

```bash
python3 -m venv .venv-rag-eval
. .venv-rag-eval/bin/activate
pip install -r tools/rag-evaluation/requirements.txt
```

## 准备测评文档

将 `benchmarks/ragbench-cn/docs/rag_basics.md` 和 `retrieval_noise.md` 分别上传到 KnowBase，审核并发布。原始文件名必须保持不变，确保问题集中的 `gold_doc` 可以映射到已发布文档。

## 执行

启动 API 后运行混合检索评测：

```bash
python tools/rag-evaluation/evaluate_retrieval.py \
  --mode hybrid \
  --top-k 5
```

也可以单独测试语义检索：

```bash
python tools/rag-evaluation/evaluate_retrieval.py \
  --mode semantic \
  --top-k 5 \
  --output-dir reports/retrieval-semantic
```

输出指标：

- `Precision@K`
- `Recall@K`
- `MRR`
- `NDCG@K`
- `hit_rate`
- 平均检索延迟

输出文件：

- `retrieval-result.json`：机器可读结果。
- `retrieval-report.md`：可读报告。
- `qrels.txt`：标准相关性标注。
- `run.txt`：标准检索结果，可交给其他 TREC/IR 工具复用。

当前没有 Answer API，因此不会在这里计算 Faithfulness、Answer Relevancy 或 Citation Correctness；这些属于后续问答生成评测。
