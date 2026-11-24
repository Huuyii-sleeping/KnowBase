import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { integerOption } from '../../ingestion/numeric-option';
import { Document } from '../entities/document.entity';
import { FileParserService } from '../parsing/file-parser.service';
import { ParseTaskStore } from './parse-task.store';
import { InvalidExtractionCheckpoint } from './parse-task.types';
import { ParseResultService } from './parse-result.service';
import { ParseCapacity } from './parse-capacity';

@Injectable()
export class ParseJobService {
  private readonly logger = new Logger(ParseJobService.name);
  private readonly maxBytes: number;
  private readonly capacity: ParseCapacity;
  constructor(
    private readonly source: DataSource,
    private readonly tasks: ParseTaskStore,
    private readonly parser: FileParserService,
    private readonly storage: StorageService,
    private readonly results: ParseResultService,
    config: ConfigService,
  ) {
    this.maxBytes = integerOption(
      config,
      'INGESTION_MAX_FILE_BYTES',
      104857600,
    );
    this.capacity = new ParseCapacity(
      integerOption(config, 'INGESTION_PARSE_CONCURRENCY', 1),
    );
  }

  async run(taskId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(taskId))
      throw new Error('Invalid parse task ID');
    return this.capacity.run(undefined, () => this.process(taskId));
  }

  private async process(taskId: string): Promise<void> {
    const task = await this.tasks.claim(taskId);
    if (!task) return;
    const abort = new AbortController();
    let heartbeat: Promise<void> | undefined;
    const timer = setInterval(
      () => {
        if (!heartbeat)
          heartbeat = this.tasks
            .heartbeat(task)
            .catch(() => abort.abort())
            .finally(() => {
              heartbeat = undefined;
            });
      },
      Math.floor(this.tasks.leaseMs / 3),
    );
    let stage = '';
    try {
      if (task.parser_config !== this.tasks.fingerprint)
        throw new Error(
          'Parse service configuration changed; submit a new parse task.',
        );
      const document = await this.source
        .getRepository(Document)
        .findOneBy({ id: task.document_id });
      if (
        !document ||
        document.version !== task.expected_version ||
        document.contentId !== task.expected_content_id
      )
        throw new Error('Superseded parse task');
      if (task.checkpoint_content_id) {
        await this.tasks.progress(task, 'restoring');
        const restored = await this.results.resume(task);
        abort.signal.throwIfAborted();
        await this.results.apply(task, restored);
        return;
      }
      const stream = await this.storage.getObject(task.storage_key);
      const buffers: Buffer[] = [];
      let bytes = 0;
      try {
        for await (const part of stream) {
          abort.signal.throwIfAborted();
          bytes += part.length;
          if (bytes > this.maxBytes)
            throw new Error('Original file exceeds byte budget');
          buffers.push(Buffer.from(part));
        }
      } finally {
        stream.destroy();
      }
      const result = await this.parser.parse(
        Buffer.concat(buffers),
        task.file_name,
        task.document_id,
        {
          signal: abort.signal,
          remoteTaskId: task.remote_task_id ?? undefined,
          onRemoteTask: (id) => this.tasks.remote(task, id),
          onAsset: (asset) => this.tasks.asset(task, asset),
          onStage: async (value) => {
            if (value !== stage) {
              stage = value;
              await this.tasks.progress(task, value);
            }
          },
        },
      );
      if (result.quality?.status === 'failed')
        throw new Error('Parser execution failed');
      abort.signal.throwIfAborted();
      await this.tasks.progress(task, 'checkpointing');
      await this.results.checkpoint(task, result);
      await this.tasks.progress(task, 'saving');
      await this.results.apply(task, result);
    } catch (error) {
      // Commit ambiguity is resolved by retry's authoritative task state under lock.
      await this.tasks.retry(
        task,
        error instanceof Error &&
          /MinerU (task failed|task canceled|HTTP 404|HTTP 410)/.test(
            error.message,
          ),
        error instanceof InvalidExtractionCheckpoint,
      );
      await this.results
        .discardIfUnreferenced(task)
        .catch(() =>
          this.logger.warn(`Deferred parse body cleanup: ${task.id}`),
        );
    } finally {
      clearInterval(timer);
      await heartbeat;
    }
  }
}
