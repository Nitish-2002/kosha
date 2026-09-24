import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Only ever populated for S3-sourced configs — a GitHub-sourced config's
// secrecy is structural (ConfigMap vs Secret manifest), not a flag anyone
// sets here (see PRD Feature 8). The actual variable *value* lives in S3;
// this table only tracks the one thing Postgres owns about it: is it Secret.
@Entity('variable_metadata')
export class VariableMetadata {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  environmentComponentConfigId!: string;

  @Column({ type: 'text' })
  key!: string;

  @Column({ type: 'boolean', default: false })
  isSecret!: boolean;

  @Column({ type: 'uuid' })
  lastChangedBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
