const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

async function collectMetadata({
  directory,
  manifest,
  documents,
  environment,
  ollamaUrl,
  config,
}) {
  const hashes = await hashDataset(directory, manifest);
  const { stdout: commit } = await promisify(execFile)(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: root },
  );
  const { stdout: status } = await promisify(execFile)(
    'git',
    ['status', '--porcelain'],
    { cwd: root },
  );
  const modelResponse = await fetch(`${ollamaUrl}/api/tags`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!modelResponse.ok)
    throw new Error('Cannot inspect local embedding model metadata');
  const model = (await modelResponse.json()).models.find((item) =>
    ['nomic-embed-text', 'nomic-embed-text:latest'].includes(item.name),
  );
  if (!model)
    throw new Error(
      'nomic-embed-text must be installed in the selected Ollama server',
    );
  const chunkResponse = await fetch(
    `${environment.elasticsearchUrl}/kh_chunk/_count`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!chunkResponse.ok)
    throw new Error('Cannot inspect indexed benchmark chunk count');
  const chunkCount = (await chunkResponse.json()).count;
  return {
    dataset: manifest.version,
    started_at: new Date().toISOString(),
    api_git_commit: commit.trim(),
    working_tree_dirty: Boolean(status.trim()),
    document_count: documents.length,
    document_mapping: documents,
    indexed_chunk_count: chunkCount,
    question_count: JSON.parse(
      await fs.readFile(path.join(directory, 'questions.json'), 'utf8'),
    ).length,
    corpus_sha256: hashes,
    embedding_model: model.name,
    embedding_digest: model?.digest || null,
    embedding_encoding: config.encoding,
    keyword_analyzer: config.lexical,
    retrieval_context: config.context,
    keyword_policy: config.keywordPolicy,
    keyword_body_slots: config.bodySlots,
    keyword_policy_details: {
      weighted: 'best_fields body^2 vs retrieval_text, tie_breaker=0.1',
      'body-reserve': `${config.bodySlots} body slots then one context slot; dedup by chunk ID; up to 2x index reads, unchanged returned budget and native chosen-hit score`,
      combined:
        'existing contextual field only (original body field in body context mode)',
    }[config.keywordPolicy],
    dimensions: 768,
    chunk_size: 1000,
    chunk_overlap: 150,
    reranking: 'existing rule-based implementation; unchanged',
    hybrid_retrieval: require(
      path.join(root, 'apps/api/dist/src/modules/search/hybrid-candidates.js'),
    ).HYBRID_RETRIEVAL_POLICY,
    scope:
      'Isolated corpus; real HTTP API, auth, parsing, persistence, RabbitMQ, Elasticsearch and Ollama embeddings; only search and RAG workers; no graph or answer evaluation.',
    top_k: [1, 3, 5],
    modes: ['keyword', 'semantic', 'hybrid'],
    warmup:
      'One untimed request per mode after corpus indexing; one measured pass per mode/K.',
    ranking_unit:
      'Deduplicate the first API TopK candidates by document; no extra candidate fetch. Evidence checks inspect all returned TopK contents.',
  };
}

async function snapshotIndexedCorpus(environment, output, request = fetch) {
  const indexedResponse = await request(
    `${environment.elasticsearchUrl}/kh_chunk/_search`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        size: 10000,
        track_total_hits: true,
        _source: ['document_id', 'document_version', 'chunk_index', 'content'],
      }),
    },
  );
  if (!indexedResponse.ok)
    throw new Error(
      'Cannot inspect benchmark evidence in actual indexed chunks',
    );
  const indexed = await indexedResponse.json();
  if (indexed.hits.total.value > indexed.hits.hits.length)
    throw new Error('Indexed corpus snapshot truncated');
  await fs.writeFile(
    path.join(output, 'indexed-corpus.json'),
    JSON.stringify(
      indexed.hits.hits.map((hit) => ({
        id: hit._id,
        documentId: hit._source.document_id,
        content: hit._source.content,
      })),
    ) + '\n',
  );
}

async function hashDataset(directory, manifest) {
  const files = [
    'manifest.json',
    'questions.json',
    ...(await fs.access(path.join(directory, 'protocol.json')).then(
      () => ['protocol.json'],
      (error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    )),
    ...manifest.documents.map((item) => `docs/${item.file}`),
  ];
  const hashes = {};
  for (const file of files)
    hashes[file] = createHash('sha256')
      .update(await fs.readFile(path.join(directory, file)))
      .digest('hex');
  return hashes;
}

module.exports = { collectMetadata, snapshotIndexedCorpus, hashDataset };
