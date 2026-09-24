import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { AccessRequest } from '../access-requests/access-request.entity';
import { Credential } from '../credentials/credential.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { Notification } from '../notifications/notification.entity';
import { Project } from '../projects/project.entity';
import { ProjectComponent } from '../projects/project-component.entity';
import { Environment } from '../environments/environment.entity';
import { EnvironmentComponentConfig } from '../environments/environment-component-config.entity';
import { VariableMetadata } from '../variables/variable-metadata.entity';
import { ProjectAssignment } from '../project-assignments/project-assignment.entity';
import { DeleteRequest } from '../requests/delete-request.entity';
import { RollbackRequest } from '../requests/rollback-request.entity';

export function buildDatabaseConfig(
  config: ConfigService,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: config.getOrThrow<string>('DATABASE_URL'),
    entities: [
      User,
      AccessRequest,
      Credential,
      AuditLog,
      Notification,
      Project,
      ProjectComponent,
      Environment,
      EnvironmentComponentConfig,
      VariableMetadata,
      ProjectAssignment,
      DeleteRequest,
      RollbackRequest,
    ],
    synchronize: false, // migrations only — see CLAUDE.md non-negotiable #4
    migrationsRun: false,
    // node-postgres's own default is 10 — too small once concurrent users are
    // actually hitting the app in parallel; requests queue behind an exhausted
    // pool instead of erroring, which just shows up as everything getting slow.
    extra: { max: config.get<number>('DB_POOL_SIZE') ?? 30 },
  };
}
