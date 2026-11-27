# OCR 核对与完整入库链路验收

2026-11-27，阶段 5.3.2 核对展示已补齐，6.1 首轮验收已有记录，最终复测仍有公开网页网络阻断。沿用 MinerU 4.2.3 Flash OCR，验证上传、候选核对采用、审核发布、三条索引激活、检索、来源授权和删除清理。没有调整召回、重排或 Prompt。

## 范围与判定

验收运行独立 NestJS HTTP 服务及其真实 Outbox/Worker，使用隔离 PostgreSQL、MongoDB、RabbitMQ、RustFS、Elasticsearch 和 Neo4j。向量使用实际本地 `nomic-embed-text:latest` 768 维；图谱抽取使用已有 `qwen2.5:0.5b` 文本模型，不新增视觉模型。运行前检查实际 Ollama 模型摘要，不把声明版本直接当实测版本。

11 个场景：一份带中间空白格的扫描 PDF、TXT、XLSX、DOCX、PPTX、多页 PDF、旧 DOC/XLS/PPT、带内嵌图片及合并表格的静态 HTML、`https://example.com/` 网页快照。前十份为生成的合成资料；公开网页内容会变化，存档保存实际抓取内容和摘要。旧 Office 使用 LibreOffice 生成真实 OLE 输入，不作为生产解析依赖。扫描件沿用已暴露样本，验证链路而非新增盲测质量。

每份资料使用上传者、管理员、同团队读者、其他团队读者四个实际登录身份。必须验证：

1. 草稿不可搜索、读者不能查看；未核对候选不能提交审核。核对说明和质量确认、重复采用冲突由实际 HTTP 检查。
2. 采用候选使文档回到 DRAFT、修订递增；正文与机器质量问题保存不变。只有管理员可审核发布。
3. 发布后 search/rag/kg 三个 generation 均指向当前修订，构建状态为成功。关键词和向量检索返回目标资料，返回片段含固定关键事实；其他团队看不到。
4. 原件、关联资源及票据读取字节一致；改票据对应对象不能读取。证据页、候选、构建状态均做权限检查。
5. 已发布资料重新解析只生成候选，不替换当前正文、状态和修订；读者不能读取候选及其图片。拒绝候选后原发布修订继续保持。
6. 删除后文档 404、旧票据拒绝、搜索不可见。等待 Mongo 正文/证据/资源登记/分块与向量缓存、RustFS 原件及候选资源、ES 文档及 Chunk、Neo4j 文档/Chunk/关系清理，三个索引指针保留删除标记。

原件来源验证是“授权读取原件 + 证据页码/块范围 + 索引保存来源”。当前语义检索响应只返回文档/Chunk 身份，尚未把全部页码/bbox 直接交付到检索结果点击定位；不宣称问答引用已经自动跳到精确区域，也不测试生成回答或图谱事实准确率。

## 本轮发现与修复

- **候选身份变更后的核对状态。** 将草稿显示、说明和勾选按 `documentId + taskId` 隔离；迟到旧响应不覆盖新候选。变更前回归失败，修复后通过。详情页原已有任务 key，本次也保证组件本身及文档切换时遵守该约束。
- **HTML 表格正文预览。** 原 ReactMarkdown 将原始 HTML 当文字显示。现在用已保存的规范单元格渲染 HTML 表格，保留 caption、空白、rowspan/colspan 和普通 Markdown 前后文；单元格作为 React 文字，不开启任意 HTML。非法或重叠偏移不消耗其他正文。该渲染使用已有表格元数据，未重新猜测原表结构。
- **正文图片授权。** Markdown 内已登记图片改用现有对象票据加载。实际页面确认 `naturalWidth > 0` 且地址含对象票据，避免浏览器直接请求受保护地址导致图片缺失。资源加载/错误提示使用行内元素，避免 Markdown 段落内嵌套段落。
- **OCR 边界提示。** 核对界面和 OCR 正文提示用户检查金额、单位、负号、否定和空白，说明图中箭头、数值归属和合并关系可能不完整。提示不能替代事实核对或证明 OCR 正确。

扫描表页实际走完上传 → needs_review → 原件/两条证据 → 勾选并说明 → 采用，界面 v2 为 DRAFT/READY，表格与原表图片可对照，提交审核按钮可用。浏览器验收止于采用与来源查看；审核发布及删除由上述真实 HTTP/Worker 场景验证，没有声称 11 个格式都逐一浏览器点击。

