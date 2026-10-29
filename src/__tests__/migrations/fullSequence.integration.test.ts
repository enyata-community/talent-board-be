import { hash } from "argon2";
import { secret, digest } from "../../admin/admin.utils";
import { adminAccountQuery } from "../../admin/adminIdentity.service";
import "reflect-metadata";
import AppDataSource from "../../datasource";
import { AdminInvitationService } from "../../admin/adminInvitation.service";
import { AdminAuthService } from "../../admin/adminAuth.service";
import { AdminRole } from "../../entities/adminAccount.entity";
import { EmailService } from "../../utils/email";

jest.mock("../../utils/email", () => ({
  EmailService: { sendAdminInvitation: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() },
}));
async function rollbackIdentityMigration(): Promise<number> {
  let count = 0;
  while (true) {
    const [latest] = await AppDataSource.query(
      "SELECT name FROM migrations ORDER BY id DESC LIMIT 1",
    );
    if (!latest) throw new Error("Identity migration was not applied");
    await AppDataSource.undoLastMigration();
    count++;
    if (latest.name === "UnifyAdminUserIdentities1793000002000") return count;
  }
}

describe("Complete migration sequence on an empty PostgreSQL database", () => {
  beforeAll(async () => {
    AppDataSource.setOptions({
      url: process.env.MIGRATION_TEST_DATABASE_URL,
      synchronize: false,
    });
    await AppDataSource.initialize();
    const tables = await AppDataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
    );
    if (tables.length)
      throw new Error("Migration tests require an empty disposable database");
  });
  afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });
  it("applies all migrations once and supports admin bootstrap/login/logout without synchronization", async () => {
    const applied = await AppDataSource.runMigrations();
    expect(applied).toHaveLength(AppDataSource.migrations.length);
    expect(applied[0].name).toBe("InitialMigration1745418605537");
    expect(applied[1].name).toBe("CreatePasswordResetTokensTable1745418605538");
    const timestamps = applied.map((migration) => migration.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(applied.length).toBeGreaterThan(20);
    expect(await AppDataSource.showMigrations()).toBe(false);
    expect(await AppDataSource.runMigrations()).toHaveLength(0);
    const triggers = await AppDataSource.query(
      `SELECT tgname FROM pg_trigger WHERE tgname = 'admin_audit_immutable'`,
    );
    expect(triggers).toHaveLength(1);
    await expect(
      AppDataSource.query(
        `INSERT INTO password_reset_tokens (user_id, email, token, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 'missing@example.com', 'hash', now())`,
      ),
    ).rejects.toMatchObject({ code: "23503" });
    let token: string;
    (EmailService.sendAdminInvitation as jest.Mock).mockImplementation(
      async (_email, url) => {
        token = new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
      },
    );
    const invitations = new AdminInvitationService();
    await invitations.bootstrap("migration-root@example.com");
    await invitations.setup(
      token!,
      "migration test password",
      "Migration Root",
      {},
      AdminRole.SUPER_ADMIN,
    );
    const auth = new AdminAuthService();
    const first = await auth.login(
      "migration-root@example.com",
      "migration test password",
      {},
      AdminRole.SUPER_ADMIN,
    );
    const second = await auth.login(
      "migration-root@example.com",
      "migration test password",
      {},
      AdminRole.SUPER_ADMIN,
    );
    await auth.logout(first.session, { actor: first.account });
    await expect(auth.authenticate(first.token)).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(auth.authenticate(second.token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
  it("reverts the entire sequence and can apply it again", async () => {
    for (let index = 0; index < AppDataSource.migrations.length; index++)
      await AppDataSource.undoLastMigration();
    const tables = await AppDataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
    );
    expect(tables).toHaveLength(0);
    expect(await AppDataSource.runMigrations()).toHaveLength(
      AppDataSource.migrations.length,
    );
  });
  it("migrates existing identities without breaking their sessions, invitations, or audit IDs", async () => {
    const reappliedCount = await rollbackIdentityMigration();
    const password = await hash("Migrated1");
    const rows = await AppDataSource.query(
      `INSERT INTO admin_accounts (email, role, status, password_hash, password_set_at, display_name)
      VALUES ('legacy-root@example.com', 'super_admin', 'active', $1, now(), 'Legacy Root'),
             ('legacy-admin@example.com', 'admin', 'pending', NULL, NULL, NULL) RETURNING id, email`,
      [password],
    );
    const rootId = rows.find(
      (row: any) => row.email === "legacy-root@example.com",
    ).id;
    const adminId = rows.find(
      (row: any) => row.email === "legacy-admin@example.com",
    ).id;
    const sessionToken = secret(),
      invitationToken = secret();
    await AppDataSource.query(
      `INSERT INTO admin_sessions (admin_account_id, token_hash, csrf_token, last_seen_at, idle_expires_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '30 minutes', now() + interval '8 hours')`,
      [rootId, digest(sessionToken), secret()],
    );
    await AppDataSource.query(
      `INSERT INTO admin_invitations (admin_account_id, invited_by_admin_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [adminId, rootId, digest(invitationToken)],
    );
    await AppDataSource.query(
      `INSERT INTO admin_audit_logs (actor_id, actor_role, action, outcome) VALUES ($1, 'super_admin', 'legacy.event', 'success')`,
      [rootId],
    );
    expect(await AppDataSource.runMigrations()).toHaveLength(reappliedCount);
    const root = await adminAccountQuery(AppDataSource.manager)
      .where("account.id = :id", { id: rootId })
      .getOneOrFail();
    expect(root.user.password).toBe(password);
    expect(root.display_name).toBe("Legacy Root");
    expect(
      (
        await new AdminAuthService().authenticate(
          sessionToken,
          AdminRole.SUPER_ADMIN,
        )
      ).account.id,
    ).toBe(rootId);
    await new AdminInvitationService().setup(
      invitationToken,
      "Eight123",
      undefined,
      {},
      AdminRole.ADMIN,
    );
    const login = await new AdminAuthService().login(
      "legacy-admin@example.com",
      "Eight123",
      {},
      AdminRole.ADMIN,
    );
    expect(login.account.id).toBe(adminId);
    expect(login.account.display_name).toBeNull();
    expect(
      await AppDataSource.query(
        `SELECT id FROM admin_audit_logs WHERE actor_id = $1 AND action = 'legacy.event'`,
        [rootId],
      ),
    ).toHaveLength(1);
  });
  it("aborts on email conflicts without changing the marketplace identity", async () => {
    const reappliedCount = await rollbackIdentityMigration();
    await AppDataSource.query(
      `INSERT INTO users (email, provider, role, password) VALUES ('legacy-root@example.com', 'local', 'talent', 'unchanged')`,
    );
    await expect(AppDataSource.runMigrations()).rejects.toThrow(
      "an admin email already belongs to a user",
    );
    const rows = await AppDataSource.query(
      `SELECT role, password FROM users WHERE email = 'legacy-root@example.com'`,
    );
    expect(rows[0]).toEqual({ role: "talent", password: "unchanged" });
    expect(
      await AppDataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_accounts' AND column_name = 'user_id'`,
      ),
    ).toHaveLength(0);
    await AppDataSource.query(
      `DELETE FROM users WHERE email = 'legacy-root@example.com'`,
    );
    expect(await AppDataSource.runMigrations()).toHaveLength(reappliedCount);
  });
});
