import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth.types';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  findByUsername(username: string): Promise<User | null> {
    return this.repository.findOne({ where: { username, active: true } });
  }

  findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id, active: true } });
  }

  toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      team: user.team,
    };
  }
}
