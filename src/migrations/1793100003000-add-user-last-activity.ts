import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserLastActivity1793100003000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "last_activity_at" timestamptz`,
    );
    // Backfill once from recorded actions. Existing timestamp columns store UTC
    // without a timezone; make that conversion explicit for the new timestamptz.
    await queryRunner.query(`
      UPDATE users account
      SET last_activity_at = activity.latest AT TIME ZONE 'UTC'
      FROM (
        SELECT user_id, MAX(activity_at) AS latest
        FROM (
          SELECT user_id, created_at AS activity_at FROM refresh_tokens WHERE deleted_at IS NULL
          UNION ALL
          SELECT sender_id, created_at FROM messages WHERE deleted_at IS NULL
          UNION ALL
          SELECT recruiter_id, recruiter_last_seen_at FROM conversation_threads WHERE deleted_at IS NULL
          UNION ALL
          SELECT talent_id, talent_last_seen_at FROM conversation_threads WHERE deleted_at IS NULL
        ) observations
        GROUP BY user_id
      ) activity
      WHERE account.id = activity.user_id AND account.deleted_at IS NULL
        AND account.role IN ('talent', 'recruiter')
    `);
    // Both directions keep unknown activity last, so they need separate indexes.
    await queryRunner.query(`CREATE INDEX "IDX_users_activity_desc"
      ON users (last_activity_at DESC NULLS LAST, id DESC) WHERE deleted_at IS NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_users_activity_asc"
      ON users (last_activity_at ASC NULLS LAST, id ASC) WHERE deleted_at IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_activity_asc"`);
    await queryRunner.query(`DROP INDEX "IDX_users_activity_desc"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "last_activity_at"`,
    );
  }
}
