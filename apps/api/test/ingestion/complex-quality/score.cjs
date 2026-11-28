const { factCoverage, tableScore } = require('../quality/metrics.cjs');
const normalize = (text) =>
  String(text).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
const coverage = (text, checks) => {
  const result = factCoverage(
    text,
    checks.map((x) => x.aliases),
  );
  return { ...result, missing: result.missing.map((i) => checks[i].id) };
};
const visualUnits = (result) =>
  (result.evidence || []).filter(
    (x) => x.data?.representation === 'visual_description',
  );
function rawMarkdown(result) {
  // Preserve UTF-16 offsets for source checks while excluding appended model prose.
  const units = visualUnits(result);
  let text = result.markdown;
  for (const section of result.sections || []) {
    const part = result.markdown.slice(section.start, section.end);
    if (
      part.includes('### 图像机器描述（需核对）') &&
      units.some((x) => part.includes(x.text))
    )
      text =
        text.slice(0, section.start) +
        ' '.repeat(section.end - section.start) +
        text.slice(section.end);
  }
  return text;
}
const sameRelation = (a, b) =>
  ['from', 'to', 'relation'].every((k) => normalize(a[k]) === normalize(b[k]));
function score(result, gold) {
  const raw = rawMarkdown(result);
  const visual = visualUnits(result);
  const generated = visual.map((x) => x.text).join('\n');
  const visible = coverage(raw, gold.visible);
  const critical = coverage(raw, gold.critical);
  const visualCritical = coverage(generated, gold.critical);
  const sourceMissing = gold.sources
    .filter(
      (check) =>
        !(result.sections || []).some(
          (s) =>
            s.source?.page === check.page &&
            coverage(raw.slice(s.start, s.end), [check]).matched === 1,
        ),
    )
    .map((x) => x.id);
  const sources = {
    expected: gold.sources.length,
    matched: gold.sources.length - sourceMissing.length,
    missing: sourceMissing,
  };
  const edges = visual.flatMap((x) => x.data.relations || []);
  const missingRelations = gold.relations
    .filter((ref) => !edges.some((x) => sameRelation(x, ref)))
    .map((x) => x.id);
  const relations = {
    expected: gold.relations.length,
    matched: gold.relations.length - missingRelations.length,
    missing: missingRelations,
    actual: edges.length,
  };
  const unknown = coverage(
    raw + '\n' + visual.flatMap((x) => x.data.uncertain || []).join('\n'),
    gold.unknown,
  );
  const contradictions = gold.contradictions
    .filter((x) => coverage(raw + '\n' + generated, [x]).matched)
    .map((x) => x.id);
  const orderMissing = gold.readingOrder.flatMap((sequence, i) => {
    let previous = -1;
    for (const token of sequence) {
      const index = normalize(raw).indexOf(normalize(token));
      if (index < 0 || index <= previous) return [`order-${i + 1}`];
      previous = index;
    }
    return [];
  });
  const readingOrder = {
    expected: gold.readingOrder.length,
    matched: gold.readingOrder.length - orderMissing.length,
    missing: orderMissing,
  };
  const actualTables = (result.blocks || []).filter((x) => x.table);
  const perTable = gold.tables.map((ref) => ({
    id: ref.id,
    ...tableScore(
      actualTables
        .filter((x) => x.source?.page === ref.page)
        .map((x) => x.table),
      [ref],
    ),
  }));
  const tables = {
    expected: gold.tables.length,
    actual: actualTables.length,
    matched: perTable.filter(
      (x) =>
        x.correctStructure === 1 &&
        x.matchedCells === x.expectedCells &&
        x.actualCells === x.expectedCells,
    ).length,
    expectedCells: perTable.reduce((n, x) => n + x.expectedCells, 0),
    matchedCells: perTable.reduce((n, x) => n + x.matchedCells, 0),
    details: perTable,
  };
  const allowed = [
    ...gold.visible,
    ...gold.critical,
    ...gold.unknown,
    ...gold.sources,
  ]
    .flatMap((x) => x.aliases)
    .map(normalize);
  // Exact nonmatches need adjudication; they are NOT proof of hallucination.
  const unverifiedFacts = visual
    .flatMap((x) => x.data.facts || [])
    .filter((x) => !allowed.includes(normalize(x)));
  const unverifiedRelations = edges.filter(
    (x) => !gold.relations.some((ref) => sameRelation(x, ref)),
  );
  const reviewProtected =
    visual.every((x) => x.data.review === 'needs_review') &&
    (!visual.length || result.ready === false);
  const errors = [
    ...(result.quality?.status === 'failed' || result.parser === 'failed'
      ? [{ type: 'PARSER_RETURNED_FAILURE', id: 'parser' }]
      : []),
    ...(tables.actual !== tables.expected
      ? [{ type: 'TABLE_COUNT', id: 'tables' }]
      : []),
    ...visible.missing.map((id) => ({ type: 'TEXT_MISSING', id })),
    ...critical.missing.map((id) => ({
      type: 'CRITICAL_MISSING_OR_CHANGED',
      id,
    })),
    ...sources.missing.map((id) => ({ type: 'SOURCE_MISMATCH', id })),
    ...relations.missing.map((id) => ({ type: 'RELATION_NOT_STRUCTURED', id })),
    ...unknown.missing.map((id) => ({ type: 'UNKNOWN_NOT_PRESERVED', id })),
    ...orderMissing.map((id) => ({ type: 'READING_ORDER', id })),
    ...perTable
      .filter(
        (x) =>
          x.correctStructure !== 1 ||
          x.matchedCells !== x.expectedCells ||
          x.actualCells !== x.expectedCells,
      )
      .map((x) => ({ type: 'TABLE_CELL_OR_MERGE', id: x.id })),
    ...contradictions.map((id) => ({ type: 'KNOWN_CONTRADICTION', id })),
    ...(!reviewProtected
      ? [{ type: 'UNREVIEWED_VISUAL_OUTPUT', id: 'review' }]
      : []),
  ];
  return {
    visible,
    critical,
    visualCritical,
    sources,
    relations,
    unknown,
    readingOrder,
    tables,
    contradictions,
    reviewProtected,
    errors,
    manualReview: {
      required: visual.length > 0,
      unverifiedFacts,
      unverifiedRelations,
      freeFormDescriptions: visual.map((x) => x.data.description),
    },
    // Passing literal checks never certifies the meaning of free-form generated text.
    automaticChecksPassed:
      errors.length === 0 &&
      tables.actual === tables.expected &&
      result.quality?.status !== 'failed',
  };
}
module.exports = { score, rawMarkdown, normalize };
