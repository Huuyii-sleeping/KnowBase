import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../common/auth/auth.decorators';
import { CreateUserDto } from './dto/create-user.dto';
import { UserAdminService } from './user-admin.service';
import { UserRole } from './entities/user.entity';

@Controller('users')
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly users: UserAdminService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }
}
