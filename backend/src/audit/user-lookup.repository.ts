import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/user.entity';

// Read-only, local to this module rather than importing UsersModule —
// UsersModule already imports AuditModule (for AuditService), so importing
// it back here would be a circular module dependency. Only ever used to
// resolve userId -> email for display; audit rows are never written through
// this. Users are never hard-deleted (only deactivated), so a live lookup
// is safe here — unlike projectNameSnapshot/environmentNameSnapshot, which
// exist because those rows really can disappear.
@Injectable()
export class UserLookupRepository {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findByIds(ids: string[]): Promise<User[]> {
    return ids.length ? this.repo.findBy({ id: In(ids) }) : Promise.resolve([]);
  }
}
