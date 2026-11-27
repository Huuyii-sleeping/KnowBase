const { digest } = require('./values.cjs');
const { parseAndReview, rejectReparse } = require('./parse-review.cjs');
const { verifySource } = require('./source.cjs');
const { publishAndSearch } = require('./publication.cjs');
const { verifyDeletion } = require('./deletion.cjs');
async function runScenario(env, actors, fixture) {
  const parsed = await parseAndReview(actors, fixture);
  const { id, document, candidate } = parsed;
  const { original, keys, evidence, body } = await verifySource(
    env,
    actors,
    fixture,
    parsed,
  );
  const { evidenceHits, ticket } = await publishAndSearch(
    env,
    actors,
    fixture,
    parsed,
    { body },
  );
  const draft = await rejectReparse(actors, document, parsed.route);
  await verifyDeletion(env, actors, fixture, parsed, keys, draft, ticket);
  return {
    id: fixture.id,
    inputSha256: digest(original),
    documentId: id,
    parser: document.content.parser,
    provenance: document.content.provenance,
    quality: document.content.quality?.status ?? 'unavailable',
    candidateRequired: Boolean(candidate),
    criticalFacts: fixture.facts.length,
    evidence: evidence.total,
    tables: document.content.tables.length,
    publishedVersion: document.version,
    activePipelines: 3,
    semanticEvidenceChunks: evidenceHits.length,
    sourceReadback: true,
    permissionChecks: true,
    reparsePreservedPublished: true,
    cleanup: true,
    status: 'passed',
  };
}
module.exports = { runScenario };
