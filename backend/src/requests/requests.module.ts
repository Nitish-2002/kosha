import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { ProjectComponent } from '../projects/project-component.entity';
import { Environment } from '../environments/environment.entity';
import { EnvironmentComponentConfig } from '../environments/environment-component-config.entity';
import { DeleteRequest } from './delete-request.entity';
import { RollbackRequest } from './rollback-request.entity';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { RequestsRepository } from './requests.repository';
import {
  EnvironmentComponentConfigLookupRepository,
  EnvironmentLookupRepository,
  ProjectComponentLookupRepository,
  ProjectLookupRepository,
  UserLookupRepository,
} from './lookups.repository';

// A leaf module, deliberately: Projects/Environments/Variables modules all
// need to import this one (their controllers create a request when a
// Member hits a delete/rollback endpoint), so this module must not import
// any of them back — hence the local, read-only lookups instead of a real
// dependency on ProjectsModule/EnvironmentsModule. See lookups.repository.ts.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeleteRequest,
      RollbackRequest,
      User,
      Project,
      ProjectComponent,
      Environment,
      EnvironmentComponentConfig,
    ]),
    UsersModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [RequestsController],
  providers: [
    RequestsService,
    RequestsRepository,
    UserLookupRepository,
    ProjectLookupRepository,
    EnvironmentLookupRepository,
    ProjectComponentLookupRepository,
    EnvironmentComponentConfigLookupRepository,
  ],
  // RequestsRepository exported too: RequestReviewsModule needs the same
  // pending/find-by-id access to approve/reject, without duplicating it.
  exports: [RequestsService, RequestsRepository],
})
export class RequestsModule {}
