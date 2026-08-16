import { Body, Controller, Post } from '@nestjs/common';
import { HybridSearchDto } from './dto/hybrid-search.dto';
import { HybridSearchService } from './hybrid-search.service';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('search')
export class HybridSearchController {
  constructor(private readonly hybridSearch: HybridSearchService) {}

  @Post('hybrid')
  search(@Body() query: HybridSearchDto, @CurrentUser() user: AuthUser) {
    return this.hybridSearch.search(query, user);
  }
}
