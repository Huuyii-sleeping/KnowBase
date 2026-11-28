import { expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
vi.mock('../entities/document.entity', () => ({
  Document: class {},
  DocumentParseStatus: {},
}));
import { ParseTaskStore } from './parse-task.store';

it('document checkpoints ignore retired media configuration and track active XLS and vision settings', () => {
  const fingerprint = (settings: Record<string, string>) =>
    new ParseTaskStore({} as any, {} as any, new ConfigService(settings))
      .fingerprint;
  const baseline = fingerprint({});
  for (const settings of [
    { ASR_LANGUAGE: 'zh' },
    { ASR_HOTWORDS: '消息队列' },
    { MEDIA_PYTHON: '/obsolete/python', ASR_MODEL_PATH: '/obsolete/model' },
  ])
    expect(fingerprint(settings)).toBe(baseline);
  expect(fingerprint({ XLS_EVIDENCE_PYTHON: '/xls/python' })).not.toBe(
    baseline,
  );
  expect(fingerprint({ VISION_MODEL_REVISION: 'changed' })).not.toBe(baseline);
});
