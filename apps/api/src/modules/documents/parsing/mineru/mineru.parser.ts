import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'node:path';
import { FileParserContext, FormatParser } from '../file-parser.types';
import { mineruOptions } from './mineru-options';
import { MineruHttp } from './mineru-http';
import { mineruArchive } from './mineru-archive';
import { mineruResult } from './mineru-result';
import { MINERU_FLASH_EXTENSIONS } from './mineru-formats';
import { restoreHtmlTables } from '../html/html-table-restorer';

@Injectable()
export class MineruParser implements FormatParser {
  private readonly options;
  private readonly http: MineruHttp;
  constructor(config: ConfigService) {
    this.options = mineruOptions(config);
    this.http = new MineruHttp(this.options);
  }

  async cancel(taskId: string): Promise<void> {
    try {
      await this.http.json(
        `/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
        { method: 'POST' },
        AbortSignal.timeout(10000),
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/^MinerU HTTP (404|409)$/.test(error.message)
      )
        throw error;
    }
  }

  async parse(buffer: Buffer, fileName: string, context: FileParserContext) {
    if (!this.options.base) throw new Error('MINERU_BASE_URL is required');
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.options.timeout),
      ...(context.execution?.signal ? [context.execution.signal] : []),
    ]);
    let taskId = context.execution?.remoteTaskId;
    let created: any;
    if (!taskId) {
      await context.execution?.onStage?.('submitting');
      const tier = MINERU_FLASH_EXTENSIONS.has(extname(fileName).toLowerCase())
        ? 'flash'
        : this.options.tier;
      created = await this.http.json(
        '/v1/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: [{ file_name: fileName, bytes: buffer.length }],
            tier,
            ocr_mode: 'auto',
            output_formats: ['default'],
          }),
        },
        signal,
      );
      if (
        typeof created.task_id !== 'string' ||
        !created.task_id ||
        !Array.isArray(created.files) ||
        created.files.length !== 1
      )
        throw new Error('Invalid MinerU create response');
      taskId = created.task_id;
      // Persist before upload; a retry can resume an already accepted task.
      await context.execution?.onRemoteTask?.(taskId!);
    }
    const snapshot =
      created ??
      (await this.http.json(
        `/v1/tasks/${encodeURIComponent(taskId!)}`,
        {},
        signal,
      ));
    const file = snapshot.files?.[0];
    if (snapshot.files?.length !== 1)
      throw new Error('Invalid MinerU task file count');
    if (file?.status === 'waiting-file' && file.upload) {
      if (typeof file.upload.url !== 'string')
        throw new Error('Invalid MinerU upload URL');
      await context.execution?.onStage?.('uploading');
      await this.http.request(
        file.upload.url,
        {
          method: 'PUT',
          headers: file.upload.headers ?? {},
          body: new Uint8Array(buffer),
        },
        signal,
        2 * 1024 * 1024,
      );
    }
    const archive = await this.http.result(
      taskId!,
      signal,
      context.execution?.onStage,
    );
    await context.execution?.onStage?.('normalizing');
    const result = await mineruResult(
      await mineruArchive(archive, this.options.maxBytes),
      fileName,
      context,
      this.options.maxPages,
    );
    if (['.html', '.htm'].includes(extname(fileName).toLowerCase()))
      restoreHtmlTables(result, buffer);
    return result;
  }
}
