const path = require('node:path');
const { readFile, mkdir, writeFile, rm } = require('node:fs/promises');
const { digest } = require('./corpus.cjs');
const { rawMarkdown } = require('./score.cjs');
function assetCapture() {
  const entries = new Map();
  return {
    entries,
    uploader: {
      async upload(documentId, input) {
        const objectKey = `assets/${documentId}/${entries.size}`;
        entries.set(objectKey, {
          bytes: Buffer.from(input.data),
          mime: input.contentType,
        });
        return {
          objectKey,
          type: input.type || 'attachment',
          url: `/asset/${entries.size}`,
          alt: input.alt,
        };
      },
      async discard(_documentId, assets) {
        for (const asset of assets) entries.delete(asset.objectKey);
      },
    },
  };
}
async function saveArtifacts(directory, result, assets) {
  await mkdir(directory, { recursive: false });
  try {
    await writeFile(
      path.join(directory, 'parsed.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    await writeFile(path.join(directory, 'ocr.md'), rawMarkdown(result));
    await writeFile(
      path.join(directory, 'visual.json'),
      JSON.stringify(
        (result.evidence || []).filter(
          (x) => x.data?.representation === 'visual_description',
        ),
        null,
        2,
      ) + '\n',
    );
    const inventory = [];
    for (const [objectKey, input] of assets.entries) {
      const file = `asset-${inventory.length}.bin`;
      const sha256 = digest(input.bytes);
      await writeFile(path.join(directory, file), input.bytes);
      if (digest(await readFile(path.join(directory, file))) !== sha256)
        throw new Error('Asset readback mismatch');
      inventory.push({
        objectKey,
        file,
        mime: input.mime,
        sha256,
        bytes: input.bytes.length,
      });
    }
    await writeFile(
      path.join(directory, 'assets.json'),
      JSON.stringify(inventory, null, 2) + '\n',
    );
    if (
      JSON.stringify(
        JSON.parse(await readFile(path.join(directory, 'parsed.json'), 'utf8')),
      ) !== JSON.stringify(result)
    )
      throw new Error('Parser result readback mismatch');
    return {
      localReadback: true,
      assets: inventory.length,
      productionPersistence: 'not_tested',
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { assetCapture, saveArtifacts };
