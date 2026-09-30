import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { RequestStatus } from './delete-request.entity';

// A Member asking an Admin to set a DB script back to pending in one
// environment, after marking it applied by mistake (PRD Feature 12).
@Entity('db_script_undo_requests')
export class DbScriptUndoRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  requesterId!: string;

  @Column({ type: 'uuid' })
  scriptId!: string;

  @Column({ type: 'uuid' })
  environmentId!: string;

  @Column({ type: 'text' })
  reason!: string;

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
