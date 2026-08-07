# KnowBase Development Guide

This document contains the current project-specific decisions. Read it together with the general rules in the repository root `AGENTS.md`.

## Product Scope

KnowBase is an enterprise knowledge base. The first milestone is the document module:

- accept `PDF`, `XLSX`, `DOCX`, `PPTX`, `TXT`, and `MD` uploads;
- preserve the original binary file;
- normalize the source into Markdown;
- keep structured metadata separate from long Markdown content;
- require review before a document becomes searchable;
- expose stable source and asset references for later RAG pipelines.

## Current Stack

- Frontend: React + Vite + TypeScript
- API: NestJS + TypeScript
- Structured data: PostgreSQL + TypeORM
- Markdown content: MongoDB + Mongoose
- Binary files and extracted assets: RustFS through its S3-compatible API
- Package manager: pnpm workspace

## Module Boundaries

The backend is a modular monolith for now. Keep business modules isolated in code, but do not split them into deployable services until there is a real operational reason.

The document module is organized around these responsibilities:

- `documents.controller.ts`: HTTP transport only.
- `documents.service.ts`: small application facade that composes use cases.
- `document-command.service.ts`: create, update, version, and delete commands.
- `document-query.service.ts`: PostgreSQL list/detail queries and response projection.
- `document-workflow.service.ts`: draft, review, publish, and reject transitions.
- `document-content.store.ts`: MongoDB Markdown persistence.
- `parsing/file-parser.service.ts`: parser dispatch and fallback only.
- `parsing/parsers/*.parser.ts`: one parser per file format.
- `parsing/markdown-table.util.ts`: Markdown table rendering only.
- `parsing/parser.utils.ts`: parser-independent text, XML, MIME, and naming helpers.
- `parsing/asset-uploader.service.ts`: extracted asset persistence only.
- `storage/storage.service.ts`: RustFS object operations only.

Do not add format-specific parsing logic back into `FileParserService` or document workflow logic into `DocumentsService`.

## Parser Contract

Every format parser implements the shared `FormatParser` contract and returns a `ParsedDocument`:

```text
Buffer + file name
  -> format parser
  -> Markdown + assets + warnings + parser name
```

Parsers receive a `FileParserContext` with an asset upload callback. They must not access PostgreSQL, MongoDB, or HTTP request objects directly.

Primary parser decisions:

- PDF: `pdf-parse`, with page text, page sections, simple table heuristics, and decodable image extraction.
- XLSX: `exceljs`, one Markdown section and table per worksheet.
- DOCX: `mammoth` to HTML, then `turndown` to Markdown, including image callbacks.
- PPTX: `jszip` plus slide XML parsing for text, tables, and media relationships.
- TXT and MD: direct Buffer processing.
- `officeparser`: fallback AST-to-Markdown conversion when a primary parser fails.

Keep parsers deterministic and independently testable with a fake `uploadAsset` callback.

## Storage Rules

PostgreSQL table `kh_document` stores metadata, ownership, status, permissions, statistics, parse status, and the current `content_id`.

MongoDB collection `document_content` stores the complete Markdown body, parser metadata, warnings, version, and extracted asset references.

RustFS stores original files under `original/` and extracted assets under `assets/`.

The PostgreSQL and MongoDB records are associated by `content_id`. Lists should read PostgreSQL only; details read MongoDB content on demand.

Markdown assets use the application object proxy URL, not a hard-coded public RustFS URL:

```text
/api/v1/storage/object?key=<encoded-object-key>
```

## Document Lifecycle

Business status:

```text
DRAFT -> PENDING_REVIEW -> PUBLISHED
                    \-> REJECTED -> PENDING_REVIEW
```

Parse status is separate:

```text
PENDING | READY | FAILED
```

Only a document with `parseStatus=READY` can enter review. Any content or meaningful metadata update to a published document returns it to `DRAFT`.

Only `PUBLISHED` documents may later trigger Chunking, Elasticsearch indexing, vector indexing, or Neo4j extraction.

## Error Handling and Consistency

The three stores do not share a distributed transaction. New code must persist in a recoverable order and clean up already-created resources when a later step fails.

Do not silently publish failed or pending parses. Preserve parser warnings and `parse_error` in the document record.

## Testing Expectations

Parser tests should be format-specific and use small fixtures. Test at least:

- Markdown output structure;
- worksheet and slide boundaries;
- table rendering and escaping;
- asset upload callback invocation;
- parser fallback behavior;
- parse failure state;
- document lifecycle transitions;
- cleanup behavior when one storage operation fails.

Run these checks before completing a change:

```bash
pnpm --filter @knowbase/api test
pnpm --filter @knowbase/api build
pnpm --filter @knowbase/web build
docker compose -f deploy/docker-compose.yml config
git diff --check
```

## Deferred Work

Do not add the following to the document module unless the relevant milestone is explicitly started:

- OCR for scanned PDFs;
- audio and video transcription;
- Chunking and retrieval indexes;
- Neo4j graph extraction;
- authentication and full RBAC enforcement;
- Mem0 long-term memory;
- Agentic RAG orchestration.

When these are added, consume the published-document boundary rather than coupling directly to parser internals.
