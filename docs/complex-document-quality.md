# 复杂资料质量基线

阶段 **5.1 已建立样本、评分器和错误报告**；阶段 **5.2 已完成真实 MinerU / 本地 VLM 对照和隔离存储交付验证**，结果见 [2026-11-25 模型报告](complex-document-model-quality-report.md)。视觉模型发现单位错误，尚不满足自动采用门槛；2026-11-26 用户决定暂停额外 VLM，后续改为 OCR 与表格优化，见 [OCR 表格报告](ocr-table-quality-report.md)。5.1 本身只增加评测；5.3.1 修改了 PDF OCR 表格后处理。不调整召回、重排、Prompt，也不增加音视频支持。

## 评测对象与可复现信息

[新语料](../benchmarks/ingestion-complex/README.md) 含 7 类 14 份合成资料，开发/保留各 7 份，8 个 PDF 共 10 页、6 个 PNG。它与历史业务语料独立，使用不同业务背景、数值及布局；标注包含可见文字、关键值、页来源、表格坐标/合并、关系、阅读顺序与未知项。跨页表格首版按原始页核对，不要求任意拼表。

每次运行记录输入、gold、评分器、Git 基点及工作区状态、生产源码/编译产物、评测工具、锁文件、字体及生成依赖摘要。原始输出、独立 OCR 文本、机器描述 JSON、图像字节、资源清单分开保存，回读比较字节摘要与 JSON。评测运行本身只证明本地证据留存；另用 `verify-delivery.cjs` 验证隔离 MongoDB、S3 兼容对象存储、真实 Embedding 和 ES 暂存索引。后者不经过审核发布、generation 激活、HTTP 权限及检索，完整用户链路仍属阶段 6。

原生解析是 `pdf-parse` 诊断对照，不是当前默认 MinerU 的质量成绩。MinerU 的部署修订和视觉模型修订必须显式声明；服务端报告版本和 API 摘要也会记录，但客户端无法独立证明权重，需部署方固定镜像/权重摘要。视觉提示、温度、1600 输出 token、4 MiB 图像、12 张唯一图像等预算固定并记录；提示所在源码也参与指纹。

## 指标与错误分类

不合成一个“总体准确率”，按 `split/category` 报告分子/分母、可用/完成/失败数量及下列错误。

| 指标             | 核对规则                                                                      | 错误分类                              |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| 选择性文字核对点 | NFKC、大小写与空白归一；保留数字边界、正负号、小数与单位                      | `TEXT_MISSING`                        |
| 关键值/否定状态  | 显式字面别名；OCR 与视觉描述各自统计                                          | `CRITICAL_MISSING_OR_CHANGED`         |
| 来源页           | 核对点必须出现在指定页对应的 UTF-16 section 范围                              | `SOURCE_MISMATCH`                     |
| 表格结构及单元格 | 原始页、行列数、表头、行列坐标、值、rowSpan/columnSpan 全部匹配；报告单元格数 | `TABLE_COUNT` / `TABLE_CELL_OR_MERGE` |
| 有向/类型关系    | 视觉输出的 `{from,to,relation}` 精确匹配；节点共现不算关系                    | `RELATION_NOT_STRUCTURED`             |
| 阅读顺序         | 指定完整核对点按先左栏后右栏出现                                              | `READING_ORDER`                       |
| 未知项           | OCR 保留原文或模型明确列入 uncertain；一般性的 needs_review 不算内容正确      | `UNKNOWN_NOT_PRESERVED`               |
| 已知相反事实     | 仅检查明确列出的危险相反值                                                    | `KNOWN_CONTRADICTION`                 |
| 核对保护         | 生成证据必须 needs_review，整份结果不可直接 ready                             | `UNREVIEWED_VISUAL_OUTPUT`            |
| 解析器显式失败   | 与质量遗漏单列                                                                | `PARSER_RETURNED_FAILURE`             |

`CRITICAL_MISSING_OR_CHANGED` 不区分漏读与替换，需回看原始结果分类；来源目前核对到页，不计算像素框定位精度。关系的字面表达不同也可能失分，人工裁决必须单列，不能事后静默改别名再宣称同指标提升。表格比较适用于本清单每页最多一张目标表的结构，不能直接用于任意多表布局。

