import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../auth/jwt-payload.interface';
import { Environment } from '../environments/environment.entity';
import { EnvironmentsRepository } from '../environments/environments.repository';
import { ProjectAssignmentsService } from '../project-assignments/project-assignments.service';
import { ProjectsRepository } from '../projects/projects.repository';
import { RequestsService } from '../requests/requests.service';
import { Project } from '../projects/project.entity';
import { DbScript } from './db-script.entity';
import { DbScriptState, DbScriptStatus } from './db-script-state.entity';
import { DbScriptsRepository } from './db-scripts.repository';
import { CreateDbScriptDto } from './dto/create-db-script.dto';
import { UpdateDbScriptDto } from './dto/update-db-script.dto';
import { normalizeSql, sqlFingerprint } from './sql-fingerprint';
import { PreviewRefreshDto, RecordRefreshDto } from './dto/refresh.dto';
import { RefreshRule, refreshOutcome } from './refresh-plan';

const UNIQUE_VIOLATION = '23505';

export interface DbScriptStateSummary {
  environmentId: string;
  status: DbScriptStatus;
  // Shown to both roles — a deliberate exception to "Members never see
  // other users" (PRD Feature 12: the team needs to know who ran it).
  appliedByEmail: string | null;
  appliedAt: Date | null;
  // A Member's undo request is waiting for an Admin.
  undoRequested: boolean;
  // Set when this "applied" came over in a restored dump, not run by hand.
  fromDump: { sourceEnvironmentName: string; dumpTakenOn: string } | null;
}

export interface RefreshPlanRow {
  scriptId: string;
  label: string;
  currentStatus: DbScriptStatus;
  sourceStatus: DbScriptStatus;
  resultStatus: DbScriptStatus;
  rule: RefreshRule;
}

export type UnapplyResult =
  { status: 'reverted'; script: DbScriptSummary } | { status: 'requested' };

export interface DbScriptSummary {
  id: string;
  sequence: number;
  name: string;
  sql: string;
  rerunAfterRestore: boolean;
  createdByEmail: string;
  createdAt: Date;
  updatedAt: Date;
  // Applied in at least one environment — including ones this requester
  // can't see — so its SQL can no longer be edited.
  locked: boolean;
  // One entry per environment the requester can see, in environment order.
  states: DbScriptStateSummary[];
}

export interface DbScriptBoard {
  // Lower → higher. A Member gets only their assigned environments, so
  // drift is judged only across what they can see.
  environments: {
    id: string;
    name: string;
    // The most recent recorded restore of this environment's database.
    lastRefresh: {
      sourceEnvironmentName: string;
      dumpTakenOn: string;
      recordedAt: Date;
    } | null;
  }[];
  scripts: DbScriptSummary[];
}

@Injectable()
export class DbScriptsService {
  constructor(
    private readonly dbScriptsRepository: DbScriptsRepository,
    private readonly projectsRepository: ProjectsRepository,
    private readonly environmentsRepository: EnvironmentsRepository,
    private readonly assignments: ProjectAssignmentsService,
    private readonly audit: AuditService,
    private readonly requests: RequestsService,
  ) {}

  async list(
    projectId: string,
    requester: RequestUser,
  ): Promise<DbScriptBoard> {
    await this.findProjectForRequester(projectId, requester);
    const [visibleEnvironments, scripts] = await Promise.all([
      this.visibleEnvironments(projectId, requester),
      this.dbScriptsRepository.findByProject(projectId),
    ]);
    const latestRefreshes =
      await this.dbScriptsRepository.latestRefreshByEnvironment(
        visibleEnvironments.map((environment) => environment.id),
      );
    return {
      environments: visibleEnvironments.map((environment) => {
        const refresh = latestRefreshes.get(environment.id);
        return {
          id: environment.id,
          name: environment.name,
          lastRefresh: refresh
            ? {
                sourceEnvironmentName: refresh.sourceEnvironmentName,
                dumpTakenOn: refresh.dumpTakenOn,
                recordedAt: refresh.createdAt,
              }
            : null,
        };
      }),
      scripts: await this.summarize(scripts, visibleEnvironments),
    };
  }

