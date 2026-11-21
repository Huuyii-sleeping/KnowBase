import { Module } from '@nestjs/common';
import { RerankService } from './rerank.service';
import { ConfigModule } from '@nestjs/config';
import { BgeHttpService } from './bge-http.service';
import { HybridRerankService } from './hybrid-rerank.service';

@Module({
  imports: [ConfigModule],
  providers: [RerankService, BgeHttpService, HybridRerankService],
  exports: [RerankService, HybridRerankService],
})
export class RerankModule {}
