const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
function compare(before, after) {
  if (
    !before.manifestSha256 ||
    before.manifestSha256 !== after.manifestSha256 ||
    before.provenance !== after.provenance
  )
    throw new Error(
      'Comparison requires identical pinned corpus and provenance',
    );
  if (
    before.cases.length !== after.cases.length ||
    new Set(before.cases.map((x) => x.id)).size !== before.cases.length ||
    new Set(after.cases.map((x) => x.id)).size !== after.cases.length
  )
    throw new Error('Comparison requires identical unique case sets');
  return {
    schema: 'document-quality-comparison-v1',
    manifestSha256: before.manifestSha256,
    provenance: before.provenance,
    cases: after.cases.map((current) => {
      const old = before.cases.find((row) => row.id === current.id);
      if (!old || old.inputSha256 !== current.inputSha256)
        throw new Error('Comparison input hashes differ');
      return {
        id: current.id,
        beforePassed: old.passed,
        afterPassed: current.passed,
        beforeCells: old.tables?.matchedCells,
        afterCells: current.tables?.matchedCells,
        expectedCells: current.tables?.expectedCells,
      };
    }),
  };
}
if (require.main === module)
  (async () => {
    const result = compare(
      JSON.parse(await readFile(process.argv[2], 'utf8')),
      JSON.parse(await readFile(process.argv[3], 'utf8')),
    );
    const destination = path.resolve(
      process.argv[4] ||
        path.resolve(
          __dirname,
          '../../../../../reports/ingestion-quality/comparison.json',
        ),
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(result, null, 2) + '\n');
    console.table(result.cases);
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { compare };
