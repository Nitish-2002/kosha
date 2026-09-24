import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { ProjectsModule } from '../projects/projects.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { ProjectAssignmentsModule } from '../project-assignments/project-assignments.module';
import { RequestsModule } from '../requests/requests.module';
import { VariableMetadata } from './variable-metadata.entity';
import { VariablesController } from './variables.controller';
import { VariablesService } from './variables.service';
import { VariableMetadataRepository } from './variable-metadata.repository';
import { S3ObjectService } from './s3-object.service';
import { GithubManifestService } from './github-manifest.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([VariableMetadata]),
    AuditModule,
    CredentialsModule,
    ProjectsModule,
    EnvironmentsModule,
    ProjectAssignmentsModule,
    RequestsModule,
  ],
  controllers: [VariablesController],
  providers: [
    VariablesService,
    VariableMetadataRepository,
    S3ObjectService,
    GithubManifestService,
  ],
  // VariablesService is exported for RequestReviewsModule, which executes
  // an approved delete/rollback request by calling it directly.
  exports: [VariablesService],
})
export class VariablesModule {}
