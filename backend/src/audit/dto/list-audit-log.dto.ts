import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type { AuditAction } from '../audit-log.entity';

const AUDIT_ACTIONS: AuditAction[] = [
  'create',
  'update',
  'delete',
  'rollback',
  'reveal',
  'import',
];

export class ListAuditLogDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: AuditAction;

  // 7-day retention (CLAUDE.md/TRD — Retention) means `from` can't usefully
  // predate that, but the DB doesn't enforce it — an old `from` just returns
  // whatever still exists, same as any other filter that matches nothing.
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
