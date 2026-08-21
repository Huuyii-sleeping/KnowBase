import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { SearchGraphDto } from './dto/search-graph.dto';
import { KnowledgeGraphQueryService } from './knowledge-graph-query.service';

@Controller('graph')
export class KnowledgeGraphController {
  constructor(private readonly graphQuery: KnowledgeGraphQueryService) {}

  @Get('search')
  search(@Query() query: SearchGraphDto, @CurrentUser() user: AuthUser) {
    return this.graphQuery.search(query, user);
  }
}
