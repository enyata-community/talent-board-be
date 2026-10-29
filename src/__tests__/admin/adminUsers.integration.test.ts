import "reflect-metadata";
import express from "express";
import cookieParser from "cookie-parser";
import { Server } from "http";
import { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { hash } from "argon2";
import AppDataSource from "../../datasource";
import adminRouter, { superAdminRouter } from "../../admin/admin.route";
import errorHandler from "../../middlewares/errorHandler";
import {
  UserEntity,
  UserRole,
  UserProvider,
  UserStatus,
} from "../../entities/user.entity";
import { AdminAccount, AdminStatus } from "../../entities/adminAccount.entity";
import {
  TalentProfileEntity,
  ExperienceLevel,
  ProfileStatus,
} from "../../entities/talentProfile.entity";
import {
  RecruiterProfileEntity,
  HiringFor,
} from "../../entities/recruiterProfile.entity";
import { SkillEntity } from "../../entities/skill.entity";
import { SavedTalentEntity } from "../../entities/savedTalent.entity";
import { ConversationThreadEntity } from "../../entities/conversationThread.entity";
import {
  MessageRequestEntity,
  MessageRequestStatus,
} from "../../entities/messageRequest.entity";
import { MessageEntity } from "../../entities/message.entity";
import { RefreshToken } from "../../entities/refreshToken.entity";

describe("Admin user management PostgreSQL and HTTP integration", () => {
  let server: Server;
  let base: string;
  let adminCookie: string;
  let rootCookie: string;
  let jane: UserEntity;
  let mark: UserEntity;
  let amy: UserEntity;
  let bob: UserEntity;
  let deleted: UserEntity;
  let admin: UserEntity;
  const password = "AdminUsers123!";

  const get = (path: string, cookie = adminCookie, realm = "admin") =>
    fetch(`${base}/${realm}/users${path}`, {
      headers: cookie ? { cookie } : {},
    });
  const data = async (path = "", cookie = adminCookie, realm = "admin") => {
    const response = await get(path, cookie, realm);
    expect(response.status).toBe(200);
    return ((await response.json()) as any).data;
  };

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const users = AppDataSource.getRepository(UserEntity);
    const createUser = (values: Partial<UserEntity>) =>
      users.save(
        users.create({
          provider: UserProvider.LOCAL,
          password: "private-marketplace-hash",
          ...values,
        }),
      );
    jane = await createUser({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      role: UserRole.TALENT,
      profile_completed: true,
      created_at: new Date("2025-01-01T00:00:00Z"),
      last_activity_at: new Date("2026-01-20T00:00:00Z"),
    });
    mark = await createUser({
      first_name: "Mark",
      last_name: "Smith",
      email: "mark@company.com",
      role: UserRole.RECRUITER,
      status: UserStatus.SUSPENDED,
      created_at: new Date("2025-02-01T00:00:00Z"),
      last_activity_at: new Date("2026-03-01T00:00:00Z"),
    });
    amy = await createUser({
      first_name: "Amy",
      last_name: "Percent_%",
      email: "amy@example.com",
      role: UserRole.TALENT,
      created_at: new Date("2025-03-01T00:00:00Z"),
    });
    bob = await createUser({
      first_name: "Bob",
      last_name: "Jones",
      email: "bob@example.com",
      role: UserRole.RECRUITER,
      created_at: new Date("2025-04-01T00:00:00Z"),
      last_activity_at: new Date("2026-02-01T00:00:00Z"),
    });
    deleted = await createUser({
      email: "deleted@example.com",
      role: UserRole.TALENT,
    });
    await users.softDelete(deleted.id);
    await createUser({ email: "unassigned@example.com" });
    const skill = await AppDataSource.manager.save(SkillEntity, {
      name: "TypeScript",
    });
    await AppDataSource.manager.save(TalentProfileEntity, {
      user: jane,
      resume_path: "resumes/private-jane.pdf",
      bio: "Engineer",
      job_title: "Developer",
      skills: [skill],
      experience_level: ExperienceLevel.EXPERT,
      profile_status: ProfileStatus.APPROVED,
      portfolio_url: "https://jane.dev",
    });
    await AppDataSource.manager.save(RecruiterProfileEntity, {
      user: mark,
      work_email: "mark@company.com",
      company_industry: "Technology",
      roles_looking_for: ["Developer"],
      hiring_for: HiringFor.COMPANY,
    });
    for (const recruiter of [mark, bob]) {
      const request = await AppDataSource.manager.save(MessageRequestEntity, {
        recruiter,
        talent: jane,
        status: MessageRequestStatus.ACCEPTED,
      });
      const thread = await AppDataSource.manager.save(
        ConversationThreadEntity,
        {
          recruiter,
          talent: jane,
          accepted_request: request,
          recruiter_last_seen_at:
            recruiter.id === mark.id ? new Date("2026-03-01T00:00:00Z") : null,
          talent_last_seen_at: new Date("2026-01-15T00:00:00Z"),
          latest_message_at: new Date("2026-02-01T00:00:00Z"),
        },
      );
      await AppDataSource.manager.save(MessageEntity, {
        thread,
        sender: recruiter,
        body: "Private message content",
        created_at: new Date("2026-02-01T00:00:00Z"),
      });
      await AppDataSource.manager.save(SavedTalentEntity, {
        recruiter,
        talent: jane,
        saved_at: new Date("2026-01-01T00:00:00Z"),
      });
    }
    await AppDataSource.manager.save(RefreshToken, {
      user: jane,
      token: "private-refresh-token",
      is_valid: false,
      created_at: new Date("2026-01-20T00:00:00Z"),
    });
    // Deleted observations must not affect activity or relationship summaries.
    const deletedThread = await AppDataSource.manager.save(
      ConversationThreadEntity,
      {
        recruiter: mark,
        talent: amy,
        talent_last_seen_at: new Date("2026-10-01T00:00:00Z"),
      },
    );
    await AppDataSource.getRepository(ConversationThreadEntity).softDelete(
      deletedThread.id,
    );
    const deletedSaved = await AppDataSource.manager.save(SavedTalentEntity, {
      recruiter: mark,
      talent: amy,
      saved_at: new Date(),
    });
    await AppDataSource.getRepository(SavedTalentEntity).softDelete(
      deletedSaved.id,
    );

    const passwordHash = await hash(password);
    admin = await createUser({
      email: "admin@example.com",
      role: UserRole.ADMIN,
      password: passwordHash,
    });
    const root = await createUser({
      email: "root@example.com",
      role: UserRole.SUPER_ADMIN,
      password: passwordHash,
    });
    for (const user of [admin, root])
      await AppDataSource.manager.save(AdminAccount, {
        user,
        user_id: user.id,
        status: AdminStatus.ACTIVE,
        password_set_at: new Date(),
      });

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
    const login = async (realm: string, email: string) => {
      const response = await fetch(`${base}/${realm}/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email, password }),
      });
      expect(response.status).toBe(200);
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    adminCookie = await login("admin", admin.email);
    rootCookie = await login("superadmin", root.email);
  });

  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("lists only marketplace accounts with stable pagination and correct totals", async () => {
    const first = await data("?limit=2");
    const second = await data("?limit=2&page=2");
    expect(first).toMatchObject({ total: 4, page: 1, limit: 2 });
    expect(first.items.map((item: any) => item.id)).toEqual([bob.id, amy.id]);
    expect(second.items.map((item: any) => item.id)).toEqual([
      mark.id,
      jane.id,
    ]);
    expect((await data("?page=3&limit=2")).items).toEqual([]);
    expect(
      (await data("?sort_order=asc")).items.map((item: any) => item.id),
    ).toEqual([jane.id, mark.id, amy.id, bob.id]);
  });

  it.each(["jane doe", "ANE D", "JANE@EXAMPLE.COM", "ane@exa"])(
    "supports case-insensitive full and partial name/email search: %s",
    async (search) => {
      const result = await data(`?search=${encodeURIComponent(search)}`);
      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe(jane.id);
    },
  );

  it("treats SQL metacharacters literally and combines search with role/status filters", async () => {
    expect(
      (await data("?search=%25")).items.map((item: any) => item.id),
    ).toEqual([amy.id]);
    expect((await data("?search=%27%20OR%201%3D1--")).total).toBe(0);
    const filtered = await data(
      "?account_type=recruiter&status=suspended&search=SMI",
    );
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({
      id: mark.id,
      status: "suspended",
    });
    expect((await data("?status=active")).total).toBe(3);
    expect((await data("?account_type=talent")).total).toBe(2);
  });

  it("sorts stored activity in both directions with unknown activity last", async () => {
    const descending = await data("?sort_by=last_activity");
    expect(descending.items.map((item: any) => item.id)).toEqual([
      mark.id,
      bob.id,
      jane.id,
      amy.id,
    ]);
    expect(descending.items[0].last_activity_at).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    const ascending = await data("?sort_by=last_activity&sort_order=asc");
    expect(ascending.items.map((item: any) => item.id)).toEqual([
      jane.id,
      bob.id,
      mark.id,
      amy.id,
    ]);
    expect(ascending.items[3].last_activity_at).toBeNull();
  });

  it("retrieves talent profile, paginated connections and saved pipeline without private content", async () => {
    const response = await get(`/${jane.id}?limit=1`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    for (const secret of [
      "private-marketplace-hash",
      "private-refresh-token",
      "private-jane.pdf",
      "Private message content",
      "resume_path",
    ])
      expect(text).not.toContain(secret);
    const result = JSON.parse(text).data;
    expect(result.profile).toMatchObject({
      bio: "Engineer",
      job_title: "Developer",
      experience_level: "expert",
      has_resume: true,
      skills: [{ id: expect.any(String), name: "TypeScript" }],
    });
    expect(result.active_connections).toMatchObject({
      total: 2,
      page: 1,
      limit: 1,
    });
    expect(result.active_connections.items).toHaveLength(1);
    expect(result.pipeline_relationships).toMatchObject({
      total: 2,
      page: 1,
      limit: 1,
    });
    expect(result.pipeline_relationships.items[0]).toMatchObject({
      stage: "saved",
      user: { account_type: "recruiter" },
    });
    const second = await data(`/${jane.id}?page=2&limit=1`);
    expect(second.active_connections.items[0].id).not.toBe(
      result.active_connections.items[0].id,
    );
    expect(second.pipeline_relationships.items[0].id).not.toBe(
      result.pipeline_relationships.items[0].id,
    );
    expect(result.interview_scheduling).toEqual({
      available: false,
      status: null,
    });
  });

  it("retrieves recruiter profiles and the opposite side of connections and pipeline", async () => {
    const result = await data(`/${mark.id}`);
    expect(result).toMatchObject({
      status: "suspended",
      account_type: "recruiter",
      profile: {
        work_email: "mark@company.com",
        company_industry: "Technology",
        hiring_for: "my company",
        roles_looking_for: ["Developer"],
      },
    });
    expect(result.active_connections.total).toBe(1);
    expect(result.active_connections.items[0].user.id).toBe(jane.id);
    expect(result.pipeline_relationships.total).toBe(1);
    expect(result.pipeline_relationships.items[0].user.id).toBe(jane.id);
  });

  it("handles incomplete profiles and excludes deleted relationships", async () => {
    const result = await data(`/${amy.id}`);
    expect(result.profile).toBeNull();
    expect(result.last_activity_at).toBeNull();
    expect(result.active_connections).toMatchObject({ total: 0, items: [] });
    expect(result.pipeline_relationships).toMatchObject({
      total: 0,
      items: [],
    });
  });

  it("supports Super Admin sessions for list and detail", async () => {
    expect((await data("", rootCookie, "superadmin")).total).toBe(4);
    expect((await data(`/${jane.id}`, rootCookie, "superadmin")).id).toBe(
      jane.id,
    );
  });

  it("rejects missing, marketplace, and cross-realm credentials", async () => {
    for (const path of ["", `/${jane.id}`]) {
      expect((await get(path, "")).status).toBe(401);
      expect((await get(path, "access_token=public.jwt.token")).status).toBe(
        401,
      );
      expect(
        (
          await get(
            path,
            rootCookie.replace(
              "talentboard_superadmin_session=",
              "talentboard_admin_session=",
            ),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await get(
            path,
            adminCookie.replace(
              "talentboard_admin_session=",
              "talentboard_superadmin_session=",
            ),
            "superadmin",
          )
        ).status,
      ).toBe(401);
    }
  });

  it("returns 404 for nonexistent, deleted and internal accounts", async () => {
    for (const id of [randomUUID(), deleted.id, admin.id])
      expect((await get(`/${id}`)).status).toBe(404);
  });

  it.each([
    "?page=0",
    "?limit=101",
    "?account_type=super_admin",
    "?status=pending",
    "?sort_by=password",
    "?search=",
    "/not-a-uuid",
  ])("validates HTTP input: %s", async (path) => {
    expect((await get(path)).status).toBe(422);
  });
});
