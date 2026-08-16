import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function context(user: unknown, roles: unknown) {
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    reflectorRoles: roles,
  } as any;
}

describe('RolesGuard', () => {
  it('allows routes without a role requirement', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(context(undefined, undefined))).toBe(true);
  });

  it('allows a user with a required role and rejects other users', () => {
    const reflector = {
      getAllAndOverride: () => ['ADMIN'],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(context({ role: 'ADMIN' }, ['ADMIN']))).toBe(true);
    expect(() => guard.canActivate(context({ role: 'MEMBER' }, ['ADMIN']))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context(undefined, ['ADMIN']))).toThrow(ForbiddenException);
  });
});
