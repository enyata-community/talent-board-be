import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAccountSuspension1793100004000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE users
      ADD COLUMN suspension_reason varchar,
      ADD COLUMN suspension_note varchar(1000),
      ADD COLUMN suspended_at timestamptz,
      ADD COLUMN suspended_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
      ADD COLUMN session_version integer NOT NULL DEFAULT 0,
      ADD CONSTRAINT "CK_user_suspension_reason" CHECK (suspension_reason IS NULL OR suspension_reason IN ('POLICY_VIOLATION', 'FRAUDULENT_PROFILE', 'USER_REQUEST', 'OTHER')),
      ADD CONSTRAINT "CK_user_session_version" CHECK (session_version >= 0)`);
    await runner.query(
      `ALTER TABLE admin_audit_logs ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE admin_audit_logs DROP COLUMN metadata`);
    await runner.query(`ALTER TABLE users DROP COLUMN session_version,
      DROP COLUMN suspended_by, DROP COLUMN suspended_at, DROP COLUMN suspension_note,
      DROP COLUMN suspension_reason`);
  }
}
