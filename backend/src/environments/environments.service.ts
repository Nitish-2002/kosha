import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../credentials/crypto.service';
import { CredentialsRepository } from '../credentials/credentials.repository';
import { ProjectsRepository } from '../projects/projects.repository';
import { ProjectComponentsRepository } from '../projects/project-components.repository';
import { ProjectComponent } from '../projects/project-component.entity';
import { Credential } from '../credentials/credential.entity';
import { ProjectAssignmentsService } from '../project-assignments/project-assignments.service';
import { RequestsService } from '../requests/requests.service';
import { RequestUser } from '../auth/jwt-payload.interface';
import { Environment } from './environment.entity';
import { EnvironmentComponentConfig } from './environment-component-config.entity';
import { EnvironmentsRepository } from './environments.repository';
import { EnvironmentComponentConfigsRepository } from './environment-component-configs.repository';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { CreateComponentConfigDto } from './dto/create-component-config.dto';
import { UpdateComponentConfigDto } from './dto/update-component-config.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { GithubBulkPreviewDto } from './dto/github-bulk-preview.dto';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

export interface EnvironmentSummary {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ComponentConfigSummary {
  id: string;
  environmentId: string;
  projectComponentId: string;
  componentName: string;
  sourceType: 's3' | 'github';
  s3Bucket: string | null;
  s3Region: string | null;
  s3CredentialId: string | null;
  s3KeyOverride: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  githubCredentialId: string | null;
  githubConfigmapPath: string | null;
  githubSecretPath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DeleteOrRequestResult =
  { status: 'deleted' } | { status: 'requested' };

export interface GithubBulkPreviewRow {
  projectComponentId: string;
  componentName: string;
  path: string;
  status: 'found' | 'not-found' | 'already-connected';
}

@Injectable()
export class EnvironmentsService {
  constructor(
    private readonly environmentsRepository: EnvironmentsRepository,
    private readonly configsRepository: EnvironmentComponentConfigsRepository,
    private readonly projectsRepository: ProjectsRepository,
    private readonly componentsRepository: ProjectComponentsRepository,
    private readonly credentialsRepository: CredentialsRepository,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly assignments: ProjectAssignmentsService,
    private readonly requests: RequestsService,
  ) {}

  // Admin sees every environment in the project; a Member sees only the
  // ones they hold a ProjectAssignment for.
  async listByProject(
    projectId: string,
    requester: RequestUser,
  ): Promise<EnvironmentSummary[]> {
    if (
      requester.role !== 'admin' &&
      !(await this.assignments.hasProjectAccess(requester.id, projectId))
    ) {
      throw new ForbiddenException();
    }
    await this.findProjectOrFail(projectId);
    const rows =
      requester.role === 'admin'
        ? await this.environmentsRepository.findByProject(projectId)
        : await this.environmentsRepository.findByIdsOrderedByCreatedAt([
            ...(await this.assignments.assignedEnvironmentIds(
              requester.id,
              projectId,
            )),
          ]);
    return rows.map((row) => this.toSummary(row));
  }

  async findOne(
    id: string,
    requester: RequestUser,
  ): Promise<EnvironmentSummary> {
    if (
      requester.role !== 'admin' &&
      !(await this.assignments.hasEnvironmentAccess(requester.id, id))
    ) {
      throw new ForbiddenException();
    }
    return this.toSummary(await this.findOrFail(id));
  }

  async create(
    projectId: string,
    dto: CreateEnvironmentDto,
    userId: string,
  ): Promise<EnvironmentSummary> {
    const project = await this.findProjectOrFail(projectId);
    const environment = this.environmentsRepository.create({
      projectId,
      name: dto.name,
    });
    let saved: Environment;
    try {
      saved = await this.environmentsRepository.save(environment);
    } catch (error) {
      throw this.translateError(
        error,
        'This project already has an environment with that name.',
      );
    }

    await this.audit.record({
      userId,
      action: 'create',
      projectId,
      projectNameSnapshot: project.name,
      environmentId: saved.id,
      environmentNameSnapshot: saved.name,
      metadata: { environmentId: saved.id, name: saved.name },
    });
    return this.toSummary(saved);
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
    const environment = await this.findOrFail(id);
    const project = await this.projectsRepository.findById(
      environment.projectId,
    );
    // Audit write happens before the delete — see the identical comment in
    // ProjectsService.remove(): audit_logs.environmentId is a real FK
    // (ON DELETE SET NULL), so it can only be inserted while the row it
    // points at still exists.
    await this.audit.record({
      userId,
      action: 'delete',
      projectId: environment.projectId,
      projectNameSnapshot: project?.name,
      environmentId: id,
      environmentNameSnapshot: environment.name,
      metadata: { environmentId: id, name: environment.name, ...extraMetadata },
    });
    await this.environmentsRepository.remove(environment);
  }

