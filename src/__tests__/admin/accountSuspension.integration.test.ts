import "reflect-metadata";
import express from "express";
import cookieParser from "cookie-parser";
import { Server } from "http";
import { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { hash } from "argon2";
import AppDataSource from "../../datasource";
import adminRouter, { superAdminRouter } from "../../admin/admin.route";
import talentRouter from "../../talents/talent.route";
import { deserializeUser } from "../../middlewares/deserializeUser";
import errorHandler from "../../middlewares/errorHandler";
import {
  UserEntity,
  UserRole,
  UserProvider,
  UserStatus,
  SuspensionReason,
} from "../../entities/user.entity";
import { AdminAccount, AdminStatus } from "../../entities/adminAccount.entity";
import { AdminAuditLog } from "../../entities/adminAuditLog.entity";
import { RefreshToken } from "../../entities/refreshToken.entity";
import {
  TalentProfileEntity,
  ExperienceLevel,
  ProfileStatus,
} from "../../entities/talentProfile.entity";
import {
  RecruiterProfileEntity,
  HiringFor,
} from "../../entities/recruiterProfile.entity";
import { SavedTalentEntity } from "../../entities/savedTalent.entity";
import {
  MessageRequestEntity,
  MessageRequestStatus,
} from "../../entities/messageRequest.entity";
import { ConversationThreadEntity } from "../../entities/conversationThread.entity";
import { SkillEntity } from "../../entities/skill.entity";
import { createSendToken } from "../../utils/createSendToken";
import { signToken, verifyToken } from "../../utils/jwt";
import { AdminAuthService } from "../../admin/adminAuth.service";
import { LocalAuthService } from "../../auth/local/local.service";
import { GoogleAuthService } from "../../auth/google/google.service";
import { LinkedInAuthService } from "../../auth/linkedin/linkedin.service";
import { AdminUserStatusService } from "../../admin/adminUserStatus.service";
import { TalentService } from "../../talents/services/talent.service";
import { TalentRecommendationService } from "../../talents/services/talentRecommendation.service";
import { DashboardService } from "../../dashboard/services/dashboard.service";
import { ConversationService } from "../../messaging/services/conversation.service";
import { MessageRequestService } from "../../messaging/services/messageRequest.service";
import { searchTalentsSchema } from "../../talents/schemas/searchTalents.schema";
import {
  createOAuthExchangeCode,
  exchangeOAuthCode,
} from "../../auth/oauthExchange";

// Exercise the real JWT signing/verification code with an isolated RSA key pair.
jest.mock("config", () => {
  const original = jest.requireActual("config");
  const { publicKey, privateKey } = require("crypto").generateKeyPairSync(
    "rsa",
    {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    },
  );
  const keys = {
    ACCESS_TOKEN_PUBLIC_KEY: Buffer.from(publicKey).toString("base64"),
    REFRESH_TOKEN_PUBLIC_KEY: Buffer.from(publicKey).toString("base64"),
    ACCESS_TOKEN_PRIVATE_KEY: Buffer.from(privateKey).toString("base64"),
    REFRESH_TOKEN_PRIVATE_KEY: Buffer.from(privateKey).toString("base64"),
  };
  return {
    ...original,
    get: (key: string) => keys[key] ?? original.get(key),
    has: original.has.bind(original),
  };
});

describe("Account suspension and reactivation", () => {
  let server: Server;
  let base: string;
  let admin: AdminAccount;
  let root: AdminAccount;
  let adminSession: Awaited<ReturnType<AdminAuthService["login"]>>;
  let rootSession: Awaited<ReturnType<AdminAuthService["login"]>>;
  let talent: UserEntity;
  let recruiter: UserEntity;
  let viewer: UserEntity;
  let thread: ConversationThreadEntity;
  let passwordHash: string;
  let skill: SkillEntity;
  const password = "SuspensionTest123!";
  const statuses = new AdminUserStatusService();
  const query = searchTalentsSchema.parse({});
  const issueSession = async (user: UserEntity) => {
    const res: any = {
      cookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      locals: {},
    };
    await createSendToken(
      user,
      200,
      "OK",
      { headers: {}, socket: {} } as any,
      res,
      AppDataSource.manager,
    );
    return {
      access: res.json.mock.calls[0][0].tokens.access_token as string,
      refresh: res.cookie.mock.calls[0][1] as string,
    };
  };
  const protectedRequest = (access: string) =>
    fetch(`${base}/protected`, {
      headers: { authorization: `Bearer ${access}` },
    });
  const change = (
    id: string,
    action: string,
    body: object = {},
    realm = "admin",
    session = adminSession,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${base}/${realm}/users/${id}/status`, {
      method: "PATCH",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        cookie: `${realm === "admin" ? "talentboard_admin_session" : "talentboard_superadmin_session"}=${session.token}`,
        "x-admin-csrf": session.csrfToken,
        ...extra,
      },
      body: JSON.stringify({
        status: action === "suspend" ? "suspended" : "active",
        ...body,
      }),
    });
  const reload = (user: UserEntity) =>
    AppDataSource.getRepository(UserEntity).findOneByOrFail({ id: user.id });

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    passwordHash = await hash(password);
    for (const role of [UserRole.ADMIN, UserRole.SUPER_ADMIN]) {
      const user = await AppDataSource.manager.save(
        UserEntity,
        AppDataSource.manager.create(UserEntity, {
          email: `${role}@example.com`,
          provider: UserProvider.LOCAL,
          role,
          password: passwordHash,
        }),
      );
      const account = await AppDataSource.manager.save(
        AdminAccount,
        AppDataSource.manager.create(AdminAccount, {
          user,
          user_id: user.id,
          status: AdminStatus.ACTIVE,
          password_set_at: new Date(),
        }),
      );
      if (role === UserRole.ADMIN) admin = account;
      else root = account;
    }
    const auth = new AdminAuthService();
    adminSession = await auth.login(admin.email, password, {}, admin.role);
    rootSession = await auth.login(root.email, password, {}, root.role);
    skill = await AppDataSource.manager.save(SkillEntity, {
      name: "TypeScript",
    });
    const app = express();
    app.use(express.json(), cookieParser());
    app.use("/api/v1/admin", adminRouter);
    app.use("/api/v1/superadmin", superAdminRouter);
    app.use("/api/v1/talents", talentRouter);
    app.post("/api/v1/exchange", exchangeOAuthCode);
    app.get("/api/v1/protected", deserializeUser, (req, res) =>
      res.json({ id: req.user.id }),
    );
    app.use(errorHandler);
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      listening.once("error", reject);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  beforeEach(async () => {
    const createUser = (role: UserRole) =>
      AppDataSource.manager.save(
        UserEntity,
        AppDataSource.manager.create(UserEntity, {
          first_name: "Suspension",
          last_name: "Fixture",
          email: `${randomUUID()}@example.com`,
          role,
          provider: UserProvider.LOCAL,
          password: passwordHash,
          is_email_verified: true,
          profile_completed: true,
        }),
      );
    talent = await createUser(UserRole.TALENT);
    recruiter = await createUser(UserRole.RECRUITER);
    viewer = await createUser(UserRole.RECRUITER);
    await AppDataSource.manager.save(TalentProfileEntity, {
      user: talent,
      resume_path: "resumes/private.pdf",
      job_title: "Developer",
      skills: [skill],
      experience_level: ExperienceLevel.EXPERT,
      profile_status: ProfileStatus.APPROVED,
    });
    for (const user of [recruiter, viewer])
      await AppDataSource.manager.save(RecruiterProfileEntity, {
        user,
        work_email: user.email,
        company_industry: "Tech",
        roles_looking_for: ["TypeScript"],
        hiring_for: HiringFor.COMPANY,
      });
    await AppDataSource.manager.save(SavedTalentEntity, {
      talent,
      recruiter,
      saved_at: new Date(),
    });
    const accepted = await AppDataSource.manager.save(MessageRequestEntity, {
      talent,
      recruiter,
      status: MessageRequestStatus.ACCEPTED,
    });
    thread = await AppDataSource.manager.save(ConversationThreadEntity, {
      talent,
      recruiter,
      accepted_request: accepted,
    });
  });
  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it.each([UserRole.TALENT, UserRole.RECRUITER])(
    "immediately blocks an existing valid %s JWT and revokes refresh sessions",
    async (role) => {
      const user = role === UserRole.TALENT ? talent : recruiter;
      const session = await issueSession(user);
      expect(
        verifyToken(session.access, "ACCESS_TOKEN_PUBLIC_KEY"),
      ).toMatchObject({ id: user.id });
      expect((await protectedRequest(session.access)).status).toBe(200);
      const response = await change(user.id, "suspend", {
        reason: "POLICY_VIOLATION",
        note: "Verified policy breach",
      });
      expect(response.status).toBe(200);
      expect((await protectedRequest(session.access)).status).toBe(401);
      const refreshResponse = await fetch(`${base}/protected`, {
        headers: { cookie: `refresh_token=${session.refresh}` },
      });
      expect(refreshResponse.status).toBe(401);
      expect(
        await AppDataSource.getRepository(RefreshToken).countBy({
          user: { id: user.id },
          is_valid: true,
        }),
      ).toBe(0);
      expect(await reload(user)).toMatchObject({
        status: "suspended",
        session_version: 1,
        suspended_by: admin.id,
      });
      const log = await AppDataSource.getRepository(
        AdminAuditLog,
      ).findOneByOrFail({
        target_id: user.id,
        action: "user.suspend",
        outcome: "success",
      });
      expect(log).toMatchObject({
        actor_id: admin.id,
        actor_role: "admin",
        outcome: "success",
        metadata: {
          previous_status: "active",
          status: "suspended",
          reason: "POLICY_VIOLATION",
          note: "Verified policy breach",
          account_type: role,
        },
      });
      expect(log.request_id).toBe(response.headers.get("x-request-id"));
      expect(log.ip_address).toBeTruthy();
    },
  );

  it.each([UserRole.TALENT, UserRole.RECRUITER])(
    "reactivates %s without reviving old tokens",
    async (role) => {
      const user = role === UserRole.TALENT ? talent : recruiter;
      const before = await issueSession(user);
      await change(user.id, "suspend", { reason: "USER_REQUEST" });
      const response = await change(
        user.id,
        "reactivate",
        { note: "Account reviewed" },
        "superadmin",
        rootSession,
      );
      expect(response.status).toBe(200);
      const current = await reload(user);
      expect(current).toMatchObject({
        status: "active",
        suspension_reason: null,
        suspended_at: null,
        suspended_by: null,
        session_version: 1,
      });
      expect((await protectedRequest(before.access)).status).toBe(401);
      await expect(issueSession(user)).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(
        (
          await fetch(`${base}/protected`, {
            headers: { cookie: `refresh_token=${before.refresh}` },
          })
        ).status,
      ).toBe(401);
      const signedIn = await new LocalAuthService().login(
        { email: user.email, password },
        AppDataSource.manager,
      );
      const fresh = await issueSession(signedIn);
      expect((await protectedRequest(fresh.access)).status).toBe(200);
      expect(
        (
          await fetch(`${base}/protected`, {
            headers: { cookie: `refresh_token=${fresh.refresh}` },
          })
        ).status,
      ).toBe(200);
      expect(
        await AppDataSource.getRepository(AdminAuditLog).findOneByOrFail({
          target_id: user.id,
          action: "user.reactivate",
          outcome: "success",
        }),
      ).toMatchObject({
        actor_id: root.id,
        metadata: {
          previous_status: "suspended",
          status: "active",
          reason: "USER_REQUEST",
        },
      });
    },
  );

  it("rejects local login, OAuth and stale session issuance while suspended", async () => {
    await change(talent.id, "suspend", { reason: "FRAUDULENT_PROFILE" });
    await expect(
      new LocalAuthService().login(
        { email: talent.email, password },
        AppDataSource.manager,
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    for (const service of [new GoogleAuthService(), new LinkedInAuthService()])
      await expect(
        service.authenticateOrCreateUser(
          { email: talent.email } as any,
          AppDataSource.manager,
        ),
      ).rejects.toMatchObject({ statusCode: 401 });
    await expect(issueSession(talent)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(
      await AppDataSource.getRepository(RefreshToken).countBy({
        user: { id: talent.id },
      }),
    ).toBe(0);
  });

  it("invalidates pre-suspension OAuth exchange codes even after reactivation", async () => {
    const codeFor = async (user: UserEntity) => {
      const response = { cookie: jest.fn() };
      const code = await createOAuthExchangeCode(
        user.id,
        { headers: {} } as any,
        response as any,
        user.session_version,
      );
      return { code, binding: response.cookie.mock.calls[0][1] };
    };
    const exchange = ({ code, binding }: { code: string; binding: string }) =>
      fetch(`${base}/exchange`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `oauth_exchange=${binding}`,
        },
        body: JSON.stringify({ code }),
      });
    const old = await codeFor(talent);
    await change(talent.id, "suspend", { reason: "USER_REQUEST" });
    await change(talent.id, "reactivate");
    expect((await exchange(old)).status).toBe(401);
    const fresh = await codeFor(await reload(talent));
    expect((await exchange(fresh)).status).toBe(200);
  });

  it("supports Super Admin suspension with OTHER and excludes deleted targets", async () => {
    const result = await change(
      recruiter.id,
      "suspend",
      { reason: "OTHER", note: "Manual review" },
      "superadmin",
      rootSession,
    );
    expect(result.status).toBe(200);
    expect(await reload(recruiter)).toMatchObject({
      suspended_by: root.id,
      suspension_reason: "OTHER",
      suspension_note: "Manual review",
    });
    await AppDataSource.getRepository(UserEntity).softDelete(talent.id);
    expect(
      (await change(talent.id, "suspend", { reason: "USER_REQUEST" })).status,
    ).toBe(404);
    expect(
      await AppDataSource.getRepository(AdminAuditLog).countBy({
        target_id: talent.id,
        action: "user.suspend",
        outcome: "success",
      }),
    ).toBe(0);
    expect(
      await AppDataSource.getRepository(AdminAuditLog).findOneByOrFail({
        target_id: talent.id,
        action: "user.suspend",
        outcome: "failure",
      }),
    ).toMatchObject({
      actor_id: admin.id,
      metadata: {
        status: "suspended",
        reason: "USER_REQUEST",
        status_code: 404,
        error: "User account not found",
      },
    });
  });

  it("removes suspended talents from search, detail, top, saved, recommendations, dashboard and résumé access", async () => {
    const talents = new TalentService();
    const recommendations = new TalentRecommendationService();
    expect(
      (await recommendations.recommendTalents(viewer.id)).some(
        (profile) => profile.user.id === talent.id,
      ),
    ).toBe(true);
    await change(talent.id, "suspend", { reason: "USER_REQUEST" });
    expect(
      (await talents.searchTalents(query)).results.some(
        (item) => item.id === talent.id,
      ),
    ).toBe(false);
    expect(
      (await talents.getTopTalents(100)).some((item) => item.id === talent.id),
    ).toBe(false);
    expect(
      (await talents.getSavedTalents(recruiter.id, query)).results,
    ).toEqual([]);
    expect(
      (await recommendations.recommendTalents(viewer.id)).some(
        (profile) => profile.user.id === talent.id,
      ),
    ).toBe(false);
    await expect(
      talents.getTalentById(talent.id, recruiter.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      talents.saveTalent(talent.id, viewer.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      talents.toggleUpvoteTalent(talent.id, viewer.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    const viewerSession = await issueSession(viewer);
    expect(
      (
        await fetch(`${base}/talents/${talent.id}/resume`, {
          headers: { authorization: `Bearer ${viewerSession.access}` },
        })
      ).status,
    ).toBe(404);
    expect(
      (await new DashboardService().getRecruiterDashboard(recruiter.id))
        .saved_talents,
    ).toEqual([]);
    // Admin inspection intentionally retains suspended accounts.
    const adminView = await fetch(`${base}/admin/users/${talent.id}`, {
      headers: { cookie: `talentboard_admin_session=${adminSession.token}` },
    });
    expect(((await adminView.json()) as any).data.status).toBe("suspended");
    expect(
      await AppDataSource.getRepository(AdminAuditLog).countBy({
        target_id: talent.id,
        action: "user.view",
        outcome: "success",
        actor_id: admin.id,
      }),
    ).toBe(1);
    await change(talent.id, "reactivate");
    expect(
      (await talents.getSavedTalents(recruiter.id, query)).results.map(
        (item) => item.id,
      ),
    ).toContain(talent.id);
    expect((await talents.getTalentById(talent.id)).id).toBe(talent.id);
  });

  it.each([UserRole.TALENT, UserRole.RECRUITER])(
    "hides suspended %s relationships and blocks direct messaging",
    async (role) => {
      const user = role === UserRole.TALENT ? talent : recruiter;
      const partner = role === UserRole.TALENT ? recruiter : talent;
      await change(user.id, "suspend", { reason: "USER_REQUEST" });
      const conversations = new ConversationService();
      expect(
        (
          await conversations.getInbox(partner.id, partner.role, {
            page: 1,
            limit: 20,
          })
        ).threads,
      ).toEqual([]);
      await expect(
        conversations.sendMessage(partner.id, thread.id, { body: "hello" }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        conversations.getMessages(partner.id, thread.id, {
          page: 1,
          limit: 20,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
      const requests = new MessageRequestService();
      expect(
        (await requests.getIncomingRequests(talent.id, { page: 1, limit: 20 }))
          .requests,
      ).toEqual([]);
      expect(
        (
          await requests.getOutgoingRequests(recruiter.id, {
            page: 1,
            limit: 20,
          })
        ).requests,
      ).toEqual([]);
      await change(user.id, "reactivate");
      expect(
        (
          await conversations.getInbox(partner.id, partner.role, {
            page: 1,
            limit: 20,
          })
        ).threads,
      ).toHaveLength(1);
    },
  );

  it("requires admin sessions, CSRF, the allowed origin, and marketplace targets", async () => {
    expect(
      (
        await change(
          talent.id,
          "suspend",
          { reason: "USER_REQUEST" },
          "admin",
          adminSession,
          { cookie: "" },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await change(
          talent.id,
          "suspend",
          { reason: "USER_REQUEST" },
          "admin",
          adminSession,
          { "x-admin-csrf": "" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await change(
          talent.id,
          "suspend",
          { reason: "USER_REQUEST" },
          "admin",
          adminSession,
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (await change(admin.user.id, "suspend", { reason: "USER_REQUEST" }))
        .status,
    ).toBe(404);
    expect(
      (await change(root.user.id, "suspend", { reason: "USER_REQUEST" }))
        .status,
    ).toBe(404);
    expect(
      (await change(randomUUID(), "suspend", { reason: "USER_REQUEST" }))
        .status,
    ).toBe(404);
    expect(
      (await change(talent.id, "suspend", { reason: "OTHER" })).status,
    ).toBe(422);
    expect((await reload(talent)).status).toBe("active");
  });

  it("tells the caller which admin credential is missing or invalid", async () => {
    const message = async (response: Promise<Response>) =>
      ((await (await response).json()) as any).message;
    expect(
      await message(
        change(
          talent.id,
          "suspend",
          { reason: "USER_REQUEST" },
          "admin",
          adminSession,
          { cookie: "" },
        ),
      ),
    ).toBe("Missing admin session token. Please log in.");
    expect(
      await message(
        change(
          talent.id,
          "suspend",
          { reason: "USER_REQUEST" },
          "superadmin",
          rootSession,
          {
            cookie: "talentboard_superadmin_session=" + "0".repeat(64),
          },
        ),
      ),
    ).toBe("Invalid super admin session token! Please log in again.");
    expect(
      await message(
        change(
          talent.id,
          "suspend",
          { reason: "USER_REQUEST" },
          "admin",
          adminSession,
          { "x-admin-csrf": "" },
        ),
      ),
    ).toMatch(/^Missing CSRF token/);
    expect(
      await message(
        change(
          talent.id,
          "suspend",
          { reason: "USER_REQUEST" },
          "admin",
          adminSession,
          { "x-admin-csrf": "wrong" },
        ),
      ),
    ).toMatch(/^Invalid CSRF token!/);
    expect((await reload(talent)).status).toBe("active");
  });

  it("serializes duplicate suspension requests and creates a single audit record", async () => {
    const responses = await Promise.all([
      change(talent.id, "suspend", { reason: "OTHER", note: "Review" }),
      change(talent.id, "suspend", { reason: "USER_REQUEST" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      await AppDataSource.getRepository(AdminAuditLog).countBy({
        target_id: talent.id,
        action: "user.suspend",
        outcome: "success",
      }),
    ).toBe(1);
    // The losing request is still recorded, as a failed attempt.
    expect(
      await AppDataSource.getRepository(AdminAuditLog).countBy({
        target_id: talent.id,
        action: "user.suspend",
        outcome: "failure",
      }),
    ).toBe(1);
    expect((await reload(talent)).session_version).toBe(1);
    expect((await change(recruiter.id, "reactivate")).status).toBe(409);
    expect(
      await AppDataSource.getRepository(AdminAuditLog).findOneByOrFail({
        target_id: recruiter.id,
        action: "user.reactivate",
        outcome: "failure",
      }),
    ).toMatchObject({
      metadata: { status: "active", status_code: 409 },
    });
  });

  it("rejects toggle-style and mismatched status bodies without changing the account", async () => {
    for (const body of [
      { status: "toggle" },
      { status: "active", reason: "USER_REQUEST" },
      { status: "suspended" },
    ])
      expect(
        (
          await fetch(`${base}/admin/users/${talent.id}/status`, {
            method: "PATCH",
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              cookie: `talentboard_admin_session=${adminSession.token}`,
              "x-admin-csrf": adminSession.csrfToken,
            },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(422);
    expect((await reload(talent)).status).toBe("active");
    for (const legacy of ["suspend", "reactivate"])
      expect(
        (
          await fetch(`${base}/admin/users/${talent.id}/${legacy}`, {
            method: "POST",
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              cookie: `talentboard_admin_session=${adminSession.token}`,
              "x-admin-csrf": adminSession.csrfToken,
            },
            body: JSON.stringify({ reason: "USER_REQUEST" }),
          })
        ).status,
      ).toBe(404);
  });

  it.each(["admin", "superadmin"])(
    "lists suspension reasons for the %s portal dropdown",
    async (realm) => {
      const session = realm === "admin" ? adminSession : rootSession;
      const response = await fetch(
        `${base}/${realm}/users/suspension-reasons`,
        {
          headers: {
            cookie: `${realm === "admin" ? "talentboard_admin_session" : "talentboard_superadmin_session"}=${session.token}`,
          },
        },
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as any).data).toEqual([
        { value: "POLICY_VIOLATION", label: "Policy violation" },
        { value: "FRAUDULENT_PROFILE", label: "Fraudulent profile" },
        { value: "USER_REQUEST", label: "User request" },
        { value: "OTHER", label: "Other", note_required: true },
      ]);
    },
  );

  it("audits failed views of personal data", async () => {
    const missing = randomUUID();
    const response = await fetch(`${base}/admin/users/${missing}`, {
      headers: { cookie: `talentboard_admin_session=${adminSession.token}` },
    });
    expect(response.status).toBe(404);
    expect(
      await AppDataSource.getRepository(AdminAuditLog).findOneByOrFail({
        target_id: missing,
        action: "user.view",
      }),
    ).toMatchObject({
      outcome: "failure",
      actor_id: admin.id,
      metadata: { status_code: 404 },
    });
  });

  it("rolls status changes and token revocation back if the audit write fails", async () => {
    const session = await issueSession(talent);
    await AppDataSource.query(`CREATE FUNCTION suspension_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'user.suspend' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER suspension_test_reject_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION suspension_test_reject_audit();`);
    try {
      await expect(
        statuses.change(
          talent.id,
          UserStatus.SUSPENDED,
          { actor: admin },
          SuspensionReason.USER_REQUEST,
        ),
      ).rejects.toThrow("audit unavailable");
      expect(await reload(talent)).toMatchObject({
        status: "active",
        session_version: 0,
      });
      expect((await protectedRequest(session.access)).status).toBe(200);
      expect(
        await AppDataSource.getRepository(RefreshToken).countBy({
          user: { id: talent.id },
          is_valid: true,
        }),
      ).toBe(1);
    } finally {
      await AppDataSource.query(
        `DROP TRIGGER suspension_test_reject_audit ON admin_audit_logs; DROP FUNCTION suspension_test_reject_audit();`,
      );
    }
  });
});