  async create(
    projectId: string,
    dto: CreateDbScriptDto,
    requester: RequestUser,
  ): Promise<DbScriptSummary> {
    const project = await this.findProjectForRequester(projectId, requester);
    const visibleEnvironments = await this.visibleEnvironments(
      projectId,
      requester,
    );
    const notApplicableIds = this.checkApplicability(
      dto.notApplicableEnvironmentIds ?? [],
      visibleEnvironments,
    );
    const name = this.cleanName(dto.name);
    const fingerprint = this.fingerprintOf(dto.sql);
    await this.assertNoDuplicate(projectId, name, fingerprint);

    // Environments hidden from a Member still get a row: pending, since
    // only the environments they can see were theirs to untick.
    const allEnvironments =
      await this.environmentsRepository.findByProject(projectId);
    let saved: DbScript;
    try {
      saved = await this.dbScriptsRepository.createWithStates(
        {
          projectId,
          sequence: await this.dbScriptsRepository.nextSequence(projectId),
          name,
          sql: dto.sql,
          sqlFingerprint: fingerprint,
          rerunAfterRestore: dto.rerunAfterRestore ?? false,
          createdBy: requester.id,
        },
        allEnvironments.map((environment) => ({
          environmentId: environment.id,
          status: notApplicableIds.has(environment.id)
            ? 'not_applicable'
            : 'pending',
        })),
      );
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    await this.recordAudit(requester.id, 'create', project, saved);
    const [summary] = await this.summarize([saved], visibleEnvironments);
    return summary;
  }

  async update(
    projectId: string,
    scriptId: string,
    dto: UpdateDbScriptDto,
    requester: RequestUser,
  ): Promise<DbScriptSummary> {
    const project = await this.findProjectForRequester(projectId, requester);
    const script = await this.findScriptOrFail(scriptId, projectId);
    const states = await this.dbScriptsRepository.statesForScripts([script.id]);
    const appliedEnvironmentIds = new Set(
      states
        .filter((state) => state.status === 'applied')
        .map((state) => state.environmentId),
    );
    const visibleEnvironments = await this.visibleEnvironments(
      projectId,
      requester,
    );

    const name =
      dto.name !== undefined ? this.cleanName(dto.name) : script.name;
    const sqlChanged = dto.sql !== undefined && dto.sql !== script.sql;
    // Once it has run anywhere, the name and SQL describe what actually ran,
    // so they're locked. The re-run flag and N/A choices stay editable.
    if (
      appliedEnvironmentIds.size > 0 &&
      (name !== script.name || sqlChanged)
    ) {
      throw new ConflictException(
        "This script has already been applied in an environment, so its name and SQL can't change. Add a new script instead.",
      );
    }
    const fingerprint = sqlChanged
      ? this.fingerprintOf(dto.sql!)
      : script.sqlFingerprint;
    await this.assertNoDuplicate(projectId, name, fingerprint, script.id);

    const previousName = script.name;
    const previousRerun = script.rerunAfterRestore;
    script.name = name;
    script.sqlFingerprint = fingerprint;
    if (sqlChanged) script.sql = dto.sql!;
    if (dto.rerunAfterRestore !== undefined) {
      script.rerunAfterRestore = dto.rerunAfterRestore;
    }
    let saved: DbScript;
    try {
      saved = await this.dbScriptsRepository.save(script);
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    // Only the environments this requester can see are theirs to change,
    // and an applied one is left alone — a record of what ran there is
    // cleared with "Set to pending" / an undo request, never by this.
    if (dto.notApplicableEnvironmentIds !== undefined) {
      const notApplicableIds = this.checkApplicability(
        dto.notApplicableEnvironmentIds,
        visibleEnvironments,
      );
      const appliedAndUnticked = visibleEnvironments.filter(
        (environment) =>
          appliedEnvironmentIds.has(environment.id) &&
          notApplicableIds.has(environment.id),
      );
      if (appliedAndUnticked.length > 0) {
        throw new BadRequestException(
          `It has already run in ${appliedAndUnticked.map((environment) => environment.name).join(', ')}. Set it back to pending there first if that was a mistake.`,
        );
      }
      await this.dbScriptsRepository.setApplicability(
        script.id,
        visibleEnvironments
          .filter((environment) => !appliedEnvironmentIds.has(environment.id))
          .map((environment) => ({
            environmentId: environment.id,
            status: notApplicableIds.has(environment.id)
              ? 'not_applicable'
              : 'pending',
          })),
      );
    }

    await this.recordAudit(requester.id, 'update', project, saved, {
      ...(previousName !== saved.name && { previousName }),
      sqlChanged,
      ...(previousRerun !== saved.rerunAfterRestore && {
        rerunAfterRestore: saved.rerunAfterRestore,
      }),
    });
    const [summary] = await this.summarize([saved], visibleEnvironments);
    return summary;
  }

  // Whoever ran the script marks it — Member or Admin, any environment,
  // prod included (PRD Feature 12). Marking while a lower environment is
  // still pending is allowed (the UI warns first); the audit row names
  // those environments so the "Mark anyway" is on record.
  async markApplied(
    projectId: string,
    scriptId: string,
    environmentId: string,
    requester: RequestUser,
  ): Promise<DbScriptSummary> {
    const { project, script, allEnvironments, targetIndex, statusIn } =
      await this.loadScriptInEnvironment(
        projectId,
        scriptId,
        environmentId,
        requester,
      );
    const currentStatus = statusIn(environmentId);
    if (currentStatus === 'not_applicable') {
      throw new BadRequestException(
        'This script is marked not applicable for that environment.',
      );
    }
    if (currentStatus === 'applied') {
      throw new ConflictException(
        'This script is already marked applied in that environment.',
      );
    }

    await this.dbScriptsRepository.markApplied(
      script.id,
      environmentId,
      requester.id,
    );
    const target = allEnvironments[targetIndex];
    await this.recordAudit(
      requester.id,
      'apply',
      project,
      script,
      {
        lowerPendingEnvironments: allEnvironments
          .slice(0, targetIndex)
          .filter((environment) => statusIn(environment.id) === 'pending')
          .map((environment) => environment.name),
      },
      target,
    );

    const [summary] = await this.summarize(
      [script],
      await this.visibleEnvironments(projectId, requester),
    );
    return summary;
  }

  // Undo a wrong "Mark applied" (PRD Feature 12). One endpoint, role check
  // inside (CLAUDE.md #3): an Admin sets it back to pending directly; a
  // Member files a request with a reason for an Admin to approve.
  async unapplyOrRequest(
    projectId: string,
    scriptId: string,
    environmentId: string,
    reason: string | undefined,
    requester: RequestUser,
  ): Promise<UnapplyResult> {
    const { script, statusIn } = await this.loadScriptInEnvironment(
      projectId,
      scriptId,
      environmentId,
      requester,
    );
    if (statusIn(environmentId) !== 'applied') {
      throw new ConflictException(
        'This script is not marked applied in that environment.',
      );
    }

    if (requester.role === 'admin') {
      await this.setBackToPending(script.id, environmentId, requester.id);
      const [summary] = await this.summarize(
        [script],
        await this.visibleEnvironments(projectId, requester),
      );
      return { status: 'reverted', script: summary };
    }

    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new BadRequestException(
        'Say why it should be undone, e.g. "marked the wrong script".',
      );
    }
    await this.requests.createDbScriptUndoRequest(
      requester.id,
      script.id,
      environmentId,
      trimmedReason,
    );
    return { status: 'requested' };
  }

  // Also the execution step of an approved undo request (RequestReviewsService),
  // where userId is the approving Admin and requestContext names the Member.
  // Already pending (e.g. an Admin undid it directly meanwhile) is a no-op,
  // so approving a stale request still succeeds.
  async setBackToPending(
    scriptId: string,
    environmentId: string,
    userId: string,
    requestContext?: Record<string, unknown>,
  ): Promise<void> {
    const script = await this.dbScriptsRepository.findById(scriptId);
    const environment =
      await this.environmentsRepository.findById(environmentId);
    if (!script || !environment) {
      throw new NotFoundException(
        'That script or environment no longer exists.',
      );
    }
    const [state] = (
      await this.dbScriptsRepository.statesForScripts([script.id])
    ).filter((candidate) => candidate.environmentId === environmentId);
    if (state?.status !== 'applied') return;

    await this.dbScriptsRepository.setApplicability(script.id, [
      { environmentId, status: 'pending' },
    ]);
    const [project, [previouslyAppliedBy]] = await Promise.all([
      this.projectsRepository.findById(script.projectId),
      this.dbScriptsRepository.findUsersByIds([state.appliedBy!]),
    ]);
    await this.audit.record({
      userId,
      action: 'update',
      projectId: script.projectId,
      projectNameSnapshot: project?.name,
      environmentId,
      environmentNameSnapshot: environment.name,
      metadata: {
        dbScriptId: script.id,
        dbScriptLabel: this.label(script),
        undoneApply: true,
        previouslyAppliedByEmail: previouslyAppliedBy?.email ?? null,
        previouslyAppliedAt: state.appliedAt,
        ...requestContext,
      },
    });
  }

  // What a DB refresh would do to each script, without writing anything.
  // Admin-only (DbRefreshesController).
  async previewRefresh(
    projectId: string,
    dto: PreviewRefreshDto,
  ): Promise<RefreshPlanRow[]> {
    return (await this.planRefresh(projectId, dto)).rows;
  }

  // "Record DB refresh": the target environment's database was restored
  // from the source's dump, so its script states become the source's (see
  // refresh-plan.ts). The plan is recomputed here, never taken from the
  // preview. The returned rows' pending ones are the scripts to run now.
  async recordRefresh(
    projectId: string,
    dto: RecordRefreshDto,
    userId: string,
  ): Promise<RefreshPlanRow[]> {
    const { project, source, target, rows, outcomes } = await this.planRefresh(
      projectId,
      dto,
    );
    await this.dbScriptsRepository.recordRefresh(
      {
        projectId,
        sourceEnvironmentId: source.id,
        sourceEnvironmentName: source.name,
        targetEnvironmentId: target.id,
        dumpTakenOn: dto.dumpTakenOn,
        recordedBy: userId,
      },
      outcomes,
    );
    await this.audit.record({
      userId,
      action: 'update',
      projectId,
      projectNameSnapshot: project.name,
      environmentId: target.id,
      environmentNameSnapshot: target.name,
      metadata: {
        dbRefresh: true,
        sourceEnvironmentName: source.name,
        dumpTakenOn: dto.dumpTakenOn,
        scriptsToRun: rows
          .filter((row) => row.resultStatus === 'pending')
          .map((row) => row.label),
      },
    });
    return rows;
  }

  private async planRefresh(projectId: string, dto: PreviewRefreshDto) {
    if (dto.sourceEnvironmentId === dto.targetEnvironmentId) {
      throw new BadRequestException(
        'The dump has to come from a different environment than the one restored.',
      );
    }
    const project = await this.projectsRepository.findById(projectId);
    if (!project) throw new NotFoundException();
    const environments =
      await this.environmentsRepository.findByProject(projectId);
    const source = environments.find(
      (environment) => environment.id === dto.sourceEnvironmentId,
    );
    const target = environments.find(
      (environment) => environment.id === dto.targetEnvironmentId,
    );
    if (!source || !target) {
      throw new NotFoundException('Both environments must be in this project.');
    }

    const scripts = await this.dbScriptsRepository.findByProject(projectId);
    const states = await this.dbScriptsRepository.statesForScripts(
      scripts.map((script) => script.id),
    );
    const stateOf = (scriptId: string, environmentId: string) =>
      states.find(
        (state) =>
          state.scriptId === scriptId && state.environmentId === environmentId,
      );
    const plans = scripts.map((script) => {
      const targetState = stateOf(script.id, target.id);
      const sourceState = stateOf(script.id, source.id);
      return {
        script,
        targetState,
        sourceState,
        outcome: refreshOutcome(
          script.rerunAfterRestore,
          targetState,
          sourceState,
        ),
      };
    });
    return {
      project,
      source,
      target,
      rows: plans.map(({ script, targetState, sourceState, outcome }) => ({
        scriptId: script.id,
        label: this.label(script),
        currentStatus: targetState?.status ?? 'pending',
        sourceStatus: sourceState?.status ?? 'pending',
        resultStatus: outcome.status,
        rule: outcome.rule,
      })),
      outcomes: plans.map(({ script, outcome }) => ({
        scriptId: script.id,
        status: outcome.status,
        appliedBy: outcome.appliedBy,
        appliedAt: outcome.appliedAt,
      })),
    };
  }

  // Shared scoping for the per-environment actions: 403 for an out-of-scope
  // Member before any existence check (CLAUDE.md #7), then 404s.
  private async loadScriptInEnvironment(
    projectId: string,
    scriptId: string,
    environmentId: string,
    requester: RequestUser,
  ) {
    const project = await this.findProjectForRequester(projectId, requester);
    if (
      requester.role !== 'admin' &&
      !(await this.assignments.hasEnvironmentAccess(
        requester.id,
        environmentId,
      ))
    ) {
      throw new ForbiddenException();
    }
    const allEnvironments =
      await this.environmentsRepository.findByProject(projectId);
    const targetIndex = allEnvironments.findIndex(
      (environment) => environment.id === environmentId,
    );
    if (targetIndex === -1) throw new NotFoundException();
    const script = await this.findScriptOrFail(scriptId, projectId);
    const states = await this.dbScriptsRepository.statesForScripts([script.id]);
    const statusIn = (id: string): DbScriptStatus =>
      states.find((state) => state.environmentId === id)?.status ?? 'pending';
    return { project, script, allEnvironments, targetIndex, statusIn };
  }

  // 403 for an unassigned Member before the project is even looked up, so
  // the answer is the same whether or not it exists (CLAUDE.md #7).
  private async findProjectForRequester(
    projectId: string,
    requester: RequestUser,
  ): Promise<Project> {
    if (
      requester.role !== 'admin' &&
      !(await this.assignments.hasProjectAccess(requester.id, projectId))
    ) {
      throw new ForbiddenException();
    }
    const project = await this.projectsRepository.findById(projectId);
    if (!project) throw new NotFoundException();
    return project;
  }

  private async visibleEnvironments(
    projectId: string,
    requester: RequestUser,
  ): Promise<Environment[]> {
    if (requester.role === 'admin') {
      return this.environmentsRepository.findByProject(projectId);
    }
    return this.environmentsRepository.findByIdsInOrder([
      ...(await this.assignments.assignedEnvironmentIds(
        requester.id,
        projectId,
      )),
    ]);
  }

  private async findScriptOrFail(
    scriptId: string,
    projectId: string,
  ): Promise<DbScript> {
    const script = await this.dbScriptsRepository.findInProject(
      scriptId,
      projectId,
    );
    if (!script) throw new NotFoundException();
    return script;
  }

  // Same 400 for an id that doesn't exist and one the Member can't see, so
  // the error never hints which is which (CLAUDE.md #7).
  private checkApplicability(
    notApplicableIds: string[],
    visibleEnvironments: Environment[],
  ): Set<string> {
    const visibleIds = new Set(visibleEnvironments.map((env) => env.id));
    if (notApplicableIds.some((id) => !visibleIds.has(id))) {
      throw new BadRequestException(
        'Applies to lists an environment that is not in this project.',
      );
    }
    return new Set(notApplicableIds);
  }

  private cleanName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Script name is required.');
    return trimmed;
  }

