import { MigrationInterface, QueryRunner } from "typeorm";

export class UnifyAdminUserIdentities1793000002000
  implements MigrationInterface
{
  name = "UnifyAdminUserIdentities1793000002000";
  async up(queryRunner: QueryRunner): Promise<void> {
    // Recreate the enum transactionally: ALTER TYPE ADD VALUE cannot be used
    // by the identity backfill until its transaction has committed.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM admin_accounts a JOIN users u ON lower(u.email) = lower(a.email)) THEN
          RAISE EXCEPTION 'Admin identity migration blocked: an admin email already belongs to a user. Resolve the conflict before retrying.';
        END IF;
      END $$;
      CREATE TYPE public.users_role_enum_next AS ENUM ('talent', 'recruiter', 'admin', 'super_admin');
      ALTER TABLE users ALTER COLUMN role TYPE public.users_role_enum_next USING role::text::public.users_role_enum_next;
      DROP TYPE public.users_role_enum;
      ALTER TYPE public.users_role_enum_next RENAME TO users_role_enum;
      ALTER TABLE admin_accounts ADD COLUMN user_id uuid;
      DO $$ BEGIN IF EXISTS (SELECT 1 FROM admin_accounts) THEN
      INSERT INTO users (id, email, password, role, provider, first_name, last_name, is_email_verified, profile_completed, created_at, updated_at)
      SELECT gen_random_uuid(), a.email, a.password_hash, a.role::public.users_role_enum, 'local',
        NULLIF(split_part(btrim(a.display_name), ' ', 1), ''),
        CASE WHEN strpos(btrim(a.display_name), ' ') > 0 THEN NULLIF(btrim(substr(btrim(a.display_name), strpos(btrim(a.display_name), ' ') + 1)), '') ELSE NULL END,
        a.password_set_at IS NOT NULL, false, a.created_at, a.updated_at
      FROM admin_accounts a;
      END IF; END $$;
      UPDATE admin_accounts a SET user_id = u.id FROM users u WHERE u.email = a.email;
      ALTER TABLE admin_accounts ALTER COLUMN user_id SET NOT NULL;
      ALTER TABLE admin_accounts ADD CONSTRAINT fk_admin_account_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
    `);
    const uniqueName =
      queryRunner.connection.namingStrategy.relationConstraintName(
        "admin_accounts",
        ["user_id"],
      );
    await queryRunner.query(
      `ALTER TABLE admin_accounts ADD CONSTRAINT "${uniqueName}" UNIQUE (user_id)`,
    );
    await queryRunner.query(`
      DROP INDEX uq_single_super_admin;
      CREATE UNIQUE INDEX uq_single_super_admin ON users(role) WHERE role = 'super_admin';
      ALTER TABLE admin_accounts DROP CONSTRAINT "CK_admin_email_normalized";
      ALTER TABLE admin_accounts DROP CONSTRAINT "CK_admin_role";
      ALTER TABLE admin_accounts DROP CONSTRAINT "CK_admin_active_password";
      ALTER TABLE admin_accounts DROP COLUMN email, DROP COLUMN password_hash, DROP COLUMN role, DROP COLUMN display_name;
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE admin_accounts ADD COLUMN email varchar, ADD COLUMN password_hash text, ADD COLUMN role varchar, ADD COLUMN display_name varchar;
      UPDATE admin_accounts a SET email = u.email, password_hash = u.password, role = u.role::text,
        display_name = NULLIF(concat_ws(' ', u.first_name, u.last_name), '') FROM users u WHERE u.id = a.user_id;
      ALTER TABLE admin_accounts ALTER COLUMN email SET NOT NULL, ALTER COLUMN role SET NOT NULL, ALTER COLUMN role SET DEFAULT 'admin';
      CREATE UNIQUE INDEX uq_admin_email ON admin_accounts(email);
      DROP INDEX uq_single_super_admin;
      CREATE UNIQUE INDEX uq_single_super_admin ON admin_accounts(role) WHERE role = 'super_admin';
      ALTER TABLE admin_accounts ADD CONSTRAINT "CK_admin_email_normalized" CHECK (email = lower(btrim(email)));
      ALTER TABLE admin_accounts ADD CONSTRAINT "CK_admin_role" CHECK (role IN ('admin', 'super_admin'));
      ALTER TABLE admin_accounts ADD CONSTRAINT "CK_admin_active_password" CHECK (status <> 'active' OR password_hash IS NOT NULL);
    `);
    // Delete only users created for the internal identities; all account/session
    // and audit IDs are retained. Any unexpected external references abort rollback.
    const users = await queryRunner.query(`SELECT user_id FROM admin_accounts`);
    await queryRunner.query(`ALTER TABLE admin_accounts DROP COLUMN user_id`);
    for (const user of users)
      await queryRunner.query(`DELETE FROM users WHERE id = $1`, [
        user.user_id,
      ]);
    await queryRunner.query(`
      CREATE TYPE public.users_role_enum_previous AS ENUM ('talent', 'recruiter');
      ALTER TABLE users ALTER COLUMN role TYPE public.users_role_enum_previous USING role::text::public.users_role_enum_previous;
      DROP TYPE public.users_role_enum;
      ALTER TYPE public.users_role_enum_previous RENAME TO users_role_enum;
    `);
  }
}
