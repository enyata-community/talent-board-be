import { UserEntity, UserRole, UserStatus } from "../../entities/user.entity";
import { adminUsersSchema } from "../../admin/schemas/adminUsers.schema";
import {
  adminUserDto,
  AdminUsersService,
} from "../../admin/adminUsers.service";
import AppDataSource from "../../datasource";

jest.mock("../../datasource", () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

describe("Admin user management", () => {
  it("defaults to a bounded newest-first list and normalizes search text", () => {
    expect(adminUsersSchema.parse({ search: "  Jane Doe  " })).toEqual({
      search: "Jane Doe",
      page: 1,
      limit: 10,
      sort_by: "join_date",
      sort_order: "desc",
    });
  });

  it.each([
    { page: 0 },
    { page: 1.5 },
    { page: 10001 },
    { limit: 101 },
    { limit: 0 },
    { search: " " },
    { search: "a".repeat(255) },
    { search: ["Jane", "Doe"] },
    { account_type: "admin" },
    { status: "pending" },
    { sort_by: "password" },
    { sort_order: "DESC;" },
    { include_deleted: true },
  ])("rejects invalid or unsupported list input %j", (query) => {
    expect(adminUsersSchema.safeParse(query).success).toBe(false);
  });

  it("accepts combined filters and coerces pagination", () => {
    expect(
      adminUsersSchema.parse({
        page: "2",
        limit: "25",
        search: "@example.com",
        account_type: "recruiter",
        status: "suspended",
        sort_by: "last_activity",
        sort_order: "asc",
      }),
    ).toMatchObject({ page: 2, limit: 25, status: "suspended" });
  });

  it("projects account information without credentials, tokens, or storage paths", () => {
    const account = Object.assign(new UserEntity(), {
      id: "id",
      role: UserRole.TALENT,
      status: UserStatus.SUSPENDED,
      email: "jane@example.com",
      password: "private-hash",
      refresh_tokens: [{ token: "private-session" }],
      talent_profile: { resume_path: "private/resume.pdf" },
      incomplete_signup_reminder_count: 4,
    });
    const result = adminUserDto(account);
    expect(result).toMatchObject({
      account_type: "talent",
      status: "suspended",
      last_activity_at: null,
    });
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("refresh_tokens");
    expect(result).not.toHaveProperty("talent_profile");
    expect(result).not.toHaveProperty("incomplete_signup_reminder_count");
  });

  it("returns 404 when no marketplace account is found", async () => {
    const qb: any = {};
    for (const method of [
      "select",
      "addSelect",
      "where",
      "andWhere",
      "leftJoinAndSelect",
    ])
      qb[method] = jest.fn().mockReturnValue(qb);
    qb.getOne = jest.fn().mockResolvedValue(null);
    jest
      .mocked(AppDataSource.getRepository)
      .mockReturnValue({ createQueryBuilder: () => qb } as any);
    await expect(
      new AdminUsersService().detail("missing"),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "User account not found",
    });
  });
});
