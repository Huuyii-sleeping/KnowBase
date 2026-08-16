import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const authUser = {
    id: 'user-1',
    username: 'member',
    displayName: 'Member',
    role: 'MEMBER',
    team: 'platform',
  };

  it('verifies credentials and issues a token with the public user projection', async () => {
    const users = {
      findByUsername: vi.fn().mockResolvedValue({
        ...authUser,
        passwordHash: '$2b$10$lf0QzUcRA5fPq0rHmhqSQexG6pIOTzet/QBEBcR43Nv4K4lRxUc7.',
      }),
      toAuthUser: vi.fn().mockReturnValue(authUser),
    };
    const jwt = { signAsync: vi.fn().mockResolvedValue('signed-token') };
    const service = new AuthService(users as any, jwt as any);

    const result = await service.login({ username: ' member ', password: 'knowbase-admin' });

    expect(users.findByUsername).toHaveBeenCalledWith('member');
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'user-1' });
    expect(result).toEqual({ accessToken: 'signed-token', user: authUser });
  });

  it('rejects unknown users and invalid passwords without issuing a token', async () => {
    const users = {
      findByUsername: vi.fn().mockResolvedValue(null),
      toAuthUser: vi.fn(),
    };
    const jwt = { signAsync: vi.fn() };
    const service = new AuthService(users as any, jwt as any);

    await expect(service.login({ username: 'missing', password: 'secret' })).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
