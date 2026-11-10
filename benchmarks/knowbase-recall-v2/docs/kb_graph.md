# KnowBase 知识图谱管线

知识图谱管线读取已发布正文，分块后使用 Ollama 抽取实体和关系。GraphExtractionService 负责实体归一化、跨 Chunk 去重和 mentions 生成。

Neo4j 保存 KnowledgeDocument、DocumentChunk 和 KnowledgeEntity 节点，以及 HAS_CHUNK、MENTIONS、RELATED_TO 关系。实体 key 由实体类型和归一化名称组成。

GET /api/v1/graph/search 提供图谱路径查询。maxHops 的默认值为 2，允许范围是 1 到 3。路径中的每条关系都必须来自有权访问的文档和已激活批次。

模型可能返回空关系，或抽取出不准确的实体类型。任务完成、批次可见与关系抽取质量是不同的评估目标。

关系问题可以追加图谱证据；图谱不可用时，普通问题仍可使用混合检索链路。
