import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ComponentConfigSourceType = 's3' | 'github';

// Exactly one of the s3_*/github_* column groups is populated per row,
// selected by sourceType and enforced by a DB CHECK constraint (see the
// migration) — not two tables, per LLD's "one row per (environment,
// component) either way" decision.
@Entity('environment_component_configs')
export class EnvironmentComponentConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  environmentId!: string;

  @Column({ type: 'uuid' })
  projectComponentId!: string;

  @Column({ type: 'text' })
  sourceType!: ComponentConfigSourceType;

  @Column({ type: 'text', nullable: true })
  s3Bucket!: string | null;

  @Column({ type: 'text', nullable: true })
  s3Region!: string | null;

  @Column({ type: 'uuid', nullable: true })
  s3CredentialId!: string | null;

  @Column({ type: 'text', nullable: true })
  s3KeyOverride!: string | null;

  @Column({ type: 'text', nullable: true })
  githubRepo!: string | null;

  @Column({ type: 'text', nullable: true })
  githubBranch!: string | null;

  @Column({ type: 'uuid', nullable: true })
  githubCredentialId!: string | null;

  @Column({ type: 'text', nullable: true })
  githubConfigmapPath!: string | null;

  @Column({ type: 'text', nullable: true })
  githubSecretPath!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
