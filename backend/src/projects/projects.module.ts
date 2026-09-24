import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ProjectAssignmentsModule } from '../project-assignments/project-assignments.module';
import { RequestsModule } from '../requests/requests.module';
import { Environment } from '../environments/environment.entity';
import { Project } from './project.entity';
import { ProjectComponent } from './project-component.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsRepository } from './projects.repository';
import { ProjectComponentsRepository } from './project-components.repository';
import { EnvironmentCountLookupRepository } from './environment-count-lookup.repository';

@Module({
  imports: [
    // Environment is registered locally here too (see
    // environment-count-lookup.repository.ts) — EnvironmentsModule imports
    // ProjectsModule, so importing it back would be a cycle.
    TypeOrmModule.forFeature([Project, ProjectComponent, Environment]),
    AuditModule,
    ProjectAssignmentsModule,
    RequestsModule,
  ],
  providers: [
    ProjectsService,
    ProjectsRepository,
    ProjectComponentsRepository,
    EnvironmentCountLookupRepository,
  ],
  controllers: [ProjectsController],
  // Repositories exported too: Environments/Variables need plain
  // existence/ownership lookups on Project/ProjectComponent, not
  // ProjectsService's assembled ProjectSummary DTOs.
  exports: [ProjectsService, ProjectsRepository, ProjectComponentsRepository],
})
export class ProjectsModule {}
