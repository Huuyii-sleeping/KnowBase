# 重排层四项定向试验

固定召回候选、原标注和生成层，检查三条数字证据漏选、推理成本、模型输入和最终候选选择。参数与门槛见 [protocol.json](protocol.json)。原 BGE 结果已经暴露，本轮属于合成数据上的定向回归，不是新的盲测或最终答案验收。

实际执行范围和停止原因见[复核报告](audit.md)：输入组合在 56/96 题时因确定无法通过零新增损失条件提前停止，没有生成全量完成文件。最终决策沿用原门槛，不把部分结果冒充全量评测。

## 试验设计

| 方向     | 对照                                                         | 范围                                                |
| -------- | ------------------------------------------------------------ | --------------------------------------------------- |
| 漏选定位 | 原规则保留而当前 BGE 组合漏掉的原句，追踪模型名次与准入原因  | 384 份固定池                                        |
| 最终选择 | 原规则预留 2→3；每文档上限 2→3；字符预算 6000→12000；Top 5→8 | 分别改一个约束，384 份池回放，复用冻结模型分数      |
| 模型输入 | 去掉额外标题前缀；标题前缀补充片段内已有章节标题             | 96 道原开发题，两种输入重新完整推理                 |
| 推理成本 | 原 batch8；batch16；完整正文的 256 token 窗口/32 token 重叠  | 12 份冻结池，两个轮次，每题轮换执行顺序，均重新推理 |

“正文”保留原文已有的 Markdown 标题，只去掉模型输入里额外拼接的元数据标题。章节模式只重复片段内真实存在的二至六级标题，沿用 64 token 元数据上限；不读取额外文档或补造父章节。所有输入方案仍覆盖正文尾部，选中后返回完整原片段。

选择回放复用历史模型分数，不叫作重新推理。文档上限、字符预算和 TopK 改动只做诊断，不能直接用诊断分数授权修改业务约束。只在原开发组选候选，随后检查所有分组；不根据验证分数改选第二名。输入没有达到事先定义的开发组收益和零新增损失门槛时停止，不继续用其他分组调参。

性能的两个轮次都须中位耗时减少至少 20%、至少 10/12 题更快。batch16 还须入选集合和顺序完全相同，最大 logit 差不超过 0.5；256 窗口会改变相关性判断，达到速度门槛后也必须补齐全量质量检查才能考虑采用。串行本机 MPS 耗时不能当作生产 SLA。

## 复现

使用原模型评测的固定依赖、权重和已存候选池，不连接业务 API 或读取业务环境文件。下面的输出目录须事先创建，最终文件不覆盖已有结果；模型任务只保存完整题目断点。

```bash
node tools/rag-evaluation/rerank-refinement.cjs \
  benchmarks/knowbase-rerank-v2/refinement/protocol.json \
  reports/retrieval-rerank-refinement/<run>/selection-replay.json
python tools/rag-evaluation/rerank_refinement_run.py \
  --protocol benchmarks/knowbase-rerank-v2/refinement/protocol.json \
  --group input --model-root /path/to/models \
  --output reports/retrieval-rerank-refinement/<run>/input-scores.json
node tools/rag-evaluation/rerank-refinement.cjs \
  benchmarks/knowbase-rerank-v2/refinement/protocol.json \
  reports/retrieval-rerank-refinement/<run>/input-replay.json \
  reports/retrieval-rerank-refinement/<run>/input-scores.json
python tools/rag-evaluation/rerank_refinement_run.py \
  --protocol benchmarks/knowbase-rerank-v2/refinement/protocol.json \
  --group performance --model-root /path/to/models \
  --output reports/retrieval-rerank-refinement/<run>/performance-scores.json
```

真实推理两组必须串行执行，不能让其他模型工作干扰性能计时。计分使用原检索评测依赖环境：

```bash
python tools/rag-evaluation/rerank_refinement_audit.py \
  --protocol benchmarks/knowbase-rerank-v2/refinement/protocol.json \
  --kind selection \
  --data reports/retrieval-rerank-refinement/<run>/selection-replay.json \
  --output reports/retrieval-rerank-refinement/<run>/selection-audit.json
```

同一命令的 `--kind input` 对应 input-replay，`--kind performance` 对应 performance-scores；`--kind losses` 不需要 `--data`。摘要可以提交，完整原文候选、模型分数、运行日志和断点保留在忽略目录。

首版协议在 `b9d94ec` 冻结。首轮模型输入在 11 题后因工具格式检查未通过而停止，未做输入质量计分，原始断点保留在 `2026-11-19-r1`。随后只格式化 JS 适配器和测试，在 `a08c1a8` 冻结当前协议；输入方案、全部题目、模型和门槛完全不变，`2026-11-19-r2` 从头运行，不拼接首轮分数。
