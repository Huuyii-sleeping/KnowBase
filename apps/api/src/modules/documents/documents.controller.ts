import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  create(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: CreateDocumentDto) {
    return this.documentsService.create(file, dto);
  }

  @Get()
  findAll(@Query() query: ListDocumentsDto) {
    return this.documentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documentsService.update(id, dto);
  }

  @Put(':id/content')
  updateContent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.documentsService.updateContent(id, dto);
  }

  @Post(':id/submit-review')
  submitForReview(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.submitForReview(id);
  }

  @Post(':id/review')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.documentsService.review(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.documentsService.remove(id);
  }
}
