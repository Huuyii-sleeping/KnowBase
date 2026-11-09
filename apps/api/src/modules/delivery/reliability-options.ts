import { ConfigService } from '@nestjs/config';

export function positiveInteger(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const value = Number(config.get<string | number>(key, fallback));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

export function retryDelay(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** Math.min(Math.max(attempt - 1, 0), 16), 60_000);
}
