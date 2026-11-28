import { BadRequestException, Injectable } from '@nestjs/common';
import { WebSnapshotFetcher } from './parsing/web/web-snapshot.fetcher';
import { DocumentCommandService } from './document-command.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { AuthUser } from '../auth/auth.types';
@Injectable()
export class WebImportService {
  constructor(
    private readonly fetcher: WebSnapshotFetcher,
    private readonly commands: DocumentCommandService,
  ) {}
  async create(url: string, dto: CreateDocumentDto, user: AuthUser) {
    let snapshot;
    try {
      snapshot = await this.fetcher.capture(url);
    } catch {
      throw new BadRequestException(
        '网页抓取失败：请检查 URL、公开访问权限、UTF-8 HTML 格式与大小。',
      );
    }
    const bytes = Buffer.from(JSON.stringify(snapshot));
    const id = await this.commands.create(
      {
        originalname: `${new URL(snapshot.finalUrl).hostname}.websnapshot`,
        buffer: bytes,
        size: bytes.length,
        mimetype: 'application/json',
      } as Express.Multer.File,
      { ...dto, markdown: undefined },
      user,
    );
    return { id };
  }
}
