import { MigrationInterface, QueryRunner } from 'typeorm';

// A Member's request to set a wrongly-marked DB script back to pending in one
// environment (PRD Feature 12 — "Undo a wrong mark"). Same shape and
// lifecycle as delete_requests/rollback_requests; reason is required because
// the Admin has to judge whether the SQL really never ran there.
// ON DELETE CASCADE on the script/environment: a request about something
// that's gone is dead weight. The partial unique index is the same
// one-pending-request-per-target guarantee as UniquePendingRequests.
export class CreateDbScriptUndoRequests1759300000000 implements MigrationInterface {
  name = 'CreateDbScriptUndoRequests1759300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "db_script_undo_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requesterId" uuid NOT NULL REFERENCES "users"("id"),
        "scriptId" uuid NOT NULL REFERENCES "db_scripts"("id") ON DELETE CASCADE,
        "environmentId" uuid NOT NULL REFERENCES "environments"("id") ON DELETE CASCADE,
        "reason" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
        "reviewerId" uuid REFERENCES "users"("id"),
        "reviewerNote" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "reviewedAt" timestamptz
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_db_script_undo_requests_pending_target"
      ON "db_script_undo_requests" ("scriptId", "environmentId")
      WHERE "status" = 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "db_script_undo_requests"`);
  }
}
