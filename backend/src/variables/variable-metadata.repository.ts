import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VariableMetadata } from './variable-metadata.entity';

@Injectable()
export class VariableMetadataRepository {
  constructor(
    @InjectRepository(VariableMetadata)
    private readonly repo: Repository<VariableMetadata>,
  ) {}

  findByConfig(
    environmentComponentConfigId: string,
  ): Promise<VariableMetadata[]> {
    return this.repo.find({ where: { environmentComponentConfigId } });
  }

  findOne(
    environmentComponentConfigId: string,
    key: string,
  ): Promise<VariableMetadata | null> {
    return this.repo.findOneBy({ environmentComponentConfigId, key });
  }

  create(fields: {
    environmentComponentConfigId: string;
    key: string;
    isSecret: boolean;
    lastChangedBy: string;
  }): VariableMetadata {
    return this.repo.create(fields);
  }

  save(metadata: VariableMetadata): Promise<VariableMetadata> {
    return this.repo.save(metadata);
  }

  delete(environmentComponentConfigId: string, key: string): Promise<void> {
    return this.repo
      .delete({ environmentComponentConfigId, key })
      .then(() => undefined);
  }
}
