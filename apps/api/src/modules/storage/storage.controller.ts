import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  Res,
  StreamableFile,
  Optional,
} from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from './storage.service';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { DocumentAccessService } from '../authorization/document-access.service';
import { byteRange } from './byte-range';
import { AllowStorageTicket } from '../common/auth/auth.decorators';
import { JwtService } from '@nestjs/jwt';

@Controller('storage')
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly access: DocumentAccessService,
    @Optional() private readonly jwt?: JwtService,
  ) {}

  @Get('object')
  @AllowStorageTicket()
  async getObject(
    @Query('key') key: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
    @Headers('range') range?: string,
  ) {
    if (!key || key.includes('..')) {
      throw new BadRequestException('invalid object key');
    }
    await this.access.assertCanViewStorageKey(key, user);

    const stat = await this.storage.statObject(key);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'",
    );
    response.setHeader(
      'Content-Type',
      stat.metaData['content-type'] || 'application/octet-stream',
    );
    const selected = range === undefined ? null : byteRange(range, stat.size);
    if (selected === undefined) {
      response.status(416);
      response.setHeader('Content-Range', `bytes */${stat.size}`);
      response.setHeader('Content-Length', '0');
      return;
    }
    const length = selected ? selected.end - selected.start + 1 : stat.size;
    response.setHeader('Content-Length', String(length));
    if (selected) {
      response.status(206);
      response.setHeader(
        'Content-Range',
        `bytes ${selected.start}-${selected.end}/${stat.size}`,
      );
    }
    const stream = selected
      ? await this.storage.getPartialObject(key, selected.start, length)
      : await this.storage.getObject(key);
    response.once('close', () => stream.destroy());
    return new StreamableFile(stream);
  }

  @Get('access')
  async accessUrl(
    @Query('key') key: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!key || key.includes('..'))
      throw new BadRequestException('invalid object key');
    await this.access.assertCanViewStorageKey(key, user);
    if (!this.jwt) throw new Error('Storage tickets are not configured');
    const ticket = await this.jwt.signAsync(
      { sub: user.id, purpose: 'storage_object', key },
      { expiresIn: '5m' },
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return {
      url: `${this.storage.getObjectUrl(key)}&ticket=${encodeURIComponent(ticket)}`,
      expiresInSeconds: 300,
    };
  }
}
