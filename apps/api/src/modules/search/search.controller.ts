import { Controller, Get, Query } from '@nestjs/common';
import { SearchDocumentsDto } from './dto/search-documents.dto';
import { SearchQueryService } from './search-query.service';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('search')
export class SearchController {
  constructor(private readonly searchQuery: SearchQueryService) {}

  @Get('documents')
  searchDocuments(@Query() query: SearchDocumentsDto, @CurrentUser() user: AuthUser) {
    return this.searchQuery.searchDocuments(query, user);
  }
}
