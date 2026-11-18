# BGE 重排接入与切换

`RAG_RERANKER=rule|bge` 控制混合检索的排序器，默认 `rule`。BGE 是可选的模型接入，当前尚未通过默认切换验收；后续[证据消费修复与真实生成检查](../benchmarks/knowbase-rerank-v2/integration/context-audit.md)已定位新的生成层阻塞，当前分支保持 draft。后续[3B/7B 生成对照](../benchmarks/knowbase-rerank-v2/integration/answer-model-audit.md)也未通过语义引用验收，未更换默认生成模型。[接入测试结果](../benchmarks/knowbase-rerank-v2/integration/audit.md)记录原因。BGE 适配器不修改索引、召回或权限复查，不需要重建向量；同一分支同时修复了问答证据与引用消费，见[问答合约](answer.md)。

## 职责与排序合约

`RerankService` 保持原同步规则，历史离线评测仍调用它。业务 `HybridSearchService` 在合并已复查的 Chunk 后，等待 `HybridRerankService`：规则模式直接返回原结果；BGE 模式由 `BgeHttpService` 请求本机 Python 模型运行时，然后使用独立的 `selectBge` 选择器。

固定组合先取原规则实际已选结果的前 2 块作为准入锚点，再按 BGE 原始相关性分补齐。TopK、同文档最多 2 块、默认 6000 UTF-16 字符及首个超长候选例外与原规则一致，锚点不足时按实际数量执行；不保证原规则后续所有证据保留。最后只对准入集合按 BGE 分排序，同分保留准入顺序。

`rerankModelScore` 保存原始模型 logit。对已选 n 块，第 i 块（从 0 开始）的 `rerankScore=(n-i)/(n+1)`，保持最终顺序且落在 0–1 内；它是排序序号分，不能解释为相关概率、模型置信度或与原规则分数等价的阈值。避免把有正负且量级不同的 logit 直接与现有图谱结果分数混用。问答保留原词语支持筛选与图谱合并；本分支的问答默认已改为最多五块、总正文 6000 UTF-16 字符（保留首条超长例外），同文档相同正文去重，完整保留段落与引用身份。该改动未新增选择开关，原来的单块漏证据得到修复；但实际生成仍有漏答/引用错位，因此尚不能据此合并或切换默认 BGE。

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

输入窗口与冻结 FP16 实验保持一致，完整覆盖正文尾部。运行时代码独立于评测目录；历史实验实现保留原样以维护已提交指纹。新增输入一致性测试及真实模型 HTTP 抽查防止两者漂移；改变运行时窗口、模型或精度后必须重新评测，不用修改历史副本来“对齐”。

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

API 的超时会中止 HTTP 等待，但不能中断已经开始的 PyTorch 推理；运行时完成前仍占用推理锁，后续请求返回忙。此轮没有实现 GPU 算子取消、横向容量扩展或推理加速，不把小规模串行测试当成生产吞吐承诺。

## 验证

小型测试覆盖模型权重/输出校验、窗口、请求边界、HTTP 繁忙/失败、并发旁路、冷却恢复、稳定顺序与正文保持。协议冻结后，384 份池通过真实业务适配器和 HTTP 分数夹具回放；夹具复用既有模型分数，不能叫作重新推理。另有 12 份池调用真实本机模型 HTTP，记录是否回退、实际耗时、原始分差及入选顺序。

复现命令与结果见[接入测试报告](../benchmarks/knowbase-rerank-v2/integration/audit.md)。数据均为已暴露合成资料，召回路由使用固定池夹具，未重新验证在线权限/版本并发、真实入库或生成答案。
