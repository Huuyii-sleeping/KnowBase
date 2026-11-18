// Real local answer generation on fixed retrieval contexts; not online retrieval.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const hash = (x) => createHash("sha256").update(x).digest("hex");

async function run(root, protocol, output) {
  for (const [file, digest] of Object.entries(protocol.files_sha256)) {
    assert.equal(hash(await fs.readFile(path.join(root, file))), digest, file);
  }
  const read = async (file) =>
    JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
  const original = await read(protocol.replay);
  const single = await read(protocol.single_replay);
  const queries = (await read(protocol.model_protocol)).queries;
  const api = createRequire(path.join(root, "apps/api/package.json"));
  api("reflect-metadata");
  const { ConfigService } = api("@nestjs/config");
  const load = (file, name) =>
    require(path.join(root, "apps/api/dist/src/modules/answer", file))[name];
  const AnswerService = load("answer.service.js", "AnswerService");
  const AnswerGroundingService = load(
    "answer-grounding.service.js",
    "AnswerGroundingService",
  );
  const AnswerPromptService = load(
    "answer-prompt.service.js",
    "AnswerPromptService",
  );
  const AnswerCitationService = load(
    "answer-citation.service.js",
    "AnswerCitationService",
  );
  const ChatModelService = load("chat-model.service.js", "ChatModelService");
  const chat = new ChatModelService(new ConfigService(protocol.chat_config));
  const observability = new Proxy({}, { get: () => () => ({}) });
  const rows = [];
  for (const c of protocol.cases) {
    const source = original.sources.find((s) => s.id === c.source);
    const row = source.rows.find((r) => r.id === c.id);
    const old = single.rows.find((r) => r.source === c.source && r.id === c.id);
    const pool = new Map(row.pool.map((p) => [p.chunkId, p]));
    for (const strategy of [
      "rule_single",
      "bge_single",
      "rule_multi",
      "bge_multi",
    ]) {
      const ids = strategy.endsWith("_single")
        ? strategy === "rule_single"
          ? old.baseline_grounded
          : old.bge_grounded
        : row.options[
            strategy === "rule_multi" ? "rule" : "bge-m3-anchor2-model-order"
          ].selected;
      const items = ids.map((id, i) => ({
        ...pool.get(id),
        rerankScore: (ids.length - i) / (ids.length + 1),
      }));
      let promptHash;
      const model = {
        generate: (prompt) => {
          promptHash = hash(prompt);
          return chat.generate(prompt);
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
      const started = performance.now();
      const result = await service.answer({
        question: queries[c.source][c.id],
        topK: 5,
      });
      for (const citation of result.citations) {
        assert.equal(
          result.contexts.find((x) => x.sourceId === citation.sourceId)
            ?.chunkId,
          citation.chunkId,
        );
      }
      rows.push({
        ...c,
        strategy,
        prompt_sha256: promptHash,
        elapsed_ms: performance.now() - started,
        result,
      });
      console.log(
        JSON.stringify({
          completed: rows.length,
          id: c.id,
          strategy,
          answer: result.answer,
        }),
      );
    }
  }
  await fs.writeFile(
    output,
    JSON.stringify({
      complete: true,
      protocol_sha256: hash(JSON.stringify(protocol)),
      scope:
        "Real ChatModelService/AnswerService generation on fixed archived retrieval contexts; exposed synthetic smoke only, no live ACL/index/retrieval",
      rows,
    }) + "\n",
    { flag: "wx" },
  );
}
if (require.main === module) {
  const [protocolFile, output] = process.argv.slice(2);
  fs.readFile(protocolFile, "utf8")
    .then((x) => run(path.resolve(__dirname, "../.."), JSON.parse(x), output))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
module.exports = { run };
