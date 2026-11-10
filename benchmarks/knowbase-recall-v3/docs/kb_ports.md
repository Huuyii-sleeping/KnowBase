# KnowBase 本地依赖端口表

下表均为宿主机访问端口，不是容器内部监听端口。

| 服务 | 宿主机端口 | 用途 |
| --- | --- | --- |
| PostgreSQL | 15432 | 结构化元数据 |
| MongoDB | 17017 | Markdown 正文 |
| RustFS S3 API | 19000 | 二进制对象读写 |
| RustFS Console | 19001 | 对象存储控制台 |
| RabbitMQ AMQP | 15672 | 应用连接消息 Broker |
| RabbitMQ Management | 15673 | 消息管理界面 |
| Elasticsearch HTTP | 19200 | 全文和向量查询 |
| Neo4j Bolt | 17687 | 应用访问图数据库 |
| Neo4j Browser | 17474 | 图数据库管理界面 |
| Ollama HTTP | 11434 | 本地模型调用 |

API 默认监听 3000，Web 开发服务器默认监听 5173。隔离验收环境使用临时端口，不与上述开发服务端口混用。
