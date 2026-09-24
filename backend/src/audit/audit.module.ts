import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { User } from '../users/user.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditRepository } from './audit.repository';
import { UserLookupRepository } from './user-lookup.repository';

@Module({
  // User is registered locally (not by importing UsersModule) — see the
  // comment atop user-lookup.repository.ts for why: UsersModule already
  // imports this module for AuditService, so the reverse import would cycle.
  imports: [TypeOrmModule.forFeature([AuditLog, User])],
  controllers: [AuditController],
  providers: [AuditService, AuditRepository, UserLookupRepository],
  exports: [AuditService],
})
export class AuditModule {}
