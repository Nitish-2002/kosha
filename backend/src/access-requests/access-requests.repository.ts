import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessRequest } from './access-request.entity';

@Injectable()
export class AccessRequestsRepository {
  constructor(
    @InjectRepository(AccessRequest)
    private readonly repo: Repository<AccessRequest>,
  ) {}

  findByEmail(email: string): Promise<AccessRequest | null> {
    return this.repo.findOneBy({ email });
  }

  findById(id: string): Promise<AccessRequest | null> {
    return this.repo.findOneBy({ id });
  }

  findPending(): Promise<AccessRequest[]> {
    return this.repo.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
    });
  }

  create(email: string): AccessRequest {
    return this.repo.create({ email, status: 'pending' });
  }

  save(request: AccessRequest): Promise<AccessRequest> {
    return this.repo.save(request);
  }
}
