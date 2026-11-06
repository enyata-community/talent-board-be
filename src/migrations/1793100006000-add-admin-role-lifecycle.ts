import { MigrationInterface, QueryRunner } from "typeorm";

// Replaces the single-Super-Admin index with a limit of two. A slot is held by an
// active Super Admin or a pending one with an open, unexpired invitation.
export class AddAdminRoleLifecycle1793100006000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS uq_single_super_admin`);
    await runner.query(
      `ALTER TABLE admin_sessions ADD COLUMN reauthenticated_at timestamptz`,
    );
    await runner.query(`
      CREATE FUNCTION talentboard_super_admin_slots(exclude_user uuid) RETURNS integer
      LANGUAGE sql VOLATILE AS $$
        SELECT count(*)::int FROM users u JOIN admin_accounts a ON a.user_id = u.id
        WHERE u.role::text = 'super_admin' AND u.deleted_at IS NULL
          AND u.id IS DISTINCT FROM exclude_user
          AND (a.status = 'active' OR (a.status = 'pending' AND EXISTS (
            SELECT 1 FROM admin_invitations i WHERE i.admin_account_id = a.id
              AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now())))
      $$;
      CREATE FUNCTION talentboard_enforce_super_admin_limit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE target uuid;
      BEGIN
        IF TG_TABLE_NAME = 'users' THEN
          IF NEW.role::text <> 'super_admin'
            OR (TG_OP = 'UPDATE' AND OLD.role::text = 'super_admin') THEN RETURN NEW; END IF;
          target := NEW.id;
        ELSIF TG_TABLE_NAME = 'admin_accounts' THEN
          IF NOT (OLD.status = 'disabled' AND NEW.status <> 'disabled') THEN RETURN NEW; END IF;
          SELECT u.id INTO target FROM users u WHERE u.id = NEW.user_id AND u.role::text = 'super_admin';
        ELSE
          SELECT u.id INTO target FROM admin_accounts a JOIN users u ON u.id = a.user_id
          WHERE a.id = NEW.admin_account_id AND u.role::text = 'super_admin';
        END IF;
        IF target IS NULL THEN RETURN NEW; END IF;
        -- Serializes with the service-level check, which takes the same lock.
        PERFORM pg_advisory_xact_lock(812744002);
        IF talentboard_super_admin_slots(target) >= 2 THEN
          RAISE EXCEPTION 'Super admin limit reached' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER super_admin_limit_users BEFORE INSERT OR UPDATE OF role ON users
        FOR EACH ROW EXECUTE FUNCTION talentboard_enforce_super_admin_limit();
      CREATE TRIGGER super_admin_limit_accounts BEFORE UPDATE OF status ON admin_accounts
        FOR EACH ROW EXECUTE FUNCTION talentboard_enforce_super_admin_limit();
      CREATE TRIGGER super_admin_limit_invitations BEFORE INSERT ON admin_invitations
        FOR EACH ROW EXECUTE FUNCTION talentboard_enforce_super_admin_limit();
    `);
  }

  // Fails if more than one Super Admin exists; demote or disable extras first.
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP TRIGGER super_admin_limit_invitations ON admin_invitations;
      DROP TRIGGER super_admin_limit_accounts ON admin_accounts;
      DROP TRIGGER super_admin_limit_users ON users;
      DROP FUNCTION talentboard_enforce_super_admin_limit();
      DROP FUNCTION talentboard_super_admin_slots(uuid);
      ALTER TABLE admin_sessions DROP COLUMN reauthenticated_at;
      CREATE UNIQUE INDEX uq_single_super_admin ON users(role) WHERE role = 'super_admin';
    `);
  }
}
