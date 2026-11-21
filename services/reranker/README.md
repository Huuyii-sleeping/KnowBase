# KnowBase 本机 BGE 运行时

模型准备、启动、API 配置、容量限制及回退合约见 [BGE 重排设计](../../docs/rerank.md)。默认仍为规则模式；部署此目录不会自动切换业务配置。

此目录只负责模型输入、推理与有界 HTTP 传输，不访问数据库、索引或对象存储，也不决定最终片段名额。依赖版本和权重哈希固定在 [manifest.json](knowbase_reranker/manifest.json)。

无需下载权重的自动化测试：

```bash
python3 -m unittest discover -s services/reranker/tests -v
```

测试使用小型 fixture 和假的模型依赖，覆盖输入、模型加载合约与真实 HTTP 传输，不代表真实模型的质量或性能验收。
