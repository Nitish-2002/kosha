import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GoogleChatService } from '../notifications/google-chat.service';
import { primaryFrontendUrl } from '../config/frontend-url';
import { RequestsRepository } from './requests.repository';
import {
  DeleteRequest,
  DeleteRequestTargetType,
  RequestStatus,
} from './delete-request.entity';
import { RollbackRequest } from './rollback-request.entity';
import { DbScriptUndoRequest } from './db-script-undo-request.entity';
import {
  DbScriptLookupRepository,
  EnvironmentComponentConfigLookupRepository,
  EnvironmentLookupRepository,
  ProjectComponentLookupRepository,
  ProjectLookupRepository,
  UserLookupRepository,
} from './lookups.repository';

const UNIQUE_VIOLATION = '23505';

export type RequestKind = 'delete' | 'rollback' | 'db_script_undo';

type CreatedNotificationType =
  | 'delete_request_created'
  | 'rollback_request_created'
  | 'db_script_undo_request_created';

export interface RequestListItem {
  id: string;
  kind: RequestKind;
  // db_script_undo only: which script, and why the Member says it never ran.
  dbScriptId: string | null;
  dbScriptLabel: string | null;
  reason: string | null;
  requesterId: string;
  requesterEmail: string;
  targetType: DeleteRequestTargetType | null;
  projectId: string | null;
  projectName: string | null;
  environmentId: string | null;
  environmentName: string | null;
  projectComponentId: string | null;
  componentName: string | null;
  key: string | null;
  targetVersionId: string | null;
  status: RequestStatus;
  reviewerId: string | null;
  reviewerEmail: string | null;
  reviewerNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

export interface CreateDeleteRequestInput {
  targetType: DeleteRequestTargetType;
  projectId?: string | null;
  environmentId?: string | null;
  projectComponentId?: string | null;
  key?: string | null;
}

@Injectable()
export class RequestsService {
  constructor(
    private readonly requestsRepository: RequestsRepository,
    private readonly userLookup: UserLookupRepository,
    private readonly projectLookup: ProjectLookupRepository,
    private readonly environmentLookup: EnvironmentLookupRepository,
    private readonly componentLookup: ProjectComponentLookupRepository,
    private readonly configLookup: EnvironmentComponentConfigLookupRepository,
    private readonly dbScriptLookup: DbScriptLookupRepository,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly chat: GoogleChatService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async createDeleteRequest(
    requesterId: string,
    input: CreateDeleteRequestInput,
  ): Promise<DeleteRequest> {
    const saved = await this.rejectDuplicate(() =>
      this.requestsRepository.createDelete({
        requesterId,
        targetType: input.targetType,
        projectId: input.projectId ?? null,
        environmentId: input.environmentId ?? null,
        projectComponentId: input.projectComponentId ?? null,
        key: input.key ?? null,
      }),
    );
    await this.recordAudit(requesterId, 'request', { deleteRequest: saved });
    await this.notifyAdminsCreated('delete_request_created', saved.id);
    return saved;
  }

  async createDbScriptUndoRequest(
    requesterId: string,
    scriptId: string,
    environmentId: string,
    reason: string,
  ): Promise<DbScriptUndoRequest> {
    const saved = await this.rejectDuplicate(() =>
      this.requestsRepository.createDbScriptUndo({
        requesterId,
        scriptId,
        environmentId,
        reason,
      }),
    );
    await this.recordAudit(requesterId, 'request', {
      dbScriptUndoRequest: saved,
    });
    await this.notifyAdminsCreated('db_script_undo_request_created', saved.id);
    return saved;
  }

  // "scriptId:environmentId" of every pending undo request on these
  // scripts, so the grid can show "undo requested" instead of inviting a
  // duplicate.
  async pendingDbScriptUndoKeys(scriptIds: string[]): Promise<Set<string>> {
    const pending =
      await this.requestsRepository.findPendingDbScriptUndosForScripts(
        scriptIds,
      );
    return new Set(
      pending.map((request) => `${request.scriptId}:${request.environmentId}`),
    );
  }

  // Audit row for a request being raised or rejected. The action executed on
  // approval is logged by the service that performs it (with requesterId).
  async recordAudit(
    userId: string,
    action: 'request' | 'reject',
    request:
      | { deleteRequest: DeleteRequest }
      | { rollbackRequest: RollbackRequest }
      | { dbScriptUndoRequest: DbScriptUndoRequest },
    reviewerNote?: string,
  ): Promise<void> {
    const [item] =
      'deleteRequest' in request
        ? await this.hydrate([request.deleteRequest], [], [])
        : 'rollbackRequest' in request
          ? await this.hydrate([], [request.rollbackRequest], [])
          : await this.hydrate([], [], [request.dbScriptUndoRequest]);
    await this.audit.record({
      userId,
      action,
      projectId: item.projectId ?? undefined,
      projectNameSnapshot: item.projectName ?? undefined,
      environmentId: item.environmentId ?? undefined,
      environmentNameSnapshot: item.environmentName ?? undefined,
      componentName: item.componentName ?? undefined,
      key: item.key ?? undefined,
      metadata: {
        requestId: item.id,
        requestKind: item.kind,
        targetType: item.targetType,
        requesterId: item.requesterId,
        ...(item.targetVersionId && { targetVersionId: item.targetVersionId }),
        ...(item.dbScriptLabel && { requestDbScriptLabel: item.dbScriptLabel }),
        ...(item.reason && { reason: item.reason }),
        ...(reviewerNote && { reviewerNote }),
      },
    });
  }

  // The partial unique indexes (UniquePendingRequests migration) allow one
  // pending request per target; a second one is a 409, not a new row.
  private async rejectDuplicate<T>(create: () => Promise<T>): Promise<T> {
    try {
      return await create();
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException(
          'A request for this is already waiting for Admin review.',
        );
      }
      throw error;
    }
  }

