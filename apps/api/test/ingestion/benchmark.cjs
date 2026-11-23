const { performance } = require('node:perf_hooks');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { fixtures } = require('./fixtures.cjs');
const { load, parserRuntime } = require('./runtime.cjs');

async function run() {
  const { parser } = parserRuntime();
  const { MarkdownChunkerService } = load(
    'pipeline/chunk/markdown-chunker.service.js',
  );
  const config = { RAG_CHUNK_SIZE: 300, RAG_CHUNK_OVERLAP: 40 };
  const chunker = new MarkdownChunkerService(new ConfigService(config));
  const {
    RecursiveCharacterTextSplitter,
  } = require('@langchain/textsplitters');
  const legacy = new RecursiveCharacterTextSplitter({
    chunkSize: 300,
    chunkOverlap: 40,
    separators: ['\n# ', '\n## ', '\n### ', '\n\n', '\n', ' ', ''],
  });
  const samples = [];
  for (const fixture of await fixtures()) {
    const start = performance.now();
    const parsed = await parser.parse(fixture.data, fixture.name, 'benchmark');
    const parseMs = performance.now() - start;
    const chunkStart = performance.now();
    const structured = await chunker.splitStructured(
      parsed.markdown,
      parsed.sections,
    );
    const chunkMs = performance.now() - chunkStart;
    const chunks = structured.map((chunk) => chunk.content);
    const legacyChunks = await legacy.splitText(parsed.markdown);
    const structure = (texts) => ({
      tableParts: texts.filter((text) => text.includes('| 项目')).length,
      tablePartsWithHeader: texts.filter(
        (text) => text.includes('| 项目') && /\| 项目\s*\| 金额/.test(text),
      ).length,
      codeParts: texts.filter((text) => /const value\d+/.test(text)).length,
      codePartsWithFences: texts.filter(
        (text) => /const value\d+/.test(text) && /```ts[\s\S]*```/.test(text),
      ).length,
    });
    samples.push({
      quality: structure(chunks),
      legacyQualityOnSameParsedText: structure(legacyChunks),
      file: fixture.name,
      sha256: createHash('sha256').update(fixture.data).digest('hex'),
      bytes: fixture.data.length,
      parser: parsed.parser,
      ready: parsed.ready,
      expectedReady: !fixture.invalid,
      parseMs,
      chunkMs,
      characters: parsed.markdown.length,
      chunks: chunks.length,
      maxChunkCharacters: Math.max(0, ...chunks.map((text) => text.length)),
      indexedCharacters: chunks.reduce((sum, text) => sum + text.length, 0),
      facts: fixture.facts.length,
      parsedFacts: fixture.facts.filter((fact) =>
        parsed.markdown.includes(fact),
      ).length,
      chunkedFacts: fixture.facts.filter((fact) =>
        chunks.some((chunk) => chunk.includes(fact)),
      ).length,
    });
  }
  const directory = path.resolve(process.argv[2] || '../../reports/ingestion');
  await mkdir(directory, { recursive: true });
  const report = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    workingTreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim(),
    ),
    config,
    node: process.version,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    scope:
      'Synthetic parser/chunker benchmark; no model, database, retrieval or index service is called. Wall times are local observations, not production throughput.',
    samples,
  };
  await writeFile(
    path.join(directory, 'baseline.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.table(
    samples.map(
      ({
        file,
        ready,
        expectedReady,
        facts,
        parsedFacts,
        chunkedFacts,
        chunks,
      }) => ({
        file,
        ready,
        expectedReady,
        facts,
        parsedFacts,
        chunkedFacts,
        chunks,
      }),
    ),
  );
  console.log(`Report: ${directory}/baseline.json`);
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
