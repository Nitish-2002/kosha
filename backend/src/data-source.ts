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
import { DbScript } from './db-scripts/db-script.entity';
import { DbScriptState } from './db-scripts/db-script-state.entity';
import { DbScriptUndoRequest } from './requests/db-script-undo-request.entity';
import { DbRefresh } from './db-scripts/db-refresh.entity';

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
    DbScript,
    DbScriptState,
    DbScriptUndoRequest,
    DbRefresh,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
