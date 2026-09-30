import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DeleteRequest, RequestStatus } from './delete-request.entity';
import { RollbackRequest } from './rollback-request.entity';
import { DbScriptUndoRequest } from './db-script-undo-request.entity';

export interface ReviewFields {
  status: Exclude<RequestStatus, 'pending'>;
  reviewerId: string;
  reviewerNote: string | null;
  reviewedAt: Date;
}

export type RequestTableKind = 'delete' | 'rollback' | 'db_script_undo';

@Injectable()
export class RequestsRepository {
  constructor(
    @InjectRepository(DeleteRequest)
    private readonly deleteRequests: Repository<DeleteRequest>,
    @InjectRepository(RollbackRequest)
    private readonly rollbackRequests: Repository<RollbackRequest>,
    @InjectRepository(DbScriptUndoRequest)
    private readonly dbScriptUndoRequests: Repository<DbScriptUndoRequest>,
  ) {}

  createDelete(fields: Partial<DeleteRequest>): Promise<DeleteRequest> {
    return this.deleteRequests.save(this.deleteRequests.create(fields));
  }

  createRollback(fields: Partial<RollbackRequest>): Promise<RollbackRequest> {
    return this.rollbackRequests.save(this.rollbackRequests.create(fields));
  }

  createDbScriptUndo(
    fields: Partial<DbScriptUndoRequest>,
  ): Promise<DbScriptUndoRequest> {
    return this.dbScriptUndoRequests.save(
      this.dbScriptUndoRequests.create(fields),
    );
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

  findPendingDbScriptUndos(): Promise<DbScriptUndoRequest[]> {
    return this.dbScriptUndoRequests.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
    });
  }

  // For the DB Scripts grid's "undo requested" marker.
  findPendingDbScriptUndosForScripts(
    scriptIds: string[],
  ): Promise<DbScriptUndoRequest[]> {
    if (scriptIds.length === 0) return Promise.resolve([]);
    return this.dbScriptUndoRequests.findBy({
      scriptId: In(scriptIds),
      status: 'pending',
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

  findMineDbScriptUndos(requesterId: string): Promise<DbScriptUndoRequest[]> {
    return this.dbScriptUndoRequests.find({
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

  findDbScriptUndoById(id: string): Promise<DbScriptUndoRequest | null> {
    return this.dbScriptUndoRequests.findOneBy({ id });
  }

  // One atomic UPDATE ... WHERE status = 'pending': of two concurrent
  // reviewers only one gets true, so a request is never executed twice.
  async claimPending(
    kind: RequestTableKind,
    id: string,
    review: ReviewFields,
  ): Promise<boolean> {
    const result = await this.tableFor(kind).update(
      { id, status: 'pending' },
      review,
    );
    return result.affected === 1;
  }

  // Undo a claim whose approved action then failed, so the request can be retried.
  async releaseClaim(kind: RequestTableKind, id: string): Promise<void> {
    await this.tableFor(kind).update(
      { id },
      {
        status: 'pending',
        reviewerId: null,
        reviewerNote: null,
        reviewedAt: null,
      },
    );
  }

  private tableFor(
    kind: RequestTableKind,
  ): Repository<DeleteRequest | RollbackRequest | DbScriptUndoRequest> {
    const tables = {
      delete: this.deleteRequests,
      rollback: this.rollbackRequests,
      db_script_undo: this.dbScriptUndoRequests,
    };
    return tables[kind] as Repository<
      DeleteRequest | RollbackRequest | DbScriptUndoRequest
    >;
  }
}
