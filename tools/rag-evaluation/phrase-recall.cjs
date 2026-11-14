const path = require('node:path');
const { phraseMode, phraseRequest } = require('./phrase-match.cjs');

function createPhraseSearch(endpoint, mode, request = fetch) {
  phraseMode(mode);
  return async (input) => {
    const { index, ...body } = phraseRequest(input, mode);
    const response = await request(`${endpoint}/${index}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`Phrase index search failed: HTTP ${response.status}`);
    return response.json();
  };
}

// Isolated benchmark adapter only. Reuse the real generation reader and the
// real publication/version/ACL hydration; no new application endpoint or flag.
function createPhraseRecalls(app, modules, request = fetch) {
  const get = (file, name) => require(path.join(modules, file))[name];
  const RagQueryService = get(
    'modules/rag/rag-query.service.js',
    'RagQueryService',
  );
  const Reader = get(
    'modules/pipeline/vector-index/elasticsearch-chunk.reader.js',
    'ElasticsearchChunkReader',
  );
  const generations = app.get(
    get('modules/indexing/index-generation.store.js', 'IndexGenerationStore'),
  );
  const documents = app.get(
    get('modules/documents/document-query.service.js', 'DocumentQueryService'),
  );
  const services = new Map();
  return (mode) => {
    phraseMode(mode);
    if (!services.has(mode)) {
      const reader = new Reader(
        {
          search: createPhraseSearch(
            process.env.ELASTICSEARCH_NODE,
            mode,
            request,
          ),
        },
        process.env.ELASTICSEARCH_CHUNK_INDEX,
        // Corpus seeding already initialized the same schema; this adapter is read-only.
        { chunks: async () => {} },
        generations,
        'cjk',
        true,
        'body-reserve',
        2,
      );
      services.set(
        mode,
        new RagQueryService(
          undefined,
          { searchKeywordChunks: (input) => reader.keyword(input) },
          documents,
        ),
      );
    }
    return services.get(mode);
  };
}

module.exports = { createPhraseSearch, createPhraseRecalls };
