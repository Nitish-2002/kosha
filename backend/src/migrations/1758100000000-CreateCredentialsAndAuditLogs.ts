import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCredentialsAndAuditLogs1758100000000 implements MigrationInterface {
  name = 'CreateCredentialsAndAuditLogs1758100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "credentials" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "type" text NOT NULL CHECK ("type" IN ('aws', 'github')),
        "label" text NOT NULL,
        "encryptedSecret" text NOT NULL,
        "createdBy" uuid NOT NULL REFERENCES "users"("id"),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id"),
        "projectId" uuid,
        "projectNameSnapshot" text,
        "environmentId" uuid,
        "environmentNameSnapshot" text,
        "componentName" text,
        "key" text,
        "action" text NOT NULL CHECK ("action" IN ('create', 'update', 'delete', 'rollback', 'reveal', 'import')),
        "metadata" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "credentials"`);
  }
}