  private fingerprintOf(sql: string): string {
    if (!normalizeSql(sql)) {
      throw new BadRequestException('The script has no SQL.');
    }
    return sqlFingerprint(sql);
  }

  // Friendly pre-checks that name the clashing script. The UNIQUE
  // constraints stay the real guarantee (translateUniqueViolation).
  private async assertNoDuplicate(
    projectId: string,
    name: string,
    fingerprint: string,
    excludeId?: string,
  ): Promise<void> {
    const [sameName, sameSql] = await Promise.all([
      this.dbScriptsRepository.findByName(projectId, name, excludeId),
      this.dbScriptsRepository.findByFingerprint(
        projectId,
        fingerprint,
        excludeId,
      ),
    ]);
    if (sameName) {
      throw new ConflictException(
        `A script with this name already exists: ${this.label(sameName)}.`,
      );
    }
    if (sameSql) {
      throw new ConflictException(
        `This SQL already exists as script ${this.label(sameSql)}.`,
      );
    }
  }

  private translateUniqueViolation(error: unknown): Error {
    const { code, constraint } = error as {
      code?: string;
      constraint?: string;
    };
    if (code !== UNIQUE_VIOLATION) return error as Error;
    if (constraint === 'uq_db_scripts_project_name') {
      return new ConflictException('A script with this name already exists.');
    }
    if (constraint === 'uq_db_scripts_project_fingerprint') {
      return new ConflictException(
        'This SQL already exists as another script.',
      );
    }
    // ponytail: two scripts added at the same moment race for the next
    // number; the loser retries. A per-project lock if that ever gets common.
    return new ConflictException(
      'Another script was added at the same time. Please try again.',
    );
  }

