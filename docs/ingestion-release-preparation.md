# 入库分支合并审查与发布准备

2026-11-28，审查基于 `aa59e45947123a1b9fc731d961cbdf1d30835d58`，已包含固定远端 main `b15d9380e77668a027f68c9700baff7fae52aa3b`。本次补充 PR 检查流水线、部署模板对象存储冒烟和审阅入口；未部署生产或修改用户数据。PR 的实时合并状态与检查结果以 GitHub 为准。

## 审阅范围与顺序

这是累计交付分支，基线相对 main 为 511 个文件、70,777 行新增和 1,779 行删除（不含本次发布准备文件）；其中冻结机器清单约 27,086 行。包含此前界面/图谱展示和错误提示改造，不将其描述成只有后端解析的小 PR。保持既有提交历史和已经联合验证的最终树，不在发布准备阶段重写提交或删除历史证据。

建议按以下依赖顺序审阅：

1. **协议和部署**：[格式及保存](multimodal-ingestion.md)、[MinerU](mineru-ingestion.md)、[操作单](ingestion-release-runbook.md)，以及 PostgreSQL 006–010、MongoDB 002–004；先迁移后启动新 Worker，不混跑新旧消费者。
2. **解析和候选**：`documents/parsing` 的格式适配、预算与原生证据；`documents/ingestion` 的租约、检查点、版本复查、核对采用；拒绝/失效后的资源补偿。
3. **存储和授权**：独立证据/资源登记、摘要核验、原件/候选访问隔离、对象票据和删除清理。控制器处理传输，解析器不直接写数据库。
4. **分块和构建**：`structure-v5` 的标题/表格范围，原文与检索文本分离，任务前缀预算/指纹、逐批向量保存、完整 generation 激活和退休回收。
5. **存量升级**：管理员预览、准入/限速、暂停/恢复、失败重试和当前有效状态；三条管线全部激活才算文档完成。
6. **Web 与既有展示改造**：上传/异步进度、候选核对、证据、索引状态和批次管理；同时注意继承的图谱、页面布局和错误恢复改动。
7. **证据**：[组合回归](ingestion-main-integration-report.md)、[故障恢复](ingestion-resilience-report.md)、[容量](ingestion-capacity-report.md)、[回退](ingestion-release-report.md)。机器清单是固定运行证据，不是运行时业务配置。

本轮检查没有发现需要修改生产服务的新增阻断缺陷；这是一轮针对状态、授权、持久化及部署入口的自查，不等于独立审阅者已批准。主线 Answer/Search/RagQuery/Retrieval 生产模块与固定 main 保持一致，未再调优召回、重排或 Prompt。

## 本轮补充验证

- API 720、Web 256 项再次通过，两端构建通过；Web 保留既有 bundle size 提示。
- CI 配置固定 Node 24、pnpm 11.6.0、frozen lockfile，PR/push-main 执行两端测试/构建、无需真实模型的入库和检索工具测试、Compose 配置检查。完整 Git 历史用于基线源码测试。权限仅 `contents: read`，不配置部署、生产凭证或第三方模型密钥。
- Docker、真实 MinerU/Ollama 的长链路不冒充由该 CI 执行；仍使用已记录的本地隔离集成证据。
- 从实际 `deploy/docker-compose.yml` 提取 RustFS 服务，保留镜像默认 entrypoint、命令和命名卷，仅隔离项目名、端口与凭证。验证服务启动、错误凭证拒绝、保存摘要回读、重启后摘要一致和删除对象/桶，共 5 个检查通过。测试容器与卷已删除。
- 首轮重启检查失败源于随机宿主端口变化；复测重新读取端口后通过，无需修改部署服务。报告见 [部署存储基线](baselines/ingestion-release-preparation-2026-11-28.json)。该检查不是跨存储备份恢复或生产容量验证。

部署冒烟复现（仅操作自己创建的容器/卷）：

```sh
DELIVERY_TEST_PULL_POLICY=never \
STORAGE_DEPLOY_OUTPUT=reports/ingestion-release-preparation/your-new-run \
node --test apps/api/test/deployment/object-storage.test.cjs
```

输出目录不得存在。凭证仅通过子进程环境传入，不写入报告或生成的 compose 文件；首次运行需准备镜像或省略 never。

## 发布前仍需确认的环境结果

当前 PR 用于审阅，不自动合并或部署。已有 [操作单](ingestion-release-runbook.md) 规定关闭写入、排空任务/远端取消、备份、迁移、单份试升级及扩大批次；不在此重复命令。

仍未验收：正常公网 DNS 下的网页最终复测、实际部署 DeepSeek/BGE 的组合业务质量、真实 OCR/模型的生产容量和长时间稳定性、跨存储备份恢复以及模型空间切换。模型指纹和维度相同不能证明新旧空间可混查。音视频继续不支持，额外 VLM 不启用。

完成 GitHub 合并审阅不代表这些生产环境条件自动满足；实际发布应记录目标提交、固定模型/服务版本及对应环境验证结果。
