const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ConfigService } = require('@nestjs/config');
const { fixtures } = require('./fixtures.cjs');
const { load, parserRuntime } = require('./runtime.cjs');
const { MarkdownChunkerService } = load(
  'pipeline/chunk/markdown-chunker.service.js',
);

test('synthetic corpus bytes remain stable between runs', async () => {
  const first = await fixtures();
  const second = await fixtures();
  assert.deepEqual(
    first.map((fixture) => fixture.data),
    second.map((fixture) => fixture.data),
  );
});

test('real format parsers preserve synthetic facts and reject invalid documents', async () => {
  const { parser } = parserRuntime();
  const chunker = new MarkdownChunkerService(
    new ConfigService({ RAG_CHUNK_SIZE: 300, RAG_CHUNK_OVERLAP: 40 }),
  );
  for (const fixture of await fixtures()) {
    const result = await parser.parse(
      fixture.data,
      fixture.name,
      'format-test',
    );
    assert.equal(
      result.ready,
      !fixture.invalid,
      `${fixture.name}: ${result.error}`,
    );
    if (fixture.invalid) continue;
    assert.notEqual(
      result.parser,
      'officeparser-fallback',
      `${fixture.name} must exercise its primary parser`,
    );
    const chunks = await chunker.splitStructured(
      result.markdown,
      result.sections,
    );
    assert.ok(chunks.every((chunk) => chunk.content.length <= 300));
    for (const fact of fixture.facts) {
      assert.ok(
        result.markdown.includes(fact),
        `${fixture.name} lost parsed fact: ${fact}`,
      );
      assert.ok(
        chunks.some((chunk) => chunk.content.includes(fact)),
        `${fixture.name} lost chunked fact: ${fact}`,
      );
    }
    if (fixture.name.endsWith('.pdf'))
      assert.deepEqual(
        result.sections.map((section) => section.source.page),
        [1, 2],
      );
    if (fixture.name.endsWith('.xlsx'))
      assert.equal(chunks[0].ranges[0].source.sheet, '费用');
    if (fixture.name.endsWith('.pptx'))
      assert.deepEqual(
        chunks.map((chunk) => chunk.ranges[0].source.slide),
        [1, 2],
      );
  }
});
