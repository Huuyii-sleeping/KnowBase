# BGE 重排

混合检索支持规则排序与本机 BGE v2 M3。`RAG_RERANKER=rule|bge` 指定模式，默认 `rule`；合并代码不会自动启动模型或切换运行中的 API。BGE 接入只改变候选选择与排序，不修改索引、召回、权限复查或问答生成，不需要重建向量。

## 职责与选择合约

`HybridSearchService` 合并已经复查的 Chunk 后，等待 `HybridRerankService`。规则模式直接返回原 `RerankService` 结果；BGE 模式由 `BgeHttpService` 请求 Python 模型运行时，再由纯函数 `selectBge` 选择片段。运行时只负责输入窗口、推理与 HTTP 传输，不访问业务存储或决定最终名额。

选择先预留原规则实际选中结果的前 2 块，再按模型分补齐。最终数量使用调用方的 TopK（通常为 5），同文档默认最多 3 块，默认正文预算为 6000 个 UTF-16 字符；显式调用参数优先。保留首个超长候选例外，后续放不下的候选跳过。名额是上限，不强制凑满；规则锚点不足时按实际数量执行，也不保证原规则第 3–5 条全部保留。规则模式及失败回退仍保持原来的每文档默认 2 块。

准入后只按 BGE 原始 logit 排序，同分保留准入顺序。`rerankModelScore` 保存 logit；对已选 n 块，第 i 块（从 0 开始）的 `rerankScore=(n-i)/(n+1)`，使现有消费者能够保持模型顺序。该值只是排序序号分，不能当作相关概率、置信度或原规则的过滤阈值。

模型响应必须通过请求 ID、模型名、候选数量、唯一身份及有限数值的整体验证，允许数组顺序不同。最终正文和元数据始终来自本次已复查候选，运行时不能添加候选或替换原文。

## 模型与输入

模型、镜像 revision、逐文件 SHA-256 和依赖版本固定在 [manifest.json](../services/reranker/knowbase_reranker/manifest.json)。启动时逐项校验，只从本机加载 safetensors，禁止远程代码。当前使用 FP16、eager attention，优先 Apple MPS，否则使用 CPU。

每个窗口最多 256 token，包含问题、标题及特殊符号；问题最多 128 token，标题最多 64 token，正文窗口重叠 32 token，batch size 为 8。每个窗口重复问题与标题，完整覆盖正文尾部，取所有窗口中最大的原始 logit 作为原片段分数；最终返回完整原文。超过整个请求的 512 个窗口预算时整次失败，不截断正文后静默评分。

## 本机运行

运行时使用独立 Python 3.12 环境，与 Nest API 分开是为了隔离 PyTorch/Transformers 依赖。仅监听 `127.0.0.1`，没有公共推理接口、自动下载或 Compose 服务。

```bash
python3.12 -m venv /path/to/bge-venv
/path/to/bge-venv/bin/pip install -r services/reranker/requirements.txt
PYTHONPATH=services/reranker /path/to/bge-venv/bin/python -m knowbase_reranker \
  --model-root /path/to/models --port 18081
```

启动前，按 manifest 的 `download_source/resolve/<revision>/<file>` 下载 `files_sha256` 中每个文件到 `/path/to/models/bge-m3/`。目录内文件的 SHA-256 必须与 manifest 一致；模型权重不进入 Git。版本检查、文件校验及模型预热全部成功后才监听端口；`GET /health` 返回已就绪。

API 使用以下配置接入，修改后需重启相应 API：

```dotenv
RAG_RERANKER=bge
BGE_RERANK_URL=http://127.0.0.1:18081
BGE_RERANK_TIMEOUT_MS=20000
BGE_RERANK_COOLDOWN_MS=30000
```

恢复 `RAG_RERANKER=rule` 并重启即可回退，无需重新入库。项目的默认配置仍为规则模式。

## 故障与容量边界

HTTP 默认期限 20 秒，包含读取响应体，禁止重定向。请求最多 2 MiB、响应最多 64 KiB，最多 120 个唯一 Chunk；问题、标题、正文另有长度边界。超限、无效分数、异常、繁忙或超时均返回本次完整规则结果，不混用部分模型分数。失败后默认冷却 30 秒，再允许下一次请求尝试恢复。日志只记录固定回退说明，不记录问题、正文或模型错误响应。

每个 API 实例最多一个模型请求在途，其余请求直接走规则。Python 运行时也只允许一次推理，忙时立即 503，最多 16 个 HTTP 连接；跨 API 实例共享模型时以运行时锁为最终边界。因此并发请求可能使用规则回退，不能保证所有请求都走 BGE。

API 超时只能中止 HTTP 等待，无法中断已开始的 PyTorch 推理；完成前仍占用模型锁。尚未实现推理取消或横向容量扩展，串行样本的耗时不代表生产吞吐保证。

## 验证与已知限制

维护的回归测试覆盖候选选择、文档及字符预算、正文保持、身份校验、请求边界、窗口完整覆盖、权重校验、HTTP 超时/繁忙、并发旁路及冷却恢复。执行方式：

```bash
npm test --workspace apps/api
npm run build --workspace apps/api
node --test tools/rag-evaluation/bge-module.test.cjs
python3 -m unittest discover -s services/reranker/tests -v
```

离线优化使用 384 份已暴露合成候选池，对应 304 个不同问题；不是生产问题盲测。同文档上限由 2 改为 3，新增 6 条证据、没有新增丢失；在该上限下将长窗口改为当前短窗口，平均证据覆盖从 97.73% 降到 97.40%，新增一条 receipt 证据漏选，配对模型推理 P50 下降约 19.5%。这是接受小幅质量代价换取速度的参数取舍，不能等同于端到端答案收益。原始实验已从本次交付移除，历史提交保留过程记录。

当前仍有三条额度类证据漏选，加上短窗口的 receipt 漏选。已比较的 RRF 融合、去重、固定分数阈值、替代轻量模型及额外模型复核没有提供可接受的综合收益，均未接入。条件长窗口能补回 receipt，但耗时超过当前 20 秒期限，也未采用。没有可靠的无答案拒答策略。

隔离环境的真实 HTTP 推理、超时、并发回退及恢复已验证；生产负载与真实用户问题仍需验收。问答端的后续多片段消费、预算与来源编号校验见[上下文设计](answer-context.md)；答案质量与引用的语义支持仍需单独验证，不能用 Top 5 证据覆盖代替该验收。
