import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CredentialType = 'aws' | 'github';

@Entity('credentials')
export class Credential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  type!: CredentialType;

  @Column({ type: 'text' })
  label!: string;

  // Encrypted JSON — {accessKeyId, secretAccessKey} for aws, {pat} for github.
  // Never sent back in any API response (see CredentialsService.toSummary).
  @Column({ type: 'text' })
  encryptedSecret!: string;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
