const path = require('node:path');
const load = (name) =>
  require(path.resolve(__dirname, '../../dist/src/modules', name));
function parserRuntime(options = {}, assetUploader) {
  const { FileParserService } = load(
    'documents/parsing/file-parser.service.js',
  );
  const parsers = ['text', 'markdown', 'pdf', 'xlsx', 'docx', 'pptx'].map(
    (name) => {
      const Parser = Object.values(
        load(`documents/parsing/parsers/${name}.parser.js`),
      )[0];
      return new Parser();
    },
  );
  const { OfficeParserFallback } = load(
    'documents/parsing/parsers/office-parser.fallback.js',
  );
  const uploads = [];
  const discarded = [];
  const { ConfigService } = require('@nestjs/config');
  const { MineruParser } = load('documents/parsing/mineru/mineru.parser.js');
  const config = new ConfigService({ DOCUMENT_PARSER: 'native', ...options });
  const mineru = new MineruParser(config);
  const vision = new (load(
    'documents/parsing/vision/vision-description.adapter.js',
  ).VisionDescriptionAdapter)(config);
  const parser = new FileParserService(
    ...parsers,
    new OfficeParserFallback(),
    assetUploader || {
      upload: async (documentId, input) => {
        const asset = {
          type: input.type || 'attachment',
          objectKey: `assets/${documentId}/${uploads.length}`,
          url: `/asset/${uploads.length}`,
          alt: input.alt,
        };
        uploads.push(asset);
        return asset;
      },
      discard: async (_documentId, assets) => {
        discarded.push(...assets);
      },
    },
    mineru,
    config,
    new (load(
      'documents/parsing/supplementary-parsers.js',
    ).SupplementaryParsers)(
      new (load(
        'documents/parsing/web/web-snapshot.parser.js',
      ).WebSnapshotParser)(mineru),
      config,
    ),
    new (load(
      'documents/parsing/parsed-document.enricher.js',
    ).ParsedDocumentEnricher)(
      new (load(
        'documents/parsing/xlsx/xlsx-evidence.extractor.js',
      ).XlsxEvidenceExtractor)(),
      new (load(
        'documents/parsing/xlsx/xls-evidence.extractor.js',
      ).XlsEvidenceExtractor)(config),
      new (load(
        'documents/parsing/vision/image-semantic-enricher.js',
      ).ImageSemanticEnricher)(vision),
    ),
  );
  return { parser, uploads, discarded };
}
module.exports = { load, parserRuntime };
