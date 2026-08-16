import { UserRole } from '../users/entities/user.entity';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  team: string | null;
}
