# BGE 重排接入与切换

`RAG_RERANKER=rule|bge` 控制混合检索的排序器，默认 `rule`。BGE 是可选的模型接入，当前尚未通过默认切换验收；[接入测试结果](../benchmarks/knowbase-rerank-v2/integration/audit.md)记录原因。它不修改索引、召回、权限复查或问答生成，不需要重建向量。

后续四项定向试验见[复核报告](../benchmarks/knowbase-rerank-v2/refinement/audit.md)。按用户逐项决策，BGE 已采用每文档 3 块，以及 256 token / 重叠 32 token 的短窗口；相对 cap3 长窗口，384 份池仅新增 1 条证据漏选，平均覆盖下降 0.325 个百分点，配对推理 P50 下降约 19.5%。完整取舍和退步实例见[落地报告](../benchmarks/knowbase-rerank-v2/adoption/audit.md)。历史报告保留当时的每文档 2 块和长窗口结果，模型与生成层不变。

最新[窗口诊断与排名融合试验](../benchmarks/knowbase-rerank-v2/fusion/audit.md)确认三条目标证据均为完整单窗口输入。原规则与 BGE 的等权 RRF 融合补回这三条，但相对当前 BGE 新增 4 条、丢失 30 条证据；用户明确选择丢弃融合，保留现有 BGE 候选。后续单项优化按收益和副作用逐项决定，不沿用旧的整体切换门槛自动否决局部收益。

随后完成的[去重、弱相关过滤与替代模型对比](../benchmarks/knowbase-rerank-v2/selection-trials/audit.md)仍支持保留当前 BGE 和 3/5 约束。保守去重没有改变最终列表，较强去重丢失 7 条证据；最宽松的固定分数阈值也丢失 9 条。mMiniLM 推理约快 88%，但覆盖和首条命中下降，用户明确选择保留当前 BGE、优先质量，因此两款替代模型均不接入。本轮不增加业务策略开关。

## 职责与排序合约

`RerankService` 保持原同步规则，历史离线评测仍调用它。业务 `HybridSearchService` 在合并已复查的 Chunk 后，等待 `HybridRerankService`：规则模式直接返回原结果；BGE 模式由 `BgeHttpService` 请求本机 Python 模型运行时，然后使用独立的 `selectBge` 选择器。

固定组合先取原规则实际已选结果的前 2 块作为准入锚点，再按 BGE 原始相关性分补齐。BGE 默认同文档最多 3 块，显式 `maxChunksPerDocument` 优先；原规则及异常回退仍默认同文档 2 块。TopK、默认 6000 UTF-16 字符及首个超长候选例外保持不变，锚点不足时按实际数量执行；不保证原规则后续所有证据保留。最后只对准入集合按 BGE 分排序，同分保留准入顺序。

每文档上限不是预留名额：Top 5 仍最多五块，不会为了凑三块强制选择同一文档。用户接受该改动带来的首条命中下降，是基于后续计划消费多块证据；当前问答仍只取一块，本次不修改该消费者，不把 Top 5 覆盖收益宣称为最终答案改善。

`rerankModelScore` 保存原始模型 logit。对已选 n 块，第 i 块（从 0 开始）的 `rerankScore=(n-i)/(n+1)`，保持最终顺序且落在 0–1 内；它是排序序号分，不能解释为相关概率、模型置信度或与原规则分数等价的阈值。避免把有正负且量级不同的 logit 直接与现有图谱结果分数混用。问答的词语支持筛选、图谱结果合并和默认只取一块的策略保持原样；当前单块消费仍会漏掉多条件证据，不能用 Top 5 提升代替上下文或答案验收。

API 按候选 ID 验证整份模型响应：模型名、请求 ID、数量、唯一候选身份和有限数值必须全对，允许响应数组顺序不同。服务端不能替换正文，API 始终从本次已复查候选返回原文与元数据，不接收模型生成的正文或新增候选。

## 本机运行

模型运行时需要独立 Python 3.12 环境，和 Nest API 分开是因为它依赖 PyTorch/Transformers；不是为拆分业务职责另建微服务。它只监听本机 `127.0.0.1`，不提供公共推理接口。当前没有增加 Docker Compose 服务或自动下载权重。

