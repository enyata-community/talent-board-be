import { MigrationInterface, QueryRunner } from "typeorm";
export class CreateAdminPortal1793000000000 implements MigrationInterface {
  name = "CreateAdminPortal1793000000000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE admin_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar NOT NULL,
        display_name varchar,
        password_hash text,
        role varchar NOT NULL DEFAULT 'admin',
        status varchar NOT NULL DEFAULT 'pending',
        password_set_at timestamptz,
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_admin_email_normalized" CHECK (email = lower(btrim(email))),
        CONSTRAINT "CK_admin_role" CHECK (role IN ('admin', 'super_admin')),
        CONSTRAINT "CK_admin_status" CHECK (status IN ('pending', 'active', 'disabled')),
        CONSTRAINT "CK_admin_active_password" CHECK (status <> 'active' OR password_hash IS NOT NULL)
      );
      CREATE UNIQUE INDEX UQ_admin_email ON admin_accounts (email);
      CREATE TABLE admin_invitations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_account_id uuid NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
        invited_by_admin_id uuid REFERENCES admin_accounts(id) ON DELETE RESTRICT,
        token_hash varchar NOT NULL,
        expires_at timestamptz NOT NULL,
        accepted_at timestamptz,
        revoked_at timestamptz,
        delivery_status varchar NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_admin_invitation_delivery" CHECK (delivery_status IN ('pending', 'sent', 'failed'))
      );
      CREATE UNIQUE INDEX UQ_admin_invitation_hash ON admin_invitations(token_hash);
      CREATE UNIQUE INDEX "UQ_admin_invitation_open" ON admin_invitations(admin_account_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;
      CREATE TABLE admin_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_account_id uuid NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
        token_hash varchar NOT NULL,
        csrf_token varchar NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL,
        idle_expires_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz
      );
      CREATE UNIQUE INDEX UQ_admin_session_hash ON admin_sessions(token_hash);
      CREATE INDEX IDX_admin_session_account ON admin_sessions(admin_account_id);
      CREATE INDEX IDX_admin_session_expiry ON admin_sessions(expires_at);
      CREATE TABLE admin_audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        occurred_at timestamptz NOT NULL DEFAULT now(),
        actor_id uuid,
        actor_role varchar,
        action varchar NOT NULL,
        outcome varchar NOT NULL,
        target_id varchar,
        request_id varchar,
        ip_address varchar
      );
      CREATE INDEX IDX_admin_audit_time ON admin_audit_logs(occurred_at, id);
      CREATE INDEX IDX_admin_audit_actor ON admin_audit_logs(actor_id);
      CREATE INDEX IDX_admin_audit_action ON admin_audit_logs(action);
      CREATE TABLE admin_auth_throttles (
        key varchar PRIMARY KEY,
        attempts integer NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE FUNCTION talentboard_admin_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Admin audit logs are append-only'; END;
      $$;
      CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON admin_audit_logs
        FOR EACH STATEMENT EXECUTE FUNCTION talentboard_admin_audit_immutable();
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER admin_audit_immutable ON admin_audit_logs;
      DROP FUNCTION talentboard_admin_audit_immutable();
      DROP TABLE admin_auth_throttles;
      DROP TABLE admin_audit_logs;
      DROP TABLE admin_sessions;
      DROP TABLE admin_invitations;
      DROP TABLE admin_accounts;
    `);
  }
}