  // CLAUDE.md #3/TRD — one endpoint per destructive action, role check
  // inside it: Admin executes remove() directly; Member gets a pending
  // DeleteRequest instead of the environment actually being touched.
  async removeOrRequest(
    id: string,
    requester: RequestUser,
  ): Promise<DeleteOrRequestResult> {
    // Scoped read — 403s an out-of-scope Member before any existence check
    // (CLAUDE.md #7), and hands back projectId for the request row either way.
    const environment = await this.findOne(id, requester);
    if (requester.role === 'admin') {
      await this.remove(id, requester.id);
      return { status: 'deleted' };
    }
    await this.requests.createDeleteRequest(requester.id, {
      targetType: 'environment',
      projectId: environment.projectId,
      environmentId: id,
    });
    return { status: 'requested' };
  }

  async listComponentConfigs(
    environmentId: string,
    requester: RequestUser,
  ): Promise<ComponentConfigSummary[]> {
    if (
      requester.role !== 'admin' &&
      !(await this.assignments.hasEnvironmentAccess(
        requester.id,
        environmentId,
      ))
    ) {
      throw new ForbiddenException();
    }
    await this.findOrFail(environmentId);
    let rows = await this.configsRepository.findByEnvironment(environmentId);

    if (requester.role !== 'admin') {
      const { all, componentIds } =
        await this.assignments.componentScopeForEnvironment(
          requester.id,
          environmentId,
        );
      if (!all) {
        rows = rows.filter((row) => componentIds.has(row.projectComponentId));
      }
    }

    const componentIds = rows.map((row) => row.projectComponentId);
    const components = await this.componentsRepository.findByIds(componentIds);
    return rows.map((row) => this.toConfigSummary(row, components));
  }

  async addComponentConfig(
    environmentId: string,
    dto: CreateComponentConfigDto,
    userId: string,
  ): Promise<ComponentConfigSummary> {
    const environment = await this.findOrFail(environmentId);
    const component = await this.componentsRepository.findById(
      dto.projectComponentId,
    );
    if (!component) {
      throw new NotFoundException('That component does not exist.');
    }
    if (component.projectId !== environment.projectId) {
      throw new BadRequestException(
        "That component does not belong to this environment's project.",
      );
    }

    if (dto.sourceType === 's3') {
      await this.assertCredentialType(dto.s3CredentialId!, 'aws');
    } else {
      await this.assertCredentialType(dto.githubCredentialId!, 'github');
    }

    const config = this.configsRepository.create({
      environmentId,
      projectComponentId: dto.projectComponentId,
      sourceType: dto.sourceType,
      s3Bucket: dto.sourceType === 's3' ? dto.s3Bucket! : null,
      s3Region: dto.sourceType === 's3' ? dto.s3Region! : null,
      s3CredentialId: dto.sourceType === 's3' ? dto.s3CredentialId! : null,
      s3KeyOverride:
        dto.sourceType === 's3' ? (dto.s3KeyOverride ?? null) : null,
      githubRepo: dto.sourceType === 'github' ? dto.githubRepo! : null,
      githubBranch: dto.sourceType === 'github' ? dto.githubBranch! : null,
      githubCredentialId:
        dto.sourceType === 'github' ? dto.githubCredentialId! : null,
      githubConfigmapPath:
        dto.sourceType === 'github' ? (dto.githubConfigmapPath ?? null) : null,
      githubSecretPath:
        dto.sourceType === 'github' ? (dto.githubSecretPath ?? null) : null,
    });

    let saved: EnvironmentComponentConfig;
    try {
      saved = await this.configsRepository.save(config);
    } catch (error) {
      throw this.translateError(
        error,
        'This environment already has a config for that component.',
      );
    }

    const project = await this.projectsRepository.findById(
      environment.projectId,
    );
    await this.audit.record({
      userId,
      action: 'create',
      projectId: environment.projectId,
      projectNameSnapshot: project?.name,
      environmentId,
      environmentNameSnapshot: environment.name,
      componentName: component.name,
      metadata: { configId: saved.id, sourceType: saved.sourceType },
    });
    return this.toConfigSummary(saved, [component]);
  }

