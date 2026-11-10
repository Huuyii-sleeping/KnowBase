const fs = require('node:fs/promises');
const path = require('node:path');
const { eventually } = require('../../apps/api/test/delivery/environment.cjs');

class BenchmarkApiClient {
  constructor(baseUrl, request = fetch) {
    this.baseUrl = baseUrl;
    this.fetch = request;
  }

  async request(route, { method = 'GET', body, status = 200 } = {}) {
    const headers = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart)
      headers['content-type'] = 'application/json';
    const response = await this.fetch(this.baseUrl + route, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : multipart
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (response.status !== status)
      throw new Error(
        `${method} ${route} returned HTTP ${response.status}, expected ${status}`,
      );
    return response.status === 204 ? undefined : response.json();
  }

  async login() {
    const result = await this.request('/auth/login', {
      method: 'POST',
      status: 201,
      body: { username: 'admin', password: 'knowbase-admin' },
    });
    if (!result.accessToken)
      throw new Error('Benchmark login did not return a token');
    this.token = result.accessToken;
    this.user = result.user;
  }
}

async function seedCorpus(
  client,
  source,
  directory,
  manifest,
  wait = eventually,
) {
  const documents = [];
  for (const entry of manifest.documents) {
    const form = new FormData();
    form.set(
      'file',
      new Blob([await fs.readFile(path.join(directory, 'docs', entry.file))], {
        type: 'text/markdown',
      }),
      entry.file,
    );
    form.set('title', entry.title);
    form.set('visibility', 'PUBLIC');
    const created = await client.request('/documents', {
      method: 'POST',
      body: form,
      status: 201,
    });
    if (created.parseStatus !== 'READY')
      throw new Error(`Corpus parsing failed: ${entry.file}`);
    await client.request(`/documents/${created.id}/submit-review`, {
      method: 'POST',
      status: 201,
    });
    await client.request(`/documents/${created.id}/review`, {
      method: 'POST',
      body: { approved: true },
      status: 201,
    });
    documents.push({ file: entry.file, id: created.id });
  }
  await wait(
    async () => {
      const rows = await source.query(
        `SELECT h.document_id,h.pipeline FROM kh_index_head h JOIN kh_document d ON d.id=h.document_id
      WHERE h.pipeline IN ('search','rag') AND NOT h.deleted AND h.generation IS NOT NULL
        AND d.status='PUBLISHED' AND d.version=h.version AND h.document_id=ANY($1::uuid[])`,
        [documents.map((document) => document.id)],
      );
      return rows.length === documents.length * 2;
    },
    'all benchmark search and RAG generations active',
    180000,
  );
  return documents;
}

module.exports = { BenchmarkApiClient, seedCorpus };
