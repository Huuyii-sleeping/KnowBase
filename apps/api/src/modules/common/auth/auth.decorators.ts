import { SetMetadata } from '@nestjs/common';
export const STORAGE_TICKET_KEY = 'allowStorageTicket';
export const AllowStorageTicket = () => SetMetadata(STORAGE_TICKET_KEY, true);
import { UserRole } from '../../users/entities/user.entity';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
