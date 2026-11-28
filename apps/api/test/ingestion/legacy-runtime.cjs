const { baselineReference } = require('./baseline-reference.cjs');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { ConfigService } = require('@nestjs/config');

// Load the actual Git snapshot, rather than a reimplementation of old behavior.
// DI metadata is unnecessary because the benchmark supplies constructor fakes.
function legacyRuntime(ref, config) {
  const repository = path.resolve(__dirname, '../../../..');
  const git = (args) =>
    execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
    }).trim();
  const revision = git([
    'rev-parse',
    '--verify',
    `${baselineReference(ref)}^{commit}`,
  ]);
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'knowbase-parser-baseline-'),
  );
  const dispose = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    fs.symlinkSync(
      path.resolve(__dirname, '../../node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    const files = git([
      'ls-tree',
      '-r',
      '--name-only',
      revision,
      'apps/api/src/modules/documents/parsing',
      'apps/api/src/modules/pipeline/chunk',
      'apps/api/src/modules/pipeline/embedding/embedding.service.ts',
      'apps/api/src/modules/pipeline/vector-index/elasticsearch-generation.writer.ts',
    ])
      .split('\n')
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'));
    if (!files.length) throw new Error('Baseline parser sources not found');
    for (const name of files) {
      const target = path.join(
        root,
        name.replace('apps/api/src/modules/', '').replace(/\.ts$/, '.js'),
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        ts.transpileModule(git(['show', `${revision}:${name}`]), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2023,
            esModuleInterop: true,
            experimentalDecorators: true,
          },
        }).outputText,
      );
    }
    const load = (name) => require(path.join(root, name));
    const parsers = ['text', 'markdown', 'pdf', 'xlsx', 'docx', 'pptx'].map(
      (name) => {
        const Parser = Object.values(
          load(`documents/parsing/parsers/${name}.parser.js`),
        )[0];
        return new Parser();
      },
    );
    const { FileParserService } = load(
      'documents/parsing/file-parser.service.js',
    );
    const { OfficeParserFallback } = load(
      'documents/parsing/parsers/office-parser.fallback.js',
    );
    const { MarkdownChunkerService } = load(
      'pipeline/chunk/markdown-chunker.service.js',
    );
    return {
      revision,
      dispose,
      embedding: new (load(
        'pipeline/embedding/embedding.service.js',
      ).EmbeddingService)(new ConfigService(config)),
      GenerationWriter: load(
        'pipeline/vector-index/elasticsearch-generation.writer.js',
      ).ElasticsearchGenerationWriter,
      parser: new FileParserService(...parsers, new OfficeParserFallback(), {
        upload: async () => ({
          type: 'image',
          objectKey: 'assets/benchmark/image',
          url: '/image',
        }),
      }),
      chunker: new MarkdownChunkerService(new ConfigService(config)),
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
module.exports = { legacyRuntime };
