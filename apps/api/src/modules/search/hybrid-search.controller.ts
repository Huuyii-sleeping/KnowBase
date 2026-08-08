import { Body, Controller, Post } from '@nestjs/common';
import { HybridSearchDto } from './dto/hybrid-search.dto';
import { HybridSearchService } from './hybrid-search.service';

@Controller('search')
export class HybridSearchController {
  constructor(private readonly hybridSearch: HybridSearchService) {}

  @Post('hybrid')
  search(@Body() query: HybridSearchDto) {
    return this.hybridSearch.search(query);
  }
}
