# MinerU 与可恢复解析任务

## 接入范围

当前适配器面向 MinerU **4.2.3 的 V1 Tasks API**：创建 JSON 任务、按返回地址 PUT 上传、查询逐文件状态、下载 `default` ZIP。旧 `/file_parse`、2.x 后端名称和 Doclib 的截断阅读响应不属于此协议。依赖固定版本；升级时运行协议及真实语料对比，不能只修改版本字符串。

默认 `DOCUMENT_PARSER=mineru`，将 PDF、DOC/DOCX、PPT/PPTX、XLS/XLSX、HTML/HTM 和 PNG/JPG/JPEG/WebP 输入交给 MinerU，TXT/MD 继续本地读取；网页上传入口已开放这些格式。默认服务为 `http://127.0.0.1:8000`、档位 Flash；Office 和静态 HTML 请求始终使用 Flash，PDF/图片使用 `MINERU_TIER`。旧 Office 由 MinerU 原生解析，生产不依赖 LibreOffice 转换。显式设置 `DOCUMENT_PARSER=native` 可回到原生六格式解析，新增格式会被 API 拒绝。MinerU 不可用或输出不符合契约时明确失败，不静默退回不同引擎掩盖 OCR 或结构问题。URL 抓取和音视频尚未接入，后续方案见 [多模态入库](multimodal-ingestion.md)。

应用通过 HTTP 连接 Python/模型运行环境；其独立部署源于运行时和资源差异，主应用仍为模块化单体。不会自动上传至 MinerU 官网。生产建议自部署并配置认证，明确服务端产物保留规则。

## 正文、结构与资源

默认结果包必须包含 `markdown.md`、`middle_json.json`、`structured_content.json`。校验 Middle JSON 的 `schema=docvortex.middle`、`schema_version=2.0`，使用 Structured Content 的有序页面/块规范化正文。原始 Markdown 与两份 JSON 作为受文档访问控制的附件保存，用于核对转换结果；图片上传至本项目对象存储并重写引用。

- 标题、正文、表格/图表、公式、代码、图片、图注/脚注保持输入块顺序；页眉、页脚、页码不进入正文。
- PDF 页码从 `page_idx+1` 转换；PPTX 对应幻灯片。Word/Excel 的内部 partition 不冒充原文件页码或工作表名称。未知的来源只保留引擎分区和块编号；bbox 是引擎原值，未承诺跨格式统一坐标单位。
- 同一页相邻块保留标题上下文；跨页、幻灯片、工作表重置上下文。当前分块策略为 `structure-v3`（含 [复杂表格](table-ingestion.md)），缓存键会失效重算。
- 行间公式作为完整知识单元，超过预算时明确失败，不切断 LaTeX。表格仍按完整行分组；大合并单元格、HTML 复杂表格和跨页续表需真实语料验证。
- 当前适配器要求块 `content` 为字符串；协议出现新的嵌套内容结构时失败，避免悄悄丢失内容。新块类型保留已有文本并触发人工确认。
- 图片引用必须来自结果包；不自动下载外部图片。HTML 的外链/缺失相对图片显示缺失提示并触发 `needs_review`，正文仍保留；其他格式的缺失图片引用明确失败。路径穿越、超过解压预算或图片格式不在白名单内的包被拒绝。静态 HTML 不执行脚本，也不承诺提取 JavaScript 运行后才出现的正文。

保存实际生产者版本、档位、文字提取模式及适配器策略。质量状态为 `accepted / needs_review / failed`：部分文档、空文本页、图片形式公式、未知块和缺失页触发 `needs_review`；执行/协议错误为 `failed`。这不是 OCR 准确率评分。沿用 PostgreSQL `PENDING / READY / FAILED` 枚举，只有 accepted 对应 READY；needs_review 保存在正文质量字段，界面显示“待确认”，编辑并核对正文后才允许进入审核。

## 异步任务和并发

启用 `INGESTION_ASYNC_ENABLED=true` 后，文件上传先保存原文件，再在同一 PostgreSQL 事务中保存 DRAFT/PENDING 文档、解析任务和 Outbox 命令；请求无需等待模型解析。显式提供 Markdown 的上传继续同步保存。同步模式仍可使用 MinerU，但不具备任务恢复与状态界面，适合短文件验证。

