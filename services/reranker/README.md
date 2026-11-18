# KnowBase 本机 BGE 运行时

运行、模型文件准备、环境配置、容量限制和回退合约见 [BGE 接入设计](../../docs/rerank.md)。本轮没有切换业务默认，原因见[后续修复与真实生成验收](../../benchmarks/knowbase-rerank-v2/integration/context-audit.md)。此目录只负责模型输入、推理和有界 HTTP 传输，不访问数据库、索引或对象存储，也不决定最终片段名额。

无需下载权重的小型测试：

```bash
python3 -m unittest discover -s services/reranker/tests -v
```

测试使用纯 Python fixture 和假的模型依赖；真实推理复现另见[接入报告](../../benchmarks/knowbase-rerank-v2/integration/audit.md)。
