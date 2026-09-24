import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
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
import {
  EnvironmentComponentConfigLookupRepository,
  EnvironmentLookupRepository,
  ProjectComponentLookupRepository,
  ProjectLookupRepository,
  UserLookupRepository,
} from './lookups.repository';

const UNIQUE_VIOLATION = '23505';

export interface RequestListItem {
  id: string;
  kind: 'delete' | 'rollback';
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
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly chat: GoogleChatService,
    private readonly config: ConfigService,
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
    await this.notifyAdminsCreated('delete_request_created', saved.id);
    return saved;
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
    await this.notifyAdminsCreated('rollback_request_created', saved.id);
    return saved;
  }

  async listPending(): Promise<RequestListItem[]> {
    const [deletes, rollbacks] = await Promise.all([
      this.requestsRepository.findPendingDeletes(),
      this.requestsRepository.findPendingRollbacks(),
    ]);
    return this.hydrate(deletes, rollbacks);
  }

  async listMine(requesterId: string): Promise<RequestListItem[]> {
    const [deletes, rollbacks] = await Promise.all([
      this.requestsRepository.findMineDeletes(requesterId),
      this.requestsRepository.findMineRollbacks(requesterId),
    ]);
    return this.hydrate(deletes, rollbacks);
  }

  private async notifyAdminsCreated(
    type: 'delete_request_created' | 'rollback_request_created',
    requestId: string,
  ): Promise<void> {
    const admins = await this.users.findAdmins();
    await this.notifications.createForUsers(
      admins.map((admin) => admin.id),
      type,
      { requestId },
    );
    const url = `${primaryFrontendUrl(this.config)}/requests`;
    await this.chat.notify(
      `New Kosha ${type === 'delete_request_created' ? 'delete' : 'rollback'} request. Review: ${url}`,
    );
  }

  // Shared by listPending/listMine — same rows, different WHERE clause.
  // Rollback rows only carry a config id, so it's resolved first to feed
  // into the same batched environment/component/project lookups delete rows
  // use directly.
  private async hydrate(
    deletes: DeleteRequest[],
    rollbacks: RollbackRequest[],
  ): Promise<RequestListItem[]> {
    const configIds = [
      ...new Set(rollbacks.map((r) => r.environmentComponentConfigId)),
    ];
    const configs = await this.configLookup.findByIds(configIds);
    const configById = new Map(configs.map((c) => [c.id, c]));

    const environmentIds = new Set<string>();
    const componentIds = new Set<string>();
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
            ...deletes.map((r) => r.reviewerId),
            ...rollbacks.map((r) => r.reviewerId),
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

    return [...deleteItems, ...rollbackItems].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }
}
