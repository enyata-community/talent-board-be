import { MigrationInterface, QueryRunner } from "typeorm";

export class NormalizeIpv4MappedAddresses1793100005000
  implements MigrationInterface
{
  // admin_audit_logs is append-only by trigger; its old rows are normalized on read instead.
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`UPDATE refresh_tokens
      SET ip_address = substring(ip_address from 8)
      WHERE ip_address ~* '^::ffff:\\d+\\.\\d+\\.\\d+\\.\\d+$'`);
  }

  // The original prefixed form carries no extra information, so there is nothing to restore.
  async down(): Promise<void> {}
}
