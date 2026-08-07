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

@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get('object')
  async getObject(@Query('key') key: string, @Res({ passthrough: true }) response: Response) {
    if (!key || key.includes('..')) {
      throw new BadRequestException('invalid object key');
    }

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
