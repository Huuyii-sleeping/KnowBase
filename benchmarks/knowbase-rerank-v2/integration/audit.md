# BGE 业务接入验收

本轮没有把 BGE 直接切成默认。模型 HTTP 服务、候选选择和异常回退都已实现并通过测试，但质量门槛和问答上下文消费仍有明确问题，因此 `.env.example` 保持 `RAG_RERANKER=rule`。

## 测试结果

| 检查                                                            | 结果                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 384 份固定池经过真实 BGE HTTP 客户端、混合搜索和 BGE 选择器回放 | 通过，入选集合与最终顺序 100% 与已冻结的 BGE 组合相同，未发生意外规则回退           |
| 12 个重点场景使用本机真实 BGE 模型 HTTP 推理                    | 通过，未回退；耗时最小 2.43s、中位 9.25s、最大 11.42s；这是串行抽查，不是 SLA       |
| 原始模型分数传输                                                | 通过，选中 Chunk 与冻结分数的最大绝对差 0；原始 logit 单独保存在 `rerankModelScore` |
| 超时、HTTP 异常、模型忙、响应身份/数量/数值错误                 | 通过，返回完整规则结果，进入冷却；不混入部分模型分数                                |
| 输入窗口、权重校验、远程代码关闭、中文/UTF-8 HTTP 边界          | 通过                                                                                |
| 业务 API 全量测试                                               | 66 个测试文件 / 252 项通过                                                          |
| Web 全量测试                                                    | 4 个测试文件 / 11 项通过                                                            |
| Node 离线工具                                                   | 50 项通过                                                                           |
| Python 检索评测 / HTTP 适配器 / BGE 运行时                      | 45 / 11 / 11 项通过                                                                 |

384 池回放中的 HTTP 响应复用了已经冻结并校验过的 BGE 分数，验证的是业务传输、身份、候选正文、名额和排序一致性；它不是重新推理。12 个重点场景才调用本机模型实际推理，覆盖发布 Outbox、版本覆盖、OCR、撤回窗口、角色权限、历史额度和留出主题。

## 为什么暂不切换

质量对照中，规则前 2 条 + BGE 补选并排序的开发组证据覆盖为 **93.75%**，原规则为 **56.25%**；两套新来源池达到 **100%**。但原先冻结的“至少提升 2 个百分点、所有分组零新增标注证据损失、来源完整率不下降”门槛仍未通过：组合留下 3 条额外额度数字标注损失。相关模型与组合结果见[重排报告](../experiments/audit.md)。

更关键的是，当前 `AnswerGroundingService` 默认只从重排结果保留 1 个片段。用 BGE 顺序进行相同消费后，发生 **17 条来源–问题–证据实例损失，涉及 14 个问题 ID**；这些事实都仍在 BGE Top 5 内，说明主要冲突在“最终上下文只取一块”，不能把 Top 5 的提升当成问答答案提升。典型情况是：

- 多条件问题只进入归档恢复片段，超时处理片段留在 Top 5 但没有进入上下文；
- 版本比较只进入当前 100 MiB，历史 20 MiB 仍在 Top 5 的后续片段；
- 角色问题只进入“恢复时核对权限”，没有进入“外组逐人授权”的完整条款；
- 双主题留出题只进入其中一个职责段落。

这些损失不能靠模型 HTTP 重试解决。仍需单独评测上下文消费策略（例如多条件问题的证据预算、支持性筛选和引用约束），并重新跑最终答案评测。`grounding-loss-review.json` 保存全部 17 条实例、原文哈希和 Top 5 保留检查；不修改原金标、不把同作者复核当成答案验收。

## 接入和回退

`RAG_RERANKER=bge` 时，API 先运行原规则并保留前 2 个准入锚点，再请求本机 BGE；模型按已选集合重新排序。BGE 正负 logit 不与图谱分数直接混用：`rerankModelScore` 是原始 logit，`rerankScore` 是保持顺序的有界序号分，不能当置信度。默认 `RAG_RERANKER=rule`，回退只需要恢复配置并重启 API，不需要重建索引。

