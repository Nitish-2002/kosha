import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndAccessRequests1758000000000 implements MigrationInterface {
  name = 'CreateUsersAndAccessRequests1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" text NOT NULL UNIQUE,
        "name" text,
        "role" text NOT NULL DEFAULT 'member' CHECK ("role" IN ('admin', 'member')),
        "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'deactivated')),
        "currentRefreshTokenId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "access_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" text NOT NULL UNIQUE,
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "access_requests"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
