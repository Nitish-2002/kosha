import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Credential } from '../credentials/credential.entity';
import { CredentialsRepository } from '../credentials/credentials.repository';
import { EnvironmentComponentConfig } from '../environments/environment-component-config.entity';
import { EnvironmentComponentConfigsRepository } from '../environments/environment-component-configs.repository';
import { EnvironmentsRepository } from '../environments/environments.repository';
import { ProjectComponentsRepository } from '../projects/project-components.repository';
import { ProjectsRepository } from '../projects/projects.repository';
import { ProjectAssignmentsService } from '../project-assignments/project-assignments.service';
import { RequestsService } from '../requests/requests.service';
import { RequestUser } from '../auth/jwt-payload.interface';
import { UserRole } from '../users/user.entity';
import { VariableMetadata } from './variable-metadata.entity';
import { VariableMetadataRepository } from './variable-metadata.repository';
import { S3ObjectService, type S3Target } from './s3-object.service';
import { GithubManifestService } from './github-manifest.service';
import { parseEnvFile, serializeEnvFile, type EnvEntry } from './env-file.util';
import { CreateVariableDto } from './dto/create-variable.dto';
import { UpdateVariableDto } from './dto/update-variable.dto';
import { RollbackDto } from './dto/rollback.dto';

export interface VariableSummary {
  key: string;
  value: string | null;
  isSecret: boolean;
}

export type DeleteOrRequestResult =
  { status: 'deleted' } | { status: 'requested' };
export type RollbackOrRequestResult =
  { status: 'executed' } | { status: 'requested' };

export interface VariableHistoryEntry {
  versionId: string;
  isCurrent: boolean;
  lastModified: Date | undefined;
  value: string | null;
}

export interface ImportPlan {
  creates: { key: string; value: string }[];
  updates: { key: string; value: string }[];
  skipped: { key: string; reason: string }[];
}

@Injectable()
export class VariablesService {
  constructor(
    private readonly configsRepository: EnvironmentComponentConfigsRepository,
    private readonly environmentsRepository: EnvironmentsRepository,
    private readonly componentsRepository: ProjectComponentsRepository,
    private readonly projectsRepository: ProjectsRepository,
    private readonly credentialsRepository: CredentialsRepository,
    private readonly metadataRepository: VariableMetadataRepository,
    private readonly s3: S3ObjectService,
    private readonly github: GithubManifestService,
    private readonly audit: AuditService,
    private readonly assignments: ProjectAssignmentsService,
    private readonly requests: RequestsService,
  ) {}

  // Every audit.record() call here needs the same three lookups (the
  // environment, its project, the config's component) — a variable action is
  // by far the most frequent thing this app logs, and without this it never
  // populated the Audit Log's Project/Environment columns at all, breaking
  // the PRD's "filterable by project" requirement for almost every row.
  private async auditContext(
    environmentId: string,
    projectComponentId: string,
  ): Promise<{
    projectId: string | undefined;
    projectNameSnapshot: string | undefined;
    environmentNameSnapshot: string | undefined;
    componentName: string | undefined;
  }> {
    const environment =
      await this.environmentsRepository.findById(environmentId);
    const [project, component] = await Promise.all([
      environment
        ? this.projectsRepository.findById(environment.projectId)
        : null,
      this.componentsRepository.findById(projectComponentId),
    ]);
    return {
      projectId: environment?.projectId,
      projectNameSnapshot: project?.name,
      environmentNameSnapshot: environment?.name,
      componentName: component?.name,
    };
  }

  async list(
    environmentId: string,
    configId: string,
    requester: RequestUser,
  ): Promise<VariableSummary[]> {
    await this.assertEnvironmentAccess(requester, environmentId);
    const config = await this.findConfigOrFail(environmentId, configId);
    await this.assertComponentAccess(
      requester,
      environmentId,
      config.projectComponentId,
    );

    if (config.sourceType === 'github') {
      const credential = await this.findCredentialOrFail(
        config.githubCredentialId,
      );
      const entries = await this.github.listVariables(config, credential);
      // GitHub Secret-manifest values are never fetched in the first place —
      // there's nothing to mask, "isSecret" here is structural, not a flag.
      return entries;
    }

    const { entries } = await this.readS3Entries(config);
    const metadataByKey = await this.metadataMap(configId);
    return entries.map(({ key, value }) => {
      const isSecret = metadataByKey.get(key)?.isSecret ?? false;
      return {
        key,
        value: this.maskIfNeeded(value, isSecret, requester.role),
        isSecret,
      };
    });
  }

