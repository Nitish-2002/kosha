import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { User, UserRole } from './user.entity';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  findAdmins(): Promise<User[]> {
    return this.repo.findBy({ role: 'admin', status: 'active' });
  }

  findAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  create(input: { email: string; role: UserRole }): Promise<User> {
    return this.repo.save(this.repo.create(input));
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  countActiveAdminsExcluding(excludingId: string): Promise<number> {
    return this.repo.count({
      where: { role: 'admin', status: 'active', id: Not(excludingId) },
    });
  }

  updateRefreshTokenId(
    userId: string,
    refreshTokenId: string | null,
  ): Promise<void> {
    // A new session is a sign-in; clearing it (logout, deactivation) is not.
    return this.repo
      .update(
        { id: userId },
        refreshTokenId
          ? { currentRefreshTokenId: refreshTokenId, lastLoginAt: new Date() }
          : { currentRefreshTokenId: null },
      )
      .then(() => undefined);
  }
}