  async createRollbackRequest(
    requesterId: string,
    environmentComponentConfigId: string,
    key: string | null,
    targetVersionId: string,
  ): Promise<RollbackRequest> {
    const saved = await this.rejectDuplicate(() =>
      this.requestsRepository.createRollback({
        requesterId,
        environmentComponentConfigId,
        key,
        targetVersionId,
      }),
    );
    await this.recordAudit(requesterId, 'request', { rollbackRequest: saved });
    await this.notifyAdminsCreated('rollback_request_created', saved.id);
    return saved;
  }

  async listPending(): Promise<RequestListItem[]> {
    const [deletes, rollbacks, undos] = await Promise.all([
      this.requestsRepository.findPendingDeletes(),
      this.requestsRepository.findPendingRollbacks(),
      this.requestsRepository.findPendingDbScriptUndos(),
    ]);
    return this.hydrate(deletes, rollbacks, undos);
  }

  async listMine(requesterId: string): Promise<RequestListItem[]> {
    const [deletes, rollbacks, undos] = await Promise.all([
      this.requestsRepository.findMineDeletes(requesterId),
      this.requestsRepository.findMineRollbacks(requesterId),
      this.requestsRepository.findMineDbScriptUndos(requesterId),
    ]);
    return this.hydrate(deletes, rollbacks, undos);
  }

  private async notifyAdminsCreated(
    type: CreatedNotificationType,
    requestId: string,
  ): Promise<void> {
    const admins = await this.users.findAdmins();
    await this.notifications.createForUsers(
      admins.map((admin) => admin.id),
      type,
      { requestId },
    );
    const url = `${primaryFrontendUrl(this.config)}/requests`;
    const requestName: Record<CreatedNotificationType, string> = {
      delete_request_created: 'delete',
      rollback_request_created: 'rollback',
      db_script_undo_request_created: 'DB script undo',
    };
    await this.chat.notify(
      `New Kosha ${requestName[type]} request. Review: ${url}`,
    );
  }

