import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectAssignmentsModule } from '../project-assignments/project-assignments.module';
import { RequestsModule } from '../requests/requests.module';
import { Environment } from './environment.entity';
import { EnvironmentComponentConfig } from './environment-component-config.entity';
import { EnvironmentsController } from './environments.controller';
import { EnvironmentsService } from './environments.service';
import { EnvironmentsRepository } from './environments.repository';
import { EnvironmentComponentConfigsRepository } from './environment-component-configs.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Environment, EnvironmentComponentConfig]),
    AuditModule,
    CredentialsModule,
    ProjectsModule,
    ProjectAssignmentsModule,
    RequestsModule,
  ],
  controllers: [EnvironmentsController],
  providers: [
    EnvironmentsService,
    EnvironmentsRepository,
    EnvironmentComponentConfigsRepository,
  ],
  // EnvironmentComponentConfigsRepository and EnvironmentsRepository are
  // exported too: VariablesModule needs the same "find this environment's
  // component config" / "find this environment's project" lookups, to
  // resolve project context for its own audit log entries.
  exports: [
    EnvironmentsService,
    EnvironmentComponentConfigsRepository,
    EnvironmentsRepository,
  ],
})
export class EnvironmentsModule {}
