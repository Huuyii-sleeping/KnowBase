import { MongooseModule } from '@nestjs/mongoose';
import {
  DocumentContent,
  DocumentContentSchema,
} from '../documents/schemas/document-content.schema';
import { Module } from '@nestjs/common';
import { DocumentAccessService } from './document-access.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../documents/entities/document.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    MongooseModule.forFeature([
      { name: DocumentContent.name, schema: DocumentContentSchema },
    ]),
  ],
  providers: [DocumentAccessService],
  exports: [DocumentAccessService],
})
export class AuthorizationModule {}
