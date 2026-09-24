import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from './users/user.entity';
import { AccessRequest } from './access-requests/access-request.entity';
import { Credential } from './credentials/credential.entity';
import { AuditLog } from './audit/audit-log.entity';
import { Notification } from './notifications/notification.entity';
import { Project } from './projects/project.entity';
import { ProjectComponent } from './projects/project-component.entity';
import { Environment } from './environments/environment.entity';
import { EnvironmentComponentConfig } from './environments/environment-component-config.entity';
import { VariableMetadata } from './variables/variable-metadata.entity';
import { ProjectAssignment } from './project-assignments/project-assignment.entity';
import { DeleteRequest } from './requests/delete-request.entity';
import { RollbackRequest } from './requests/rollback-request.entity';

// Used only by the `typeorm` CLI (migration:generate/run/revert — see package.json
// scripts). The running app gets its connection via TypeOrmModule in app.module.ts;
// this file exists purely so migrations can be authored/applied outside Nest's DI.
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
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
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
