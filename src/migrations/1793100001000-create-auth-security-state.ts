import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuthSecurityState1793100001000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "auth_security_state" (
      "key" text PRIMARY KEY,
      "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "binding_hash" text,
      "hits" integer NOT NULL DEFAULT 0,
      "expires_at" timestamptz NOT NULL
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_AUTH_SECURITY_STATE_EXPIRY" ON "auth_security_state" ("expires_at")`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auth_security_state"`);
  }
}
