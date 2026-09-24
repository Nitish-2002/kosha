import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ProjectAssignmentsService } from '../project-assignments/project-assignments.service';
import { RequestsService } from '../requests/requests.service';
import { RequestUser } from '../auth/jwt-payload.interface';
import { Project } from './project.entity';
import { ProjectComponent } from './project-component.entity';
import { ProjectsRepository } from './projects.repository';
import { ProjectComponentsRepository } from './project-components.repository';
import { ProjectEnvironmentLookupRepository } from './project-environment-lookup.repository';
import { Environment } from '../environments/environment.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateComponentDto } from './dto/create-component.dto';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
// ON DELETE RESTRICT raises this instead of 23503 — Postgres checks a
// RESTRICT constraint immediately, unlike the default NO ACTION which defers
// to end-of-statement and raises 23503. Both mean the same thing here: this
// row is still referenced and can't be removed.
const RESTRICT_VIOLATION = '23001';

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  components: { id: string; name: string; createdAt: Date }[];
  // Loaded in one query for the whole list (see
  // project-environment-lookup.repository.ts), scoped to a Member's
  // assignments like components are.
  environments: { id: string; name: string }[];
  environmentCount: number;
  // Distinct Members assigned to the project. Admin-only — null for a
  // Member, who must not learn who else has access (CLAUDE.md #7).
  memberCount: number | null;
  // Latest write in the audit log (who + when). Admin-only and list-only —
  // null for a Member (it names another user) and outside findAll().
  lastActivity: { at: Date; byEmail: string | null } | null;
}

