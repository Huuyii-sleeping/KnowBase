import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
vi.mock('../entities/document.entity', () => ({
  Document: class {},
  DocumentParseStatus: { READY: 'READY', FAILED: 'FAILED' },
}));
import { ParseJobService } from './parse-job.service';
import { ParseResultService } from './parse-result.service';

function fixture() {
  const task = {
    id: '00000000-0000-0000-0000-000000000001',
    document_id: 'doc',
    expected_version: 1,
    expected_content_id: 'old',
    content_id: 'new',
    run_id: 'run',
    remote_task_id: 'remote',
  };
  const source = {
    getRepository: () => ({
      findOneBy: vi.fn(async () => ({ version: 1, contentId: 'old' })),
    }),
  };
  const tasks = {
    leaseMs: 120000,
    claim: vi.fn(async () => task),
    heartbeat: vi.fn(),
    retry: vi.fn(),
    progress: vi.fn(),
    asset: vi.fn(),
    remote: vi.fn(),
    checkpoint: vi.fn(),
    find: vi.fn(),
  };
  const parser = {
    parse: vi.fn(async () => ({
      markdown: '正文',
      ready: true,
      parser: 'test',
      assets: [],
      warnings: [],
    })),
  };
  const storage = {
    getObject: vi.fn(async () => Readable.from([Buffer.from('original')])),
  };
  const results = {
    apply: vi.fn(),
    checkpoint: vi.fn(),
    resume: vi.fn(),
    discardIfUnreferenced: vi.fn(async () => undefined),
  };
  return {
    task,
    source,
    tasks,
    parser,
    storage,
    results,
    service: new ParseJobService(
      source as any,
      tasks as any,
      parser as any,
      storage as any,
      results as any,
      new ConfigService(),
    ),
  };
}
describe('Parse job workflow', () => {
  it('resumes remote work and publishes the result through its fenced application service', async () => {
    const f = fixture();
    await f.service.run(f.task.id);
    expect(f.parser.parse).toHaveBeenCalledWith(
      Buffer.from('original'),
      undefined,
      'doc',
      expect.objectContaining({ remoteTaskId: 'remote' }),
    );
    expect(f.results.apply).toHaveBeenCalledOnce();
    expect(f.tasks.retry).not.toHaveBeenCalled();
  });
  it('leaves duplicate claims alone and schedules durable retry after provider failure', async () => {
    const f = fixture();
    f.tasks.claim.mockResolvedValueOnce(undefined as any);
    await f.service.run(f.task.id);
    expect(f.storage.getObject).not.toHaveBeenCalled();
    f.parser.parse.mockRejectedValueOnce(new Error('MinerU task failed'));
    await f.service.run(f.task.id);
    expect(f.tasks.retry).toHaveBeenCalledWith(f.task, true, false);
    expect(f.results.discardIfUnreferenced).toHaveBeenCalledWith(f.task);
  });
  it('rejects oversized originals and invalid command IDs', async () => {
    const f = fixture();
    const limited = new ParseJobService(
      f.source as any,
      f.tasks as any,
      f.parser as any,
      f.storage as any,
      f.results as any,
      new ConfigService({ INGESTION_MAX_FILE_BYTES: 2 }),
    );
    await limited.run(f.task.id);
    expect(f.parser.parse).not.toHaveBeenCalled();
    expect(f.tasks.retry).toHaveBeenCalledOnce();
    await expect(limited.run('bad')).rejects.toThrow('task ID');
  });
});

describe('Parse result publication', () => {
  it('refuses to replace an edited document and removes only an unreferenced attempt body', async () => {
    const f = fixture();
    const manager = {
      findOne: vi.fn(async () => ({ version: 2, contentId: 'edited' })),
      query: vi.fn(async () => [{ state: 'running', run_id: 'run' }]),
      save: vi.fn(),
    };
    const source = {
      transaction: async (work) => work(manager),
      getRepository: () => ({
        findOneBy: async () => ({ contentId: 'edited' }),
      }),
    };
    const content = {
      create: vi.fn(),
      verifyEvidence: vi.fn(),
      deleteByContentId: vi.fn(),
    };
    const service = new ParseResultService(
      source as any,
      content as any,
      f.tasks as any,
    );
    await expect(
      service.apply(f.task as any, {
        markdown: 'stale',
        ready: true,
        assets: [],
        parser: 'test',
        warnings: [],
      }),
    ).rejects.toThrow('no longer owns');
    expect(manager.save).not.toHaveBeenCalled();
    await service.discardIfUnreferenced(f.task as any);
    expect(content.deleteByContentId).toHaveBeenCalledWith('new');
  });
  it('preserves an adopted body after an uncertain commit', async () => {
    const source = {
      getRepository: () => ({ findOneBy: async () => ({ contentId: 'new' }) }),
    };
    const content = { deleteByContentId: vi.fn() };
    await new ParseResultService(
      source as any,
      content as any,
      {} as any,
    ).discardIfUnreferenced({ document_id: 'doc', content_id: 'new' } as any);
    expect(content.deleteByContentId).not.toHaveBeenCalled();
  });
});
