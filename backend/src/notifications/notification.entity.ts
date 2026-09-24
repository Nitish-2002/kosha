import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type NotificationType =
  | 'access_request_created'
  | 'access_request_approved'
  | 'access_request_rejected'
  | 'delete_request_created'
  | 'delete_request_approved'
  | 'delete_request_rejected'
  | 'rollback_request_created'
  | 'rollback_request_approved'
  | 'rollback_request_rejected';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  recipientId!: string;

  @Column({ type: 'text' })
  type!: NotificationType;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
