import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSnapshotParser } from './web/web-snapshot.parser';
import { FormatParser } from './file-parser.types';
import { DEFAULT_DOCUMENT_PARSER } from './parser-defaults';
@Injectable()
export class SupplementaryParsers {
  constructor(
    private readonly web: WebSnapshotParser,
    private readonly config: ConfigService,
  ) {}
  get(extension: string): FormatParser | undefined {
    if (
      extension === '.websnapshot' &&
      this.config.get('DOCUMENT_PARSER', DEFAULT_DOCUMENT_PARSER) === 'mineru'
    )
      return this.web;
    return undefined;
  }
}
