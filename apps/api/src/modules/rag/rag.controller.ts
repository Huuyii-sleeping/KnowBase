import { Body, Controller, Post } from '@nestjs/common';
import { SemanticSearchDto } from './dto/semantic-search.dto';
import { RagQueryService } from './rag-query.service';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('search')
export class RagController {
  constructor(private readonly ragQuery: RagQueryService) {}

  @Post('semantic')
  semanticSearch(@Body() query: SemanticSearchDto, @CurrentUser() user: AuthUser) {
    return this.ragQuery.search(query, user);
  }
}