  async create(
    environmentId: string,
    configId: string,
    dto: CreateVariableDto,
    requester: RequestUser,
  ): Promise<void> {
    await this.assertEnvironmentAccess(requester, environmentId);
    const config = await this.assertS3Writable(environmentId, configId);
    await this.assertComponentAccess(
      requester,
      environmentId,
      config.projectComponentId,
    );

    const { entries, etag } = await this.readS3Entries(config);
    if (entries.some((e) => e.key === dto.key)) {
      throw new BadRequestException(
        'That key already exists — use update instead.',
      );
    }
    await this.writeEntries(
      config,
      [...entries, { key: dto.key, value: dto.value }],
      etag,
    );
    // isSecret is Admin-only to set, always (CLAUDE.md #8) — force false for
    // anyone else regardless of what the request body asked for.
    const isSecret = requester.role === 'admin' && (dto.isSecret ?? false);
    await this.upsertMetadata(configId, dto.key, requester.id, isSecret);

    const context = await this.auditContext(
      environmentId,
      config.projectComponentId,
    );
    await this.audit.record({
      userId: requester.id,
      action: 'create',
      ...context,
      environmentId,
      key: dto.key,
      // Never the actual value for a Secret — the audit log must not become
      // a second, ungoverned copy of secret history alongside S3 (CLAUDE.md
      // #1/#14). A non-Secret value is safe to keep here; it's the only way
      // an audit row says what was actually set, not just that something was.
      metadata: isSecret ? { secretValue: true } : { newValue: dto.value },
    });
  }

  async update(
    environmentId: string,
    configId: string,
    key: string,
    dto: UpdateVariableDto,
    requester: RequestUser,
  ): Promise<void> {
    await this.assertEnvironmentAccess(requester, environmentId);
    const config = await this.assertS3Writable(environmentId, configId);
    await this.assertComponentAccess(
      requester,
      environmentId,
      config.projectComponentId,
    );

    const isSecret =
      (await this.metadataMap(configId)).get(key)?.isSecret ?? false;
    if (isSecret && requester.role !== 'admin') {
      throw new ForbiddenException('Only an Admin can change a Secret value.');
    }
    const { entries, etag } = await this.readS3Entries(config);
    const previousValue = entries.find((e) => e.key === key)?.value;
    if (previousValue === undefined) {
      throw new NotFoundException();
    }
    const updated = entries.map((e) =>
      e.key === key ? { key, value: dto.value } : e,
    );
    await this.writeEntries(config, updated, etag);
    await this.upsertMetadata(configId, key, requester.id, isSecret);

    const context = await this.auditContext(
      environmentId,
      config.projectComponentId,
    );
    await this.audit.record({
      userId: requester.id,
      action: 'update',
      ...context,
      environmentId,
      key,
      // Never the actual values for a Secret — see the identical comment in
      // create() (CLAUDE.md #1/#14).
      metadata: isSecret
        ? { secretValue: true }
        : { previousValue, newValue: dto.value },
    });
  }

  async updateSecretFlag(
    environmentId: string,
    configId: string,
    key: string,
    isSecret: boolean,
    userId: string,
  ): Promise<void> {
    const config = await this.assertS3Writable(environmentId, configId);
    const { entries } = await this.readS3Entries(config);
    if (!entries.some((e) => e.key === key)) {
      throw new NotFoundException();
    }
    await this.upsertMetadata(configId, key, userId, isSecret);

    const context = await this.auditContext(
      environmentId,
      config.projectComponentId,
    );
    await this.audit.record({
      userId,
      action: 'update',
      ...context,
      environmentId,
      key,
      metadata: { secretFlagChanged: true, isSecret },
    });
  }

