import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Credential } from './credential.entity';

@Injectable()
export class CredentialsRepository {
  constructor(
    @InjectRepository(Credential) private readonly repo: Repository<Credential>,
  ) {}

  findAll(): Promise<Credential[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  findById(id: string): Promise<Credential | null> {
    return this.repo.findOneBy({ id });
  }

  create(
    fields: Pick<
      Credential,
      'type' | 'label' | 'encryptedSecret' | 'createdBy'
    >,
  ): Credential {
    return this.repo.create(fields);
  }

  save(credential: Credential): Promise<Credential> {
    return this.repo.save(credential);
  }

  remove(credential: Credential): Promise<Credential> {
    return this.repo.remove(credential);
  }
}