  async updateComponentConfig(
    environmentId: string,
    configId: string,
    dto: UpdateComponentConfigDto,
    userId: string,
  ): Promise<ComponentConfigSummary> {
    const environment = await this.findOrFail(environmentId);
    const config = await this.findConfigOrFail(environmentId, configId);
    const component = await this.componentsRepository.findById(
      config.projectComponentId,
    );

    const isS3Field =
      dto.s3Bucket !== undefined ||
      dto.s3Region !== undefined ||
      dto.s3CredentialId !== undefined ||
      dto.s3KeyOverride !== undefined;
    const isGithubField =
      dto.githubRepo !== undefined ||
      dto.githubBranch !== undefined ||
      dto.githubCredentialId !== undefined ||
      dto.githubConfigmapPath !== undefined ||
      dto.githubSecretPath !== undefined;

    if (config.sourceType === 's3' && isGithubField) {
      throw new BadRequestException(
        'This is an S3-sourced config; only s3* fields can be updated.',
      );
    }
    if (config.sourceType === 'github' && isS3Field) {
      throw new BadRequestException(
        'This is a GitHub-sourced config; only github* fields can be updated.',
      );
    }

    if (config.sourceType === 's3' && dto.s3CredentialId !== undefined) {
      await this.assertCredentialType(dto.s3CredentialId, 'aws');
    }
    if (
      config.sourceType === 'github' &&
      dto.githubCredentialId !== undefined
    ) {
      await this.assertCredentialType(dto.githubCredentialId, 'github');
    }

    if (dto.s3Bucket !== undefined) config.s3Bucket = dto.s3Bucket;
    if (dto.s3Region !== undefined) config.s3Region = dto.s3Region;
    if (dto.s3CredentialId !== undefined)
      config.s3CredentialId = dto.s3CredentialId;
    if (dto.s3KeyOverride !== undefined)
      config.s3KeyOverride = dto.s3KeyOverride;
    if (dto.githubRepo !== undefined) config.githubRepo = dto.githubRepo;
    if (dto.githubBranch !== undefined) config.githubBranch = dto.githubBranch;
    if (dto.githubCredentialId !== undefined)
      config.githubCredentialId = dto.githubCredentialId;
    if (dto.githubConfigmapPath !== undefined)
      config.githubConfigmapPath = dto.githubConfigmapPath;
    if (dto.githubSecretPath !== undefined)
      config.githubSecretPath = dto.githubSecretPath;

    const saved = await this.configsRepository.save(config);
    const project = await this.projectsRepository.findById(
      environment.projectId,
    );
    await this.audit.record({
      userId,
      action: 'update',
      projectId: environment.projectId,
      projectNameSnapshot: project?.name,
      environmentId,
      environmentNameSnapshot: environment.name,
      componentName: component?.name,
      metadata: { configId: saved.id },
    });
    return this.toConfigSummary(saved, component ? [component] : []);
  }

  async removeComponentConfig(
    environmentId: string,
    configId: string,
    userId: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    const environment = await this.findOrFail(environmentId);
    const config = await this.findConfigOrFail(environmentId, configId);
    const component = await this.componentsRepository.findById(
      config.projectComponentId,
    );
    await this.configsRepository.remove(config);
    const project = await this.projectsRepository.findById(
      environment.projectId,
    );
    await this.audit.record({
      userId,
      action: 'delete',
      projectId: environment.projectId,
      projectNameSnapshot: project?.name,
      environmentId,
      environmentNameSnapshot: environment.name,
      componentName: component?.name,
      metadata: { configId, ...extraMetadata },
    });
  }

  // Same split as removeOrRequest, for one environment's component
  // connection. listComponentConfigs is reused for both the 403-before-404
  // scoping check and to resolve the config's projectComponentId — a Member
  // only sees the configs their assignments cover, so one outside their
  // scope 404s the same way a nonexistent one would.
  async removeComponentOrRequest(
    environmentId: string,
    configId: string,
    requester: RequestUser,
  ): Promise<DeleteOrRequestResult> {
    const configs = await this.listComponentConfigs(environmentId, requester);
    const config = configs.find((c) => c.id === configId);
    if (!config) {
      throw new NotFoundException();
    }
    if (requester.role === 'admin') {
      await this.removeComponentConfig(environmentId, configId, requester.id);
      return { status: 'deleted' };
    }
    await this.requests.createDeleteRequest(requester.id, {
      targetType: 'component',
      environmentId,
      projectComponentId: config.projectComponentId,
    });
    return { status: 'requested' };
  }