服务只监听本机，最多一个模型请求在途；请求超时、服务繁忙、响应不完整或模型失败均使用完整规则结果并开启 30 秒冷却。模型运行时限制输入/输出大小、候选数量和窗口数，启动校验依赖版本、权重 SHA-256、safetensors 和 `trust_remote_code=False`。不记录问题、正文或远端错误响应。

代码和结果：

- [接入协议](protocol.json)
- [汇总结果](results.json)
- [切换决策](decision.json)
- [上下文损失复核](grounding-loss-review.json)
- [BGE 模型重排报告](../experiments/audit.md)
- [BGE 接入设计](../../../docs/rerank.md)

当前决策是“**保留 BGE 可选开关，业务默认继续使用规则**”。本 PR 继续只处理重排层：下游问答消费保持原样，17条消费损失仅记录为后续问题，不在此处修改提示词、上下文策略、引用或生成模型。重排层下一步应处理三条新增标注证据损失与模型推理成本，再决定能否切换默认。

## 复现与范围

协议及适配器先提交为 `b479530`。首次回放发现 HTTP 分数夹具逐 TCP 块转文字会切断中文 UTF-8；在 `f07f92c` 修复为先合并字节再解码，并增加单字节切片测试后再跑完整回放。未改模型、窗口、名额、超时或门槛。完整协议记录这次修复，不把失败运行当成功结果。

启动本机模型运行时并构建 API 后执行：

```bash
node tools/rag-evaluation/bge-integration.cjs \
  benchmarks/knowbase-rerank-v2/integration/protocol.json replay \
  /path/to/new-replay.json
node tools/rag-evaluation/bge-integration.cjs \
  benchmarks/knowbase-rerank-v2/integration/protocol.json live \
  /path/to/new-live.json
python tools/rag-evaluation/bge_integration_audit.py \
  --protocol benchmarks/knowbase-rerank-v2/integration/protocol.json \
  --replay /path/to/new-replay.json --output /path/to/new-grounding.json
```

源码、输入与运行结果均有 SHA-256；原始完整产物保留在忽略目录 `reports/retrieval-bge-integration/2026-11-17-r1/`。协议要求原历史池和原模型分数可用，不会遇到缺文件就偷偷重跑不同召回。上下文计分是在已知模型结果后新增的结果诊断，沿用原标注；不是预先隔离的新盲测。未经复核不得更换旧标注来通过门槛。

全工程共 **380 项测试通过**（API252、Web11、Node50、Python检索45、原适配器11、运行时11）。API/Web构建及格式、测试Compose配置、diff检查通过；Web保留原有bundle体积提示。没有修改用户业务环境文件或重启业务API，未进行真实ACL/版本并发故障注入、在线重建或生成答案评测。本轮没有用到其他用户的私有数据。

Nest 模块装配另通过构建产物创建真实应用上下文验证（不读取 API `.env`），确保新增 provider 可解析；Vitest 的 TypeScript 转换不生成构造参数反射元数据，因此没有把源码直接创建 Nest 测试容器作为装配结论。

## 范围收回与推理耗时试验

本次 PR 曾越出重排层，修改问答消费及引用，并测试生成模型。用户明确当前只优化重排后，这些改动已全部从本 PR 的最终差异移出，保存到本地 `codex/answer-evaluation-follow-up` 分支。`apps/api/src/modules/answer` 与主分支保持一致，生成模型仍为原默认，未合并到主分支。

重排层保留 eager/SDPA 的同输入对照：12份池的中位耗时从8579ms到7551ms，减少11.99%，未达到事先冻结的20%门槛，因此没有改动业务推理内核。输入窗口、权重、FP16与batch8保持一致，实际attention类分别校验；第一版不支持动态切换而停止的试验不计为有效结果。协议见[attention-protocol-v2.json](attention-protocol-v2.json)，摘要见[attention-results.json](attention-results.json)。没有把这些耗时当作生产SLA或全池质量验收。

收回范围后重新通过API252项、Node50项、Python45+11+11项及API构建，384份池重放仍与冻结的BGE入选集合和顺序完全一致。确认问答目录相对主分支无差异，未重跑或更换生成模型。

后续四项优化的独立协议、实际停止范围和结果见[定向复核](../refinement/audit.md)；未用该试验改写本轮原始分数或验收结论。
