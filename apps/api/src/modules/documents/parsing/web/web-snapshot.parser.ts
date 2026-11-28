import { staticWebBody } from './static-web-body';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FileParserContext, FormatParser } from '../file-parser.types';
import { MineruParser } from '../mineru/mineru.parser';
import { webUrl } from './web-url-policy';
import { WebSnapshot } from './web-snapshot.fetcher';

@Injectable()
export class WebSnapshotParser implements FormatParser {
  constructor(private readonly mineru: MineruParser) {}
  async parse(buffer: Buffer, _name: string, context: FileParserContext) {
    const snapshot = JSON.parse(buffer.toString('utf8')) as WebSnapshot;
    if (
      snapshot.schema !== 'web-snapshot-v1' ||
      typeof snapshot.html !== 'string' ||
      Buffer.byteLength(snapshot.html) > 5 * 1024 * 1024 ||
      !snapshot.html.trim() ||
      !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
      createHash('sha256').update(snapshot.html).digest('hex') !==
        snapshot.sha256
    )
      throw new Error('Invalid web snapshot integrity');
    webUrl(snapshot.requestedUrl);
    webUrl(snapshot.finalUrl);
    const body = staticWebBody(snapshot.html);
    const result = await this.mineru.parse(
      Buffer.from(body.html),
      'snapshot.html',
      context,
    );
    result.evidence = [
      ...(result.evidence ?? []),
      {
        schema: 'evidence-v1',
        id: 'web-snapshot',
        kind: 'web_snapshot',
        source: {},
        objectKeys: [],
        text: '',
        producer: 'web-snapshot-v1:mineru',
        data: {
          requestedUrl: snapshot.requestedUrl,
          finalUrl: snapshot.finalUrl,
          capturedAt: snapshot.capturedAt,
          sha256: snapshot.sha256,
          source: 'original_websnapshot_file',
          rendering: 'static_html',
          bodySelection: body.selection,
          externalResources: 'not_fetched',
        },
      },
    ];
    // Static capture can preserve navigation and cannot observe script-generated
    // content. Keep this explicit until the owner compares it with the source.
    const issue = {
      code: 'WEB_STATIC_SNAPSHOT_REVIEW',
      evidenceId: 'web-snapshot',
      message:
        'Static webpage snapshot: check main content, navigation noise and missing dynamic content.',
    };
    result.quality = {
      status: 'needs_review',
      issues: [...(result.quality?.issues ?? []), issue],
    };
    result.ready = false;
    result.warnings.push(issue.message);
    result.parser = 'web-snapshot-mineru';
    return result;
  }
}
