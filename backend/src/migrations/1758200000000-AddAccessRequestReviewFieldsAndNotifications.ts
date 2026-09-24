import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccessRequestReviewFieldsAndNotifications1758200000000 implements MigrationInterface {
  name = 'AddAccessRequestReviewFieldsAndNotifications1758200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "access_requests"
        ADD COLUMN "reviewedBy" uuid REFERENCES "users"("id"),
        ADD COLUMN "reviewedAt" timestamptz
    `);

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "recipientId" uuid NOT NULL REFERENCES "users"("id"),
        "type" text NOT NULL,
        "payload" jsonb,
        "readAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`
      ALTER TABLE "access_requests"
        DROP COLUMN "reviewedBy",
        DROP COLUMN "reviewedAt"
    `);
  }
}
