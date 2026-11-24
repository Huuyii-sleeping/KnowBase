import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth.guard';
const fixture = (
  ticket = true,
  key = 'assets/doc/a',
  scope = 'storage_object',
) => {
  const request = {
    headers: ticket ? {} : { authorization: 'Bearer token' },
    query: ticket ? { ticket: 'scoped', key } : {},
    user: undefined,
  };
  const jwt = {
    verifyAsync: vi.fn(async () => ({
      sub: 'user',
      purpose: scope,
      key: 'assets/doc/a',
    })),
  };
  const users = {
    findById: vi.fn(async () => ({ id: 'user' })),
    toAuthUser: vi.fn((user) => user),
  };
  const reflector = {
    getAllAndOverride: vi.fn(() => false),
    get: vi.fn(() => true),
  };
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return {
    guard: new AuthGuard(reflector as any, jwt as any, users as any),
    context,
    reflector,
    request,
    users,
  };
};
describe('resource ticket authentication', () => {
  it('accepts only the bound object and reloads the current user', async () => {
    const f = fixture();
    expect(await f.guard.canActivate(f.context as any)).toBe(true);
    expect(f.users.findById).toHaveBeenCalledWith('user');
    expect(f.request.user).toEqual({ id: 'user' });
  });
  it('rejects cross-object, cross-endpoint and inactive user ticket use', async () => {
    const wrong = fixture(true, 'assets/doc/b');
    await expect(wrong.guard.canActivate(wrong.context as any)).rejects.toThrow(
      'scope',
    );
    const bearer = fixture(false);
    await expect(
      bearer.guard.canActivate(bearer.context as any),
    ).rejects.toThrow('scope');
    const endpoint = fixture();
    endpoint.reflector.get.mockReturnValue(false);
    await expect(
      endpoint.guard.canActivate(endpoint.context as any),
    ).rejects.toThrow('authentication');
    const inactive = fixture();
    inactive.users.findById.mockResolvedValueOnce(null as any);
    await expect(
      inactive.guard.canActivate(inactive.context as any),
    ).rejects.toThrow('inactive');
  });
});

it('rejects real expired signed tickets', async () => {
  const { JwtService } = await import('@nestjs/jwt');
  const jwt = new JwtService({ secret: 'test-only-signing-secret' });
  const f = fixture();
  (f.request.query as any).ticket = await jwt.signAsync(
    { sub: 'user', purpose: 'storage_object', key: 'assets/doc/a' },
    { expiresIn: -1 },
  );
  const guard = new AuthGuard(f.reflector as any, jwt, f.users as any);
  await expect(guard.canActivate(f.context as any)).rejects.toThrow('expired');
  expect(f.users.findById).not.toHaveBeenCalled();
});
