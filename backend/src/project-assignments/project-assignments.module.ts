import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { ProjectComponent } from '../projects/project-component.entity';
import { Environment } from '../environments/environment.entity';
import { ProjectAssignment } from './project-assignment.entity';
import { ProjectAssignmentsController } from './project-assignments.controller';
import { ProjectAssignmentsService } from './project-assignments.service';
import { ProjectAssignmentsRepository } from './project-assignments.repository';
import {
  EnvironmentLookupRepository,
  ProjectComponentLookupRepository,
  ProjectLookupRepository,
  UserLookupRepository,
} from './lookups.repository';

// Registers Project/ProjectComponent/Environment/User entities locally
// (rather than importing ProjectsModule/EnvironmentsModule/UsersModule) —
// see the comment atop lookups.repository.ts for why: those modules import
// this one for scoping, so importing them back here would be a cycle.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectAssignment,
      User,
      Project,
      ProjectComponent,
      Environment,
    ]),
    AuditModule,
  ],
  controllers: [ProjectAssignmentsController],
  providers: [
    ProjectAssignmentsService,
    ProjectAssignmentsRepository,
    UserLookupRepository,
    ProjectLookupRepository,
    ProjectComponentLookupRepository,
    EnvironmentLookupRepository,
  ],
  exports: [ProjectAssignmentsService],
})
export class ProjectAssignmentsModule {}
