import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from './storage.service';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { DocumentAccessService } from '../authorization/document-access.service';

@Controller('storage')
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly access: DocumentAccessService,
  ) {}

  @Get('object')
  async getObject(
    @Query('key') key: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!key || key.includes('..')) {
      throw new BadRequestException('invalid object key');
    }
    await this.access.assertCanViewStorageKey(key, user);

    const [stream, stat] = await Promise.all([
      this.storage.getObject(key),
      this.storage.statObject(key),
    ]);
    response.setHeader(
      'Content-Type',
      stat.metaData['content-type'] || 'application/octet-stream',
    );
    response.setHeader('Content-Length', stat.size.toString());
    return new StreamableFile(stream);
  }
}
