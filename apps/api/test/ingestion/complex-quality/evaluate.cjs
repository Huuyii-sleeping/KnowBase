const path = require('node:path');
const { readFile, mkdir, writeFile, rename } = require('node:fs/promises');
const { loadCorpus, digest } = require('./corpus.cjs');
const { score } = require('./score.cjs');
const { summarize } = require('./report.cjs');
const { root, fingerprint, gitState } = require('./trace.cjs');
const { budgets, profile, probe } = require('./profile.cjs');
const { saveArtifacts } = require('./artifacts.cjs');
const { infer } = require('./runtime.cjs');
const { tokenUsage, enhancementStatus } = require('./transport-trace.cjs');
async function evaluate(
  directory,
  destination,
  profileName,
  split = 'development',
  adapters = {},
) {
  if (!['development', 'holdout', 'all'].includes(split))
    throw new Error('Invalid split');
  const corpus = await loadCorpus(directory);
  const configuration = profile(profileName);
  const availability = await (adapters.probe || probe)(configuration);
  await mkdir(destination, { recursive: false });
  const report = {
    schema: 'complex-quality-run-v1',
    createdAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    scope:
      'Synthetic parser-quality diagnostic; local asset capture, no database/index delivery claim.',
    manifestSha256: corpus.manifestSha256,
    goldSha256: corpus.manifest.goldSha256,
    scorerSha256: digest(
      (await readFile(path.join(__dirname, 'score.cjs'))) +
        (await readFile(path.join(__dirname, '../quality/metrics.cjs'))),
    ),
    git: gitState(),
    profile: configuration.identity,
    budgets,
    availability,
    source: await fingerprint(
      path.join(root, 'apps/api/src/modules/documents/parsing'),
    ),
    ingestionSource: await fingerprint(
      path.join(root, 'apps/api/src/modules/ingestion'),
    ),
    compiled: await fingerprint(
      path.join(root, 'apps/api/dist/src/modules/documents/parsing'),
    ),
    tool: await fingerprint(__dirname),
    lockSha256: digest(await readFile(path.join(root, 'pnpm-lock.yaml'))),
    status: 'running',
    cases: [],
    holdoutExposure: [],
  };
  const flush = async () => {
    report.summary = summarize(report.cases);
    const pending = path.join(destination, 'run.pending');
    await writeFile(pending, JSON.stringify(report, null, 2) + '\n');
    await rename(pending, path.join(destination, 'run.json'));
  };
  await flush();
  try {
    for (const item of corpus.manifest.cases.filter(
      (x) => split === 'all' || x.split === split,
    )) {
      const row = {
        id: item.id,
        category: item.category,
        split: item.split,
        inputSha256: item.sha256,
      };
      if (
        !availability.available ||
        (profileName === 'native-ocr' && item.file.endsWith('.png'))
      ) {
        report.cases.push({
          ...row,
          status: 'unavailable',
          reason: !availability.available
            ? availability.code
            : 'NATIVE_IMAGE_UNSUPPORTED',
        });
      } else {
        if (item.split === 'holdout') {
          report.holdoutExposure.push({
            id: item.id,
            at: new Date().toISOString(),
            reason:
              'Quality evaluation; diagnostic after this run, never unseen again.',
          });
          await flush();
        }
        try {
          // Only bytes, filename and fixed configuration enter inference; never gold.
          const observation = await (adapters.infer || infer)(
            await readFile(path.join(corpus.root, item.file)),
            item.file,
            configuration,
          );
          const artifacts = await saveArtifacts(
            path.join(destination, item.id),
            observation.result,
            observation.assets,
          );
          report.cases.push({
            ...row,
            status: 'completed',
            parser: observation.result.parser,
            parserReady: observation.result.ready,
            parserQuality: observation.result.quality?.status,
            provenance: observation.result.provenance,
            elapsedMs: observation.elapsedMs,
            requests: observation.requests,
            visionCalls: observation.visionCalls || [],
            enhancement: enhancementStatus(
              observation.result,
              configuration.identity.imageMode === 'describe',
            ),
            tokens: tokenUsage(observation.visionCalls || []),
            cost: null,
            usageNote:
              'Observed OpenAI-compatible usage only; missing usage remains unmeasured, monetary cost not inferred.',
            artifacts,
            score: score(observation.result, corpus.gold.get(item.id)),
          });
        } catch (error) {
          report.cases.push({
            ...row,
            status: 'failed',
            reason: 'INFERENCE_OR_ARTIFACT_FAILURE',
            ...(error.telemetry || {}),
          });
        }
      }
      await flush();
    }
    report.status = report.cases.some((x) => x.status === 'unavailable')
      ? 'partial'
      : report.cases.some((x) => x.status === 'failed')
        ? 'failed'
        : 'completed';
    return report;
  } finally {
    if (report.status === 'running') report.status = 'interrupted';
    await flush();
  }
}
if (require.main === module) {
  if (process.argv.length < 5)
    throw new Error(
      'Usage: evaluate.cjs CORPUS NEW_OUTPUT native-ocr|mineru-ocr|mineru-vision [development|holdout|all]',
    );
  evaluate(
    path.resolve(process.argv[2]),
    path.resolve(process.argv[3]),
    process.argv[4],
    process.argv[5],
  )
    .then((report) => {
      console.table(
        report.cases.map((x) => ({
          id: x.id,
          status: x.status,
          critical: x.score
            ? `${x.score.critical.matched}/${x.score.critical.expected}`
            : null,
          errors: x.score?.errors.length,
          reason: x.reason,
        })),
      );
      // Quality gaps are observations. Failed/unavailable inference is an incomplete run.
      if (report.status !== 'completed') process.exitCode = 2;
    })
    .catch(() => {
      console.error(
        'Evaluation could not start; check corpus, build, configuration and fresh output directory.',
      );
      process.exitCode = 1;
    });
}
module.exports = { evaluate };