## 结果与复现

2026-11-26 初轮 11/11 通过；最终代码增加更严格的 ES 文档/Neo4j 清理、模型摘要检查和更多权限断言后，2026-11-27 本地文件场景 **10/10 通过**。公开网页返回抓取失败；同机 curl 访问 example.com 也发生 TLS 连接错误，单独重试同样保留实际结果。因此本轮最终全套结果按 **部分通过、网页待网络恢复后复测** 记录，不能把历史 11/11 当成今日全套通过。

逐场景结果、固定源码/工具/编译产物及模型摘要、HTTP 状态计数和原报告摘要见 [机器基线](baselines/ingestion-acceptance-2026-11-27.json)。完整本地报告、截图、日志及生成输入保留在忽略的 `reports/ingestion-acceptance/`。

API 507 项、Web 256 项测试通过；验收工具 2 项通过；API/Web 构建通过。Web 仍有已有包体积提示。变更文件格式、Compose 合并配置与 diff 检查通过。

```bash
pnpm --filter @knowbase/api build
# 先启动固定版本 MinerU OCR 和已具备对应模型的 Ollama。
MINERU_BASE_URL=http://127.0.0.1:18080 \
QUALITY_MINERU_REVISION=mineru-4.2.3:5ac1b90c8761385768caf3354d4ca7fcf8fcb1c7c98d0f71f7de0b8e292a152b \
QUALITY_EMBEDDING_REVISION=sha256:0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f \
QUALITY_KG_REVISION=sha256:a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67 \
XLS_EVIDENCE_PYTHON=/absolute/path/to/python-with-xlrd-2.0.2 \
DELIVERY_TEST_PULL_POLICY=never \
node apps/api/test/ingestion/acceptance/run.cjs reports/ingestion-acceptance/new-run
node --test apps/api/test/ingestion/acceptance/*.test.cjs
```

输出目录必须不存在。扫描输入先按 [OCR 表格报告](ocr-table-quality-report.md) 生成到 `reports/ingestion-complex/ocr-table-new-v2`；旧 Office 夹具需要 `soffice`（可由 SOFFICE_BIN 指定）。`never` 需要已有 Docker 镜像。可用 `ACCEPTANCE_CASE_IDS` 逗号分隔选择场景，报告只统计实际运行项。公开网页需要可访问外网；不能以替身响应充当网络抓取验收。

`browser-session.cjs NEW_OUTPUT` 使用相同环境变量开启回环隔离页面，测试密码仅放本地忽略的 session.json，结束应向该进程发送 SIGTERM，移除自身服务和卷；不要提交该文件。验收工具按环境、HTTP、格式夹具、候选、来源、发布检索及删除责任拆分，生产解析器不依赖这些工具。

## 失败记录与限制

早期运行依次发现测试环境的 Mongo 客户端导入、RustFS 镜像入口/目录权限、Compose tmpfs 合并和子进程信号退出判断错误，均修复后重新运行；另一次使用超出接口限制的 topK=100 被正常拒绝，改为实际允许的 20。最终全格式重跑曾在 PPTX 出现“任务 completed 但本次详情正文尚未回读”的短暂状态：任务与正文分别查询，测试原先只等待任务状态；现同时等待 READY 与正文再进入断言，保留该失败报告。

浏览器演练启动器退出时还曾因页面服务关闭异常未执行后续资源清理；已改为各清理动作独立执行，本轮两组浏览器环境由明确项目名移除并核对无剩余容器，清理日志保留。

续跑时临时 Python 环境被清理。通过本机包缓存按原版本约束恢复，重新对 `/Users/huayi/.mineru/models/MinerU-4_models_torch` 做运行时及权重快照，摘要与历史完全一致；没有用新依赖冒充原基线。在线恢复曾受 TLS 网络中断，失败日志保留。模型和依赖只用于测试本机，不进入提交。

阶段 6.1 首轮覆盖正常生命周期及相关权限/重解析行为，今日最终验收还需网络恢复后补公开网页复测，不表示整个阶段 6 已结束。下一项为 6.2：受控故障和并发交错验收（超时、保存失败、重复投递、激活结果不确定、编辑/采用/删除交错），随后固定负载、迁移发布与回滚演练。main 接口整合及联合版本回归仍是发布前置；原件精确定位到检索 UI 另有接口衔接工作。
