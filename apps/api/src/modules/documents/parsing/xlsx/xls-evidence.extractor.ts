import { xlsScript } from './python-script-path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceUnit } from '../../evidence/evidence.types';
import { evidenceManifest } from '../../evidence/evidence-manifest';
import { ParseQuality } from '../file-parser.types';
const run = promisify(execFile);
@Injectable()
export class XlsEvidenceExtractor {
  constructor(private readonly config: ConfigService) {}
  async extract(buffer: Buffer, signal?: AbortSignal) {
    const python = this.config.get<string>('XLS_EVIDENCE_PYTHON')?.trim();
    const issues: ParseQuality['issues'] = [
      {
        code: 'XLS_FORMULA_METADATA_UNAVAILABLE',
        message:
          'BIFF saved values can be inspected, but formula expressions are unavailable; verify calculations against the original.',
      },
    ];
    if (!python)
      return {
        evidence: [] as EvidenceUnit[],
        issues: [
          {
            code: 'XLS_NATIVE_EVIDENCE_UNAVAILABLE',
            message:
              'Native XLS cell evidence is not configured; verify the MinerU reading view against the original.',
          },
        ],
      };
    const directory = await mkdtemp(join(tmpdir(), 'knowbase-xls-'));
    try {
      const source = join(directory, 'input.xls'),
        output = join(directory, 'evidence.json');
      await writeFile(source, buffer);
      await run(
        python,
        [
          this.config.get<string>('XLS_EVIDENCE_SCRIPT')?.trim() ||
            xlsScript('extract_xls.py'),
          source,
          output,
        ],
        { signal, timeout: 60000, maxBuffer: 65536 },
      );
      if ((await stat(output)).size > 64 * 1024 * 1024)
        throw new Error('XLS evidence exceeds byte budget');
      const evidence = JSON.parse(
        await readFile(output, 'utf8'),
      ) as EvidenceUnit[];
      evidenceManifest(evidence, []);
      return { evidence, issues };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
