import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { RequestStatus } from './delete-request.entity';

// Rollback only ever applies to one granularity — a specific config's file —
// so unlike DeleteRequest this keeps a direct FK instead of decomposing into
// project/environment/component ids.
@Entity('rollback_requests')
export class RollbackRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  requesterId!: string;

  @Column({ type: 'uuid' })
  environmentComponentConfigId!: string;

  // Omitted = whole-file rollback, same convention as RollbackDto.
  @Column({ type: 'text', nullable: true })
  key!: string | null;

  @Column({ type: 'text' })
  targetVersionId!: string;

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
