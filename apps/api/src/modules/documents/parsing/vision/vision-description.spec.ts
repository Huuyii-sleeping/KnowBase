import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  VisionDescriptionAdapter,
  validateVisualDescription,
} from './vision-description.adapter';
import { ImageSemanticEnricher } from './image-semantic-enricher';
afterEach(() => vi.unstubAllGlobals());
const description = {
  description: '流程从审核到发布',
  facts: ['审核', '发布'],
  relations: [{ from: '审核', to: '发布', relation: '通过后' }],
  uncertain: [],
};
const fixture = () =>
  ({
    markdown: '原始OCR',
    ready: true,
    parser: 'mineru',
    assets: [],
    warnings: [],
    evidence: [
      {
        schema: 'evidence-v1',
        id: 'image-1',
        kind: 'image',
        source: { page: 2 },
        objectKeys: ['assets/doc/img'],
        text: '审核 发布',
        producer: 'mineru',
        data: { semanticAnalysis: 'not_requested' },
      },
    ],
  }) as any;
describe('image semantic evidence', () => {
  it('reuses identical image bytes within a document while keeping separate source evidence', async () => {
    const adapter = {
      requested: true,
      revision: 'fixed',
      describe: vi.fn(async () => description),
    };
    const result = fixture();
    result.evidence.push({
      ...structuredClone(result.evidence[0]),
      id: 'image-2',
      source: { page: 3 },
      objectKeys: ['assets/doc/duplicate'],
    });
    await new ImageSemanticEnricher(adapter as any).enrich(
      result,
      new Map([
        [
          'assets/doc/img',
          { bytes: Buffer.from('same pixels'), mime: 'image/png' },
        ],
        [
          'assets/doc/duplicate',
          { bytes: Buffer.from('same pixels'), mime: 'image/png' },
        ],
      ]),
    );
    expect(adapter.describe).toHaveBeenCalledTimes(1);
    expect(result.evidence.slice(2).map((unit) => unit.source.page)).toEqual([
      2, 3,
    ]);
    expect(result.evidence[2].data.inputSha256).toBe(
      result.evidence[3].data.inputSha256,
    );
    const other = fixture();
    await new ImageSemanticEnricher(adapter as any).enrich(
      other,
      new Map([
        [
          'assets/doc/img',
          { bytes: Buffer.from('same pixels'), mime: 'image/png' },
        ],
      ]),
    );
    expect(adapter.describe).toHaveBeenCalledTimes(2);
  });
  it('keeps the unique-image budget and does not repeatedly call a failed provider for duplicate images', async () => {
    const adapter = {
      requested: true,
      revision: 'fixed',
      describe: vi.fn(async () => {
        throw new Error('failed provider');
      }),
    };
    const result = fixture();
    result.evidence.push({
      ...structuredClone(result.evidence[0]),
      id: 'image-2',
    });
    await new ImageSemanticEnricher(adapter as any).enrich(
      result,
      new Map([
        ['assets/doc/img', { bytes: Buffer.from('same'), mime: 'image/png' }],
      ]),
    );
    expect(adapter.describe).toHaveBeenCalledTimes(1);
    expect(
      result.quality.issues.filter(
        (issue) => issue.code === 'IMAGE_DESCRIPTION_FAILED',
      ),
    ).toHaveLength(2);
    expect(result.evidence).toHaveLength(2);
    const budget = fixture();
    budget.evidence = Array.from({ length: 14 }, (_, index) => ({
      ...structuredClone(budget.evidence[0]),
      id: `image-${index}`,
      objectKeys: [`assets/doc/${index}`],
    }));
    const inputs = new Map(
      Array.from({ length: 14 }, (_, index) => [
        `assets/doc/${index}`,
        {
          bytes: Buffer.from(String(index === 13 ? 0 : index)),
          mime: 'image/png',
        },
      ]),
    );
    const successAdapter = {
      ...adapter,
      describe: vi.fn(async () => description),
    };
    await new ImageSemanticEnricher(successAdapter as any).enrich(
      budget,
      inputs,
    );
    expect(successAdapter.describe).toHaveBeenCalledTimes(12);
    expect(
      budget.evidence.filter(
        (unit) => unit.data.representation === 'visual_description',
      ),
    ).toHaveLength(13);
    expect(
      budget.quality.issues.filter(
        (issue) => issue.code === 'IMAGE_DESCRIPTION_MISSING',
      ),
    ).toHaveLength(1);
  });
  it('keeps source OCR intact and writes separately traceable descriptions requiring review', async () => {
    const adapter = {
      requested: true,
      revision: 'fixed-sha',
      describe: vi.fn(async () => description),
    };
    const result = fixture();
    const original = structuredClone(result.evidence[0]);
    await new ImageSemanticEnricher(adapter as any).enrich(
      result,
      new Map([
        ['assets/doc/img', { bytes: Buffer.from('image'), mime: 'image/png' }],
      ]),
    );
    expect(result.evidence[0]).toEqual(original);
    expect(result.evidence[1]).toMatchObject({
      source: { page: 2 },
      producer: 'vision:fixed-sha',
      data: {
        representation: 'visual_description',
        review: 'needs_review',
        inputEvidenceId: 'image-1',
      },
    });
    expect(result.markdown).toContain('审核 → 发布: 通过后');
    expect(result.ready).toBe(false);
  });
  it('retains original evidence after provider failures and enforces response structure', async () => {
    const result = fixture();
    await new ImageSemanticEnricher({
      requested: true,
      describe: vi.fn(async () => {
        throw new Error('secret');
      }),
    } as any).enrich(
      result,
      new Map([
        ['assets/doc/img', { bytes: Buffer.from('image'), mime: 'image/png' }],
      ]),
    );
    expect(result.markdown).toBe('原始OCR');
    expect(result.evidence.length).toBe(1);
    expect(result.quality.issues[0].code).toBe('IMAGE_DESCRIPTION_FAILED');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(() =>
      validateVisualDescription({
        ...description,
        relations: [{ from: 'a' }],
      } as any),
    ).toThrow('Invalid');
    expect(() =>
      validateVisualDescription({ ...description, facts: [''] }),
    ).toThrow('Invalid');
  });
  it('uses the image input on the configured provider and stores no credentials in the result', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: JSON.stringify(description) } }],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const adapter = new VisionDescriptionAdapter(
      new ConfigService({
        IMAGE_ANALYSIS_MODE: 'describe',
        VISION_BASE_URL: 'http://vision/v1',
        VISION_MODEL: 'visual-model',
        VISION_MODEL_REVISION: 'sha256:revision',
        VISION_API_KEY: 'provider-secret',
      }),
    );
    expect(await adapter.describe(Buffer.from('pixels'), 'image/png')).toEqual(
      description,
    );
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.messages[1].content[0].image_url.url).toBe(
      'data:image/png;base64,cGl4ZWxz',
    );
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    await expect(
      new VisionDescriptionAdapter(new ConfigService()).describe(
        Buffer.from('image'),
        'image/png',
      ),
    ).rejects.toThrow('fixed revision');
  });
});
