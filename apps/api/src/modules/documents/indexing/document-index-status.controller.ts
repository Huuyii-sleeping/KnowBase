import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../auth/auth.types';
import { DocumentIndexStatusService } from './document-index-status.service';
@Controller('documents')
export class DocumentIndexStatusController {
  constructor(private readonly status: DocumentIndexStatusService) {}
  @Get(':id/index-status')
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.status.read(id, user);
  }
}
