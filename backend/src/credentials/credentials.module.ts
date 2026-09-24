import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Credential } from './credential.entity';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { CredentialsRepository } from './credentials.repository';
import { CryptoService } from './crypto.service';

@Module({
  imports: [TypeOrmModule.forFeature([Credential]), AuditModule],
  controllers: [CredentialsController],
  providers: [CredentialsService, CredentialsRepository, CryptoService],
  // CredentialsRepository is exported too: Environments/Variables need a
  // plain "does this credential exist and what type is it" lookup, not
  // CredentialsService's full CRUD+audit surface.
  exports: [CryptoService, CredentialsRepository],
})
export class CredentialsModule {}
