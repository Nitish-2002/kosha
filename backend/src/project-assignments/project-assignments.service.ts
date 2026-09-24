import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ProjectAssignment } from './project-assignment.entity';
import { ProjectAssignmentsRepository } from './project-assignments.repository';
import {
  EnvironmentLookupRepository,
  ProjectComponentLookupRepository,
  ProjectLookupRepository,
  UserLookupRepository,
} from './lookups.repository';
import { CreateAssignmentDto } from './dto/create-assignment.dto';

export interface AssignmentSummary {
  id: string;
  userId: string;
  userEmail: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  projectComponentId: string | null;
  componentName: string | null;
  createdAt: Date;
}

@Injectable()
export class ProjectAssignmentsService {
  constructor(
    private readonly assignmentsRepository: ProjectAssignmentsRepository,
    private readonly userLookup: UserLookupRepository,
    private readonly projectLookup: ProjectLookupRepository,
    private readonly componentLookup: ProjectComponentLookupRepository,
    private readonly environmentLookup: EnvironmentLookupRepository,
    private readonly audit: AuditService,
  ) {}

  async listForUser(userId: string): Promise<AssignmentSummary[]> {
    const rows = await this.assignmentsRepository.findForUser(userId);
    return this.hydrate(rows);
  }

  async listForProject(projectId: string): Promise<AssignmentSummary[]> {
    const rows = await this.assignmentsRepository.findForProject(projectId);
    return this.hydrate(rows);
  }

  async create(
    targetUserId: string,
    dto: CreateAssignmentDto,
    createdBy: string,
  ): Promise<AssignmentSummary> {
    const user = await this.userLookup.findById(targetUserId);
    if (!user) throw new NotFoundException();

    const environment = await this.environmentLookup.findById(
      dto.environmentId,
    );
    if (!environment || environment.projectId !== dto.projectId) {
      throw new BadRequestException(
        'That environment does not belong to this project.',
      );
    }

    let componentName: string | undefined;
    if (dto.projectComponentId) {
      const component = await this.componentLookup.findById(
        dto.projectComponentId,
      );
      if (!component || component.projectId !== dto.projectId) {
        throw new BadRequestException(
          'That component does not belong to this project.',
        );
      }
      componentName = component.name;
    }

    const duplicate = await this.assignmentsRepository.findOneMatching(
      targetUserId,
      dto.environmentId,
      dto.projectComponentId ?? null,
    );
    if (duplicate) {
      throw new ConflictException('This assignment already exists.');
    }

    const saved = await this.assignmentsRepository.save(
      this.assignmentsRepository.create({
        userId: targetUserId,
        projectId: dto.projectId,
        environmentId: dto.environmentId,
        projectComponentId: dto.projectComponentId ?? null,
        createdBy,
      }),
    );

    const project = await this.projectLookup.findById(dto.projectId);
    await this.audit.record({
      userId: createdBy,
      action: 'create',
      projectId: dto.projectId,
      projectNameSnapshot: project?.name,
      environmentId: dto.environmentId,
      environmentNameSnapshot: environment.name,
      componentName,
      metadata: {
        assignedUserId: targetUserId,
        projectComponentId: dto.projectComponentId ?? null,
      },
    });

    const [summary] = await this.hydrate([saved]);
    return summary;
  }

  async remove(id: string, removedBy: string): Promise<void> {
    const assignment = await this.assignmentsRepository.findById(id);
    if (!assignment) throw new NotFoundException();

    const [project, environment, component] = await Promise.all([
      this.projectLookup.findById(assignment.projectId),
      this.environmentLookup.findById(assignment.environmentId),
      assignment.projectComponentId
        ? this.componentLookup.findById(assignment.projectComponentId)
        : null,
    ]);

    await this.assignmentsRepository.remove(assignment);
    await this.audit.record({
      userId: removedBy,
      action: 'delete',
      projectId: assignment.projectId,
      projectNameSnapshot: project?.name,
      environmentId: assignment.environmentId,
      environmentNameSnapshot: environment?.name,
      componentName: component?.name,
      metadata: {
        assignedUserId: assignment.userId,
        projectComponentId: assignment.projectComponentId,
      },
    });
  }

  // ---- Scoping reads, used by Projects/Environments/Variables services to
  // restrict a Member to exactly their assigned surface area. Never called
  // for an Admin caller — every call site checks role first. ----

