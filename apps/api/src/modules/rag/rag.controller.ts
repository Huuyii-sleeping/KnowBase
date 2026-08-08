import { Body, Controller, Post } from '@nestjs/common';
import { SemanticSearchDto } from './dto/semantic-search.dto';
import { RagQueryService } from './rag-query.service';

@Controller('search')
export class RagController {
  constructor(private readonly ragQuery: RagQueryService) {}

  @Post('semantic')
  semanticSearch(@Body() query: SemanticSearchDto) {
    return this.ragQuery.search(query);
  }
}
