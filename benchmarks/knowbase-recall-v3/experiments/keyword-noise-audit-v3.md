# 关键词疑问词降噪对照

本轮未测到证据召回收益，不接入业务，保留原问题查询。原问题与降噪两模式各跑全部 224 题，共 448 次计分；134 题实际改写，旧题组 62、开发组 48、已暴露验证组 24。关键词原始候选、保留候选、合并池与最终 Top 5 均没有逐证据新增或丢失，剩余 `val017` 仍未进入任何一路的原始候选。

## 固定条件与方法

协议为 [keyword-noise-protocol.json](keyword-noise-protocol.json)，测量与决策分别为 [keyword-noise-results.json](keyword-noise-results.json)、[keyword-noise-decision.json](keyword-noise-decision.json)。协议和实现先提交为 `29ac7ea`，两轮均从该提交的干净工作区运行；问题、答案及语料没有根据结果调整。

每轮独立上传、解析、发布 158 份 Markdown，等待 Search/RAG generation 全部激活。220 个原始 Chunk 的正文、文档内位置、语料/问题指纹及模型摘要逐项一致。固定 `nomic-embed-text`、plain、CJK、标题章节上下文、正文保护 2:1、关键词 30 / 向量 15、最终 Top 5；跨路合并与重排代码不变。

降噪只作用于关键词一路：删除协议列出的疑问词及标点前的“吗”，用空格替代，避免产生新的 CJK 相邻词。数字、标识符、否定、条件、是否/能否及数量/时长词保留；引号、代码、括号等输入回退原文。语义与重排始终使用原问题，实际 Trace 查询计划已核对；这不代表降噪后的查询在所有业务场景下语义等价。

每题仍调用关键词、向量各一次；关键词内部仍有正文/上下文两次 ES 查询。计分部分每模式按计划推算 672 次索引查询、224 次 query embedding，不含上传建索引、预热和 HTTP 抽查。原始读取和路由保留预算均不扩大。HTTP 抽查验证现行业务原问题的 15:15 路径，实验没有公开 HTTP 入口。

## 结果

下表两模式的结果完全相同，数值为正例题目的证据召回均值。

| 分组 | 关键词保留证据 | 合并池证据 | 最终 Top 5 证据 |
| --- | ---: | ---: | ---: |
| 开发组 | 100.00% | 100.00% | 56.25% |
| 旧题组 | 98.61% | 98.61% | 48.61% |
| 已暴露验证组 | 100.00% | 100.00% | 65.28% |

不只检查均分：每题每条金标准证据在关键词原始/保留、向量原始/保留、合并池和最终选择中的命中状态均未改变。只看 134 道触发题也没有收益或退步；未触发题的证据命中同样未变。所有原始证据都存在于实际索引，跨路合并无证据丢失。新基线与前一轮不拆解基线的关键词、池和最终证据命中也逐条一致。

证据指标相同不表示所有候选或分数相同。两轮独立重建后，关键词保留列表有 54 题次序变化、4 题候选集合变化，其中也有 34 道查询未改动的题出现次序/分数变化；最终 Top 5 有 5 题候选集合变化，均未改变标注证据命中。两轮向量保留列表归一化到文档文件与 Chunk 位置后，次序、分数均一致。

这些未改动题的关键词差异说明重建运行本身也存在候选波动，本轮没有定位其底层原因，不能把全部次序变化归因于降噪。原始 Trace 和差异计数已保存；后续若要宣称小幅排名提升，应使用同一索引交替对照及重复测量。本轮没有证据收益，不为继续调整停用词而追加测量。

`val017` 的问题是“解析尚未成功的草稿能申请发布审批吗，最终由什么角色批准？”。降噪后为“解析尚未成功的草稿能申请发布审批 ，最终由 角色批准？”，仍找不到审核证据，不能用追加已知答案词来宣称这一规则有效。

## 结论与限制

停止本轮疑问词删除规则的细调，实验默认 off，业务仍使用原问题。它没有给当前语料带来新增证据，也没有修复剩余漏召回。保留工具用于复现，不将实验规则自动推广到业务查询。

全部数据均为助手合成、有模板相关性且已暴露。本轮测的是标注证据的召回与最终选择，不是独立验收、回答正确率或完整 Precision；没有穷尽相关性标注，未标注候选不能直接算不相关。每模式只有一次测量，不给出生产时延或吞吐结论。

## 验证与复现

后端 232、前端 11、Node 评测 28、Python 检索 24、Python 适配器 11 项测试通过；API/Web 构建、Prettier、Black、三份测试 Compose 配置和 diff 检查通过。Web 构建仍有已有的 bundle 大小提示。两轮真实接入与索引激活成功，临时容器和卷已清理；本次未重跑未修改的消息/索引故障注入测试。

```bash
DELIVERY_TEST_PULL_POLICY=never caffeinate -i node tools/rag-evaluation/run_baseline.cjs \
  --python /path/to/eval-venv/bin/python \
  --suite recall --dataset benchmarks/knowbase-recall-v3 --split all \
  --encoding plain --lexical cjk --context title-heading \
  --keyword-policy body-reserve --body-slots 2 \
  --query-mode off --keyword-query-mode off --route-budgets 30:15 \
  --output-dir reports/retrieval-keyword-noise-off
```

第二轮将 `--keyword-query-mode` 改为 `trim-question`，输出改为 `reports/retrieval-keyword-noise-trim-question`，其余参数一致。

原始报告（本地 reports 目录不提交）：

- `reports/retrieval-keyword-noise-off/2026-11-14T10-43-39-511Z-99457/`
- `reports/retrieval-keyword-noise-trim-question/2026-11-14T10-47-47-876Z-508/`
