import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_DOCUMENT_PARSER,
  DEFAULT_MINERU_BASE_URL,
  DEFAULT_MINERU_TIER,
} from '../parser-defaults';
import { integerOption } from '../../../ingestion/numeric-option';

export function mineruOptions(config: ConfigService) {
  const base = config
    .get<string>('MINERU_BASE_URL', DEFAULT_MINERU_BASE_URL)
    .trim();
  const tier = config.get<string>('MINERU_TIER', DEFAULT_MINERU_TIER);
  if (
    config.get<string>('DOCUMENT_PARSER', DEFAULT_DOCUMENT_PARSER) ===
      'mineru' &&
    !base
  )
    throw new Error('MINERU_BASE_URL is required when DOCUMENT_PARSER=mineru');
  if (!['flash', 'basic', 'standard', 'advanced'].includes(tier))
    throw new Error('Invalid MINERU_TIER');
  if (base) {
    const url = new URL(base);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid MINERU_BASE_URL');
  }
  return {
    base: base.replace(/\/$/, ''),
    tier,
    key: config.get<string>('MINERU_API_KEY', ''),
    timeout: integerOption(config, 'MINERU_TIMEOUT_MS', 600000),
    pollMs: integerOption(config, 'MINERU_POLL_MS', 1000),
    maxBytes: integerOption(config, 'MINERU_RESULT_MAX_BYTES', 67108864),
    maxPages: integerOption(config, 'INGESTION_MAX_PAGES', 1000),
    origins: config
      .get<string>('MINERU_TRANSFER_ORIGINS', '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  };
}
