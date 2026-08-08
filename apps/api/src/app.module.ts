import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsModule } from './modules/documents/documents.module';
import { Document } from './modules/documents/entities/document.entity';
import { StorageModule } from './modules/storage/storage.module';
import { HealthController } from './health.controller';
import { MessageQueueModule } from './modules/message-queue/message-queue.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('POSTGRES_HOST'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        database: config.getOrThrow<string>('POSTGRES_DB'),
        username: config.getOrThrow<string>('POSTGRES_USER'),
        password: config.getOrThrow<string>('POSTGRES_PASSWORD'),
        entities: [Document],
        synchronize: false,
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    StorageModule,
    DocumentsModule,
    MessageQueueModule,
    PipelineModule,
    SearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
