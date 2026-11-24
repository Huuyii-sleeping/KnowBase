import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../auth/auth.types';
import { DocumentEvidenceQueryService } from './document-evidence-query.service';
import { ParseDraftService } from '../ingestion/parse-draft.service';
import { ReviewParseDto } from '../ingestion/review-parse.dto';

@Controller('documents')
export class DocumentEvidenceController {
  constructor(
    private readonly evidence: DocumentEvidenceQueryService,
    private readonly drafts: ParseDraftService,
  ) {}
  @Get(':id/evidence')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('draftTaskId') taskId?: string,
  ) {
    return this.evidence.list(id, user, offset, limit, taskId);
  }
  @Get(':id/parse-drafts/:taskId')
  async draft(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const { body } = await this.drafts.read(id, taskId, user);
    return {
      contentId: body.contentId,
      markdown: body.markdown,
      warnings: body.warnings,
      quality: body.quality,
      evidenceManifest: body.evidenceManifest,
      assets: body.assets,
      ready: body.ready,
    };
  }
  @Post(':id/parse-review')
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewParseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.drafts.review(id, dto, user);
  }
}