  async assignedProjectIds(userId: string): Promise<Set<string>> {
    const rows = await this.assignmentsRepository.findForUser(userId);
    return new Set(rows.map((r) => r.projectId));
  }

  async hasProjectAccess(userId: string, projectId: string): Promise<boolean> {
    const rows = await this.assignmentsRepository.findForUserAndProject(
      userId,
      projectId,
    );
    return rows.length > 0;
  }

  async assignedEnvironmentIds(
    userId: string,
    projectId: string,
  ): Promise<Set<string>> {
    const rows = await this.assignmentsRepository.findForUserAndProject(
      userId,
      projectId,
    );
    return new Set(rows.map((r) => r.environmentId));
  }

  async hasEnvironmentAccess(
    userId: string,
    environmentId: string,
  ): Promise<boolean> {
    const rows = await this.assignmentsRepository.findForUserAndEnvironment(
      userId,
      environmentId,
    );
    return rows.length > 0;
  }

  // Which components of this environment the user can see: `all: true` means
  // every component (a wildcard row exists), otherwise exactly `componentIds`.
  async componentScopeForEnvironment(
    userId: string,
    environmentId: string,
  ): Promise<{ all: boolean; componentIds: Set<string> }> {
    const rows = await this.assignmentsRepository.findForUserAndEnvironment(
      userId,
      environmentId,
    );
    const all = rows.some((r) => r.projectComponentId === null);
    return {
      all,
      componentIds: new Set(
        rows
          .map((r) => r.projectComponentId)
          .filter((id): id is string => id !== null),
      ),
    };
  }

  // Everything ProjectsService needs to scope one project's summary for a
  // Member, from one query: which environments they can see (the count
  // shown on a project card) and which components (the union across every
  // environment they're assigned to in this project — `all: true` means at
  // least one of those assignments is a wildcard, so the full catalog
  // applies). Both were previously two separate methods each re-querying
  // the same assignment rows.
  async projectScope(
    userId: string,
    projectId: string,
  ): Promise<{
    environmentIds: Set<string>;
    componentScope: { all: boolean; componentIds: Set<string> };
  }> {
    const rows = await this.assignmentsRepository.findForUserAndProject(
      userId,
      projectId,
    );
    return {
      environmentIds: new Set(rows.map((r) => r.environmentId)),
      componentScope: {
        all: rows.some((r) => r.projectComponentId === null),
        componentIds: new Set(
          rows
            .map((r) => r.projectComponentId)
            .filter((id): id is string => id !== null),
        ),
      },
    };
  }

  async hasComponentAccess(
    userId: string,
    environmentId: string,
    projectComponentId: string,
  ): Promise<boolean> {
    const { all, componentIds } = await this.componentScopeForEnvironment(
      userId,
      environmentId,
    );
    return all || componentIds.has(projectComponentId);
  }

  private async hydrate(
    rows: ProjectAssignment[],
  ): Promise<AssignmentSummary[]> {
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.map((row) => row.userId))];
    const projectIds = [...new Set(rows.map((row) => row.projectId))];
    const environmentIds = [...new Set(rows.map((row) => row.environmentId))];
    const componentIds = [
      ...new Set(
        rows
          .map((row) => row.projectComponentId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const [users, projects, environments, components] = await Promise.all([
      this.userLookup.findByIds(userIds),
      this.projectLookup.findByIds(projectIds),
      this.environmentLookup.findByIds(environmentIds),
      this.componentLookup.findByIds(componentIds),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    const environmentById = new Map(
      environments.map((environment) => [environment.id, environment]),
    );
    const componentById = new Map(
      components.map((component) => [component.id, component]),
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userEmail: userById.get(row.userId)?.email ?? '(deleted user)',
      projectId: row.projectId,
      projectName: projectById.get(row.projectId)?.name ?? '(deleted project)',
      environmentId: row.environmentId,
      environmentName:
        environmentById.get(row.environmentId)?.name ?? '(deleted environment)',
      projectComponentId: row.projectComponentId,
      componentName: row.projectComponentId
        ? (componentById.get(row.projectComponentId)?.name ??
          '(deleted component)')
        : null,
      createdAt: row.createdAt,
    }));
  }
}