  // Read-only check, no AuditLog — this never persists anything, it just
  // tells the caller whether the credential+target they've typed actually
  // works, before they commit to wiring it up. Deliberately tests reachability
  // (bucket/repo+branch exist and the credential can see them), not a
  // specific object/manifest path — that may not exist yet for a brand-new
  // connection, and isn't what "is this credential right" is asking.
  async testConnection(dto: TestConnectionDto): Promise<{ success: true }> {
    if (dto.sourceType === 's3') {
      const credential = await this.assertCredentialType(
        dto.s3CredentialId!,
        'aws',
      );
      await this.testS3Bucket(
        credential,
        dto.s3Bucket!,
        dto.s3Region!,
        dto.s3KeyOverride,
      );
    } else {
      const credential = await this.assertCredentialType(
        dto.githubCredentialId!,
        'github',
      );
      await this.testGithubRepo(
        credential,
        dto.githubRepo!,
        dto.githubBranch!,
        dto.githubConfigmapPath,
        dto.githubSecretPath,
      );
    }
    return { success: true };
  }

  // Read-only, no AuditLog — same as testConnection. Resolves the path
  // template per project component and checks each file on the branch; the
  // frontend then creates the chosen rows through addComponentConfig, so
  // each config stays a plain row with its own FK and audit entry.
  async previewGithubBulk(
    environmentId: string,
    dto: GithubBulkPreviewDto,
  ): Promise<GithubBulkPreviewRow[]> {
    const environment = await this.findOrFail(environmentId);
    const credential = await this.assertCredentialType(
      dto.githubCredentialId,
      'github',
    );
    await this.testGithubRepo(credential, dto.githubRepo, dto.githubBranch);

    const [components, configs] = await Promise.all([
      this.componentsRepository.findByProject(environment.projectId),
      this.configsRepository.findByEnvironment(environmentId),
    ]);
    const connectedIds = new Set(configs.map((c) => c.projectComponentId));
    const headers = this.githubHeaders(credential);

    return Promise.all(
      components.map(async (component) => {
        const path = dto.pathTemplate.replaceAll('{component}', component.name);
        let status: GithubBulkPreviewRow['status'] = 'already-connected';
        if (!connectedIds.has(component.id)) {
          const found = await this.githubFileExists(
            headers,
            dto.githubRepo,
            dto.githubBranch,
            path,
          );
          status = found ? 'found' : 'not-found';
        }
        return {
          projectComponentId: component.id,
          componentName: component.name,
          path,
          status,
        };
      }),
    );
  }

  private async testS3Bucket(
    credential: Credential,
    bucket: string,
    region: string,
    key?: string,
  ): Promise<void> {
    const secret = JSON.parse(
      this.crypto.decrypt(credential.encryptedSecret),
    ) as {
      accessKeyId: string;
      secretAccessKey: string;
    };
    const client = new S3Client({
      region,
      credentials: {
        accessKeyId: secret.accessKeyId,
        secretAccessKey: secret.secretAccessKey,
      },
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      throw new BadRequestException(this.describeS3Error(error, bucket));
    }

    // Checking the bucket alone lets "Test connection" say success for a key
    // that's simply wrong — only checked when a key is actually entered,
    // since no override means a default id-based path that may not exist
    // yet for a brand-new connection (see resolveTarget in variables.service).
    if (!key) return;
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) {
        throw new BadRequestException(
          `Key "${key}" was not found in bucket "${bucket}".`,
        );
      }
      throw new BadRequestException(
        `Could not reach key "${key}" in bucket "${bucket}": ${(error as { message?: string })?.message ?? 'unknown error'}.`,
      );
    }
  }

  private describeS3Error(error: unknown, bucket: string): string {
    const name = (error as { name?: string })?.name ?? '';
    const status = (error as { $metadata?: { httpStatusCode?: number } })
      ?.$metadata?.httpStatusCode;
    if (name === 'NotFound' || status === 404) {
      return `Bucket "${bucket}" does not exist.`;
    }
    if (name === 'Forbidden' || status === 403) {
      return `This credential doesn't have access to bucket "${bucket}" (or it doesn't exist).`;
    }
    if (name === 'PermanentRedirect' || status === 301) {
      return `Bucket "${bucket}" exists in a different region than entered.`;
    }
    return `Could not reach bucket "${bucket}": ${(error as { message?: string })?.message ?? 'unknown error'}.`;
  }

