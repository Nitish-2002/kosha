import { Injectable } from '@nestjs/common';
import { AuditAction } from './audit-log.entity';
import { AuditRepository } from './audit.repository';
import { UserLookupRepository } from './user-lookup.repository';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

export interface RecordAuditParams {
  userId: string;
  action: AuditAction;
  metadata?: Record<string, unknown>;
  projectId?: string;
  projectNameSnapshot?: string;
  environmentId?: string;
  environmentNameSnapshot?: string;
  componentName?: string;
  key?: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userEmail: string;
  action: AuditAction;
  projectId: string | null;
  projectName: string | null;
  environmentId: string | null;
  environmentName: string | null;
  componentName: string | null;
  key: string | null;
  // Human-readable summary for actions that aren't about a variable at all
  // (e.g. a member access grant/revoke) — those rows have no key/component,
  // so without this the row renders as all dashes even though it's a real,
  // fully-logged event.
  details: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
}

const DEFAULT_LIMIT = 50;
const VALUE_PREVIEW_LENGTH = 40;

function truncate(value: string): string {
  return value.length > VALUE_PREVIEW_LENGTH
    ? `"${value.slice(0, VALUE_PREVIEW_LENGTH)}…"`
    : `"${value}"`;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly auditRepository: AuditRepository,
    private readonly userLookup: UserLookupRepository,
  ) {}

  async record(params: RecordAuditParams): Promise<void> {
    await this.auditRepository.save({
      userId: params.userId,
      action: params.action,
      metadata: params.metadata ?? null,
      projectId: params.projectId ?? null,
      projectNameSnapshot: params.projectNameSnapshot ?? null,
      environmentId: params.environmentId ?? null,
      environmentNameSnapshot: params.environmentNameSnapshot ?? null,
      componentName: params.componentName ?? null,
      key: params.key ?? null,
    });
  }

  async list(filter: ListAuditLogDto): Promise<AuditLogPage> {
    const limit = filter.limit ?? DEFAULT_LIMIT;
    const offset = filter.offset ?? 0;
    const [rows, total] = await this.auditRepository.findFiltered({
      projectId: filter.projectId,
      userId: filter.userId,
      action: filter.action,
      from: filter.from,
      to: filter.to,
      limit,
      offset,
    });

    const assignedUserIds = rows
      .map((row) => row.metadata?.assignedUserId)
      .filter((id): id is string => typeof id === 'string');
    const userIds = [
      ...new Set([...rows.map((row) => row.userId), ...assignedUserIds]),
    ];
    const users = await this.userLookup.findByIds(userIds);
    const emailById = new Map(users.map((user) => [user.id, user.email]));

    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userEmail: emailById.get(row.userId) ?? '(deleted user)',
        action: row.action,
        projectId: row.projectId,
        projectName: row.projectNameSnapshot,
        environmentId: row.environmentId,
        environmentName: row.environmentNameSnapshot,
        componentName: row.componentName,
        key: row.key,
        details: this.describe(row, emailById),
        metadata: row.metadata,
        createdAt: row.createdAt,
      })),
      total,
    };
  }

  // Turns metadata that would otherwise be invisible in the table into a
  // one-line summary:
  // - Member access grant/revoke rows carry an assignedUserId instead of a
  //   key, so without this they render as all dashes despite being a real,
  //   fully-logged event.
  // - A Secret-flag toggle (VariablesService.updateSecretFlag) is recorded
  //   as action='update' on the same key an actual value edit would use —
  //   without this it's indistinguishable from someone having changed the
  //   value itself.
  // - create()/update() on a non-Secret variable carry the actual value(s)
  //   — otherwise the log says a key changed but never what to or from,
  //   which is most of what makes an audit trail useful in the first place.
  //   Never done for a Secret (VariablesService only ever sets
  //   metadata.secretValue=true for those) — the audit log must not become
  //   a second, ungoverned copy of secret history alongside S3.
  private describe(
    row: { action: AuditAction; metadata: Record<string, unknown> | null },
    emailById: Map<string, string>,
  ): string | null {
    if (row.metadata?.secretFlagChanged === true) {
      return row.metadata.isSecret === true
        ? 'Flagged as Secret'
        : 'Secret flag removed';
    }
    if (row.metadata?.secretValue === true) {
      return 'Secret value (use Reveal to view)';
    }
    const { previousValue, newValue } = row.metadata ?? {};
    if (typeof newValue === 'string') {
      return typeof previousValue === 'string'
        ? `${truncate(previousValue)} → ${truncate(newValue)}`
        : `Set to ${truncate(newValue)}`;
    }
    const assignedUserId = row.metadata?.assignedUserId;
    if (typeof assignedUserId !== 'string') return null;
    const email = emailById.get(assignedUserId) ?? '(deleted user)';
    return row.action === 'delete'
      ? `Access revoked from ${email}`
      : `Access granted to ${email}`;
  }
}