  // extraMetadata: PRD Feature 6 — an approved DeleteRequest's execution is
  // "logged with both the requester and the approver". userId here is
  // always the approver (CLAUDE.md #2 — the real actor performing the
  // write); removeOrRequest passes the original requester through here so
  // that traceability lives in the metadata instead.
  async remove(
    environmentId: string,
    configId: string,
    key: string,
    userId: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    const config = await this.assertS3Writable(environmentId, configId);
    const { entries, etag } = await this.readS3Entries(config);
    if (!entries.some((e) => e.key === key)) {
      throw new NotFoundException();
    }
    await this.writeEntries(
      config,
      entries.filter((e) => e.key !== key),
      etag,
    );
    await this.metadataRepository.delete(configId, key);

    const context = await this.auditContext(
      environmentId,
      config.projectComponentId,
    );
    await this.audit.record({
      userId,
      action: 'delete',
      ...context,
      environmentId,
      key,
      metadata: extraMetadata,
    });
  }

  // CLAUDE.md #3/TRD — one endpoint per destructive action, role check
  // inside it: Admin executes remove() directly; Member gets a pending
  // DeleteRequest instead of the key actually being touched. The
  // request-creation path still needs the same scoping and GitHub-read-only
  // checks the direct-execute path gets via assertS3Writable.
  async removeOrRequest(
    environmentId: string,
    configId: string,
    key: string,
    requester: RequestUser,
  ): Promise<DeleteOrRequestResult> {
    if (requester.role === 'admin') {
      await this.remove(environmentId, configId, key, requester.id);
      return { status: 'deleted' };
    }
    const config = await this.assertRequestable(
      environmentId,
      configId,
      requester,
    );
    await this.requests.createDeleteRequest(requester.id, {
      targetType: 'variable',
      environmentId,
      projectComponentId: config.projectComponentId,
      key,
    });
    return { status: 'requested' };
  }

  // Same split as removeOrRequest, for rollback.
  async rollbackOrRequest(
    environmentId: string,
    configId: string,
    dto: RollbackDto,
    requester: RequestUser,
  ): Promise<RollbackOrRequestResult> {
    if (requester.role === 'admin') {
      await this.rollback(environmentId, configId, dto, requester.id);
      return { status: 'executed' };
    }
    await this.assertRequestable(environmentId, configId, requester);
    await this.requests.createRollbackRequest(
      requester.id,
      configId,
      dto.key ?? null,
      dto.targetVersionId,
    );
    return { status: 'requested' };
  }

  private async assertRequestable(
    environmentId: string,
    configId: string,
    requester: RequestUser,
  ): Promise<EnvironmentComponentConfig> {
    await this.assertEnvironmentAccess(requester, environmentId);
    const config = await this.assertS3Writable(environmentId, configId);
    await this.assertComponentAccess(
      requester,
      environmentId,
      config.projectComponentId,
    );
    return config;
  }

  async history(
    environmentId: string,
    configId: string,
    key: string,
    requester: RequestUser,
  ): Promise<VariableHistoryEntry[]> {
    await this.assertEnvironmentAccess(requester, environmentId);
    const config = await this.assertS3Writable(environmentId, configId);
    await this.assertComponentAccess(
      requester,
      environmentId,
      config.projectComponentId,
    );

    const credential = await this.findCredentialOrFail(config.s3CredentialId);
    const target = this.resolveTarget(config);
    const isSecret =
      (await this.metadataMap(configId)).get(key)?.isSecret ?? false;
    const versions = await this.s3.listVersions(credential, target);

    return Promise.all(
      versions.map(async (v) => {
        const text = await this.s3.getText(credential, target, v.versionId);
        const value =
          parseEnvFile(text).find((e) => e.key === key)?.value ?? null;
        return {
          versionId: v.versionId,
          isCurrent: v.isLatest,
          lastModified: v.lastModified,
          value: this.maskIfNeeded(value, isSecret, requester.role),
        };
      }),
    );
  }

  async reveal(
    environmentId: string,
    configId: string,
    key: string,
    userId: string,
  ): Promise<string> {
    const config = await this.assertS3Writable(environmentId, configId);
    const { entries } = await this.readS3Entries(config);
    const value = entries.find((e) => e.key === key)?.value;
    if (value === undefined) {
      throw new NotFoundException();
    }

    const context = await this.auditContext(
      environmentId,
      config.projectComponentId,
    );
    await this.audit.record({
      userId,
      action: 'reveal',
      ...context,
      environmentId,
      key,
    });
    return value;
  }

