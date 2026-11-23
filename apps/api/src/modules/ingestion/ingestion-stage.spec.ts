import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ingestionStage } from './ingestion-stage';

describe('ingestion stage observations', () => {
  it('records duration and status without logging the result or error content', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    expect(
      await ingestionStage(
        'parse',
        { documentId: 'doc' },
        async () => 'private source',
      ),
    ).toBe('private source');
    const error = new Error('sensitive provider response');
    await expect(
      ingestionStage('embedding', { documentId: 'doc' }, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      stage: 'parse',
      status: 'completed',
      durationMs: expect.any(Number),
    });
    expect(JSON.parse(warn.mock.calls[0][0])).toMatchObject({
      stage: 'embedding',
      status: 'failed',
    });
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toMatch(
      /private|sensitive/,
    );
    log.mockRestore();
    warn.mockRestore();
  });
});
