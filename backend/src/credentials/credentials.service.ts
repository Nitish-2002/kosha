import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Credential, CredentialType } from './credential.entity';
import { CryptoService } from './crypto.service';
import { CredentialsRepository } from './credentials.repository';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { UpdateCredentialDto } from './dto/update-credential.dto';

export interface CredentialSummary {
  id: string;
  type: CredentialType;
  label: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AwsSecret {
  accessKeyId: string;
  secretAccessKey: string;
}

interface GithubSecret {
  username: string;
  pat: string;
}

@Injectable()
export class CredentialsService {
  constructor(
    private readonly credentialsRepository: CredentialsRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<CredentialSummary[]> {
    const rows = await this.credentialsRepository.findAll();
    return rows.map((row) => this.toSummary(row));
  }

  async create(
    dto: CreateCredentialDto,
    userId: string,
  ): Promise<CredentialSummary> {
    const secret: AwsSecret | GithubSecret =
      dto.type === 'aws'
        ? {
            accessKeyId: dto.accessKeyId!,
            secretAccessKey: dto.secretAccessKey!,
          }
        : { username: dto.username!, pat: dto.pat! };

    const saved = await this.credentialsRepository.save(
      this.credentialsRepository.create({
        type: dto.type,
        label: dto.label,
        encryptedSecret: this.crypto.encrypt(JSON.stringify(secret)),
        createdBy: userId,
      }),
    );

    await this.audit.record({
      userId,
      action: 'create',
      metadata: {
        credentialId: saved.id,
        type: saved.type,
        label: saved.label,
      },
    });
    return this.toSummary(saved);
  }

  async update(
    id: string,
    dto: UpdateCredentialDto,
    userId: string,
  ): Promise<CredentialSummary> {
    const existing = await this.findOrFail(id);

    if (
      dto.accessKeyId !== undefined ||
      dto.secretAccessKey !== undefined ||
      dto.username !== undefined ||
      dto.pat !== undefined
    ) {
      const current = JSON.parse(
        this.crypto.decrypt(existing.encryptedSecret),
      ) as AwsSecret & GithubSecret;
      const next: AwsSecret | GithubSecret =
        existing.type === 'aws'
          ? {
              accessKeyId: dto.accessKeyId ?? current.accessKeyId,
              secretAccessKey: dto.secretAccessKey ?? current.secretAccessKey,
            }
          : {
              username: dto.username ?? current.username,
              pat: dto.pat ?? current.pat,
            };
      existing.encryptedSecret = this.crypto.encrypt(JSON.stringify(next));
    }
    if (dto.label !== undefined) {
      existing.label = dto.label;
    }

    const saved = await this.credentialsRepository.save(existing);
    await this.audit.record({
      userId,
      action: 'update',
      metadata: {
        credentialId: saved.id,
        type: saved.type,
        label: saved.label,
      },
    });
    return this.toSummary(saved);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.findOrFail(id);
    await this.credentialsRepository.remove(existing);
    await this.audit.record({
      userId,
      action: 'delete',
      metadata: {
        credentialId: id,
        type: existing.type,
        label: existing.label,
      },
    });
  }

  private async findOrFail(id: string): Promise<Credential> {
    const found = await this.credentialsRepository.findById(id);
    if (!found) {
      throw new NotFoundException();
    }
    return found;
  }

  private toSummary(credential: Credential): CredentialSummary {
    return {
      id: credential.id,
      type: credential.type,
      label: credential.label,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
}
