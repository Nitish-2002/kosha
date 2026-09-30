import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { ProjectAssignmentsModule } from '../project-assignments/project-assignments.module';
import { ProjectsModule } from '../projects/projects.module';
import { RequestsModule } from '../requests/requests.module';
import { User } from '../users/user.entity';
import { DbScript } from './db-script.entity';
import { DbScriptState } from './db-script-state.entity';
import { DbRefresh } from './db-refresh.entity';
import { DbScriptsController } from './db-scripts.controller';
import { DbRefreshesController } from './db-refreshes.controller';
import { DbScriptsRepository } from './db-scripts.repository';
import { DbScriptsService } from './db-scripts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DbScript, DbScriptState, DbRefresh, User]),
    AuditModule,
    EnvironmentsModule,
    ProjectAssignmentsModule,
    ProjectsModule,
    RequestsModule,
  ],
  controllers: [DbScriptsController, DbRefreshesController],
  providers: [DbScriptsService, DbScriptsRepository],
  // RequestReviewsModule runs an approved undo request through it.
  exports: [DbScriptsService],
})
export class DbScriptsModule {}
