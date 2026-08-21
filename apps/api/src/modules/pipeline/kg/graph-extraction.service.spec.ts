import { describe, expect, it, vi } from 'vitest';
import { GraphExtractionService } from './graph-extraction.service';

describe('GraphExtractionService', () => {
  it('normalizes and deduplicates entities and relations across chunks', async () => {
    const provider = {
      extract: vi.fn()
        .mockResolvedValueOnce({
          entities: [
            { name: 'KnowBase', type: '产品' },
            { name: 'Ollama', type: '技术' },
          ],
          relations: [{ source: 'KnowBase', target: 'Ollama', type: '使用' }],
        })
        .mockResolvedValueOnce({
          entities: [{ name: ' knowbase ', type: '产品' }, { name: 'RabbitMQ', type: '技术' }],
          relations: [
            { source: 'KnowBase', target: 'RabbitMQ', type: '使用' },
            { source: 'KnowBase', target: 'RabbitMQ', type: '使用' },
          ],
        }),
    };
    const service = new GraphExtractionService(provider as any);

    await expect(service.extract([
      { id: 'chunk-1', content: '# first' },
      { id: 'chunk-2', content: '# second' },
    ])).resolves.toEqual({
      entities: [
        { key: '产品:knowbase', name: 'KnowBase', type: '产品' },
        { key: '技术:ollama', name: 'Ollama', type: '技术' },
        { key: '技术:rabbitmq', name: 'RabbitMQ', type: '技术' },
      ],
      mentions: [
        { chunkId: 'chunk-1', entityKey: '产品:knowbase' },
        { chunkId: 'chunk-1', entityKey: '技术:ollama' },
        { chunkId: 'chunk-2', entityKey: '产品:knowbase' },
        { chunkId: 'chunk-2', entityKey: '技术:rabbitmq' },
      ],
      relations: [
        {
          key: 'chunk-1:产品:knowbase:技术:ollama:使用',
          source: 'KnowBase',
          target: 'Ollama',
          type: '使用',
          sourceKey: '产品:knowbase',
          targetKey: '技术:ollama',
          chunkId: 'chunk-1',
        },
        {
          key: 'chunk-2:产品:knowbase:技术:rabbitmq:使用',
          source: 'KnowBase',
          target: 'RabbitMQ',
          type: '使用',
          sourceKey: '产品:knowbase',
          targetKey: '技术:rabbitmq',
          chunkId: 'chunk-2',
        },
      ],
    });
  });

  it('creates unknown endpoint entities when a model relation omits them', async () => {
    const service = new GraphExtractionService({
      extract: vi.fn().mockResolvedValue({
        entities: [{ name: '平台', type: '产品' }],
        relations: [{ source: '平台', target: '未列出的系统', type: '依赖' }],
      }),
    } as any);

    const result = await service.extract([{ id: 'chunk-1', content: 'text' }]);

    expect(result.entities).toContainEqual({
      key: '未知:未列出的系统',
      name: '未列出的系统',
      type: '未知',
    });
    expect(result.relations).toHaveLength(1);
    expect(result.mentions).toContainEqual({
      chunkId: 'chunk-1',
      entityKey: '未知:未列出的系统',
    });
  });
});