任务表 `kh_document_parse_task` 保存预期文档版本/正文指针、执行 token、租约、尝试次数、MinerU task ID、资源引用与阶段。每次尝试使用独立正文 ID。接单前的版本检查和最终短事务中的行锁复查防止过期结果覆盖新正文；手工修改、元数据修订、重新解析和删除会使活动任务失效。取消不会恢复旧 READY 状态，需要重试或编辑正文。

任务使用独立 RabbitMQ 队列 `knowbase.document.parse` 和既有 Outbox/receipt 机制。解析任务的业务重试次数由 `INGESTION_TASK_MAX_ATTEMPTS` 控制；队列重试仍负责数据库或消费者结算错误。默认一个进程同时读取/解析一个文档，另有解析器共享预算；不同进程的总并发须在部署层控制。

Worker 定期续租；启动及每 15 秒回收已过期的 running 任务，轮换 token 后重新投递。已持久化的 MinerU task ID 优先继续查询/下载，不重新提交；上传响应丢失时查询后按协议补传。创建任务响应与本地保存之间不具备跨服务原子性，极端断连可能遗留未引用远端任务，需依赖 MinerU 自身保留策略。

取消/失效/最终失败任务的远端取消请求由维护任务补偿；已结束或已回收的远端任务视为完成取消。更换引擎、服务地址或档位会使任务配置指纹不一致，旧任务不会被新配置执行或取消；更换前应先停止接单并排空/取消任务。

已保存但未采用的尝试正文，在至少一天后由解析维护服务清理，并先删除其资源。活动任务和当前正文不进入回收；只扫描尝试自己记录的 ID，不扫描对象存储全目录。已采用正文历史和同步模式资源继续使用既有文档删除机制。对象上传与任务资源引用之间仍存在进程崩溃窗口，未记录资源需后续存储清单核对，当前不宣称完全消除孤儿对象。

## 接口

以下接口均需要登录并沿用文档访问权限：

