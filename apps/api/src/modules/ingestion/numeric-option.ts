import { ConfigService } from '@nestjs/config';

export function integerOption(
  config: ConfigService,
  key: string,
  fallback: number,
  minimum = 1,
): number {
  const value = Number(config.get<string | number>(key, fallback));
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${key} must be an integer >= ${minimum}`);
  return value;
}
