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
import { PublishDocumentDto } from './dto/publish-document.dto';
import { DocumentsService } from './documents.service';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  create(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: CreateDocumentDto, @CurrentUser() user: AuthUser) {
    return this.documentsService.create(file, dto, user);
  }

  @Get()
  findAll(@Query() query: ListDocumentsDto, @CurrentUser() user: AuthUser) {
    return this.documentsService.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.documentsService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentsService.update(id, dto, user);
  }

  @Put(':id/content')
  updateContent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentsService.updateContent(id, dto, user);
  }

  @Post(':id/submit-review')
  submitForReview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.documentsService.submitForReview(id, user);
  }

  @Post(':id/review')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentsService.review(id, dto, user);
  }

  @Post(':id/publish')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentsService.publish(id, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.documentsService.remove(id, user);
  }
}