  // Shared by listPending/listMine — same rows, different WHERE clause.
  // Rollback rows only carry a config id, so it's resolved first to feed
  // into the same batched environment/component/project lookups delete rows
  // use directly.
  private async hydrate(
    deletes: DeleteRequest[],
    rollbacks: RollbackRequest[],
    undos: DbScriptUndoRequest[],
  ): Promise<RequestListItem[]> {
    const configIds = [
      ...new Set(rollbacks.map((r) => r.environmentComponentConfigId)),
    ];
    const [configs, scripts] = await Promise.all([
      this.configLookup.findByIds(configIds),
      this.dbScriptLookup.findByIds([
        ...new Set(undos.map((row) => row.scriptId)),
      ]),
    ]);
    const configById = new Map(configs.map((c) => [c.id, c]));
    const scriptById = new Map(scripts.map((script) => [script.id, script]));

    const environmentIds = new Set<string>();
    const componentIds = new Set<string>();
    for (const row of undos) environmentIds.add(row.environmentId);
    for (const row of deletes) {
      if (row.environmentId) environmentIds.add(row.environmentId);
      if (row.projectComponentId) componentIds.add(row.projectComponentId);
    }
    for (const row of rollbacks) {
      const config = configById.get(row.environmentComponentConfigId);
      if (config) {
        environmentIds.add(config.environmentId);
        componentIds.add(config.projectComponentId);
      }
    }

    const environments = await this.environmentLookup.findByIds([
      ...environmentIds,
    ]);
    const environmentById = new Map(environments.map((e) => [e.id, e]));

    const projectIds = new Set<string>();
    for (const row of deletes) {
      if (row.projectId) projectIds.add(row.projectId);
    }
    for (const environment of environments) {
      projectIds.add(environment.projectId);
    }

    const [projects, components, users] = await Promise.all([
      this.projectLookup.findByIds([...projectIds]),
      this.componentLookup.findByIds([...componentIds]),
      this.userLookup.findByIds([
        ...new Set(
          [
            ...deletes.map((r) => r.requesterId),
            ...rollbacks.map((r) => r.requesterId),
            ...undos.map((r) => r.requesterId),
            ...deletes.map((r) => r.reviewerId),
            ...rollbacks.map((r) => r.reviewerId),
            ...undos.map((r) => r.reviewerId),
          ].filter((id): id is string => id !== null),
        ),
      ]),
    ]);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const componentById = new Map(components.map((c) => [c.id, c]));
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    const deleteItems: RequestListItem[] = deletes.map((row) => {
      const environment = row.environmentId
        ? environmentById.get(row.environmentId)
        : undefined;
      const projectId = row.projectId ?? environment?.projectId ?? null;
      return {
        id: row.id,
        kind: 'delete',
        dbScriptId: null,
        dbScriptLabel: null,
        reason: null,
        requesterId: row.requesterId,
        requesterEmail: emailById.get(row.requesterId) ?? '(deleted user)',
        targetType: row.targetType,
        projectId,
        projectName: projectId
          ? (projectById.get(projectId)?.name ?? '(deleted project)')
          : null,
        environmentId: row.environmentId,
        environmentName: row.environmentId
          ? (environment?.name ?? '(deleted environment)')
          : null,
        projectComponentId: row.projectComponentId,
        componentName: row.projectComponentId
          ? (componentById.get(row.projectComponentId)?.name ??
            '(deleted component)')
          : null,
        key: row.key,
        targetVersionId: null,
        status: row.status,
        reviewerId: row.reviewerId,
        reviewerEmail: row.reviewerId
          ? (emailById.get(row.reviewerId) ?? '(deleted user)')
          : null,
        reviewerNote: row.reviewerNote,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
      };
    });

    const rollbackItems: RequestListItem[] = rollbacks.map((row) => {
      const config = configById.get(row.environmentComponentConfigId);
      const environment = config
        ? environmentById.get(config.environmentId)
        : undefined;
      return {
        id: row.id,
        kind: 'rollback',
        dbScriptId: null,
        dbScriptLabel: null,
        reason: null,
        requesterId: row.requesterId,
        requesterEmail: emailById.get(row.requesterId) ?? '(deleted user)',
        targetType: null,
        projectId: environment?.projectId ?? null,
        projectName: environment
          ? (projectById.get(environment.projectId)?.name ??
            '(deleted project)')
          : null,
        environmentId: config?.environmentId ?? null,
        environmentName: config
          ? (environment?.name ?? '(deleted environment)')
          : null,
        projectComponentId: config?.projectComponentId ?? null,
        componentName: config
          ? (componentById.get(config.projectComponentId)?.name ??
            '(deleted component)')
          : null,
        key: row.key,
        targetVersionId: row.targetVersionId,
        status: row.status,
        reviewerId: row.reviewerId,
        reviewerEmail: row.reviewerId
          ? (emailById.get(row.reviewerId) ?? '(deleted user)')
          : null,
        reviewerNote: row.reviewerNote,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
      };
    });

    const undoItems: RequestListItem[] = undos.map((row) => {
      const environment = environmentById.get(row.environmentId);
      const script = scriptById.get(row.scriptId);
      return {
        id: row.id,
        kind: 'db_script_undo',
        dbScriptId: row.scriptId,
        dbScriptLabel: script
          ? `${String(script.sequence).padStart(3, '0')} ${script.name}`
          : '(deleted script)',
        reason: row.reason,
        requesterId: row.requesterId,
        requesterEmail: emailById.get(row.requesterId) ?? '(deleted user)',
        targetType: null,
        projectId: environment?.projectId ?? null,
        projectName: environment
          ? (projectById.get(environment.projectId)?.name ??
            '(deleted project)')
          : null,
        environmentId: row.environmentId,
        environmentName: environment?.name ?? '(deleted environment)',
        projectComponentId: null,
        componentName: null,
        key: null,
        targetVersionId: null,
        status: row.status,
        reviewerId: row.reviewerId,
        reviewerEmail: row.reviewerId
          ? (emailById.get(row.reviewerId) ?? '(deleted user)')
          : null,
        reviewerNote: row.reviewerNote,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
      };
    });

    return [...deleteItems, ...rollbackItems, ...undoItems].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }
}
