import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'admin' | 'member';
export type UserStatus = 'active' | 'deactivated';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  // DB enforces the allowed values via a CHECK constraint (see the migration),
  // not a native Postgres enum type — easier to extend later. TypeScript's
  // UserRole/UserStatus unions are what give compile-time safety here.
  @Column({ type: 'text', default: 'member' })
  role!: UserRole;

  @Column({ type: 'text', default: 'active' })
  status!: UserStatus;

  // Single-session enforcement (see CLAUDE.md): a refresh token is only valid
  // if its `sid` claim matches this column. A fresh login overwrites it,
  // invalidating any previously issued refresh token.
  @Column({ type: 'uuid', nullable: true })
  currentRefreshTokenId!: string | null;

  // Set whenever a new session starts (each Google sign-in) — see
  // UsersRepository.updateRefreshTokenId. Shown as "Last active".
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
