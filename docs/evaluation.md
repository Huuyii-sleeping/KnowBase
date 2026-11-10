# 检索评测

检索评测的主集是项目原创的 `knowbase-retrieval-v1`：14 篇 Markdown 文档、40 道中文问题，覆盖多主题来源、同义改写、流程、参数表、版本、多文档和跨 Chunk 证据。每道可回答问题标注标准来源、参考答案和原文证据；4 道无答案问题单独统计。指标由 [`ir_measures`](https://github.com/terrierteam/ir_measures) 计算。语料和计分口径固定，运行记录保存被测检索实现的提交与策略。

原有 [RAGBench-CN](https://github.com/Ace-teng/ragbench-cn) MIT 示例仍保留，但其中 20 道检索题均指向同一标准文档，主要用于演示适配器，不作为本轮质量结论的依据。问答评测是独立入口，见本文后半部分。

已冻结的实测结果、失败样本和后续实验顺序见 [2026-11-10 基线报告](../benchmarks/knowbase-retrieval-v1/baseline.md)，完整汇总数据见 [baseline.json](../benchmarks/knowbase-retrieval-v1/baseline.json)。

当前混合检索的候选与正文证据设计见 [检索设计](retrieval.md)。原始基线保持冻结，优化实验另存结果，不修改题目或标注来适配新实现。

正文 Chunk 与候选池的分步实测见 [混合检索优化实验](../benchmarks/knowbase-retrieval-v1/experiments/hybrid-evidence-v1.md)。

## 目录

- `benchmarks/knowbase-retrieval-v1/manifest.json`：冻结的语料清单。
- `benchmarks/knowbase-retrieval-v1/questions.json`：题型、参考答案、标准来源和证据原句。
- `benchmarks/knowbase-retrieval-v1/docs/`：原创项目文档与模拟业务规则、历史规则、相似噪声。
- `benchmarks/ragbench-cn/`：保留的外部许可演示集。
- `tools/rag-evaluation/evaluate_retrieval.py`：KnowBase 检索适配器和评测命令。
- `tools/rag-evaluation/run_baseline.cjs`：隔离环境、真实上传/审核/索引和评测矩阵入口。
- `reports/retrieval-knowbase-v1/<运行时间与进程号>/`：每轮独立的完整输出，不提交到 Git。

qrels 是文档级相关性标注，支持 `gold_doc` 或 `gold_docs`。运行器分页读取所有已发布文档，将 `fileName` 映射到内部 `documentId`；同名来源存在歧义时直接报错。旧 RAGBench-CN 字段保持兼容。

## 安装

```bash
python3 -m venv .venv-rag-eval
. .venv-rag-eval/bin/activate
pip install -r tools/rag-evaluation/requirements.txt
```

## 一键运行项目基线

需要 Docker、Node/pnpm、已安装评测依赖的 Python，以及可访问的 Ollama `nomic-embed-text` 模型：

```bash
ollama pull nomic-embed-text
pnpm --filter @knowbase/api benchmark:retrieval \
  --python "$PWD/.venv-rag-eval/bin/python"
```

缓存镜像已经齐全、镜像仓库暂不可访问时，在命令前加 `DELIVERY_TEST_PULL_POLICY=never`。可用 `KNOWBASE_BENCHMARK_OLLAMA_URL` 指定本地模型服务地址，用 `--output-dir` 指定输出根目录。

命令构建 API，在独立 `knowbase-retrieval-<进程号>` Compose 项目中启动 PostgreSQL、MongoDB、RustFS、RabbitMQ、Elasticsearch 和 Neo4j，执行数据库初始化，再通过真实 HTTP 接口上传全部语料、提交审核和批准发布。等待每篇文档的全文与向量批次激活后，分别运行 keyword、semantic、hybrid 在 K=1/3/5 的 9 组评测，共 360 次计分请求；每种模式另有一次不计分的预热。

评测使用真实解析、存储、登录鉴权、消息投递和 Ollama Embedding。只启动 Search/RAG 消费者，KG 消息留在隔离队列中，不执行图谱抽取，也不调用对话模型，避免争抢模型计算资源。语料均为 PUBLIC Markdown、请求身份为管理员；PDF/Office 解析质量、权限隔离、图谱与答案质量不属于本轮测量范围。

整个过程不读取 API `.env`，不使用业务数据库、业务索引或业务存储卷。正常完成和受控失败后清理本轮容器与卷；中断或强制终止进程可能需要按 Compose 项目名手动清理。`run-status.json` 标识当前轮是否完整结束，每次运行都创建新目录，避免把旧结果误认为本轮输出。

输出包括总览 `comparison.md/json`、配置与语料 SHA-256、模型摘要、每组的逐题 JSON/Markdown、TREC qrels/run 和 API 日志。报告不包含认证 Token。

## 指标口径

- 文档 Precision@K、Recall@K、MRR@K、nDCG@K 和命中率，只统计 36 道可回答问题。多来源 Recall 按每道题的标准来源数计算，再宏平均；“全部来源命中率”要求该题所有标准来源都找到。
- K 是生产接口实际返回的候选数量。对前 K 个候选按文档去重计算文档指标，不额外扩大召回，因此语义/混合接口的多个 Chunk 可能占用同一文档的名额。三种模式并非相同的唯一文档预算。
- 排名指标按 API 实际返回顺序计算，TREC score 由排名转换，避免评测工具根据原始分数进行第二次排序；原始候选与分数仍保存在逐题 JSON。
- 证据召回检查前 K 个实际返回正文中是否包含对应来源的标注原句，统一 Unicode 和空白后匹配。先按每题证据条数计算，再宏平均；不会把文档命中直接当成证据命中。关键词接口只有元数据和高亮，证据指标记为 N/A，不伪装成 0 或 100%。
- 4 道无答案题单独统计“空候选率”。向量近邻通常会返回候选，返回了候选不代表模型已经编造答案；该指标不是问答拒答准确率，也不混入正样本的召回分母。
- 延迟只包含检索 HTTP 请求，不含上传、建索引、登录和预热；报告包含平均与 P95。当前为本机单次串行测量，不是并发或生产性能结论。

这是一套手工编写并可见的开发集，不是独立用户问题盲测。它适合定位问题和比较固定配置，不能据此宣称整体检索质量。后续需要加入真实用户问题和独立保留集；标注遗漏或合理替代证据应人工复核并升级数据集版本，不能为了当前配置的分数随意改答案。

## 召回层逐阶段诊断

`knowbase-recall-v2` 为 134 篇、80 题的合成扩展集，包含 v1 的 14 篇原文、120 篇模拟干扰资料、40 道原始开发题和 40 道冻结的新措辞验证题。其协议文件预设本轮工程验证阈值；验证措辞仍来自同一作者与同一事实，不是独立真实用户盲测。

```bash
pnpm --filter @knowbase/api benchmark:retrieval \
  --python "$PWD/.venv-rag-eval/bin/python" \
  --suite recall --dataset benchmarks/knowbase-recall-v2 \
  --split development --encoding plain \
  --output-dir reports/retrieval-recall-plain
```

在开发组上对比原始编码与 `--encoding nomic-task`（正文 `search_document: `、问题 `search_query: `），分别全新建索引。选定编码与预算后，再用 `--split validation --budgets 15`（预算按开发选择结果替换）验证。`--lexical standard|cjk` 选择正文关键词分词方式，默认 `standard`；对比 `cjk` 时使用同一语料与默认空任务前缀，全新建立索引。默认预算矩阵为每路 5/10/15/30/60，最终选择固定为 Top 5，重排规则和问答逻辑保持固定。

诊断通过隔离 API 进程的内部服务 IPC 获取真实索引原始候选、过滤后路由候选、合并池和最终选择，并对一个样本与真实 HTTP 路径核对 Chunk 顺序。没有公开诊断 HTTP 接口。耗时为内部服务时间，不能和旧 HTTP 基线的延迟直接比较。

输出 `indexed-corpus.json`（实际索引正文）、`recall-traces.json`（原始候选）、`recall-audit.json/md`（阶段与题型指标）以及元数据、API 日志和运行状态。证据损失分为：索引中不存在或被切断、未进入原始候选、路由过滤或预算截断、合并丢失、最终选择淘汰。候选命中使用原文证据检查，无法代替人工语义相关性判断；原始候选可能包含需要过滤的过期记录，不能直接用于问答。

## 对已有 API 单独评测

评测接口受 JWT 保护。默认使用本地初始化的 `admin / knowbase-admin`，生产或其他环境请通过环境变量覆盖；也可以使用已有 Token：

```bash
export KNOWBASE_USERNAME=admin
export KNOWBASE_PASSWORD=knowbase-admin
# 或：export KNOWBASE_TOKEN=<existing-jwt>
```

### 保留的 RAGBench-CN 演示集

将 `benchmarks/ragbench-cn/docs/rag_basics.md` 和 `retrieval_noise.md` 分别上传到 KnowBase，审核并发布。原始文件名必须保持不变，确保问题集中的 `gold_doc` 可以映射到已发布文档。

### 执行

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

关键词检索可使用 `--mode keyword`。评测项目主集时，用 `--questions benchmarks/knowbase-retrieval-v1/questions.json`，并确保 manifest 中的全部文档均已上传发布且相关索引就绪。

输出指标：

- `Precision@K`
- `Recall@K`
- `MRR@K`
- `NDCG@K`
- `hit_rate`
- 平均检索延迟

输出文件：

- `retrieval-result.json`：机器可读结果。
- `retrieval-report.md`：可读报告。
- `qrels.txt`：标准相关性标注。
- `run.txt`：标准检索结果，可交给其他 TREC/IR 工具复用。

当前已经有 `POST /api/v1/rag/answer`，但本评测命令仍专注于检索层指标。Faithfulness、Answer Relevancy、Citation Correctness 等问答生成指标将在下一步接入 Ragas 或 DeepEval。

## 问答评测基线

问答数据集位于 `benchmarks/ragbench-cn/questions/answers_zh.json`，每条样本包含参考答案、关键事实、标准来源以及是否应该拒答。运行器会真实调用 `/rag/answer`，输出以下可解释指标：

- `answer_fact_coverage`：回答覆盖关键事实的比例；
- `context_fact_support`：检索上下文覆盖关键事实的比例；
- `citation_correctness`：引用是否指向标准来源，拒答问题要求没有引用；
- `citation_completeness`：是否存在引用且没有引用非标准来源；
- `refusal_accuracy`：无答案问题是否正确拒答；
- `context_source_accuracy`：图谱问题是否真的使用 `graph` 上下文，而不是仅依赖普通文档片段；
- `pass_rate` 和平均延迟。

其中 `a009`-`a011` 覆盖单跳关系和两跳关系，`a012` 是没有图谱关系的负样本。图谱样本通过 `expected_context_source=graph` 标注，避免只看最终答案文字而漏掉检索路径错误。

```bash
python tools/rag-evaluation/evaluate_answer.py \
  --top-k 3 \
  --output-dir reports/answer
```

该基线不依赖 OpenAI Key，也不把评测逻辑放进 API。后续可在相同数据采集结果上增加 Ragas/DeepEval 的模型评判指标，例如 Faithfulness 和 Answer Relevancy。
