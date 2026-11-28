import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY, STORAGE_TICKET_KEY } from './auth.decorators';
import { UserService } from '../../users/user.service';
import { AuthUser } from '../../auth/auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      query?: { ticket?: string; key?: string };
      user?: AuthUser;
    }>();
    const allowsTicket = this.reflector.get<boolean>(
      STORAGE_TICKET_KEY,
      context.getHandler(),
    );
    const ticket =
      allowsTicket && typeof request.query?.ticket === 'string'
        ? request.query.ticket
        : undefined;
    const token =
      ticket || request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('authentication required');

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        purpose?: string;
        key?: string;
      }>(token);
      if (
        ticket
          ? payload.purpose !== 'storage_object' ||
            payload.key !== request.query?.key
          : payload.purpose !== undefined
      )
        throw new UnauthorizedException('invalid token scope');
      const user = payload.sub ? await this.users.findById(payload.sub) : null;
      if (!user)
        throw new UnauthorizedException('user is inactive or not found');
      request.user = this.users.toAuthUser(user);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('invalid or expired token');
    }
  }
}
