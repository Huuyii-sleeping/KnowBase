# 第一阶段架构

## 模块边界

```text
DocumentsController
        |
DocumentsService
   _____|____________________
  |            |             |
PostgreSQL   MongoDB       RustFS
metadata     markdown      original file
```

`DocumentsService` 负责文档业务流程，不把 PostgreSQL 和 MongoDB 的访问逻辑泄露给 Controller。后续解析、索引和审核事件可以在 Service 后面增加异步任务或领域事件。

## 关键设计

- `status` 表示业务审核生命周期。
- `parse_status` 表示正文是否已经准备好，和审核状态分离。
- `content_id` 是 PostgreSQL 当前正文版本和 MongoDB 正文的关联键。
- 文档正文更新创建新的 `content_id`，历史正文暂不删除，为后续版本历史保留空间。
- 文档列表默认只查询 PostgreSQL，文档详情才读取 MongoDB 正文。
- 所有已发布文档后续需要通过一个 `DocumentPublished` 入口触发索引流水线。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/v1/documents` | 上传文件并创建草稿 |
| GET | `/api/v1/documents` | 分页查询文档元数据 |
| GET | `/api/v1/documents/:id` | 查询元数据和 Markdown 正文 |
| PATCH | `/api/v1/documents/:id` | 更新标题、分类、团队和标签 |
| PUT | `/api/v1/documents/:id/content` | 更新 Markdown 正文并递增版本 |
| POST | `/api/v1/documents/:id/submit-review` | 提交审核 |
| POST | `/api/v1/documents/:id/review` | 管理员通过或驳回 |
| DELETE | `/api/v1/documents/:id` | 删除文档及其存储资源 |

