import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { XlsEvidenceExtractor } from './xls-evidence.extractor';
import { xlsScript } from './python-script-path';

describe('independent XLS subprocess adapter', () => {
  let directory: string;
  let script: string;
  let observed: string;
  const bytes = Buffer.from('BIFF input fixture');
  const evidence = [
    {
      schema: 'evidence-v1',
      id: 'xls-0-2',
      kind: 'worksheet_row',
      source: { sheet: '预算', rowStart: 2, rowEnd: 2, cellRange: 'A2:B2' },
      objectKeys: [],
      text: '退款 | 0',
      producer: 'fixture',
      data: {
        cells: [
          { address: 'A2', value: '退款' },
          { address: 'B2', value: 0 },
        ],
      },
    },
  ];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kb-xls-adapter-test-'));
    script = join(directory, 'extract.cjs');
    observed = join(directory, 'observed.json');
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const extractor = () =>
    new XlsEvidenceExtractor(
      new ConfigService({
        XLS_EVIDENCE_PYTHON: process.execPath,
        XLS_EVIDENCE_SCRIPT: script,
      }),
    );
  async function fixture(body: string) {
    await writeFile(
      script,
      `const fs = require('node:fs');
      const [source, output] = process.argv.slice(2);
      fs.writeFileSync(${JSON.stringify(observed)}, JSON.stringify({ source, bytes: fs.readFileSync(source).toString('base64') }));
      ${body}`,
    );
  }
  async function assertCleaned() {
    const record = JSON.parse(await readFile(observed, 'utf8'));
    expect(record.bytes).toBe(bytes.toString('base64'));
    await expect(access(dirname(record.source))).rejects.toThrow();
  }
  it('passes original bytes, preserves native cell values and requires formula review', async () => {
    await fixture(
      `fs.writeFileSync(output, ${JSON.stringify(JSON.stringify(evidence))});`,
    );
    const result = await extractor().extract(bytes);
    expect(result.evidence).toEqual(evidence);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'XLS_FORMULA_METADATA_UNAVAILABLE',
    ]);
    await assertCleaned();
  });
  it.each([
    ['process failure', "throw new Error('corrupt BIFF');", 'corrupt BIFF'],
    ['invalid JSON', "fs.writeFileSync(output, '{');", 'JSON'],
    ['invalid evidence', "fs.writeFileSync(output, '[{}]');", 'evidence'],
    [
      'oversized output',
      "const fd=fs.openSync(output,'w'); fs.ftruncateSync(fd,64*1024*1024+1); fs.closeSync(fd);",
      'byte budget',
    ],
    ['missing output', '', 'ENOENT'],
  ])(
    'rejects %s and cleans temporary input/output',
    async (_label, body, message) => {
      await fixture(body);
      await expect(extractor().extract(bytes)).rejects.toThrow(message);
      await assertCleaned();
    },
  );
  it('cancels an active subprocess and removes its working directory', async () => {
    await fixture('setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const pending = expect(
      extractor().extract(bytes, controller.signal),
    ).rejects.toThrow();
    try {
      await (async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            await access(observed);
            return;
          } catch {
            await setTimeout(20);
          }
        }
        throw new Error('XLS fixture did not start');
      })();
    } finally {
      controller.abort();
    }
    await pending;
    await assertCleaned();
  });
  it('keeps unconfigured XLS explicit and locates the independently packaged script', async () => {
    const result = await new XlsEvidenceExtractor(
      new ConfigService({}),
    ).extract(bytes);
    expect(result.evidence).toEqual([]);
    expect(result.issues[0].code).toBe('XLS_NATIVE_EVIDENCE_UNAVAILABLE');
    await expect(access(xlsScript('extract_xls.py'))).resolves.toBeUndefined();
    expect(() => xlsScript('missing-script.py')).toThrow(
      'XLS extraction scripts',
    );
  });
});
