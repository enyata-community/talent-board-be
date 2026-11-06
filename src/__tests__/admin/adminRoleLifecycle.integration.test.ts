import "reflect-metadata";
import express from "express";
import cookieParser from "cookie-parser";
import { Server } from "http";
import { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { hash } from "argon2";
import { IsNull } from "typeorm";
import AppDataSource from "../../datasource";
import adminRouter, { superAdminRouter } from "../../admin/admin.route";
import errorHandler from "../../middlewares/errorHandler";
import { UserEntity, UserProvider, UserRole } from "../../entities/user.entity";
import {
  AdminAccount,
  AdminRole,
  AdminStatus,
} from "../../entities/adminAccount.entity";
import { AdminAuditLog } from "../../entities/adminAuditLog.entity";
import { AdminInvitation } from "../../entities/adminInvitation.entity";
import { AdminSession } from "../../entities/adminSession.entity";
import { AdminAuthService } from "../../admin/adminAuth.service";
import { AdminAccountService } from "../../admin/adminAccounts.service";
import { EmailService } from "../../utils/email";

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() },
}));
jest.mock("../../utils/email", () => ({
  EmailService: { sendAdminInvitation: jest.fn() },
}));

type Session = Awaited<ReturnType<AdminAuthService["login"]>>;

describe("Admin role lifecycle", () => {
  const password = "RoleLifecycle123!";
  const auth = new AdminAuthService();
  const accounts = new AdminAccountService();
  let server: Server;
  let base: string;
  let passwordHash: string;
  let tokens: string[];
  let root: AdminAccount;
  let rootSession: Session;

  const createAdmin = async (
    role: AdminRole,
    status = AdminStatus.ACTIVE,
    email = `${randomUUID()}@example.com`,
  ) => {
    const user = await AppDataSource.manager.save(
      UserEntity,
      AppDataSource.manager.create(UserEntity, {
        email,
        provider: UserProvider.LOCAL,
        role: role as unknown as UserRole,
        password: passwordHash,
      }),
    );
    return AppDataSource.manager.save(
      AdminAccount,
      AppDataSource.manager.create(AdminAccount, {
        user,
        user_id: user.id,
        status,
        password_set_at: new Date(),
      }),
    );
  };
  const login = (account: AdminAccount) =>
    auth.login(account.email, password, {}, account.role);
  const call = (
    path: string,
    session: Session,
    body?: object,
    method = body ? "POST" : "GET",
    realm = session.account.role === AdminRole.SUPER_ADMIN
      ? "superadmin"
      : "admin",
  ) =>
    fetch(`${base}/${realm}${path}`, {
      method,
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        cookie: `${realm === "admin" ? "talentboard_admin_session" : "talentboard_superadmin_session"}=${session.token}`,
        "x-admin-csrf": session.csrfToken,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const invite = (email: string, role: string, session = rootSession) =>
    call("/invitations", session, { email, role });
  const json = async (response: Response) => (await response.json()) as any;
  const reload = (account: AdminAccount) =>
    AppDataSource.getRepository(AdminAccount).findOneByOrFail({
      id: account.id,
    });
  const invitationFor = async (email: string) => {
    const account = await AppDataSource.getRepository(
      AdminAccount,
    ).findOneByOrFail({ user: { email } });
    return AppDataSource.getRepository(AdminInvitation).findOneByOrFail({
      admin_account_id: account.id,
    });
  };
  const lastAudit = (action: string, outcome?: string) =>
    AppDataSource.getRepository(AdminAuditLog).findOneOrFail({
      where: { action, ...(outcome ? { outcome } : {}) },
      order: { occurred_at: "DESC" },
    });

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    passwordHash = await hash(password);
    const app = express();
    app.use(express.json(), cookieParser());
    app.use("/api/v1/admin", adminRouter);
    app.use("/api/v1/superadmin", superAdminRouter);
    app.use(errorHandler);
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      listening.once("error", reject);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  beforeEach(async () => {
    // Audit history is append-only and has no foreign keys, so it is kept.
    await AppDataSource.query(
      "TRUNCATE admin_sessions, admin_invitations, admin_auth_throttles, admin_accounts, users CASCADE",
    );
    tokens = [];
    (EmailService.sendAdminInvitation as jest.Mock).mockImplementation(
      async (_email: string, url: string) => {
        tokens.push(
          new URLSearchParams(new URL(url).hash.slice(1)).get("token")!,
        );
      },
    );
    root = await createAdmin(AdminRole.SUPER_ADMIN);
    rootSession = await login(root);
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  describe("Super Admin invitations and the two-slot limit", () => {
    it("invites a second Super Admin who sets a password and logs in to the Super Admin portal", async () => {
      const response = await invite("second@example.com", "super_admin");
      expect(response.status).toBe(201);
      const url = (EmailService.sendAdminInvitation as jest.Mock).mock
        .calls[0][1];
      expect(url).toContain("/superadmin/setup-password#token=");
      // The Admin portal cannot consume a Super Admin invitation.
      const setup = (realm: string) =>
        fetch(`${base}/${realm}/auth/setup-password`, {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
          },
          body: JSON.stringify({ token: tokens[0], password }),
        });
      expect((await setup("admin")).status).toBe(400);
      expect((await setup("superadmin")).status).toBe(200);
      const second = await AppDataSource.getRepository(
        AdminAccount,
      ).findOneByOrFail({ user: { email: "second@example.com" } });
      expect(second).toMatchObject({ status: AdminStatus.ACTIVE });
      expect(second.role).toBe(AdminRole.SUPER_ADMIN);
      expect((await login(second)).account.role).toBe(AdminRole.SUPER_ADMIN);
      expect(await lastAudit("admin.invitation.create", "success")).toEqual(
        expect.objectContaining({ metadata: { role: "super_admin" } }),
      );
    });

    it("counts pending invitations against the limit and releases the slot on revoke", async () => {
      expect((await invite("second@example.com", "super_admin")).status).toBe(
        201,
      );
      const third = await invite("third@example.com", "super_admin");
      expect(third.status).toBe(409);
      expect((await json(third)).message).toMatch(/Super Admin limit reached/);
      expect(await lastAudit("admin.invitation.create", "failure")).toEqual(
        expect.objectContaining({
          metadata: expect.objectContaining({
            email: "third@example.com",
            role: "super_admin",
            status_code: 409,
          }),
        }),
      );
      // Admin invitations are unaffected by the Super Admin limit.
      expect((await invite("staff@example.com", "admin")).status).toBe(201);
      const pending = await invitationFor("second@example.com");
      expect(
        (
          await call(
            `/invitations/${pending.id}`,
            rootSession,
            undefined,
            "DELETE",
          )
        ).status,
      ).toBe(204);
      expect((await invite("third@example.com", "super_admin")).status).toBe(
        201,
      );
    });

    it("releases the slot of an expired invitation but re-checks it on resend", async () => {
      expect((await invite("second@example.com", "super_admin")).status).toBe(
        201,
      );
      const expired = await invitationFor("second@example.com");
      await AppDataSource.query(
        "UPDATE admin_invitations SET expires_at = now() - interval '1 minute'",
      );
      expect((await invite("third@example.com", "super_admin")).status).toBe(
        201,
      );
      const resend = await call(
        `/invitations/${expired.id}/resend`,
        rootSession,
        {},
      );
      expect(resend.status).toBe(409);
      expect((await json(resend)).message).toMatch(/Super Admin limit reached/);
    });

    it("never grants more than two slots under concurrent invitations", async () => {
      const responses = await Promise.all(
        ["a", "b", "c"].map((name) =>
          invite(`${name}@example.com`, "super_admin"),
        ),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const [{ slots }] = await AppDataSource.query(
        "SELECT talentboard_super_admin_slots(NULL) AS slots",
      );
      expect(slots).toBe(2);
    });

    it("rejects a third Super Admin at the database level even without the service check", async () => {
      await createAdmin(AdminRole.SUPER_ADMIN);
      await expect(createAdmin(AdminRole.SUPER_ADMIN)).rejects.toMatchObject({
        message: expect.stringContaining("Super admin limit reached"),
      });
    });

    it("rejects invitations to an email already used by any account type", async () => {
      const talent = await AppDataSource.manager.save(UserEntity, {
        email: "talent@example.com",
        role: UserRole.TALENT,
        provider: UserProvider.LOCAL,
      });
      for (const role of ["admin", "super_admin"])
        expect((await invite(talent.email, role)).status).toBe(409);
      expect((await invite(root.email.toUpperCase(), "admin")).status).toBe(
        409,
      );
    });
  });

  describe("role changes", () => {
    it("promotes when a slot is free, revokes sessions, and audits the change", async () => {
      const staff = await createAdmin(AdminRole.ADMIN);
      const staffSession = await login(staff);
      const response = await call(
        `/admins/${staff.id}/role`,
        rootSession,
        { role: "super_admin" },
        "PATCH",
      );
      expect(response.status).toBe(200);
      expect((await json(response)).data).toMatchObject({
        id: staff.id,
        role: "super_admin",
        status: "active",
      });
      expect((await reload(staff)).role).toBe(AdminRole.SUPER_ADMIN);
      // The old Admin session stops working straight away.
      expect((await call("/auth/me", staffSession)).status).toBe(401);
      expect(
        await AppDataSource.getRepository(AdminSession).countBy({
          admin_account_id: staff.id,
          revoked_at: IsNull(),
        }),
      ).toBe(0);
      expect(await lastAudit("admin.role.change", "success")).toMatchObject({
        actor_id: root.id,
        target_id: staff.id,
        metadata: { previous_role: "admin", role: "super_admin" },
      });
    });

    it("refuses promotion when both slots are taken, including under concurrency", async () => {
      const [a, b] = await Promise.all([
        createAdmin(AdminRole.ADMIN),
        createAdmin(AdminRole.ADMIN),
      ]);
      const responses = await Promise.all(
        [a, b].map((target) =>
          call(
            `/admins/${target.id}/role`,
            rootSession,
            { role: "super_admin" },
            "PATCH",
          ),
        ),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await lastAudit("admin.role.change", "failure")).toMatchObject({
        metadata: expect.objectContaining({ status_code: 409 }),
      });
    });

    it("demotes another Super Admin and blocks self-demotion", async () => {
      const second = await createAdmin(AdminRole.SUPER_ADMIN);
      const secondSession = await login(second);
      expect(
        (
          await call(
            `/admins/${root.id}/role`,
            rootSession,
            { role: "admin" },
            "PATCH",
          )
        ).status,
      ).toBe(403);
      expect(await lastAudit("admin.role.change", "denied")).toMatchObject({
        target_id: root.id,
      });
      const demoted = await call(
        `/admins/${second.id}/role`,
        rootSession,
        { role: "admin" },
        "PATCH",
      );
      expect(demoted.status).toBe(200);
      expect((await call("/auth/me", secondSession)).status).toBe(401);
      expect(
        (
          await call(
            `/admins/${second.id}/role`,
            rootSession,
            { role: "admin" },
            "PATCH",
          )
        ).status,
      ).toBe(409);
    });

    it("rejects role changes for pending, disabled, and unknown accounts", async () => {
      for (const status of [AdminStatus.PENDING, AdminStatus.DISABLED]) {
        const target = await createAdmin(AdminRole.ADMIN, status);
        expect(
          (
            await call(
              `/admins/${target.id}/role`,
              rootSession,
              { role: "super_admin" },
              "PATCH",
            )
          ).status,
        ).toBe(409);
      }
      expect(
        (
          await call(
            `/admins/${randomUUID()}/role`,
            rootSession,
            { role: "admin" },
            "PATCH",
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            `/admins/${root.id}/role`,
            rootSession,
            { role: "talent" },
            "PATCH",
          )
        ).status,
      ).toBe(422);
    });

    it("keeps at least one active Super Admin", async () => {
      // Only reachable if the actor is not counted, e.g. a stale actor object.
      const second = await createAdmin(AdminRole.SUPER_ADMIN);
      await AppDataSource.manager.update(
        AdminAccount,
        { id: root.id },
        { status: AdminStatus.DISABLED },
      );
      await expect(
        accounts.changeRole(second.id, AdminRole.ADMIN, { actor: root }),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: "At least one active Super Admin must remain",
      });
    });
  });

  describe("deactivation", () => {
    it("disables an Admin, ends their sessions, and blocks login", async () => {
      const staff = await createAdmin(AdminRole.ADMIN);
      const staffSession = await login(staff);
      const response = await call(
        `/admins/${staff.id}/status`,
        rootSession,
        { status: "disabled" },
        "PATCH",
      );
      expect(response.status).toBe(200);
      expect((await reload(staff)).status).toBe(AdminStatus.DISABLED);
      expect((await call("/auth/me", staffSession)).status).toBe(401);
      await expect(login(staff)).rejects.toMatchObject({ statusCode: 401 });
      expect(await lastAudit("admin.deactivate", "success")).toMatchObject({
        target_id: staff.id,
        metadata: { role: "admin", previous_status: "active" },
      });
      expect(
        (
          await call(
            `/admins/${staff.id}/status`,
            rootSession,
            { status: "disabled" },
            "PATCH",
          )
        ).status,
      ).toBe(409);
    });

    it("disables another Super Admin, freeing a slot, but never the caller", async () => {
      const second = await createAdmin(AdminRole.SUPER_ADMIN);
      expect((await invite("third@example.com", "super_admin")).status).toBe(
        409,
      );
      expect(
        (
          await call(
            `/admins/${second.id}/status`,
            rootSession,
            { status: "disabled" },
            "PATCH",
          )
        ).status,
      ).toBe(200);
      expect((await invite("third@example.com", "super_admin")).status).toBe(
        201,
      );
      expect(
        (
          await call(
            `/admins/${root.id}/status`,
            rootSession,
            { status: "disabled" },
            "PATCH",
          )
        ).status,
      ).toBe(403);
      expect((await reload(root)).status).toBe(AdminStatus.ACTIVE);
    });

    it("revokes the setup link when a pending account is disabled", async () => {
      expect((await invite("pending@example.com", "admin")).status).toBe(201);
      const pending = await AppDataSource.getRepository(
        AdminAccount,
      ).findOneByOrFail({ user: { email: "pending@example.com" } });
      expect(
        (
          await call(
            `/admins/${pending.id}/status`,
            rootSession,
            { status: "disabled" },
            "PATCH",
          )
        ).status,
      ).toBe(200);
      await expect(
        AppDataSource.getRepository(AdminInvitation).countBy({
          admin_account_id: pending.id,
          revoked_at: IsNull(),
        }),
      ).resolves.toBe(0);
    });

    it("does not offer reactivation yet", async () => {
      const staff = await createAdmin(AdminRole.ADMIN, AdminStatus.DISABLED);
      const response = await call(
        `/admins/${staff.id}/status`,
        rootSession,
        { status: "active" },
        "PATCH",
      );
      expect(response.status).toBe(422);
      expect(JSON.stringify(await json(response))).toContain(
        "admin reactivation is not available yet",
      );
    });
  });

  describe("access control", () => {
    it("keeps admin management on the Super Admin portal only", async () => {
      const staff = await createAdmin(AdminRole.ADMIN);
      const staffSession = await login(staff);
      expect((await call("/admins", staffSession)).status).toBe(404);
      expect(
        (await call("/invitations", staffSession, { email: "x@example.com" }))
          .status,
      ).toBe(404);
      // A Super Admin cookie is not accepted on the Admin portal paths.
      expect(
        (await call("/users", rootSession, undefined, "GET", "admin")).status,
      ).toBe(401);
    });

    it("lists admin accounts with Super Admin slot usage", async () => {
      await createAdmin(AdminRole.ADMIN);
      await createAdmin(AdminRole.ADMIN, AdminStatus.DISABLED);
      const all = await json(await call("/admins", rootSession));
      expect(all.data).toMatchObject({
        total: 3,
        super_admin_slots: { used: 1, max: 2 },
      });
      expect(all.data.items[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          email: expect.any(String),
          role: expect.any(String),
          status: expect.any(String),
        }),
      );
      expect(all.data.items[0]).not.toHaveProperty("password");
      const disabled = await json(
        await call("/admins?status=disabled&role=admin", rootSession),
      );
      expect(disabled.data.total).toBe(1);
    });
  });

  describe("step-up authentication", () => {
    const age = (session: Session, minutes: number) =>
      AppDataSource.manager.update(
        AdminSession,
        { id: session.session.id },
        { reauthenticated_at: new Date(Date.now() - minutes * 60000) },
      );

    it("requires a recent password confirmation for sensitive actions", async () => {
      const staff = await createAdmin(AdminRole.ADMIN);
      await age(rootSession, 6);
      for (const response of [
        await call(
          `/admins/${staff.id}/role`,
          rootSession,
          { role: "super_admin" },
          "PATCH",
        ),
        await call(
          `/admins/${staff.id}/status`,
          rootSession,
          { status: "disabled" },
          "PATCH",
        ),
        await invite("late@example.com", "admin"),
      ]) {
        expect(response.status).toBe(403);
        expect((await json(response)).message).toMatch(
          /^Recent authentication required/,
        );
      }
      expect(await lastAudit("admin.step_up", "denied")).toMatchObject({
        actor_id: root.id,
      });
      // Non-sensitive reads still work.
      expect((await call("/admins", rootSession)).status).toBe(200);

      const wrong = await call("/auth/reauthenticate", rootSession, {
        password: "not the password",
      });
      expect(wrong.status).toBe(403);
      expect(await lastAudit("admin.reauthenticate", "failure")).toBeTruthy();
      const ok = await call("/auth/reauthenticate", rootSession, { password });
      expect(ok.status).toBe(200);
      const until = new Date((await json(ok)).data.reauthenticated_until);
      expect(until.getTime()).toBeGreaterThan(Date.now() + 4 * 60000);
      expect(
        (
          await call(
            `/admins/${staff.id}/role`,
            rootSession,
            { role: "super_admin" },
            "PATCH",
          )
        ).status,
      ).toBe(200);
    });

    it("counts a fresh login as recent authentication", async () => {
      await age(rootSession, 4);
      expect((await invite("fresh@example.com", "admin")).status).toBe(201);
    });
  });

  describe("login lockout", () => {
    const fail = (email: string) =>
      auth.login(email, "wrong password", {}, AdminRole.SUPER_ADMIN);

    it("locks an email for 15 minutes after five failures, even with the right password", async () => {
      for (let i = 0; i < 5; i++)
        await expect(fail(root.email)).rejects.toMatchObject({
          statusCode: 401,
        });
      await expect(login(root)).rejects.toMatchObject({
        statusCode: 429,
        message: "Too many failed attempts. Try again in 15 minutes.",
      });
      expect(await lastAudit("admin.login.locked", "denied")).toMatchObject({
        metadata: { attempted_action: "login" },
      });
      // Existing sessions are not affected, and re-authentication is also locked.
      const reauth = await call("/auth/reauthenticate", rootSession, {
        password,
      });
      expect(reauth.status).toBe(429);
      await AppDataSource.query(
        "UPDATE admin_auth_throttles SET expires_at = now() - interval '1 second' WHERE key LIKE 'lockout:%'",
      );
      await expect(login(root)).resolves.toBeTruthy();
    });

    it("treats unknown emails the same way, so lockouts do not reveal accounts", async () => {
      for (let i = 0; i < 5; i++)
        await expect(fail("nobody@example.com")).rejects.toMatchObject({
          statusCode: 401,
        });
      await expect(fail("nobody@example.com")).rejects.toMatchObject({
        statusCode: 429,
      });
    });

    it("resets the count after a successful login and counts emails case-insensitively", async () => {
      for (let i = 0; i < 4; i++)
        await expect(fail(root.email.toUpperCase())).rejects.toBeTruthy();
      await login(root);
      for (let i = 0; i < 4; i++)
        await expect(fail(root.email)).rejects.toMatchObject({
          statusCode: 401,
        });
      await expect(login(root)).resolves.toBeTruthy();
    });

    it("counts concurrent failures atomically", async () => {
      await Promise.allSettled(
        Array.from({ length: 8 }, () => fail(root.email)),
      );
      await expect(login(root)).rejects.toMatchObject({ statusCode: 429 });
    });
  });
});