  private async testGithubRepo(
    credential: Credential,
    repo: string,
    branch: string,
    configmapPath?: string,
    secretPath?: string,
  ): Promise<void> {
    const headers = this.githubHeaders(credential);
    let repoResponse: Response;
    try {
      repoResponse = await fetch(`https://api.github.com/repos/${repo}`, {
        headers,
      });
    } catch {
      throw new BadRequestException('Could not reach GitHub.');
    }
    if (repoResponse.status === 404) {
      throw new BadRequestException(
        `Repo "${repo}" was not found, or this credential can't see it.`,
      );
    }
    if (!repoResponse.ok) {
      throw new BadRequestException(
        `GitHub returned ${repoResponse.status} for repo "${repo}".`,
      );
    }

    const branchResponse = await fetch(
      `https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`,
      { headers },
    );
    if (branchResponse.status === 404) {
      throw new BadRequestException(
        `Branch "${branch}" was not found in "${repo}".`,
      );
    }
    if (!branchResponse.ok) {
      throw new BadRequestException(
        `GitHub returned ${branchResponse.status} checking branch "${branch}".`,
      );
    }

    // Checking repo+branch reachability alone lets "Test connection" say
    // success for a path that's simply wrong — the whole point of testing
    // before saving. Only checked when a path is actually entered, since one
    // may not exist yet for a brand-new wiring.
    for (const [label, path] of [
      ['ConfigMap', configmapPath],
      ['Secret', secretPath],
    ] as const) {
      if (!path) continue;
      if (!(await this.githubFileExists(headers, repo, branch, path))) {
        throw new BadRequestException(
          `${label} file "${path}" was not found in "${repo}"@"${branch}".`,
        );
      }
    }
  }

  private githubHeaders(credential: Credential): Record<string, string> {
    const secret = JSON.parse(
      this.crypto.decrypt(credential.encryptedSecret),
    ) as { pat: string };
    return {
      Authorization: `Bearer ${secret.pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // false on 404; any other non-OK answer is a real problem worth surfacing.
  private async githubFileExists(
    headers: Record<string, string>,
    repo: string,
    branch: string,
    path: string,
  ): Promise<boolean> {
    const fileResponse = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      { headers },
    );
    if (fileResponse.status === 404) return false;
    if (!fileResponse.ok) {
      throw new BadRequestException(
        `GitHub returned ${fileResponse.status} checking "${path}".`,
      );
    }
    return true;
  }

  private async assertCredentialType(
    credentialId: string,
    expectedType: 'aws' | 'github',
  ): Promise<Credential> {
    const credential = await this.credentialsRepository.findById(credentialId);
    if (!credential) {
      throw new BadRequestException('That credential does not exist.');
    }
    if (credential.type !== expectedType) {
      throw new BadRequestException(
        `That credential is a ${credential.type} credential, not ${expectedType}.`,
      );
    }
    return credential;
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

  private async findProjectOrFail(id: string) {
    const found = await this.projectsRepository.findById(id);
    if (!found) {
      throw new NotFoundException();
    }
    return found;
  }

  private async findOrFail(id: string): Promise<Environment> {
    const found = await this.environmentsRepository.findById(id);
    if (!found) {
      throw new NotFoundException();
    }
    return found;
  }

  private translateError(error: unknown, conflictMessage: string): Error {
    const code = (error as { code?: string }).code;
    if (code === UNIQUE_VIOLATION || code === FOREIGN_KEY_VIOLATION) {
      return new ConflictException(conflictMessage);
    }
    return error as Error;
  }

  private toSummary(environment: Environment): EnvironmentSummary {
    return {
      id: environment.id,
      projectId: environment.projectId,
      name: environment.name,
      createdAt: environment.createdAt,
      updatedAt: environment.updatedAt,
    };
  }

  private toConfigSummary(
    config: EnvironmentComponentConfig,
    components: ProjectComponent[],
  ): ComponentConfigSummary {
    const component = components.find(
      (c) => c.id === config.projectComponentId,
    );
    return {
      id: config.id,
      environmentId: config.environmentId,
      projectComponentId: config.projectComponentId,
      componentName: component?.name ?? '',
      sourceType: config.sourceType,
      s3Bucket: config.s3Bucket,
      s3Region: config.s3Region,
      s3CredentialId: config.s3CredentialId,
      s3KeyOverride: config.s3KeyOverride,
      githubRepo: config.githubRepo,
      githubBranch: config.githubBranch,
      githubCredentialId: config.githubCredentialId,
      githubConfigmapPath: config.githubConfigmapPath,
      githubSecretPath: config.githubSecretPath,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }
}
