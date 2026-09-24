import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { User, UserRole } from './user.entity';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findById(id);
  }

  findAdmins(): Promise<User[]> {
    return this.usersRepository.findAdmins();
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.findAll();
  }

  create(input: { email: string; role: UserRole }): Promise<User> {
    return this.usersRepository.create(input);
  }

  async updateRole(
    id: string,
    role: UserRole,
    reviewerId: string,
  ): Promise<User> {
    const user = await this.findOrFail(id);
    if (user.role === 'admin' && role !== 'admin') {
      await this.assertNotLastActiveAdmin(id);
    }
    const previousRole = user.role;
    user.role = role;
    const saved = await this.usersRepository.save(user);

    await this.audit.record({
      userId: reviewerId,
      action: 'update',
      metadata: { targetUserId: id, previousRole, newRole: role },
    });
    return saved;
  }

  async deactivate(id: string, reviewerId: string): Promise<User> {
    if (id === reviewerId) {
      throw new ConflictException('Cannot deactivate your own account');
    }
    const user = await this.findOrFail(id);
    if (user.role === 'admin') {
      await this.assertNotLastActiveAdmin(id);
    }
    user.status = 'deactivated';
    user.currentRefreshTokenId = null;
    const saved = await this.usersRepository.save(user);

    await this.audit.record({
      userId: reviewerId,
      action: 'update',
      metadata: { targetUserId: id, status: 'deactivated' },
    });
    return saved;
  }

  async reactivate(id: string, reviewerId: string): Promise<User> {
    const user = await this.findOrFail(id);
    user.status = 'active';
    const saved = await this.usersRepository.save(user);

    await this.audit.record({
      userId: reviewerId,
      action: 'update',
      metadata: { targetUserId: id, status: 'active' },
    });
    return saved;
  }

  setCurrentRefreshTokenId(
    userId: string,
    refreshTokenId: string | null,
  ): Promise<void> {
    return this.usersRepository.updateRefreshTokenId(userId, refreshTokenId);
  }

  private async findOrFail(id: string): Promise<User> {
    const found = await this.findById(id);
    if (!found) {
      throw new NotFoundException();
    }
    return found;
  }

  // Guards against locking Kosha out of itself — no one left who can approve
  // access requests, manage credentials, or fix a mistake without raw SQL.
  private async assertNotLastActiveAdmin(excludingId: string): Promise<void> {
    const remaining =
      await this.usersRepository.countActiveAdminsExcluding(excludingId);
    if (remaining === 0) {
      throw new ConflictException('Cannot remove the last active Admin');
    }
  }
}