| 接口                               | 行为                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /documents/:id/reparse`      | 上传者/管理员从原文件重新解析，递增版本、回到草稿并清空审核状态；异步功能需启用      |
| `GET /documents/:id/parse-status`  | 可查看文档的用户查询最近任务的阶段、状态和尝试次数，不返回远端地址、原始错误或资源键 |
| `POST /documents/:id/parse-cancel` | 上传者/管理员取消活动任务                                                            |

文档详情响应增加可选 `ingestion` 字段；详情页在处理期间自动刷新阶段，并提供重新解析/取消操作。持久状态目前覆盖解析阶段，后续分块、Embedding、索引构建仍通过阶段日志排查。

## 配置与部署

| 配置                          | 默认值                | 说明                                                   |
| ----------------------------- | --------------------- | ------------------------------------------------------ |
| `DOCUMENT_PARSER`             | mineru                | native 或 mineru                                       |
| `INGESTION_ASYNC_ENABLED`     | false                 | 启用后台解析及管理入口；`.env.example` 显式启用为 true |
| `INGESTION_PARSE_CONCURRENCY` | 1                     | 单进程原文件读取/解析并发                              |
| `INGESTION_MAX_FILE_BYTES`    | 104857600             | 写入原文件前检查的输入预算；HTTP 上传仍有 100 MiB 上限 |
| `INGESTION_MAX_CONTENT_BYTES` | 4194304               | 规范化 Markdown 字节预算                               |
| `INGESTION_MAX_PAGES`         | 1000                  | 原生 PDF / MinerU 结果页数预算                         |
| `INGESTION_TASK_LEASE_MS`     | 120000                | 续租周期约为租期的三分之一，最小 3000                  |
| `INGESTION_TASK_MAX_ATTEMPTS` | 3                     | 包括租约恢复在内的尝试次数                             |
| `MINERU_BASE_URL`             | http://127.0.0.1:8000 | V1 之前的服务根地址                                    |
| `MINERU_API_KEY`              | 空                    | 服务认证                                               |
| `MINERU_TIER`                 | flash                 | flash/basic/standard/advanced                          |
| `MINERU_TIMEOUT_MS`           | 600000                | 单次适配器调用的总 HTTP 等待预算                       |
| `MINERU_POLL_MS`              | 1000                  | 状态查询间隔                                           |
| `MINERU_RESULT_MAX_BYTES`     | 67108864              | 下载、解压与提取资源的字节预算                         |
| `MINERU_TRANSFER_ORIGINS`     | 空                    | 明确允许的额外上传/下载 origin，逗号分隔               |

认证只发送给配置服务的同源请求；跨源签名传输必须显式允许，且不携带服务密钥。不自动跟随重定向。

部署前执行 PostgreSQL [006_document_parse_tasks.sql](../deploy/postgres/migrations/006_document_parse_tasks.sql) 与 [007_generation_retention.sql](../deploy/postgres/migrations/007_generation_retention.sql)，均可重复执行。新库 init 脚本包含同一结构。即使暂不开启异步，文档修订/删除也会检查任务，因此必须先迁移再部署应用。新 Worker 的任务表结构与配置应保持一致。

回滚时先停止接单和新 Worker，排空/取消解析任务及资源清理命令；不要让旧 Worker 消费新消息。解析任务队列独立，但新字段不会自动被旧代码恢复。保留已保存正文与原文件，关闭相关新配置并回滚代码；保留新增表不会影响旧代码。

MinerU 4.2.3 要求 Python 3.11–3.14。服务端的模型、运行时、CPU/GPU及档位选择参照[官方档位说明](https://opendatalab.github.io/MinerU/zh/usage/tiers/)。本项目不在 NestJS 启动时安装 Python、下载模型或启动第三方服务。

本地从仓库根目录单独启动服务（Python 3.12 已实测）：

```bash
python3.12 -m venv .venv-mineru
.venv-mineru/bin/python -m pip install -r deploy/mineru/requirements.txt
.venv-mineru/bin/mineru-kit api-server --host 127.0.0.1 --port 8000 --tier flash --disable-image-analysis
```

依赖固定为 4.2.3。首次 PDF/OCR 请求会准备模型，应先预热并确认下载完成再接业务流量；普通 Office 不依赖这次 OCR 模型下载。上述本地命令仅监听回环地址；远程部署需配置服务认证及应用 `MINERU_API_KEY`。应用与服务位于不同容器时，将 `MINERU_BASE_URL` 改成可达的服务地址。

## 对比评测

```bash
pnpm --filter @knowbase/api test:parse-tasks
MINERU_BASE_URL=http://127.0.0.1:8000 MINERU_TIER=flash pnpm --filter @knowbase/api benchmark:mineru
```

第二条命令需要真实 MinerU 服务，默认比较合成 PDF/Office 样本。自有标注语料可通过 API 目录下运行 `node test/ingestion/compare-mineru.cjs /absolute/path/corpus.json` 接入：

```json
[
  {
    "path": "scanned-contract.pdf",
    "facts": ["违约金为合同金额的5%"],
    "order": ["付款条件", "违约责任"],
    "expectedReady": true
  }
]
```

文件路径相对清单目录。清单及文件不需提交到仓库；报告写入忽略的 `reports/ingestion-mineru/comparison.json`，含样本摘要、解析/分块事实覆盖、证据顺序、耗时和实际解析版本，不含全文、密钥或服务地址。某个引擎失败时仍写出报告并返回非零退出码。真实复杂扫描件、合并/跨页表格和公式的业务准确率必须通过调用方语料补充，不能从合成样本外推。

### 本地服务验证记录

默认 MinerU/Flash 路由已通过真实 Word 冒烟检查：3/3 个标注事实保留，READY，版本 4.2.3（仅覆盖一份合成 Word，不代表所有格式）。首次运行因模型初始化/下载超过 60 秒失败；模型备齐后的复测已经完成 Office、文本 PDF 和中英文纯图片扫描件。新旧原生解析的 20 轮对比、MinerU 的 3 轮耗时及事实覆盖结果统一维护在 [ingestion-comparison.md](ingestion-comparison.md)。该结果仅适用于已标注的合成样本，不能代替生产语料验收。

## 旧 generation 回收

`INDEX_GENERATION_GC_ENABLED=false` 默认关闭。开启后每分钟查询登记过的、已退休的完整 generation，`INDEX_GENERATION_RETENTION_HOURS` 默认 24 小时，至少 1 小时。宽限从旧指针被替换/删除的事务开始，不能从构建时间计算；部署需确保宽限长于应用和数据库允许的最长在途查询。

新激活指针与退休登记在同一事务提交；回收再次检查活动指针，并以 generation 为范围删除 ES/Neo4j 数据。清理失败保留登记供下次重试。未完成构建、不确定 COMMIT 的暂存数据以及升级前没有登记的旧 generation 不扫描删除。该机制不替代失败构建的即时补偿，也不自动清理所有历史数据。

其他构建优化的真实 Ollama/MongoDB/ES 数据、分块缓存回退和索引批次成本见 [ingestion-performance.md](ingestion-performance.md)。
