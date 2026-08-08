import { Module } from '@nestjs/common';
import { RerankService } from './rerank.service';

@Module({
  providers: [RerankService],
  exports: [RerankService],
})
export class RerankModule {}
