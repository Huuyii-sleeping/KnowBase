# KnowBase 语义检索与问答

Markdown 使用 RecursiveCharacterTextSplitter 切分。默认 chunk size 为 1000，chunk overlap 为 150。

默认使用 Ollama 的 nomic-embed-text 生成 768 维向量，写入 Elasticsearch 的 kh_chunk。用户的问题也转换成向量，通过 cosine 相似度进行 KNN 检索。

语义接口的 topK 默认是 5，可设置范围为 1 到 20。topK 表示返回的候选片段数量，不保证这些片段来自不同文档。

POST /api/v1/rag/answer 先检索证据，再让对话模型生成回答。结果包含 answer、citations 和 contexts，引用使用 [S1] 等来源标记。

没有足够的可用上下文时，系统返回“知识库中没有找到足够信息”，不调用对话模型。检索接口返回候选与问答接口决定是否拒答是两件不同的事。

文档级命中不等于关键段落命中；即使找到正确文档，也可能取错其中的 Chunk。