  async rollback(
    environmentId: string,
    configId: string,
    dto: RollbackDto,
    userId: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    const config = await this.assertS3Writable(environmentId, configId);
    const credential = await this.findCredentialOrFail(config.s3CredentialId);
    const target = this.resolveTarget(config);
    const oldText = await this.s3.getText(
      credential,
      target,
      dto.targetVersionId,
    );

    const { entries, etag } = await this.readS3Entries(config);
    if (!dto.key) {
      await this.s3.putText(credential, target, oldText, etag);
    } else {
      const oldValue = parseEnvFile(oldText).find(
        (e) => e.key === dto.key,
      )?.value;
      if (oldValue === undefined) {
        throw new NotFoundException(
          `"${dto.key}" did not exist in that version.`,
        );
      }
      const hasKey = entries.some((e) => e.key === dto.key);
      const updated = hasKey
        ? entries.map((e) =>
            e.key === dto.key ? { key: dto.key, value: oldValue } : e,
          )
        : [...entries, { key: dto.key, value: oldValue }];
      await this.writeEntries(config, updated, etag);
    }

    const context = await this.auditContext(
      environmentId,
      config.projectComponentId,
    );
    await this.audit.record({
      userId,
      action: 'rollback',
      ...context,
      environmentId,
      key: dto.key,
      metadata: { targetVersionId: dto.targetVersionId, ...extraMetadata },
    });
  }

  async importPreview(
    environmentId: string,
    configId: string,
    envText: string,
    requester: RequestUser,
  ): Promise<ImportPlan> {
    await this.assertEnvironmentAccess(requester, environmentId);
    const config = await this.assertS3Writable(environmentId, configId);
    await this.assertComponentAccess(
      requester,
      environmentId,
      config.projectComponentId,
    );
    return this.planImport(config, envText, requester.role);
  }

  async importCommit(
    environmentId: string,
    configId: string,
    envText: string,
    requester: RequestUser,
  ): Promise<ImportPlan> {
    await this.assertEnvironmentAccess(requester, environmentId);
    const config = await this.assertS3Writable(environmentId, configId);
    await this.assertComponentAccess(
      requester,
      environmentId,
      config.projectComponentId,
    );

    // Re-derived from scratch, never trusting a client-supplied plan (LLD).
    const plan = await this.planImport(config, envText, requester.role);
    if (plan.creates.length === 0 && plan.updates.length === 0) {
      return plan;
    }

    const { entries, etag } = await this.readS3Entries(config);
    const byKey = new Map(entries.map((e) => [e.key, e.value]));
    for (const { key, value } of [...plan.creates, ...plan.updates]) {
      byKey.set(key, value);
    }
    await this.writeEntries(
      config,
      [...byKey.entries()].map(([key, value]) => ({ key, value })),
      etag,
    );

    const metadataByKey = await this.metadataMap(configId);
    for (const { key } of plan.creates) {
      if (!metadataByKey.has(key)) {
        await this.upsertMetadata(configId, key, requester.id, false);
      }
    }

    const context = await this.auditContext(
      environmentId,
      config.projectComponentId,
    );
    await this.audit.record({
      userId: requester.id,
      action: 'import',
      ...context,
      environmentId,
      metadata: {
        created: plan.creates.map((c) => c.key),
        updated: plan.updates.map((u) => u.key),
        skipped: plan.skipped.map((s) => s.key),
      },
    });
    return plan;
  }

  private async planImport(
    config: EnvironmentComponentConfig,
    envText: string,
    role: UserRole,
  ): Promise<ImportPlan> {
    const proposed = parseEnvFile(envText);
    const { entries: current } = await this.readS3Entries(config);
    const currentByKey = new Map(current.map((e) => [e.key, e.value]));
    const metadataByKey = await this.metadataMap(config.id);

    const creates: ImportPlan['creates'] = [];
    const updates: ImportPlan['updates'] = [];
    const skipped: ImportPlan['skipped'] = [];

    for (const { key, value } of proposed) {
      const existingValue = currentByKey.get(key);
      const isSecret = metadataByKey.get(key)?.isSecret ?? false;
      if (existingValue === undefined) {
        creates.push({ key, value });
      } else if (existingValue === value) {
        // Idempotent import — a no-op isn't written or logged (TRD).
        continue;
      } else if (isSecret && role !== 'admin') {
        skipped.push({ key, reason: 'secret-protected' });
      } else {
        updates.push({ key, value });
      }
    }
    return { creates, updates, skipped };
  }