  private label(script: DbScript): string {
    return `${String(script.sequence).padStart(3, '0')} ${script.name}`;
  }

  private async recordAudit(
    userId: string,
    action: 'create' | 'update' | 'apply',
    project: Project,
    script: DbScript,
    extraMetadata?: Record<string, unknown>,
    environment?: Environment,
  ): Promise<void> {
    await this.audit.record({
      userId,
      action,
      projectId: project.id,
      projectNameSnapshot: project.name,
      environmentId: environment?.id,
      environmentNameSnapshot: environment?.name,
      metadata: {
        dbScriptId: script.id,
        dbScriptLabel: this.label(script),
        ...extraMetadata,
      },
    });
  }

  private async summarize(
    scripts: DbScript[],
    visibleEnvironments: Environment[],
  ): Promise<DbScriptSummary[]> {
    const states = await this.dbScriptsRepository.statesForScripts(
      scripts.map((script) => script.id),
    );
    const userIds = [
      ...new Set([
        ...scripts.map((script) => script.createdBy),
        ...states
          .map((state) => state.appliedBy)
          .filter((id): id is string => id !== null),
      ]),
    ];
    const [users, pendingUndoKeys, refreshes] = await Promise.all([
      this.dbScriptsRepository.findUsersByIds(userIds),
      this.requests.pendingDbScriptUndoKeys(scripts.map((script) => script.id)),
      this.dbScriptsRepository.findRefreshesByIds([
        ...new Set(
          states
            .map((state) => state.refreshId)
            .filter((id): id is string => id !== null),
        ),
      ]),
    ]);
    const emailById = new Map(users.map((user) => [user.id, user.email]));
    const refreshById = new Map(
      refreshes.map((refresh) => [refresh.id, refresh]),
    );
    const fromDumpOf = (refreshId: string | null) => {
      const refresh = refreshId ? refreshById.get(refreshId) : undefined;
      return refresh
        ? {
            sourceEnvironmentName: refresh.sourceEnvironmentName,
            dumpTakenOn: refresh.dumpTakenOn,
          }
        : null;
    };

    const statesByScript = new Map<string, DbScriptState[]>();
    for (const state of states) {
      statesByScript.set(state.scriptId, [
        ...(statesByScript.get(state.scriptId) ?? []),
        state,
      ]);
    }

    return scripts.map((script) => {
      const scriptStates = statesByScript.get(script.id) ?? [];
      return {
        id: script.id,
        sequence: script.sequence,
        name: script.name,
        sql: script.sql,
        rerunAfterRestore: script.rerunAfterRestore,
        createdByEmail: emailById.get(script.createdBy) ?? '(deleted user)',
        createdAt: script.createdAt,
        updatedAt: script.updatedAt,
        locked: scriptStates.some((state) => state.status === 'applied'),
        states: visibleEnvironments.map((environment) => {
          const state = scriptStates.find(
            (candidate) => candidate.environmentId === environment.id,
          );
          return {
            environmentId: environment.id,
            status: state?.status ?? 'pending',
            appliedByEmail: state?.appliedBy
              ? (emailById.get(state.appliedBy) ?? '(deleted user)')
              : null,
            appliedAt: state?.appliedAt ?? null,
            undoRequested: pendingUndoKeys.has(
              `${script.id}:${environment.id}`,
            ),
            fromDump: fromDumpOf(state?.refreshId ?? null),
          };
        }),
      };
    });
  }
}
