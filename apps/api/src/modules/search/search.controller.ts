import { Controller, Get, Query } from '@nestjs/common';
import { SearchDocumentsDto } from './dto/search-documents.dto';
import { SearchQueryService } from './search-query.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchQuery: SearchQueryService) {}

  @Get('documents')
  searchDocuments(@Query() query: SearchDocumentsDto) {
    return this.searchQuery.searchDocuments(query);
  }
}