模型的 facts/relations 没有精确匹配标注时列为 **unverified**，不是自动断定为幻觉。描述自由文本全部要求人工核对；`automaticChecksPassed` 只是自动核对项通过。即使已知矛盾计数为零，也不能声称“无幻觉”。建议人工裁决另存对应原始结果摘要，记录 supported / unsupported / uncertain 和原图位置，双人复核后再计算新增事实准确率。

没有配置/服务不可达/原生不支持的输入标为 `unavailable`，**没有质量分数**；推理或留存异常为 `failed`；已完成但内容漏读仍保留质量分母。报告逐类别同时显示这些数量，不能删除失败项来提高准确率。耗时为一次串行本地观察，不作吞吐或提速结论；请求数为实际 fetch 次数（含轮询/传输），与模型调用数分开。评测层独立捕获真实响应的 usage、finish reason 和请求/响应摘要；缺失 usage 保持未计量，同时报告已观测与未计量调用数。金额成本为 null，不能当成免费或零消耗。报告的 completed 仅表示评测返回并留存；必须同时检查 `PARSER_RETURNED_FAILURE` 和 `enhancement.status`，OCR 完成不等于视觉增强成功。

## 执行

从仓库根目录执行；Python 依赖固定在 [requirements.txt](../benchmarks/ingestion-complex/requirements.txt)，另需 CJK TrueType 字体。字体字节不同会改变输入摘要，生成清单会如实记录。生成后检查 `previews/` 的全部页面；不能只看文字抽取结果。

```bash
python3 apps/api/test/ingestion/complex-quality/generate.py \
  reports/ingestion-complex/corpus-new \
  --font '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'

pnpm --filter @knowbase/api build
pnpm --filter @knowbase/api test:complex-quality
python3 -m unittest discover -s apps/api/test/ingestion/complex-quality -p 'test_*.py' -v

node apps/api/test/ingestion/complex-quality/evaluate.cjs \
  reports/ingestion-complex/corpus-new reports/ingestion-complex/native-dev-new native-ocr development
```

所有输出目录必须是新目录，生成和运行不会覆盖旧清单。评测逐项原子写 `run.json`；异常停止留下已完成结果。退出码 2 表示运行存在 unavailable/failed，0 表示运行完成，**不是质量通过**。

真实服务可用后设置 `MINERU_BASE_URL` 和 `QUALITY_MINERU_REVISION`（固定部署/模型修订），运行 `mineru-ocr`。然后配置 `VISION_BASE_URL`（OpenAI 兼容 API 根地址）、`VISION_MODEL`、`VISION_MODEL_REVISION`、按需配置 API key，运行 `mineru-vision`。所有地址和凭证只从环境读取，不进入报告；不要把 key 写进命令或资料。服务不通不会自动退回原生解析。

```bash
node apps/api/test/ingestion/complex-quality/evaluate.cjs \
  reports/ingestion-complex/corpus-new reports/ingestion-complex/mineru-dev-new mineru-ocr development
node apps/api/test/ingestion/complex-quality/evaluate.cjs \
  reports/ingestion-complex/corpus-new reports/ingestion-complex/vision-dev-new mineru-vision development
node apps/api/test/ingestion/complex-quality/compare.cjs \
  reports/ingestion-complex/mineru-dev-new/run.json \
  reports/ingestion-complex/vision-dev-new/run.json \
  reports/ingestion-complex/comparison-new.json
```

比较器要求同输入清单、gold、评分器、预算、唯一 case 集合及分类/split；允许变化的模型/代码必须在两份报告中说明。不可用项目显示不可比较，不生成零分差值。开发流程验证后再用同一参数运行 `holdout`。一旦保留项进入推理，运行前即写暴露记录；检查结果后只能称已暴露诊断样本，再调参需要新的外部保留资料。删除本地报告不能使其重新变为未见样本。

## 本轮结果与下一步

固定结果见 [2026-11-24 报告](complex-document-quality-report.md) 和 [机器清单](baselines/complex-document-quality-2026-11-24.json)。真实模型结果、固定权重摘要、失败记录和隔离交付命令见 [2026-11-25 模型报告](complex-document-model-quality-report.md)；当前路线为 **5.3：OCR 表格结构、事实保真及保存交付**，不再优化额外 VLM。金额、符号、否定不得新增错误，未知项不得自动采用。当前小模型未达到此门槛，默认仍使用 OCR，不自动启用视觉描述。