  // Tier 1 of the two-tier scoping check (see class doc comment style used
  // across Projects/Environments): a Member must be assigned to this
  // environment at all before anything about a specific config is looked
  // up, so an unassigned Member gets the same 403 whether or not the
  // config/environment actually exists (CLAUDE.md #7).
  private async assertEnvironmentAccess(
    requester: RequestUser,
    environmentId: string,
  ): Promise<void> {
    if (requester.role === 'admin') return;
    if (
      !(await this.assignments.hasEnvironmentAccess(
        requester.id,
        environmentId,
      ))
    ) {
      throw new ForbiddenException();
    }
  }

  // Tier 2: once environment-level access is established, narrow further to
  // the specific component — a Member assigned to only one component of a
  // multi-component environment can't reach a sibling's variables.
  private async assertComponentAccess(
    requester: RequestUser,
    environmentId: string,
    projectComponentId: string,
  ): Promise<void> {
    if (requester.role === 'admin') return;
    if (
      !(await this.assignments.hasComponentAccess(
        requester.id,
        environmentId,
        projectComponentId,
      ))
    ) {
      throw new ForbiddenException();
    }
  }

  private async assertS3Writable(
    environmentId: string,
    configId: string,
  ): Promise<EnvironmentComponentConfig> {
    const config = await this.findConfigOrFail(environmentId, configId);
    if (config.sourceType === 'github') {
      throw new ForbiddenException({ error: 'read_only_source' });
    }
    return config;
  }

  private async readS3Entries(
    config: EnvironmentComponentConfig,
  ): Promise<{ entries: EnvEntry[]; etag: string | null }> {
    const credential = await this.findCredentialOrFail(config.s3CredentialId);
    const target = this.resolveTarget(config);
    const { text, etag } = await this.s3.getObject(credential, target);
    return { entries: parseEnvFile(text), etag };
  }

  // etag = what readS3Entries saw; the write is rejected with a 409 if the
  // object changed since (see S3ObjectService.putText).
  private async writeEntries(
    config: EnvironmentComponentConfig,
    entries: EnvEntry[],
    etag: string | null,
  ): Promise<void> {
    const credential = await this.findCredentialOrFail(config.s3CredentialId);
    const target = this.resolveTarget(config);
    await this.s3.putText(credential, target, serializeEnvFile(entries), etag);
  }

  // No key override = a stable, id-based default path — names (project,
  // environment, component) can be renamed later without silently orphaning
  // the S3 object the config already points at.
  private resolveTarget(config: EnvironmentComponentConfig): S3Target {
    return {
      bucket: config.s3Bucket!,
      region: config.s3Region!,
      key:
        config.s3KeyOverride ??
        `${config.environmentId}/${config.projectComponentId}.env`,
    };
  }

  private maskIfNeeded(
    value: string | null,
    isSecret: boolean,
    role: UserRole,
  ): string | null {
    if (value === null) return null;
    return isSecret && role !== 'admin' ? null : value;
  }

  private async metadataMap(
    configId: string,
  ): Promise<Map<string, VariableMetadata>> {
    const rows = await this.metadataRepository.findByConfig(configId);
    return new Map(rows.map((row) => [row.key, row]));
  }

  private async upsertMetadata(
    configId: string,
    key: string,
    userId: string,
    isSecret: boolean,
  ): Promise<void> {
    const existing = await this.metadataRepository.findOne(configId, key);
    if (existing) {
      existing.isSecret = isSecret;
      existing.lastChangedBy = userId;
      await this.metadataRepository.save(existing);
    } else {
      await this.metadataRepository.save(
        this.metadataRepository.create({
          environmentComponentConfigId: configId,
          key,
          isSecret,
          lastChangedBy: userId,
        }),
      );
    }
  }

  private async findConfigOrFail(
    environmentId: string,
    configId: string,
  ): Promise<EnvironmentComponentConfig> {
    const found = await this.configsRepository.findByIdAndEnvironment(
      configId,
      environmentId,
    );
    if (!found) {
      throw new NotFoundException();
    }
    return found;
  }

  private async findCredentialOrFail(
    credentialId: string | null,
  ): Promise<Credential> {
    const found = credentialId
      ? await this.credentialsRepository.findById(credentialId)
      : null;
    if (!found) {
      throw new BadRequestException(
        'The credential this config points at no longer exists.',
      );
    }
    return found;
  }
}
