import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AuditAction =
  'create' | 'update' | 'delete' | 'rollback' | 'reveal' | 'import';

// Append-only — see CLAUDE.md #2. No update/remove method exists on
// AuditService by design; don't add one.
//
// projectId/environmentId are DB-level FKs (ON DELETE SET NULL, added in the
// environments migration) but not TypeORM @ManyToOne relations — this entity
// only ever reads/writes the raw id, so a relation would be unused weight.
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid', nullable: true })
  projectId!: string | null;

  @Column({ type: 'text', nullable: true })
  projectNameSnapshot!: string | null;

  @Column({ type: 'uuid', nullable: true })
  environmentId!: string | null;

  @Column({ type: 'text', nullable: true })
  environmentNameSnapshot!: string | null;

  @Column({ type: 'text', nullable: true })
  componentName!: string | null;

  @Column({ type: 'text', nullable: true })
  key!: string | null;

  @Column({ type: 'text' })
  action!: AuditAction;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
