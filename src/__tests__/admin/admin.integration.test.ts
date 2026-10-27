import { LocalAuthService } from "../../auth/local/local.service";
import { GoogleAuthService } from "../../auth/google/google.service";
import { LinkedInAuthService } from "../../auth/linkedin/linkedin.service";
import { UserEntity, UserRole, UserProvider } from "../../entities/user.entity";
import express from "express";
import cookieParser from "cookie-parser";
import { AddressInfo } from "net";
import adminRouter, { superAdminRouter } from "../../admin/admin.route";
import errorHandler from "../../middlewares/errorHandler";
import "reflect-metadata";
import { DataSource, IsNull } from "typeorm";
import {
  AdminAccount,
  AdminRole,
  AdminStatus,
} from "../../entities/adminAccount.entity";
import { AdminInvitation } from "../../entities/adminInvitation.entity";
import { AdminSession } from "../../entities/adminSession.entity";
import { AdminAuditLog } from "../../entities/adminAuditLog.entity";
import { AdminAuthThrottle } from "../../entities/adminAuthThrottle.entity";
import { CreateAdminPortal1793000000000 } from "../../migrations/1793000000000-create-admin-portal";
import { EnforceSingleSuperAdmin1793000001000 } from "../../migrations/1793000001000-enforce-single-super-admin";
import AppDataSource from "../../datasource";
import { AdminInvitationService } from "../../admin/adminInvitation.service";
import { AdminAuthService } from "../../admin/adminAuth.service";
import { EmailService } from "../../utils/email";
import {
  throttleAdmin,
  requireSuperAdmin,
} from "../../admin/middlewares/adminSecurity";

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() },
}));
jest.mock("../../datasource", () => ({ __esModule: true, default: {} }));
jest.mock("../../utils/email", () => ({
  EmailService: { sendAdminInvitation: jest.fn().mockResolvedValue(undefined) },
}));
describe("Admin Portal PostgreSQL integration", () => {
  let ds: DataSource;
  let tokens: string[];
  const invitations = new AdminInvitationService();
  const auth = new AdminAuthService();
  beforeAll(async () => {
    ds = new DataSource({
      type: "postgres",
      url: process.env.ADMIN_TEST_DATABASE_URL,
      entities: ["src/entities/**/*.ts"],
      migrations: ["src/migrations/**/*.ts"],
      synchronize: false,
    });
    await ds.initialize();
    await ds.runMigrations();
    Object.assign(AppDataSource, {
      manager: ds.manager,
      transaction: ds.transaction.bind(ds),
      getRepository: ds.getRepository.bind(ds),
    });
  });
  beforeEach(() => {
    tokens = [];
    (EmailService.sendAdminInvitation as jest.Mock).mockImplementation(
      async (_email, url) => {
        tokens.push(
          new URLSearchParams(new URL(url).hash.slice(1)).get("token")!,
        );
      },
    );
  });
  afterAll(async () => {
    if (ds?.isInitialized) {
      for (let index = 0; index < ds.migrations.length; index++)
        await ds.undoLastMigration();
      await ds.destroy();
    }
  });
  it("keeps the migration schema aligned with entity metadata", async () => {
    const columns = await ds.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_accounts'`,
    );
    expect(columns.map((column: any) => column.column_name)).toContain(
      "user_id",
    );
    for (const duplicate of ["email", "password_hash", "role", "display_name"])
      expect(columns.map((column: any) => column.column_name)).not.toContain(
        duplicate,
      );
  });
  it("serializes bootstrap and consumes a setup token exactly once", async () => {
    const results = await Promise.allSettled([
      invitations.bootstrap("root@example.com"),
      invitations.bootstrap("root@example.com"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await ds.getRepository(AdminAccount).count()).toBe(1);
    const originalToken = tokens[0];
    await expect(
      invitations.bootstrap("other@example.com", true),
    ).rejects.toMatchObject({ statusCode: 409 });
    await invitations.bootstrap("root@example.com", true);
    await expect(
      invitations.setup(originalToken, "unique long password", "Root", {}),
    ).rejects.toMatchObject({ statusCode: 400 });
    const setup = await Promise.allSettled([
      invitations.setup(tokens[1], "unique long password", "Root", {}),
      invitations.setup(tokens[1], "unique long password", "Root", {}),
    ]);
    expect(setup.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const root = await ds
      .getRepository(AdminAccount)
      .findOneByOrFail({ user: { email: "root@example.com" } });
    expect(root.status).toBe(AdminStatus.ACTIVE);
    expect(root.user.role).toBe(UserRole.SUPER_ADMIN);
    expect(root.user.email).toBe(root.email);
    expect(root.user.password).toBeTruthy();
    expect(root.user_id).toBe(root.user.id);
    expect(root).not.toHaveProperty("password_hash");
    await expect(
      invitations.bootstrap("root@example.com", true),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("rotates invitations and prevents revoked/expired token use", async () => {
    const root = await ds
      .getRepository(AdminAccount)
      .findOneByOrFail({ user: { role: UserRole.SUPER_ADMIN } });
    const context = { actor: root };
    const first = await invitations.invite(
      "staff@example.com",
      "Staff",
      context,
    );
    const oldToken = tokens[0];
    const second = await invitations.change(first.id, true, context);
    await expect(
      invitations.setup(oldToken, "unique long password", "Staff", {}),
    ).rejects.toMatchObject({ statusCode: 400 });
    await ds.manager.update(
      AdminInvitation,
      { id: second!.id },
      { expires_at: new Date(0) },
    );
    await expect(
      invitations.setup(tokens[1], "unique long password", "Staff", {}),
    ).rejects.toMatchObject({ statusCode: 400 });
    const third = await invitations.change(second!.id, true, context);
    await invitations.setup(tokens[2], "staff long password", "Staff", {});
    expect(third!.delivery_status).toBe("sent");
  });
  it("logs in and immediately revokes sessions on logout", async () => {
    const result = await auth.login(
      "staff@example.com",
      "staff long password",
      {},
    );
    expect(result.account.role).toBe(AdminRole.ADMIN);
    const current = await auth.authenticate(result.token);
    expect(current.account.email).toBe("staff@example.com");
    const stored = await ds
      .getRepository(AdminSession)
      .createQueryBuilder("s")
      .addSelect("s.token_hash")
      .getOneOrFail();
    expect(stored.token_hash).not.toBe(result.token);
    await auth.logout(current.session, { actor: current.account });
    await expect(auth.authenticate(result.token)).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(auth.authenticate("public.jwt.token")).rejects.toMatchObject({
      statusCode: 401,
    });
  });
  it.each([
    ["staff@example.com", "staff long password", AdminRole.ADMIN],
    ["root@example.com", "unique long password", AdminRole.SUPER_ADMIN],
  ])(
    "revokes every existing session for %s without affecting other accounts",
    async (email, password, role) => {
      const first = await auth.login(email, password, {}, role);
      const second = await auth.login(email, password, {}, role);
      const otherEmail =
        role === AdminRole.ADMIN ? "root@example.com" : "staff@example.com";
      const otherPassword =
        role === AdminRole.ADMIN
          ? "unique long password"
          : "staff long password";
      const other = await auth.login(otherEmail, otherPassword, {});
      const current = await auth.authenticate(first.token, role);
      await auth.logout(current.session, { actor: current.account });
      for (const token of [first.token, second.token]) {
        await expect(auth.authenticate(token, role)).rejects.toMatchObject({
          statusCode: 401,
        });
      }
      expect(
        await ds.getRepository(AdminSession).countBy({
          admin_account_id: first.account.id,
          revoked_at: IsNull(),
        }),
      ).toBe(0);
      await expect(auth.authenticate(other.token)).resolves.toBeDefined();
      const fresh = await auth.login(email, password, {}, role);
      // Even a logout authenticated just before the first logout cannot revoke
      // a later login if it reaches the transaction after the original logout.
      await auth.logout(current.session, { actor: current.account });
      await expect(auth.authenticate(fresh.token, role)).resolves.toBeDefined();
    },
  );
  it("handles simultaneous logouts without leaving reusable sessions", async () => {
    const first = await auth.login(
      "root@example.com",
      "unique long password",
      {},
      AdminRole.SUPER_ADMIN,
    );
    const second = await auth.login(
      "root@example.com",
      "unique long password",
      {},
      AdminRole.SUPER_ADMIN,
    );
    await Promise.all([
      auth.logout(first.session, { actor: first.account }),
      auth.logout(second.session, { actor: second.account }),
    ]);
    await expect(auth.authenticate(first.token)).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(auth.authenticate(second.token)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
  it("rolls back all revocations if the logout audit write fails", async () => {
    const first = await auth.login(
      "root@example.com",
      "unique long password",
      {},
    );
    const second = await auth.login(
      "root@example.com",
      "unique long password",
      {},
    );
    await ds.query(`CREATE FUNCTION admin_logout_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'admin.logout' THEN RAISE EXCEPTION 'audit unavailable for test'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER admin_logout_test_reject_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION admin_logout_test_reject_audit();`);
    try {
      await expect(
        auth.logout(first.session, { actor: first.account }),
      ).rejects.toThrow("audit unavailable for test");
      await expect(auth.authenticate(first.token)).resolves.toBeDefined();
      await expect(auth.authenticate(second.token)).resolves.toBeDefined();
    } finally {
      await ds.query(
        `DROP TRIGGER admin_logout_test_reject_audit ON admin_audit_logs; DROP FUNCTION admin_logout_test_reject_audit();`,
      );
    }
  });
  it.each(["root@example.com", "staff@example.com"])(
    "blocks public authentication and recovery for %s",
    async (email) => {
      const password = email.startsWith("root")
        ? "unique long password"
        : "staff long password";
      const local = new LocalAuthService();
      await expect(
        local.login({ email, password }, ds.manager),
      ).rejects.toMatchObject({ statusCode: 401 });
      await expect(
        local.forgotPassword(email, ds.manager),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        new GoogleAuthService().authenticateOrCreateUser(
          { email } as any,
          ds.manager,
        ),
      ).rejects.toMatchObject({ statusCode: 401 });
      await expect(
        new LinkedInAuthService().authenticateOrCreateUser(
          { email } as any,
          ds.manager,
        ),
      ).rejects.toMatchObject({ statusCode: 401 });
    },
  );
  it("stores optional names in users and preserves unspecified name fields", async () => {
    const root = await ds
      .getRepository(AdminAccount)
      .findOneByOrFail({ user: { role: UserRole.SUPER_ADMIN } });
    await invitations.invite(
      "named@example.com",
      undefined,
      { actor: root },
      { first_name: "Jane", last_name: "Doe" },
    );
    await invitations.setup(
      tokens[0],
      "Eight123",
      undefined,
      {},
      AdminRole.ADMIN,
      { first_name: "Janet" },
    );
    const login = await auth.login(
      "named@example.com",
      "Eight123",
      {},
      AdminRole.ADMIN,
    );
    expect(login.account.user.first_name).toBe("Janet");
    expect(login.account.user.last_name).toBe("Doe");
    expect(login.account.display_name).toBe("Janet Doe");
  });
  it("does not promote an existing marketplace user through invitations", async () => {
    const publicUser = await ds.manager.save(
      UserEntity,
      ds.manager.create(UserEntity, {
        email: "marketplace@example.com",
        role: UserRole.TALENT,
        provider: UserProvider.LOCAL,
      }),
    );
    const root = await ds
      .getRepository(AdminAccount)
      .findOneByOrFail({ user: { role: UserRole.SUPER_ADMIN } });
    await expect(
      invitations.invite(publicUser.email, undefined, { actor: root }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (await ds.manager.findOneByOrFail(UserEntity, { id: publicUser.id }))
        .role,
    ).toBe(UserRole.TALENT);
  });
  it("rejects bad credentials, disabled accounts, and expired sessions", async () => {
    await expect(
      auth.login("missing@example.com", "staff long password", {}),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      auth.login("staff@example.com", "wrong password", {}),
    ).rejects.toMatchObject({ statusCode: 401 });
    const result = await auth.login(
      "staff@example.com",
      "staff long password",
      {},
    );
    await ds.manager.update(
      AdminSession,
      { id: result.session.id },
      { idle_expires_at: new Date(0) },
    );
    await expect(auth.authenticate(result.token)).rejects.toMatchObject({
      statusCode: 401,
    });
    const active = await auth.login(
      "staff@example.com",
      "staff long password",
      {},
    );
    await ds.manager.update(
      AdminAccount,
      { id: active.account.id },
      { status: AdminStatus.DISABLED },
    );
    await expect(auth.authenticate(active.token)).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      auth.login("staff@example.com", "staff long password", {}),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
  it("recovers failed email delivery through resend", async () => {
    const root = await ds
      .getRepository(AdminAccount)
      .findOneByOrFail({ user: { role: UserRole.SUPER_ADMIN } });
    (EmailService.sendAdminInvitation as jest.Mock).mockRejectedValueOnce(
      new Error("SMTP unavailable"),
    );
    const first = await invitations.invite("retry@example.com", undefined, {
      actor: root,
    });
    expect(first.delivery_status).toBe("failed");
    expect(
      (await invitations.change(first.id, true, { actor: root }))!
        .delivery_status,
    ).toBe("sent");
  });
  it("rejects Admin access to Super Admin operations", async () => {
    const staff = await ds
      .getRepository(AdminAccount)
      .findOneByOrFail({ user: { email: "staff@example.com" } });
    await expect(
      invitations.invite("forbidden@example.com", undefined, { actor: staff }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const next = jest.fn();
    await requireSuperAdmin({ admin: staff } as any, {} as any, next);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });
  it("increments throttle counters atomically under concurrency", async () => {
    const handler = throttleAdmin("test", 2, true);
    const calls = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const next = jest.fn();
        await handler(
          { ip: "127.0.0.1", body: { email: "root@example.com" } } as any,
          { setHeader: jest.fn() } as any,
          next,
        );
        return next.mock.calls[0][0];
      }),
    );
    expect(calls.filter(Boolean)).toHaveLength(3);
    expect(calls.filter(Boolean).every((e) => e.statusCode === 429)).toBe(true);
  });
  it("enforces browser session, origin, CSRF, and role contracts over HTTP", async () => {
    const app = express();
    app.use(express.json(), cookieParser());
    app.use("/api/v1/admin", adminRouter);
    app.use("/api/v1/superadmin", superAdminRouter);
    app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const request = (
      path: string,
      body?: object,
      headers: Record<string, string> = {},
      method = body ? "POST" : "GET",
    ) =>
      fetch(base + "/superadmin" + path, {
        method,
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    try {
      expect(
        (
          await request(
            "/auth/login",
            { email: "root@example.com", password: "unique long password" },
            { origin: "https://evil.example" },
          )
        ).status,
      ).toBe(403);
      const login = await request("/auth/login", {
        email: "root@example.com",
        password: "unique long password",
      });
      expect(login.status).toBe(200);
      expect(login.headers.get("cache-control")).toBe("no-store");
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      expect(login.headers.get("set-cookie")).toContain("HttpOnly");
      const json = (await login.json()) as any;
      expect(json.data.admin).not.toHaveProperty("password_hash");
      const headers = { cookie, "x-admin-csrf": json.data.csrf_token };
      expect(
        (
          await fetch(base + "/admin/auth/me", {
            headers: {
              cookie: cookie.replace(
                "talentboard_superadmin_session=",
                "talentboard_admin_session=",
              ),
            },
          })
        ).status,
      ).toBe(401);
      expect((await request("/auth/me", undefined, { cookie })).status).toBe(
        200,
      );
      expect(
        (
          await request(
            "/invitations",
            { email: "browser@example.com" },
            { cookie },
          )
        ).status,
      ).toBe(403);
      const invited = await request(
        "/invitations",
        { email: "browser@example.com" },
        headers,
      );
      expect(invited.status).toBe(201);
      const invitation = (await invited.json()) as any;
      expect(invitation.data).not.toHaveProperty("token_hash");
      expect(
        (
          await fetch(base + "/admin/auth/setup-password", {
            method: "POST",
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              token: tokens[tokens.length - 1],
              password: "Browser1",
            }),
          })
        ).status,
      ).toBe(200);
      const staffLogin = await fetch(base + "/admin/auth/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "browser@example.com",
          password: "Browser1",
        }),
      });
      expect(staffLogin.status).toBe(200);
      expect(
        (
          await request("/auth/login", {
            email: "browser@example.com",
            password: "Browser1",
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(base + "/admin/auth/login", {
            method: "POST",
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              email: "root@example.com",
              password: "unique long password",
            }),
          })
        ).status,
      ).toBe(401);
      const staffCookie = staffLogin.headers.get("set-cookie")!.split(";")[0];
      expect(
        (await request("/audit-logs", undefined, { cookie: staffCookie }))
          .status,
      ).toBe(401);
      expect(
        (await request("/invitations?limit=101", undefined, headers)).status,
      ).toBe(422);
      const secondLogin = await request("/auth/login", {
        email: "root@example.com",
        password: "unique long password",
      });
      expect(secondLogin.status).toBe(200);
      const secondCookie = secondLogin.headers.get("set-cookie")!.split(";")[0];
      expect((await request("/auth/logout", {}, headers)).status).toBe(204);
      expect(
        (await request("/auth/me", undefined, { cookie: secondCookie })).status,
      ).toBe(401);
      expect((await request("/auth/me", undefined, { cookie })).status).toBe(
        401,
      );
      expect((await request("/auth/logout", {}, { cookie })).status).toBe(204);
      expect(
        (
          await request("/auth/me", undefined, {
            authorization: "Bearer public.jwt.token",
          })
        ).status,
      ).toBe(401);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it("enforces exactly one Super Admin identity in PostgreSQL", async () => {
    await expect(
      ds.manager.insert(UserEntity, {
        email: "second-root@example.com",
        role: UserRole.SUPER_ADMIN,
        provider: UserProvider.LOCAL,
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("keeps audit history append-only and rolls back mutations if audit writes fail", async () => {
    const logs = await ds.getRepository(AdminAuditLog).find();
    expect(logs.some((l) => l.action === "admin.password.setup")).toBe(true);
    await expect(ds.query("DELETE FROM admin_audit_logs")).rejects.toThrow(
      "append-only",
    );
    await expect(
      ds.transaction(async (tx) => {
        await tx.update(
          UserEntity,
          { email: "root@example.com" },
          { first_name: "Should roll back" },
        );
        await tx.insert(AdminAuditLog, {
          action: null as any,
          outcome: "success",
        });
      }),
    ).rejects.toThrow();
    expect(
      (
        await ds
          .getRepository(AdminAccount)
          .findOneByOrFail({ user: { email: "root@example.com" } })
      ).display_name,
    ).toBe("Root");
  });
});
