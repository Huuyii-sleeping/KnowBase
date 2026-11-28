import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ASSET_REGISTRY_MODEL,
  AssetRegistrySchema,
} from './asset-registry.schema';
import { StorageController } from './storage.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    AuthorizationModule,
    MongooseModule.forFeature([
      { name: ASSET_REGISTRY_MODEL, schema: AssetRegistrySchema },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [StorageService],
  controllers: [StorageController],
  exports: [StorageService],
})
export class StorageModule {}
