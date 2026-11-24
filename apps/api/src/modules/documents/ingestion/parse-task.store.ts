import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { OutboxStore } from '../../delivery/outbox.store';
import { MESSAGE_ROUTING_KEYS } from '../../message-queue/message-queue.constants';
import { integerOption } from '../../ingestion/numeric-option';
import { Document, DocumentParseStatus } from '../entities/document.entity';
import { ParsedAsset } from '../parsing/file-parser.types';
import {
  DEFAULT_DOCUMENT_PARSER,
  DEFAULT_MINERU_BASE_URL,
  DEFAULT_MINERU_TIER,
} from '../parsing/parser-defaults';
import { ParseTask, ParseTaskSuperseded } from './parse-task.types';

@Injectable()
export class ParseTaskStore {
  readonly leaseMs: number;
  readonly fingerprint: string;
  private readonly maxAttempts: number;
  constructor(
    private readonly source: DataSource,
    private readonly outbox: OutboxStore,
    config: ConfigService,
  ) {
    this.fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          'evidence-pipeline-v6:xlsx-native-v1:html-native-v1:pdf-tables-v1:documents-only',
          ...[
            'XLS_EVIDENCE_PYTHON',
            'IMAGE_ANALYSIS_MODE',
            'VISION_BASE_URL',
            'VISION_MODEL',
            'VISION_MODEL_REVISION',
          ].map((key) => config.get(key, '')),
          config.get('DOCUMENT_PARSER', DEFAULT_DOCUMENT_PARSER),
          config.get('MINERU_BASE_URL', DEFAULT_MINERU_BASE_URL),
          config.get('MINERU_TIER', DEFAULT_MINERU_TIER),
        ]),
      )
      .digest('hex');
    this.leaseMs = integerOption(config, 'INGESTION_TASK_LEASE_MS', 120000);
    if (this.leaseMs < 3000)
      throw new Error('INGESTION_TASK_LEASE_MS must be at least 3000');
    this.maxAttempts = integerOption(config, 'INGESTION_TASK_MAX_ATTEMPTS', 3);
  }

  async create(
    manager: EntityManager,
    document: Document,
    requiresReview = false,
  ): Promise<string> {
    await this.invalidate(manager, document.id);
    const id = randomUUID();
    await manager.query(
      `INSERT INTO kh_document_parse_task
      (id, document_id, expected_version, expected_content_id, content_id, file_name, storage_key, parser_config, requires_review)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        document.id,
        document.version,
        document.contentId,
        randomUUID(),
        document.fileName,
        document.storageKey,
        this.fingerprint,
        requiresReview,
      ],
    );
    await this.dispatch(manager, id);
    return id;
  }

  private async dispatch(manager: EntityManager, taskId: string, delayMs = 0) {
    await this.outbox.schedule(
      manager,
      {
        eventId: randomUUID(),
        routingKey: MESSAGE_ROUTING_KEYS.PARSE,
        body: JSON.stringify({ type: 'DOCUMENT_PARSE', taskId }),
        attempt: 0,
      },
      delayMs,
    );
  }

  async invalidate(
    manager: EntityManager,
    documentId: string,
    state = 'stale',
  ): Promise<void> {
    const rows: ParseTask[] = await manager.query(
      `WITH changed AS (UPDATE kh_document_parse_task SET state=$2, stage=$2,
      finished_at=clock_timestamp(), updated_at=clock_timestamp(), lease_until=NULL
      WHERE document_id=$1 AND state IN ('queued','running','needs_review') RETURNING *) SELECT * FROM changed`,
      [documentId, state],
    );
    for (const task of rows) await this.discard(manager, task);
  }

  async claim(id: string): Promise<ParseTask | undefined> {
    const run = randomUUID();
    const rows = await this.source.query(
      `WITH changed AS (UPDATE kh_document_parse_task SET state='running', stage=CASE WHEN checkpoint_content_id IS NULL THEN 'reading' ELSE 'restoring' END, content_id=COALESCE(checkpoint_content_id,$4),
      content_ids=CASE WHEN checkpoint_content_id IS NULL THEN array_append(content_ids,$4::uuid) ELSE content_ids END,
      attempts=attempts+1, run_id=$2, updated_at=clock_timestamp(), lease_until=clock_timestamp()+$3*INTERVAL '1 millisecond'
      WHERE id=$1 AND state='queued' RETURNING *) SELECT * FROM changed`,
      [id, run, this.leaseMs, randomUUID()],
    );
    return rows[0];
  }

  async heartbeat(task: ParseTask): Promise<void> {
    const rows = await this.source.query(
      `WITH changed AS (UPDATE kh_document_parse_task SET lease_until=clock_timestamp()+$3*INTERVAL '1 millisecond',
      updated_at=clock_timestamp() WHERE id=$1 AND run_id=$2 AND state='running' RETURNING id) SELECT * FROM changed`,
      [task.id, task.run_id, this.leaseMs],
    );
    if (!rows.length) throw new ParseTaskSuperseded();
  }

  async checkpoint(task: ParseTask): Promise<void> {
    const rows = await this.source.query(
      `UPDATE kh_document_parse_task SET checkpoint_content_id=$3, stage='extracted', updated_at=clock_timestamp()
       WHERE id=$1 AND run_id=$2 AND state='running' AND content_id=$3 RETURNING id`,
      [task.id, task.run_id, task.content_id],
    );
    if (!rows.length) throw new ParseTaskSuperseded();
    task.checkpoint_content_id = task.content_id;
  }

  async progress(task: ParseTask, stage: string): Promise<void> {
    const rows = await this.source.query(
      `WITH changed AS (UPDATE kh_document_parse_task SET stage=$3, updated_at=clock_timestamp()
      WHERE id=$1 AND run_id=$2 AND state='running' RETURNING id) SELECT * FROM changed`,
      [task.id, task.run_id, stage],
    );
    if (!rows.length) throw new ParseTaskSuperseded();
  }

  async remote(task: ParseTask, id: string): Promise<void> {
    const rows = await this.source.query(
      `WITH changed AS (UPDATE kh_document_parse_task SET remote_task_id=$3
      WHERE id=$1 AND run_id=$2 AND state='running' RETURNING id) SELECT * FROM changed`,
      [task.id, task.run_id, id],
    );
    if (!rows.length) throw new ParseTaskSuperseded();
  }

  async asset(task: ParseTask, asset: ParsedAsset): Promise<void> {
    const rows = await this.source.query(
      `WITH changed AS (UPDATE kh_document_parse_task SET assets=assets || $3::jsonb
      WHERE id=$1 AND run_id=$2 AND state='running' RETURNING id) SELECT * FROM changed`,
      [task.id, task.run_id, JSON.stringify([asset])],
    );
    if (!rows.length) throw new ParseTaskSuperseded();
  }

  async latest(documentId: string): Promise<ParseTask | undefined> {
    return (
      await this.source.query(
        'SELECT * FROM kh_document_parse_task WHERE document_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1',
        [documentId],
      )
    )[0];
  }

  async find(id: string): Promise<ParseTask | undefined> {
    return (
      await this.source.query(
        'SELECT * FROM kh_document_parse_task WHERE id=$1',
        [id],
      )
    )[0];
  }

  async discard(manager: EntityManager, task: ParseTask): Promise<void> {
    if (task.assets.length)
      await this.outbox.enqueue(manager, MESSAGE_ROUTING_KEYS.ASSETS_DELETE, {
        type: 'DOCUMENT_ASSETS_DELETE',
        documentId: task.document_id,
        keys: task.assets.map((asset) => asset.objectKey),
      });
  }

  /** Lock document before task, matching revisions/deletion/finalization. */
  async retry(
    task: ParseTask,
    resetRemote = false,
    resetCheckpoint = false,
  ): Promise<void> {
    await this.source.transaction(async (manager) => {
      const document = await manager.findOne(Document, {
        where: { id: task.document_id },
        lock: { mode: 'pessimistic_write' },
      });
      const [current]: ParseTask[] = await manager.query(
        'SELECT * FROM kh_document_parse_task WHERE id=$1 FOR UPDATE',
        [task.id],
      );
      if (
        !current ||
        current.run_id !== task.run_id ||
        current.state !== 'running'
      )
        return;
      const published = document?.contentId === current.content_id;
      if (published) return;
      const stale =
        !document ||
        document.version !== task.expected_version ||
        document.contentId !== task.expected_content_id;
      const state = stale
        ? 'stale'
        : current.attempts >= this.maxAttempts
          ? 'failed'
          : 'queued';
      const keepCheckpoint =
        state === 'queued' &&
        !resetCheckpoint &&
        Boolean(current.checkpoint_content_id);
      if (!keepCheckpoint) await this.discard(manager, current);
      await manager.query(
        `UPDATE kh_document_parse_task SET state=$2, stage=$2, assets=CASE WHEN $4 THEN assets ELSE '[]'::jsonb END,
        checkpoint_content_id=CASE WHEN $4 THEN checkpoint_content_id ELSE NULL END,
        lease_until=NULL, run_id=NULL, error_code='PARSE_ATTEMPT_FAILED', remote_task_id=CASE WHEN $3 THEN NULL ELSE remote_task_id END,
        updated_at=clock_timestamp(), finished_at=CASE WHEN $2='queued' THEN NULL ELSE clock_timestamp() END WHERE id=$1`,
        [task.id, state, resetRemote, keepCheckpoint],
      );
      if (state === 'queued')
        await this.dispatch(
          manager,
          task.id,
          Math.min(30000, 1000 * current.attempts),
        );
      if (state === 'failed' && document && !current.requires_review) {
        document.parseStatus = DocumentParseStatus.FAILED;
        document.parseError =
          'Parsing failed after retries. Retry parsing or edit the content.';
        await manager.save(Document, document);
      }
    });
  }

  async recover(): Promise<void> {
    const expired: ParseTask[] = await this.source
      .query(`SELECT * FROM kh_document_parse_task
      WHERE state='running' AND lease_until < clock_timestamp() ORDER BY lease_until LIMIT 20`);
    for (const task of expired) {
      // retry rechecks the token under lock; a completed/canceled task is never revived.
      await this.retryExpired(task);
    }
  }

  private async retryExpired(task: ParseTask): Promise<void> {
    const rows = await this.source.query(
      `WITH changed AS (UPDATE kh_document_parse_task SET run_id=$2
      WHERE id=$1 AND state='running' AND run_id=$3 AND lease_until < clock_timestamp() RETURNING *) SELECT * FROM changed`,
      [task.id, randomUUID(), task.run_id],
    );
    if (rows.length) await this.retry(rows[0]);
  }
}
