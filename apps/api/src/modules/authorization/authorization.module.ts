import { Module } from '@nestjs/common';
import { DocumentAccessService } from './document-access.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../documents/entities/document.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Document])],
  providers: [DocumentAccessService],
  exports: [DocumentAccessService],
})
export class AuthorizationModule {}