export type DeleteOrRequestResult =
  { status: 'deleted' } | { status: 'requested' };

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly componentsRepository: ProjectComponentsRepository,
    private readonly environmentLookup: ProjectEnvironmentLookupRepository,
    private readonly audit: AuditService,
    private readonly assignments: ProjectAssignmentsService,
    private readonly requests: RequestsService,
  ) {}

  // Admin sees every project, every component, the real environment count —
  // all in two batched queries (no per-project round trip). A Member sees
  // only the projects they hold at least one ProjectAssignment for, and
  // within each, only the components and environments their assignments
  // actually cover — one query per project (projectScope), same as the
  // scoping VariablesService/EnvironmentsService already enforce for
  // wiring/variables, applied here too so a project's summary doesn't leak
  // components/environments a Member has no access to.
  async findAll(requester: RequestUser): Promise<ProjectSummary[]> {
    const projects =
      requester.role === 'admin'
        ? await this.projectsRepository.findAllOrderedByCreatedAt()
        : await this.projectsRepository.findByIdsOrderedByCreatedAt([
            ...(await this.assignments.assignedProjectIds(requester.id)),
          ]);
    if (projects.length === 0) return [];
    const projectIds = projects.map((project) => project.id);
    const [allComponents, allEnvironments] = await Promise.all([
      this.componentsRepository.findAllOrderedByCreatedAt(),
      this.environmentLookup.findByProjectIds(projectIds),
    ]);

    if (requester.role === 'admin') {
      const [memberCounts, latestWrites] = await Promise.all([
        this.assignments.memberCountsByProject(projectIds),
        this.audit.latestWriteByProject(projectIds),
      ]);
      return projects.map((project) =>
        this.toSummary(project, allComponents, null, {
          environments: allEnvironments,
          memberCount: memberCounts.get(project.id) ?? 0,
          lastActivity: latestWrites.get(project.id) ?? null,
        }),
      );
    }

    return Promise.all(
      projects.map(async (project) => {
        const { environmentIds, componentScope } =
          await this.assignments.projectScope(requester.id, project.id);
        return this.toSummary(project, allComponents, componentScope, {
          environments: allEnvironments.filter((environment) =>
            environmentIds.has(environment.id),
          ),
          memberCount: null,
        });
      }),
    );
  }

  async findOne(id: string, requester: RequestUser): Promise<ProjectSummary> {
    if (
      requester.role !== 'admin' &&
      !(await this.assignments.hasProjectAccess(requester.id, id))
    ) {
      // Checked before any existence lookup — an unassigned Member gets the
      // same 403 whether or not the project actually exists (CLAUDE.md #7).
      throw new ForbiddenException();
    }
    return this.getSummary(id, requester);
  }

  async create(dto: CreateProjectDto, userId: string): Promise<ProjectSummary> {
    const project = this.projectsRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      createdBy: userId,
    });
    const saved = await this.save(
      project,
      'A project with that name already exists.',
    );

    await this.audit.record({
      userId,
      action: 'create',
      projectId: saved.id,
      projectNameSnapshot: saved.name,
      metadata: { projectId: saved.id, name: saved.name },
    });
    return this.toSummary(saved, [], null, {
      environments: [],
      memberCount: 0,
    });
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    userId: string,
  ): Promise<ProjectSummary> {
    const project = await this.findOrFail(id);
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    const saved = await this.save(
      project,
      'A project with that name already exists.',
    );

    await this.audit.record({
      userId,
      action: 'update',
      projectId: saved.id,
      projectNameSnapshot: saved.name,
      metadata: { projectId: saved.id },
    });
    return this.getSummary(saved.id);
  }

  async archive(id: string, userId: string): Promise<ProjectSummary> {
    return this.setArchived(id, userId, new Date());
  }

  async unarchive(id: string, userId: string): Promise<ProjectSummary> {
    return this.setArchived(id, userId, null);
  }

  // extraMetadata: PRD Feature 6 — an approved DeleteRequest's execution is
  // "logged with both the requester and the approver"; removeOrRequest
  // passes the original requester through here (userId is always the
  // approver, CLAUDE.md #2).
  async remove(
    id: string,
    userId: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    const project = await this.findOrFail(id);
    // Audit write happens before the delete: audit_logs.projectId is a real
    // FK now (ON DELETE SET NULL), so it can only be inserted pointing at a
    // project that still exists. The delete then nulls it out on its own —
    // projectNameSnapshot is what keeps the log readable afterwards.
    await this.audit.record({
      userId,
      action: 'delete',
      projectId: id,
      projectNameSnapshot: project.name,
      metadata: { projectId: id, name: project.name, ...extraMetadata },
    });
    await this.projectsRepository.remove(project);
  }

  // CLAUDE.md #3/TRD — one endpoint per destructive action, role check
  // inside it: Admin executes remove() directly; Member gets a pending
  // DeleteRequest instead of the project actually being touched.
  async removeOrRequest(
    id: string,
    requester: RequestUser,
  ): Promise<DeleteOrRequestResult> {
    // Scoped read — 403s an out-of-scope Member before any existence check
    // (CLAUDE.md #7).
    await this.findOne(id, requester);
    if (requester.role === 'admin') {
      await this.remove(id, requester.id);
      return { status: 'deleted' };
    }
    await this.requests.createDeleteRequest(requester.id, {
      targetType: 'project',
      projectId: id,
    });
    return { status: 'requested' };
  }

  async addComponent(
    projectId: string,
    dto: CreateComponentDto,
    userId: string,
  ): Promise<ProjectSummary> {
    const project = await this.findOrFail(projectId);
    const component = this.componentsRepository.create({
      projectId,
      name: dto.name,
    });
    try {
      await this.componentsRepository.save(component);
    } catch (error) {
      throw this.translateError(
        error,
        'This project already has a component with that name.',
      );
    }

    await this.audit.record({
      userId,
      action: 'create',
      projectId,
      projectNameSnapshot: project.name,
      componentName: dto.name,
      metadata: { projectId, componentName: dto.name },
    });
    return this.getSummary(projectId);
  }

  async removeComponent(
    projectId: string,
    componentId: string,
    userId: string,
  ): Promise<ProjectSummary> {
    const project = await this.findOrFail(projectId);
    const component = await this.componentsRepository.findByIdAndProject(
      componentId,
      projectId,
    );
    if (!component) {
      throw new NotFoundException();
    }
    try {
      await this.componentsRepository.remove(component);
    } catch (error) {
      throw this.translateError(
        error,
        'This component is still referenced by an environment and cannot be removed.',
      );
    }

    await this.audit.record({
      userId,
      action: 'delete',
      projectId,
      projectNameSnapshot: project.name,
      componentName: component.name,
      metadata: { projectId, componentName: component.name },
    });
    return this.getSummary(projectId);
  }

  private async setArchived(
    id: string,
    userId: string,
    archivedAt: Date | null,
  ): Promise<ProjectSummary> {
    const project = await this.findOrFail(id);
    project.archivedAt = archivedAt;
    const saved = await this.projectsRepository.save(project);

    await this.audit.record({
      userId,
      action: 'update',
      projectId: id,
      projectNameSnapshot: saved.name,
      metadata: { projectId: id, archived: archivedAt !== null },
    });
    return this.getSummary(saved.id);
  }

  private async save(
    project: Project,
    conflictMessage: string,
  ): Promise<Project> {
    try {
      return await this.projectsRepository.save(project);
    } catch (error) {
      throw this.translateError(error, conflictMessage);
    }
  }

  private translateError(error: unknown, conflictMessage: string): Error {
    const code = (error as { code?: string }).code;
    if (
      code === UNIQUE_VIOLATION ||
      code === FOREIGN_KEY_VIOLATION ||
      code === RESTRICT_VIOLATION
    ) {
      return new ConflictException(conflictMessage);
    }
    return error as Error;
  }

  private async findOrFail(id: string): Promise<Project> {
    const found = await this.projectsRepository.findById(id);
    if (!found) {
      throw new NotFoundException();
    }
    return found;
  }

  // Builds the DTO for a known-accessible project — used both by the
  // scoped, requester-checked findOne() above and by every mutation method
  // (already admin-gated at the controller) that needs the fresh summary
  // after a change. requester omitted, or Admin: unfiltered components and
  // the project's real environment count. Member: both scoped down to their
  // ProjectAssignments, from one query (projectScope).
  private async getSummary(
    id: string,
    requester?: RequestUser,
  ): Promise<ProjectSummary> {
    const [project, components, environments] = await Promise.all([
      this.findOrFail(id),
      this.componentsRepository.findByProject(id),
      this.environmentLookup.findByProjectIds([id]),
    ]);
    if (requester && requester.role !== 'admin') {
      const { environmentIds, componentScope } =
        await this.assignments.projectScope(requester.id, id);
      return this.toSummary(project, components, componentScope, {
        environments: environments.filter((environment) =>
          environmentIds.has(environment.id),
        ),
        memberCount: null,
      });
    }
    const memberCounts = await this.assignments.memberCountsByProject([id]);
    return this.toSummary(project, components, null, {
      environments,
      memberCount: memberCounts.get(id) ?? 0,
    });
  }

  private toSummary(
    project: Project,
    allComponents: ProjectComponent[],
    scope: { all: boolean; componentIds: Set<string> } | null,
    extras: {
      environments: Environment[];
      memberCount: number | null;
      lastActivity?: { at: Date; byEmail: string | null } | null;
    },
  ): ProjectSummary {
    const projectEnvironments = extras.environments
      .filter((environment) => environment.projectId === project.id)
      .map((environment) => ({ id: environment.id, name: environment.name }));
    const projectComponents = allComponents.filter(
      (component) => component.projectId === project.id,
    );
    const visible =
      scope === null || scope.all
        ? projectComponents
        : projectComponents.filter((component) =>
            scope.componentIds.has(component.id),
          );
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      archivedAt: project.archivedAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      components: visible.map((component) => ({
        id: component.id,
        name: component.name,
        createdAt: component.createdAt,
      })),
      environments: projectEnvironments,
      environmentCount: projectEnvironments.length,
      memberCount: extras.memberCount,
      lastActivity: extras.lastActivity ?? null,
    };
  }
}
