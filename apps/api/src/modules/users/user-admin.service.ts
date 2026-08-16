import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserRole } from './entities/user.entity';

@Injectable()
export class UserAdminService {
  constructor(@InjectRepository(User) private readonly repository: Repository<User>) {}

  async create(dto: CreateUserDto) {
    const existing = await this.repository.findOne({ where: { username: dto.username.trim() } });
    if (existing) throw new ConflictException('username already exists');

    const user = this.repository.create({
      username: dto.username.trim(),
      displayName: dto.displayName.trim(),
      email: dto.email?.trim() || null,
      passwordHash: await hash(dto.password, 10),
      role: dto.role ?? UserRole.MEMBER,
      team: dto.team?.trim() || null,
      active: true,
    });
    return this.toPublicUser(await this.repository.save(user));
  }

  async list() {
    const users = await this.repository.find({ order: { createdAt: 'ASC' } });
    return users.map((user) => this.toPublicUser(user));
  }

  private toPublicUser(user: User) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      team: user.team,
      active: user.active,
      createdAt: user.createdAt,
    };
  }
}
