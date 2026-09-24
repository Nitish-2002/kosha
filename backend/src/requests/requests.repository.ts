import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeleteRequest, RequestStatus } from './delete-request.entity';
import { RollbackRequest } from './rollback-request.entity';

export interface ReviewFields {
  status: Exclude<RequestStatus, 'pending'>;
  reviewerId: string;
  reviewerNote: string | null;
  reviewedAt: Date;
}

@Injectable()
export class RequestsRepository {
  constructor(
    @InjectRepository(DeleteRequest)
    private readonly deleteRequests: Repository<DeleteRequest>,
    @InjectRepository(RollbackRequest)
    private readonly rollbackRequests: Repository<RollbackRequest>,
  ) {}

  createDelete(fields: Partial<DeleteRequest>): Promise<DeleteRequest> {
    return this.deleteRequests.save(this.deleteRequests.create(fields));
  }

  createRollback(fields: Partial<RollbackRequest>): Promise<RollbackRequest> {
    return this.rollbackRequests.save(this.rollbackRequests.create(fields));
  }

  findPendingDeletes(): Promise<DeleteRequest[]> {
    return this.deleteRequests.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
    });
  }

  findPendingRollbacks(): Promise<RollbackRequest[]> {
    return this.rollbackRequests.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
    });
  }

  findMineDeletes(requesterId: string): Promise<DeleteRequest[]> {
    return this.deleteRequests.find({
      where: { requesterId },
      order: { createdAt: 'DESC' },
    });
  }

  findMineRollbacks(requesterId: string): Promise<RollbackRequest[]> {
    return this.rollbackRequests.find({
      where: { requesterId },
      order: { createdAt: 'DESC' },
    });
  }

  findDeleteById(id: string): Promise<DeleteRequest | null> {
    return this.deleteRequests.findOneBy({ id });
  }

  findRollbackById(id: string): Promise<RollbackRequest | null> {
    return this.rollbackRequests.findOneBy({ id });
  }

  // One atomic UPDATE ... WHERE status = 'pending': of two concurrent
  // reviewers only one gets true, so a request is never executed twice.
  async claimPending(
    kind: 'delete' | 'rollback',
    id: string,
    review: ReviewFields,
  ): Promise<boolean> {
    const repo =
      kind === 'delete' ? this.deleteRequests : this.rollbackRequests;
    const result = await repo.update({ id, status: 'pending' }, review);
    return result.affected === 1;
  }

  // Undo a claim whose approved action then failed, so the request can be retried.
  async releaseClaim(kind: 'delete' | 'rollback', id: string): Promise<void> {
    const repo =
      kind === 'delete' ? this.deleteRequests : this.rollbackRequests;
    await repo.update(
      { id },
      {
        status: 'pending',
        reviewerId: null,
        reviewerNote: null,
        reviewedAt: null,
      },
    );
  }
}
