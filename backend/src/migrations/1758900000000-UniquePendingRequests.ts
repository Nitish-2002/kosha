import { MigrationInterface, QueryRunner } from 'typeorm';

// At most one PENDING request per target (GAPS — duplicate requests). A DB
// guarantee, not an app-level check: two simultaneous clicks can't both get
// through. The nullable target columns are COALESCEd because NULLs never
// collide in a unique index.
const NO_ID = `'00000000-0000-0000-0000-000000000000'::uuid`;

export class UniquePendingRequests1758900000000 implements MigrationInterface {
  name = 'UniquePendingRequests1758900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing duplicates would block the index: keep the oldest pending
    // request per target, close the rest with a note saying why.
    await queryRunner.query(`
      UPDATE "delete_requests" d
      SET "status" = 'rejected',
          "reviewerNote" = 'Closed automatically: duplicate of an earlier pending request.',
          "reviewedAt" = now()
      WHERE d."status" = 'pending' AND EXISTS (
        SELECT 1 FROM "delete_requests" o
        WHERE o."status" = 'pending'
          AND o."targetType" = d."targetType"
          AND o."projectId" IS NOT DISTINCT FROM d."projectId"
          AND o."environmentId" IS NOT DISTINCT FROM d."environmentId"
          AND o."projectComponentId" IS NOT DISTINCT FROM d."projectComponentId"
          AND o."key" IS NOT DISTINCT FROM d."key"
          AND (o."createdAt", o."id") < (d."createdAt", d."id")
      )
    `);
    await queryRunner.query(`
      UPDATE "rollback_requests" r
      SET "status" = 'rejected',
          "reviewerNote" = 'Closed automatically: duplicate of an earlier pending request.',
          "reviewedAt" = now()
      WHERE r."status" = 'pending' AND EXISTS (
        SELECT 1 FROM "rollback_requests" o
        WHERE o."status" = 'pending'
          AND o."environmentComponentConfigId" = r."environmentComponentConfigId"
          AND o."key" IS NOT DISTINCT FROM r."key"
          AND (o."createdAt", o."id") < (r."createdAt", r."id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_delete_requests_pending_target" ON "delete_requests" (
        "targetType",
        COALESCE("projectId", ${NO_ID}),
        COALESCE("environmentId", ${NO_ID}),
        COALESCE("projectComponentId", ${NO_ID}),
        COALESCE("key", '')
      ) WHERE "status" = 'pending'
    `);
    // One pending rollback per key (or per whole file, key NULL) of a config.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_rollback_requests_pending_target" ON "rollback_requests" (
        "environmentComponentConfigId",
        COALESCE("key", '')
      ) WHERE "status" = 'pending'
    `);
  }

  // Drops the guarantee only — duplicates closed by up() stay closed.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_rollback_requests_pending_target"`);
    await queryRunner.query(`DROP INDEX "uq_delete_requests_pending_target"`);
  }
}
