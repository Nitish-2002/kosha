import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectsService } from '../projects/projects.service';
import { EnvironmentsService } from '../environments/environments.service';
import { EnvironmentComponentConfigsRepository } from '../environments/environment-component-configs.repository';
import { EnvironmentComponentConfig } from '../environments/environment-component-config.entity';
import { VariablesService } from '../variables/variables.service';
import { RequestsService } from '../requests/requests.service';
import { RequestsRepository } from '../requests/requests.repository';
import { DeleteRequest } from '../requests/delete-request.entity';
import { RollbackRequest } from '../requests/rollback-request.entity';

type Outcome = 'approved' | 'rejected';

// Sits above RequestsModule (create + list, a leaf module) specifically to
// execute an approved request — that needs real access to
// Projects/Environments/Variables services, which RequestsModule can't
// import without creating a cycle (those modules import RequestsModule to
// create a request in the first place). See requests.module.ts.
@Injectable()
export class RequestReviewsService {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly requestsRepository: RequestsRepository,
    private readonly projectsService: ProjectsService,
    private readonly environmentsService: EnvironmentsService,
    private readonly configsRepository: EnvironmentComponentConfigsRepository,
    private readonly variablesService: VariablesService,
    private readonly notifications: NotificationsService,
  ) {}

  listPending() {
    return this.requestsService.listPending();
  }

  async approve(id: string, reviewerId: string, note?: string): Promise<void> {
    await this.resolve(id, 'approved', reviewerId, note);
  }

  async reject(id: string, reviewerId: string, note?: string): Promise<void> {
    await this.resolve(id, 'rejected', reviewerId, note);
  }

  private async resolve(
    id: string,
    outcome: Outcome,
    reviewerId: string,
    note?: string,
  ): Promise<void> {
    const deleteRequest = await this.requestsRepository.findDeleteById(id);
    if (deleteRequest) {
      return this.resolveDelete(deleteRequest, outcome, reviewerId, note);
    }
    const rollbackRequest = await this.requestsRepository.findRollbackById(id);
    if (rollbackRequest) {
      return this.resolveRollback(rollbackRequest, outcome, reviewerId, note);
    }
    throw new NotFoundException();
  }

  // Claim first (atomic), then act: a second concurrent reviewer loses the
  // claim and gets 409 instead of executing the same request again. If the
  // approved action itself fails, the claim is released so it stays pending.
  private async claimAndRun(
    kind: 'delete' | 'rollback',
    id: string,
    outcome: Outcome,
    reviewerId: string,
    note: string | undefined,
    execute: () => Promise<void>,
  ): Promise<void> {
    const claimed = await this.requestsRepository.claimPending(kind, id, {
      status: outcome,
      reviewerId,
      reviewerNote: note ?? null,
      reviewedAt: new Date(),
    });
    if (!claimed) {
      throw new ConflictException('This request has already been reviewed.');
    }
    if (outcome !== 'approved') return;
    try {
      await execute();
    } catch (error) {
      await this.requestsRepository.releaseClaim(kind, id);
      throw error;
    }
  }

  private async resolveDelete(
    request: DeleteRequest,
    outcome: Outcome,
    reviewerId: string,
    note?: string,
  ): Promise<void> {
    await this.claimAndRun(
      'delete',
      request.id,
      outcome,
      reviewerId,
      note,
      () => this.executeDelete(request, reviewerId),
    );
    await this.notifications.createForUsers(
      [request.requesterId],
      outcome === 'approved'
        ? 'delete_request_approved'
        : 'delete_request_rejected',
      { requestId: request.id },
    );
  }

  private async executeDelete(
    request: DeleteRequest,
    reviewerId: string,
  ): Promise<void> {
    // PRD Feature 6 — the executed action is logged with both the
    // requester and the approver; the audit row's userId is always the
    // approver (CLAUDE.md #2), so the requester goes in metadata instead.
    const requestContext = {
      requestId: request.id,
      requesterId: request.requesterId,
    };
    switch (request.targetType) {
      case 'project':
        await this.projectsService.remove(
          request.projectId!,
          reviewerId,
          requestContext,
        );
        return;
      case 'environment':
        await this.environmentsService.remove(
          request.environmentId!,
          reviewerId,
          requestContext,
        );
        return;
      case 'component': {
        const config = await this.findConfigOrFail(
          request.environmentId!,
          request.projectComponentId!,
        );
        await this.environmentsService.removeComponentConfig(
          request.environmentId!,
          config.id,
          reviewerId,
          requestContext,
        );
        return;
      }
      case 'variable': {
        const config = await this.findConfigOrFail(
          request.environmentId!,
          request.projectComponentId!,
        );
        await this.variablesService.remove(
          request.environmentId!,
          config.id,
          request.key!,
          reviewerId,
          requestContext,
        );
        return;
      }
    }
  }

  private async resolveRollback(
    request: RollbackRequest,
    outcome: Outcome,
    reviewerId: string,
    note?: string,
  ): Promise<void> {
    await this.claimAndRun(
      'rollback',
      request.id,
      outcome,
      reviewerId,
      note,
      async () => {
        const config = await this.configsRepository.findById(
          request.environmentComponentConfigId,
        );
        if (!config) {
          throw new NotFoundException(
            'That component connection no longer exists.',
          );
        }
        await this.variablesService.rollback(
          config.environmentId,
          config.id,
          {
            key: request.key ?? undefined,
            targetVersionId: request.targetVersionId,
          },
          reviewerId,
          { requestId: request.id, requesterId: request.requesterId },
        );
      },
    );
    await this.notifications.createForUsers(
      [request.requesterId],
      outcome === 'approved'
        ? 'rollback_request_approved'
        : 'rollback_request_rejected',
      { requestId: request.id },
    );
  }

  private async findConfigOrFail(
    environmentId: string,
    projectComponentId: string,
  ): Promise<EnvironmentComponentConfig> {
    const config = await this.configsRepository.findByEnvironmentAndComponent(
      environmentId,
      projectComponentId,
    );
    if (!config) {
      throw new NotFoundException(
        'That component connection no longer exists.',
      );
    }
    return config;
  }
}
