const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fixtures } = require('./fixtures.cjs');
const exec = promisify(execFile);

// LibreOffice only generates genuine OLE test inputs; it is not a production dependency.
async function extendedFixtures() {
  const root = await mkdtemp(path.join(tmpdir(), 'knowbase-legacy-fixtures-'));
  const converter = process.env.SOFFICE_BIN || 'soffice';
  try {
    const source = path.join(root, 'source');
    const target = path.join(root, 'legacy');
    await mkdir(source);
    await mkdir(target);
    const { stdout: converterVersion } = await exec(converter, ['--version'], {
      timeout: 30000,
    });
    const all = await fixtures();
    const result = [];
    for (const [modern, old, filter] of [
      ['docx', 'doc', 'MS Word 97'],
      ['xlsx', 'xls', 'MS Excel 97'],
      ['pptx', 'ppt', 'MS PowerPoint 97'],
    ]) {
      const fixture = all.find((item) => item.name.endsWith(`.${modern}`));
      const input = path.join(source, fixture.name);
      await writeFile(input, fixture.data);
      await exec(
        converter,
        [
          `-env:UserInstallation=${pathToFileURL(path.join(root, 'profile')).href}`,
          '--headless',
          '--convert-to',
          `${old}:${filter}`,
          '--outdir',
          target,
          input,
        ],
        { timeout: 60000 },
      );
      const name = fixture.name.replace(new RegExp(`${modern}$`), old);
      const data = await readFile(path.join(target, name));
      assert.equal(
        data.subarray(0, 8).toString('hex'),
        'd0cf11e0a1b11ae1',
        'fixture must be a real legacy OLE file',
      );
      result.push({ name, data, facts: fixture.facts });
      result.push({
        name: `broken.${old}`,
        data: Buffer.from('not an OLE file'),
        facts: [],
        invalid: true,
      });
    }
    const html =
      '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>发布指南</title></head><body><main><h1>发布指南</h1><p>审核通过后建立索引。</p><table><tr><th>项目</th><th>金额</th></tr><tr><td>存储</td><td>100</td></tr></table><p>保留原始来源。</p></main><script>DO_NOT_INDEX_SCRIPT</script></body></html>';
    for (const extension of ['html', 'htm'])
      result.push({
        name: `page.${extension}`,
        data: Buffer.from(html),
        facts: ['审核通过后建立索引。', '存储', '100', '保留原始来源。'],
        forbidden: ['DO_NOT_INDEX_SCRIPT'],
      });
    result.push({
      name: 'external-image.html',
      data: Buffer.from(
        html.replace(
          '</main>',
          '<img src="https://example.com/missing.png" alt="架构图"></main>',
        ),
      ),
      facts: ['审核通过后建立索引。', '存储'],
      review: true,
    });
    result.push({
      name: 'empty.html',
      data: Buffer.from('<html><body></body></html>'),
      facts: [],
      invalid: true,
    });
    return { fixtures: result, converterVersion: converterVersion.trim() };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
module.exports = { extendedFixtures };
