const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const {
  AcceptanceEnvironment,
  eventually,
  root,
} = require('../acceptance/environment.cjs');
const { httpClient } = require('../acceptance/http.cjs');
const { drain, cleanup } = require('../capacity/workload.cjs');
const { fingerprint, gitState } = require('../complex-quality/trace.cjs');
async function run() {
  const output = path.resolve(
    process.env.COMBINED_OUTPUT || 'reports/ingestion-integration/combined',
  );
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const env = new AcceptanceEnvironment();
  env.events = [];
  env.applicationEnvironment = {
    DOCUMENT_PARSER: 'native',
    CHAT_MODEL_PROVIDER: 'ollama',
    OLLAMA_CHAT_MODEL: 'qwen2.5:7b',
    RAG_RERANKER: 'rule',
    RAG_RETRIEVAL_CONTEXT: 'title-heading',
    RAG_KEYWORD_ANALYZER: 'cjk',
    RAG_CHUNK_SIZE: '256',
    RAG_CHUNK_OVERLAP: '20',
    EMBEDDING_DOCUMENT_PREFIX: 'search_document: ',
    EMBEDDING_QUERY_PREFIX: 'search_query: ',
    EMBEDDING_MODEL_REVISION:
      'sha256:0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f',
    OLLAMA_KG_MODEL_REVISION:
      'sha256:a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67',
  };
  const report = {
    schema: 'ingestion-main-integration-v1',
    createdAt: new Date().toISOString(),
    git: gitState(),
    source: await fingerprint(path.join(root, 'apps/api/src')),
    tools: await fingerprint(__dirname),
    status: 'running',
    cases: [],
    scope:
      'Real Ollama 768d query/document encoders with task prefixes, local 7b answer provider, rule rerank; not DeepSeek or real BGE quality validation.',
  };
  const docs = [];
  try {
    const tags = await (await fetch('http://127.0.0.1:11434/api/tags')).json();
    report.models = tags.models
      .filter((m) =>
        ['nomic-embed-text:latest', 'qwen2.5:0.5b', 'qwen2.5:7b'].includes(
          m.name,
        ),
      )
      .map(({ name, digest }) => ({ name, digest }));
    assert.equal(
      report.models.find((m) => m.name === 'nomic-embed-text:latest')?.digest,
      env.applicationEnvironment.EMBEDDING_MODEL_REVISION.replace(
        'sha256:',
        '',
      ),
    );
    await env.start(output);
    const actors = {};
    for (const role of ['owner', 'reader', 'admin', 'outsider']) {
      const auth = await httpClient(env.baseUrl, null, env.events)(
        'POST',
        '/auth/login',
        { username: 'acceptance-' + role, password: env.password },
        201,
      );
      actors[role] = httpClient(env.baseUrl, auth.accessToken, env.events);
    }
    const markdown =
      '# 项目规则\n\n审批窗口\n---\n\n审批额度为731件。\n\n## 审批费用\n\n| 部门 | 额度 |\n| --- | --- |\n| 研究组 | 731 |\n| 财务组 | 180 |\n\n' +
      '附件登记与审批记录须保留。'.repeat(60);
    for (const visibility of ['TEAM', 'PRIVATE']) {
      const data = new FormData();
      data.set('file', new Blob([markdown]), 'evidence.md');
      data.set(
        'title',
        visibility === 'TEAM' ? '集成采购准入' : '私有审计账本',
      );
      data.set('team', 'quality');
      data.set('visibility', visibility);
      const created = await actors.owner('POST', '/documents', data, 201);
      docs.push(created);
      let doc;
      await eventually(async () => {
        doc = await actors.owner('GET', '/documents/' + created.id);
        return doc.parseStatus === 'READY' && doc.content;
      }, 'combined native body');
      await actors.owner(
        'POST',
        '/documents/' + doc.id + '/submit-review',
        {},
        201,
      );
      await actors.admin(
        'POST',
        '/documents/' + doc.id + '/review',
        { approved: true },
        201,
      );
      await eventually(
        async () => {
          const heads = await env.source.query(
            'SELECT * FROM kh_index_head WHERE document_id=$1',
            [doc.id],
          );
          return (
            heads.length === 3 &&
            heads.every(
              (h) => h.generation && !h.deleted && h.version === doc.version,
            )
          );
        },
        'combined generation',
        120000,
      );
      const indexed = await env.elastic.search({
        index: 'acceptance_chunks',
        size: 1000,
        query: { term: { document_id: doc.id } },
      });
      const artifacts = await env.db
        .collection('ingestion_chunks')
        .find({ documentId: doc.id, index: { $gte: 0 } })
        .sort({ index: 1 })
        .toArray();
      assert.equal(indexed.hits.hits.length, artifacts.length);
      for (const hit of indexed.hits.hits) {
        const chunk = artifacts[hit._source.chunk_index].chunk;
        assert.equal(hit._source.content, chunk.content);
        assert.deepEqual(hit._source.ingestion.ranges, chunk.ranges);
        assert.equal(hit._source.ingestion.contentHash, chunk.contentHash);
        assert.ok(hit._source.ingestion.strategy.startsWith('structure-v5:'));
        assert.ok(hit._source.retrieval_text.includes(doc.title));
        assert.ok(!hit._source.content.includes(doc.title));
      }
      const cacheBefore = await env.db
        .collection('ingestion_embeddings')
        .countDocuments({ documentId: doc.id });
      assert.ok(cacheBefore > 0);
      const before = await env.source.query(
        'SELECT generation FROM kh_index_head WHERE document_id=$1',
        [doc.id],
      );
      await actors.admin(
        'POST',
        '/documents/' + doc.id + '/rebuild-indexes',
        {},
        202,
      );
      await eventually(
        async () => {
          const heads = await env.source.query(
            'SELECT generation FROM kh_index_head WHERE document_id=$1',
            [doc.id],
          );
          return (
            heads.length === 3 &&
            heads.every(
              (h) => !before.some((old) => old.generation === h.generation),
            )
          );
        },
        'combined cached rebuild',
        120000,
      );
      assert.equal(
        await env.db
          .collection('ingestion_embeddings')
          .countDocuments({ documentId: doc.id }),
        cacheBefore,
      );
      const semantic = await actors.reader(
        'POST',
        '/search/semantic',
        { query: '审批额度731件', topK: 20 },
        201,
      );
      const hybrid = await actors.reader(
        'POST',
        '/search/hybrid',
        { query: doc.title + ' 审批额度', topK: 10 },
        201,
      );
      const publicExpected = visibility === 'TEAM';
      assert.equal(
        semantic.items.some((i) => i.documentId === doc.id),
        publicExpected,
      );
      assert.equal(
        hybrid.items.some((i) => i.documentId === doc.id),
        publicExpected,
      );
      if (publicExpected) {
        const evidence = semantic.items.filter((i) => i.documentId === doc.id);
        assert.ok(evidence.some((i) => i.content.includes('731')));
        assert.ok(evidence.every((i) => !i.content.includes(doc.title)));
        const outsider = await actors.outsider(
          'POST',
          '/search/hybrid',
          { query: doc.title, topK: 10 },
          201,
        );
        assert.ok(!outsider.items.some((i) => i.documentId === doc.id));
      }
      report.cases.push({
        visibility,
        documentId: doc.id,
        chunks: artifacts.length,
        bodyAndSourceMetadataPreserved: true,
        retrievalTextSeparate: true,
        cacheEntries: cacheBefore,
        taskPrefixes: true,
        cachedRebuild: true,
        semanticAndHybridAcl: true,
      });
    }
    const empty = await actors.outsider(
      'POST',
      '/rag/answer',
      { question: '研究组审批额度是多少？', topK: 5 },
      201,
    );
    assert.equal(empty.status, 'insufficient');
    assert.deepEqual(empty.citations, []);
    assert.deepEqual(empty.contexts, []);
    report.unauthorizedAnswer = {
      status: empty.status,
      citations: 0,
      contexts: 0,
    };
    const answer = await actors.reader(
      'POST',
      '/rag/answer',
      { question: '审批额度为多少件？', topK: 5 },
      201,
    );
    assert.equal(answer.status, 'answered');
    assert.ok(
      answer.answer.includes('731'),
      'The known sentinel fact must reach the generated answer',
    );
    if (answer.status === 'answered') {
      assert.ok(answer.citations.length);
      assert.ok(answer.contexts.every((c) => c.documentId === docs[0].id));
      assert.ok(
        answer.contexts.every(
          (c) => c.content && !c.content.includes('集成采购准入'),
        ),
      );
    } else {
      assert.deepEqual(answer.citations, []);
      assert.deepEqual(answer.contexts, []);
    }
    report.localAnswer = {
      status: answer.status,
      answer: answer.answer,
      citations: answer.citations.length,
      contexts: answer.contexts.length,
      scope: 'protocol/ACL smoke only; no answer accuracy claim',
    };
    await drain(env);
    const log = await readFile(path.join(output, 'api.log'), 'utf8');
    const misses = [
      ...log.matchAll(
        /\{"documentId":"[^"]+","stage":"embedding.cache"[^\n]+/g,
      ),
    ].map((m) => JSON.parse(m[0].replace(/\x1b\[[0-9;]*m/g, '')));
    assert.ok(misses.filter((m) => m.misses === 0 && m.hits > 0).length >= 2);
    report.cacheHitRebuilds = misses.filter(
      (m) => m.misses === 0 && m.hits > 0,
    ).length;
    await cleanup(env, actors.owner, docs);
    report.cleanup = true;
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    throw error;
  } finally {
    try {
      await env.close();
      report.isolatedServicesRemoved = true;
    } finally {
      await writeFile(
        path.join(output, 'report.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
    }
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
