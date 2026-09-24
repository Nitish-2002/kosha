import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type DeleteRequestTargetType =
  'variable' | 'component' | 'environment' | 'project';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

// Only the columns relevant to targetType are populated — see the migration
// comment for which ones per target. Not a TypeORM relation on purpose, same
// reasoning as AuditLog: this only ever reads/writes raw ids.
@Entity('delete_requests')
export class DeleteRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  requesterId!: string;

  @Column({ type: 'text' })
  targetType!: DeleteRequestTargetType;

  @Column({ type: 'uuid', nullable: true })
  projectId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  environmentId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  projectComponentId!: string | null;

  @Column({ type: 'text', nullable: true })
  key!: string | null;

  @Column({ type: 'text', default: 'pending' })
  status!: RequestStatus;

  @Column({ type: 'uuid', nullable: true })
  reviewerId!: string | null;

  @Column({ type: 'text', nullable: true })
  reviewerNote!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;
}
