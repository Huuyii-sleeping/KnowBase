import { describe, expect, it, vi } from 'vitest';
import { SearchQueryService } from './search-query.service';

describe('SearchQueryService', () => {
  it('normalizes search inputs before querying the index', async () => {
    const searchDocuments = vi.fn().mockResolvedValue({
      items: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });
    const service = new SearchQueryService({ searchDocuments } as any, undefined);

    await service.searchDocuments({
      keyword: '  RabbitMQ  ',
      category: '  platform ',
      team: ' ',
      tag: undefined,
      page: 2,
      pageSize: 10,
    });

    expect(searchDocuments).toHaveBeenCalledWith({
      keyword: 'RabbitMQ',
      category: 'platform',
      team: undefined,
      tag: undefined,
      page: 2,
      pageSize: 10,
    });
  });
});
