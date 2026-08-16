import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { UserService } from '../users/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.users.findByUsername(dto.username.trim());
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('invalid username or password');
    }

    const authUser = this.users.toAuthUser(user);
    return {
      accessToken: await this.jwt.signAsync({ sub: authUser.id }),
      user: authUser,
    };
  }
}
