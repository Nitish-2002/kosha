import { MigrationInterface, QueryRunner } from 'typeorm';

// Every query these back is a straight equality/lookup filter on a column
// that had no index at all — fine at today's row counts, not fine forever.
export class AddPerformanceIndexes1758300000000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1758300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // NotificationsService.listForUser() filters on this on every call.
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_recipient_id" ON "notifications" ("recipientId")`,
    );

    // AccessRequestsService.listPending() filters on this.
    await queryRunner.query(
      `CREATE INDEX "idx_access_requests_status" ON "access_requests" ("status")`,
    );

    // UsersService.findAdmins() filters on both together.
    await queryRunner.query(
      `CREATE INDEX "idx_users_role_status" ON "users" ("role", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_users_role_status"`);
    await queryRunner.query(`DROP INDEX "idx_access_requests_status"`);
    await queryRunner.query(`DROP INDEX "idx_notifications_recipient_id"`);
  }
}
