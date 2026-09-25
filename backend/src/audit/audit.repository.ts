import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditAction, AuditLog, NON_WRITE_ACTIONS } from './audit-log.entity';

export interface AuditLogFilter {
  projectId?: string;
  userId?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditRepository {
  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  save(fields: Omit<AuditLog, 'id' | 'createdAt'>): Promise<AuditLog> {
    return this.repo.save(this.repo.create(fields));
  }

  // Newest write (reveals, requests etc. don't count) per project, one row
  // each, in one query — DISTINCT ON keeps the first row per projectId in
  // createdAt DESC order.
  latestWritePerProject(projectIds: string[]): Promise<AuditLog[]> {
    if (projectIds.length === 0) return Promise.resolve([]);
    return this.repo
      .createQueryBuilder('audit')
      .distinctOn(['"audit"."projectId"'])
      .where('audit.projectId IN (:...projectIds)', { projectIds })
      .andWhere('audit.action NOT IN (:...nonWrites)', {
        nonWrites: NON_WRITE_ACTIONS,
      })
      .orderBy('"audit"."projectId"')
      .addOrderBy('audit.createdAt', 'DESC')
      .getMany();
  }

  findFiltered(filter: AuditLogFilter): Promise<[AuditLog[], number]> {
    const where: FindOptionsWhere<AuditLog> = {};
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.userId) where.userId = filter.userId;
    if (filter.action) where.action = filter.action;
    if (filter.from && filter.to) {
      where.createdAt = And(
        MoreThanOrEqual(new Date(filter.from)),
        LessThanOrEqual(new Date(filter.to)),
      );
    } else if (filter.from) {
      where.createdAt = MoreThanOrEqual(new Date(filter.from));
    } else if (filter.to) {
      where.createdAt = LessThanOrEqual(new Date(filter.to));
    }

    return this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: filter.limit,
      skip: filter.offset,
    });
  }
}
