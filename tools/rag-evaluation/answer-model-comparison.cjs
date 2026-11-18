// Fixed-context generation comparison: no retrieval, label-dependent routing or fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const hash = (x) => createHash('sha256').update(x).digest('hex');

function caseItems(row, old, strategy) {
  assert.ok(
    ['rule_single', 'rule_multi', 'bge_multi'].includes(strategy),
    'unknown strategy',
  );
  const ids =
    strategy === 'rule_single'
      ? old.baseline_grounded
      : row.options[
          strategy === 'rule_multi' ? 'rule' : 'bge-m3-anchor2-model-order'
        ].selected;
  assert.equal(new Set(ids).size, ids.length, 'duplicate selected ID');
  const pool = new Map(row.pool.map((p) => [p.chunkId, p]));
  assert.equal(pool.size, row.pool.length, 'duplicate pool ID');
  return ids.map((id, i) => {
    assert.ok(pool.has(id), 'selected ID outside pool');
    return {
      ...pool.get(id),
      rerankScore: (ids.length - i) / (ids.length + 1),
    };
  });
}

async function measureAnswer(service, question) {
  const started = performance.now();
  try {
    const result = await service.answer({ question, topK: 5 });
    return {
      status: 'completed',
      result,
      elapsed_ms: performance.now() - started,
    };
  } catch {
    // A failed provider request is not an answer or a knowledge refusal.
    return {
      status: 'provider_error',
      result: null,
      elapsed_ms: performance.now() - started,
    };
  }
}

async function run(root, protocol, phase, output, modelName) {
  assert.ok(['development', 'validation'].includes(phase), 'invalid phase');
  for (const [file, digest] of Object.entries(protocol.files_sha256)) {
    assert.equal(hash(await fs.readFile(path.join(root, file))), digest, file);
  }
  const read = async (file) =>
    JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
  const original = await read(protocol.replay);
  const old = await read(protocol.single_replay);
  const queries = (await read(protocol.model_protocol)).queries;
  const api = createRequire(path.join(root, 'apps/api/package.json'));
  api('reflect-metadata');
  const { ChatOllama } = api('@langchain/ollama');
  const load = (file, name) =>
    require(path.join(root, 'apps/api/dist/src/modules/answer', file))[name];
  const AnswerService = load('answer.service.js', 'AnswerService');
  const AnswerGroundingService = load(
    'answer-grounding.service.js',
    'AnswerGroundingService',
  );
  const AnswerPromptService = load(
    'answer-prompt.service.js',
    'AnswerPromptService',
  );
  const AnswerCitationService = load(
    'answer-citation.service.js',
    'AnswerCitationService',
  );
  const observability = new Proxy({}, { get: () => () => ({}) });
  const tagsResponse = await fetch(protocol.endpoint + '/api/tags');
  assert.ok(tagsResponse.ok, 'model inventory unavailable');
  const tags = (await tagsResponse.json()).models;
  const models = modelName
    ? protocol.models.filter((m) => m.name === modelName)
    : protocol.models;
  assert.ok(models.length, 'model is not in frozen comparison');
  for (const model of models) {
    assert.equal(
      tags.find((t) => t.name === model.name)?.digest,
      model.digest,
      'model digest differs',
    );
  }
  const cases = protocol.cases.filter((c) => c.phase === phase);
  assert.ok(cases.length, 'empty phase');
  await fs.writeFile(output + '.partial.jsonl', '', { flag: 'wx' });
  const rows = [];
  // Keep each model loaded in turn. Never run chat and reranker inference together.
  for (const descriptor of models) {
    const chat = new ChatOllama({
      baseUrl: protocol.endpoint,
      model: descriptor.name,
      temperature: 0,
      seed: 42,
      numCtx: protocol.num_ctx,
      numPredict: protocol.num_predict,
    });
    for (const c of cases) {
      const source = original.sources.find((s) => s.id === c.source);
      const row = source.rows.find((r) => r.id === c.id);
      const archived = old.rows.find(
        (r) => r.source === c.source && r.id === c.id,
      );
      assert.ok(archived, 'missing archive');
      for (const strategy of protocol.strategies) {
        const items = caseItems(row, archived, strategy);
        let usage, metadata, promptSha, rawGeneration;
        const model = {
          generate: async (prompt) => {
            promptSha = hash(prompt);
            const response = await chat.invoke(prompt, {
              signal: AbortSignal.timeout(protocol.timeout_ms),
            });
            usage = response.usage_metadata;
            metadata = response.response_metadata;
            assert.equal(typeof response.content, 'string', 'non-text output');
            assert.equal(metadata.done, true, 'incomplete model response');
            rawGeneration = response.content;
            return response.content.trim();
          },
        };
        const service = new AnswerService(
          { retrieve: async () => ({ items, graphUsed: false }) },
          new AnswerPromptService(),
          model,
          new AnswerCitationService(),
          new AnswerGroundingService(),
          observability,
        );
        const measured = await measureAnswer(service, queries[c.source][c.id]);
        const record = {
          ...c,
          model: descriptor.name,
          strategy,
          prompt_sha256: promptSha,
          ...measured,
          usage,
          metadata,
          raw_generation: rawGeneration,
        };
        rows.push(record);
        // Retain a complete prefix if a later request fails; never report it as complete.
        await fs.appendFile(
          output + '.partial.jsonl',
          JSON.stringify(record) + '\n',
          { flag: 'a' },
        );
        console.log(
          JSON.stringify({
            completed: rows.length,
            model: descriptor.name,
            id: c.id,
            strategy,
            status: measured.status,
            answer: measured.result?.answer,
          }),
        );
      }
    }
  }
  await fs.writeFile(
    output,
    JSON.stringify({
      complete: true,
      failed_requests: rows.filter((r) => r.status === 'provider_error').length,
      phase,
      protocol_sha256: hash(JSON.stringify(protocol)),
      scope:
        'Actual local generation on exposed synthetic fixed contexts; not online retrieval or blind acceptance',
      rows,
    }) + '\n',
    { flag: 'wx' },
  );
}
if (require.main === module) {
  const [file, phase, output, modelName] = process.argv.slice(2);
  fs.readFile(file, 'utf8')
    .then((x) =>
      run(
        path.resolve(__dirname, '../..'),
        JSON.parse(x),
        phase,
        output,
        modelName,
      ),
    )
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
module.exports = { caseItems, measureAnswer, run };
