import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the non-write events to the audit trail: Member request raised,
// Admin request rejected, and session login/logout/refresh. "userId" becomes
// nullable for exactly one case — an access request from a not-yet-whitelisted
// Google account, which has no users row; its email goes in metadata.
export class ExtendAuditLogActions1759100000000 implements MigrationInterface {
  name = 'ExtendAuditLogActions1759100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_check"`,
    );
    await queryRunner.query(`
      ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_check"
      CHECK ("action" IN ('create', 'update', 'delete', 'rollback', 'reveal', 'import',
                          'request', 'reject', 'login', 'logout', 'refresh'))
    `);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "userId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows the old constraints can't hold have to go before they're restored.
    await queryRunner.query(`
      DELETE FROM "audit_logs"
      WHERE "userId" IS NULL
         OR "action" IN ('request', 'reject', 'login', 'logout', 'refresh')
    `);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "userId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_check"`,
    );
    await queryRunner.query(`
      ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_check"
      CHECK ("action" IN ('create', 'update', 'delete', 'rollback', 'reveal', 'import'))
    `);
  }
}
