import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Public } from '../common/auth/auth.decorators';
import { AuthUser } from './auth.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
