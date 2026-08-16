import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserService } from './user.service';
import { UsersController } from './users.controller';
import { UserAdminService } from './user-admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UserService, UserAdminService],
  exports: [UserService],
})
export class UsersModule {}