```bash
python3.12 -m venv /path/to/bge-venv
/path/to/bge-venv/bin/pip install -r services/reranker/requirements.txt
PYTHONPATH=services/reranker /path/to/bge-venv/bin/python -m knowbase_reranker \
  --model-root /path/to/models --port 18081
```

按 `services/reranker/knowbase_reranker/manifest.json` 的镜像固定 revision 下载 `files_sha256` 中列出的文件到 `/path/to/models/bge-m3/`。下载与校验方式沿用[模型评测复现说明](../benchmarks/knowbase-rerank-v2/README.md)。启动时检查依赖版本和每个文件哈希，禁止远程代码，只加载 safetensors；健康预热成功后才监听端口，`GET /health` 返回模型已就绪。

当前输入窗口为 256 token（包含问题、标题和特殊符号），问题最多 128 token、标题最多 64 token，正文窗口重叠 32 token，batch8。完整覆盖正文尾部，各窗口取最高原始 logit。该配置已完成全池质量验证及两轮配对速度比较。运行时代码独立于评测目录；历史实验实现保留原样以维护已提交指纹。窗口算法一致性及实际配置下的正文覆盖测试防止漂移；后续改变窗口、模型或精度仍须重新评测，不修改历史副本来“对齐”。

要在隔离环境试用，在 API 的环境配置设置后重启该 API：

```dotenv
RAG_RERANKER=bge
BGE_RERANK_URL=http://127.0.0.1:18081
BGE_RERANK_TIMEOUT_MS=20000
BGE_RERANK_COOLDOWN_MS=30000
```

恢复 `RAG_RERANKER=rule` 并重启即可回退，无需删索引或重新入库。默认配置的改变必须以验收为依据；此轮没有修改用户本地 `.env`，也没有重启业务 API。

## 故障与容量边界

HTTP 请求的 20 秒默认期限包含读响应体，禁止重定向。请求最多 2 MiB、响应最多 64 KiB；最多 120 个唯一 Chunk，输入超限、分数不完整、HTTP 异常或超时均返回本次完整原规则结果，不混入部分模型分数。失败后默认 30 秒冷却，再允许下一次请求尝试恢复；日志只记录固定的回退说明，不记录问题、正文、Token 或服务错误响应。

每个 API 实例最多一个模型请求在途，其他请求直接走规则。Python 运行时也只允许一次推理，忙时立即 503，限制最多 16 个 HTTP 连接，不排队堆积 GPU 工作；请求还限制问题/标题/正文长度及最多 512 个窗口。跨 API 实例共享模型时以运行时锁为最终边界。回退会导致并发时部分请求采用规则，不能宣称所有请求都使用 BGE。

API 的超时会中止 HTTP 等待，但不能中断已经开始的 PyTorch 推理；运行时完成前仍占用推理锁，后续请求返回忙。短窗口只在已测场景降低推理耗时，没有实现 GPU 算子取消或横向容量扩展，不把小规模串行测试当成生产吞吐承诺。

## 验证

小型测试覆盖模型权重/输出校验、窗口、请求边界、HTTP 繁忙/失败、并发旁路、冷却恢复、稳定顺序与正文保持。协议冻结后，384 份池通过真实业务适配器和 HTTP 分数夹具回放；夹具复用既有模型分数，不能叫作重新推理。另有 12 份池调用真实本机模型 HTTP，记录是否回退、实际耗时、原始分差及入选顺序。

复现命令与结果见[接入测试报告](../benchmarks/knowbase-rerank-v2/integration/audit.md)。数据均为已暴露合成资料，召回路由使用固定池夹具，未重新验证在线权限/版本并发、真实入库或生成答案。

## 后续 TODO

- [x] 在当前输入及 3/5 约束下完成 mMiniLM、BGE base 对比及两轮配对计时；结果见上述三项试验报告，未替换当前模型。
- [x] 用户已选择质量优先、保留当前 BGE，不接入本轮替代模型、去重或固定阈值策略。
- [ ] 后续单独调整问答多片段消费并验证答案与引用；本次只修改重排层。
