import { Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

const logger = new Logger('IngestionStage');

/** Logs identifiers and resource counts only; never logs source text or vectors. */
export async function ingestionStage<T>(
  stage: string,
  attributes: Record<string, string | number>,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const value = await work();
    logger.log(
      JSON.stringify({
        ...attributes,
        stage,
        status: 'completed',
        durationMs: performance.now() - start,
      }),
    );
    return value;
  } catch (error) {
    logger.warn(
      JSON.stringify({
        ...attributes,
        stage,
        status: 'failed',
        durationMs: performance.now() - start,
      }),
    );
    throw error;
  }
}
