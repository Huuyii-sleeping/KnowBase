# 问答模型接入

项目问答生成默认使用 DeepSeek 托管 API，通过 API Key、Base URL 和模型名称连接；问答 API 不再需要在本机加载 Qwen 权重。代码与示例的默认模型为 `deepseek-v4-pro`；用户实际配置为 `deepseek-flash`，接入器按环境配置调用。Flash 的首轮真实回归见[DeepSeek 验证](answer-deepseek-validation.md)，不能把该结果归给未经本项目实测的 Pro。

## 配置与启动

在运行 API 时的工作目录准备本地 `.env`，或将同名变量注入 API 进程。Nest 的全局 `ConfigModule.forRoot()` 加载配置；示例文件不会被自动读取。从仓库根运行 `npm run start:dev` 时，workspace 脚本的工作目录是 `apps/api`，因此配置文件应放在 `apps/api/.env`。本轮未创建或修改用户 `.env`，没有重启现有 API，也没有安装或启动新模型。

```env
CHAT_MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=在本地填写平台密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
```

完成其余数据库等项目环境配置后，在仓库根启动：

```bash
npm run start:dev
```

首次配置可复制仓库根的 `.env.example` 为 `apps/api/.env` 后填写（已有 `.env` 时直接编辑，避免覆盖）。直接运行编译产物时，则以该进程实际工作目录为准。

`CHAT_MODEL_PROVIDER` 默认就是 `deepseek`，显式写出是为了部署清晰。`DEEPSEEK_BASE_URL` 为 API 根地址（可带 `/v1`），不要填写完整的 `/chat/completions` 路径；接入器会请求该根地址下的 `/chat/completions`。兼容代理可替换 Base URL 和模型名，但必须支持这里使用的 Chat Completions 及 `thinking` 参数，并以实际测试验证。密钥只放在后端环境，不能放 `VITE_` 变量、前端代码或 Git。

DeepSeek 缺少密钥时 API 启动会报出配置缺失，未知 provider 或非法 Base URL 同样明确失败；不会在未说明的情况下回退成本地 Qwen。显式 `DEEPSEEK_MODEL` 决定实际模型，不读取 `OLLAMA_CHAT_MODEL` 作为远程模型名。模型名称写入生成观测记录，不再从 Ollama 环境变量推测；密钥不会作为模型元数据输出。

官方文档在本次接入时列出的模型为 `deepseek-flash` 与 `deepseek-v4-pro`，当前版本分别是 DeepSeek-V4.1-Flash-1017 与 DeepSeek-V4-Pro-0813。模型别名可能变化，之后部署应以平台支持的名称为准：[首次调用](https://api-docs.deepseek.com/)与[模型说明](https://api-docs.deepseek.com/quick_start/pricing)。

## 调用链与参数

`AnswerService → AnswerGenerationService → ChatModelService → DeepSeekChatModelService → ChatOpenAI → DeepSeek Chat Completions`。

复用已有 `@langchain/openai` 依赖，不增加新 SDK。`ChatModelService` 仅选择提供方；独立适配器负责各自接口，公共调用工具负责期限、最终文本提取与完成状态检查。问答上下文、完整输入预算、结构化结论与引句校验、一轮合约修正均由公共模块负责，当前预算与选择规则见[上下文设计](answer-context.md)；切换生成提供方不需要重建向量索引。

远程调用使用非流式 Chat Completions，`max_tokens=4096`、`temperature=0`、`thinking={"type":"disabled"}`，不发送本地 Ollama 的 seed、`num_ctx` 或 `num_predict`。长规则答案在原 1,024 token 上限下发生截断后，扩大最终输出预算，验收见[修复报告](answer-repair-validation.md)。官方 DeepSeek 支持思考与非思考模式；本次显式关闭默认思考，单次期限仍为 30 秒。后续如测试思考模式，应单独验证输出与超时预算，而非把隐藏推理当作最终答案。DeepSeek 对温度参数的实际处理依模型模式而定，温度设置不承诺确定性，见[思考模式说明](https://api-docs.deepseek.com/guides/thinking_mode)。

每次调用由独立计时器限制 30 秒，同时传递取消信号并禁用 SDK 自动重试；一次问答如需引用修正，最多会有两次调用。取消不保证上游立即停止计费或生成。401、429、服务端异常和网络故障作为调用失败返回，不伪装成“知识库没有答案”，也不触发 Ollama 静默降级。输出达到 token 上限、被过滤、工具调用而非文本、没有最终内容都拒绝作为完整回答，不返回推理内容或不完整前缀。

## 本地能力范围

本次切换仅针对问答生成。Embedding 仍由 `EMBEDDING_PROVIDER` 单独决定；当前示例保留 Ollama `nomic-embed-text`，图谱实体抽取也仍使用 `OLLAMA_KG_MODEL`。因此问答模型移到云端不等于项目完全不再使用 Ollama。召回、重排和图谱抽取没有在本次改换模型。

显式需要复现历史本地评测时，配置：

```env
CHAT_MODEL_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b
OLLAMA_CHAT_TEMPERATURE=0
OLLAMA_CHAT_SEED=42
```

## 验收与后续

使用本地随机端口的模拟 OpenAI 兼容服务器调用真实 SDK，检查 endpoint、鉴权头、模型与参数序列化、引用失败后的一次修正、401/429/500 不自动重试、截断和空回答失败；独立假适配器覆盖完全不响应的超时与计时器清理。该接入验收不需要密钥、不发送业务资料到外部，也不冒充 DeepSeek 实际效果或接口鉴权成功。

用户配置密钥后，已使用真实 DeepSeek Flash 完成连通性验证、76 道固定回归及 24 道冲突题的正反顺序验证。答案、引用支持、延迟和遗留问题统一记录于[DeepSeek 验证](answer-deepseek-validation.md)。本轮使用独立工作区编译代码读取用户已配置的环境文件，未复制密钥、合并代码到主工作区或重启正在运行的服务；配置存在不代表旧进程已经切换提供方。尚未测量实际账单费用，仍需新来源问题、独立标注与业务 HTTP 验收。

后续已完成上下文、结构化状态与原文引句的[收尾验证](answer-refinement-validation.md)，当前实际合约以[上下文设计](answer-context.md)为准。早期 Flash 首测保留作修改前基线。
