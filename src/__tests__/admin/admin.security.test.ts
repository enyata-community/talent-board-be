import { UserEntity, UserRole } from "../../entities/user.entity";
import { identityNames } from "../../admin/adminIdentity.service";
import { signupSchema } from "../../auth/local/schemas/signup.schema";
import { assertLocalSeedTarget } from "../../admin/localSuperAdmin.service";
import { adminConfig } from "../../admin/admin.config";
import { digest, equalSecret, secret, adminDto } from "../../admin/admin.utils";
import {
  invitationSchema,
  loginSchema,
  setupSchema,
  auditListSchema,
} from "../../admin/schemas/admin.schema";
import { adminInvitationEmail } from "../../utils/email/templates/adminInvitation";
import { AdminAccount, AdminRole } from "../../entities/adminAccount.entity";
import { checkAdminOrigin } from "../../admin/middlewares/adminSecurity";

jest.mock("../../datasource", () => ({ __esModule: true, default: {} }));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() },
}));

describe("Admin security contracts", () => {
  it("isolates cookie names and paths by realm", () => {
    const admin = adminConfig(AdminRole.ADMIN);
    const root = adminConfig(AdminRole.SUPER_ADMIN);
    expect(root.cookie).not.toBe(admin.cookie);
    expect(root.path).toBe("/api/v1/superadmin");
    expect(admin.path).toBe("/api/v1/admin");
  });
  it("blocks local test credentials in production and on remote databases", () => {
    expect(() =>
      assertLocalSeedTarget(
        "production",
        "production",
        "postgres://localhost/db",
      ),
    ).toThrow();
    expect(() =>
      assertLocalSeedTarget(
        "development",
        "production",
        "postgres://localhost/db",
      ),
    ).toThrow();
    expect(() =>
      assertLocalSeedTarget(
        "development",
        "development",
        "postgres://db.example.com/db",
      ),
    ).toThrow();
    expect(() =>
      assertLocalSeedTarget(
        "development",
        "development",
        "postgres://postgres/db",
      ),
    ).not.toThrow();
  });
  it("normalizes emails and rejects client-controlled privileges", () => {
    expect(
      loginSchema.parse({ email: " ADMIN@Example.com ", password: "password" })
        .email,
    ).toBe("admin@example.com");
    expect(
      invitationSchema.safeParse({
        email: "admin@example.com",
        role: "super_admin",
      }).success,
    ).toBe(false);
  });
  it("requires a strong setup password and opaque token", () => {
    expect(
      setupSchema.safeParse({
        token: "short",
        password: "short",
        display_name: "Admin",
      }).success,
    ).toBe(false);
    expect(
      setupSchema.safeParse({
        token: secret(),
        password: "Eight123",
        display_name: "Admin",
      }).success,
    ).toBe(true);
  });
  it("accepts eight-character passwords without a display name", () => {
    expect(
      setupSchema.safeParse({ token: secret(), password: "Eight123" }).success,
    ).toBe(true);
    expect(
      setupSchema.safeParse({ token: secret(), password: "short12" }).success,
    ).toBe(false);
    expect(
      setupSchema.safeParse({ token: secret(), password: "a".repeat(129) })
        .success,
    ).toBe(false);
  });
  it("bounds audit queries and validates date ranges", () => {
    expect(auditListSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      auditListSchema.safeParse({
        from: "2026-02-01T00:00:00Z",
        to: "2026-01-01T00:00:00Z",
      }).success,
    ).toBe(false);
  });
  it("generates independent secrets and compares without accepting prefixes", () => {
    const token = secret();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(secret()).not.toBe(token);
    expect(digest(token)).not.toBe(token);
    expect(equalSecret(token, token)).toBe(true);
    expect(equalSecret(token, token.slice(1))).toBe(false);
  });
  it("only exposes an explicit admin DTO", () => {
    const identity = Object.assign(new UserEntity(), {
      id: "user-id",
      email: "admin@example.com",
      role: UserRole.ADMIN,
      password: "private",
      first_name: "Admin",
      last_name: null,
    });
    const result = adminDto(
      Object.assign(new AdminAccount(), {
        id: "id",
        user_id: identity.id,
        user: identity,
      }),
    );
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("user");
    expect(result).not.toHaveProperty("password_hash");
  });
  it("uses optional identity names and falls back to email", () => {
    expect(
      identityNames(undefined, { first_name: "Jane", last_name: "Doe" }),
    ).toEqual({ first_name: "Jane", last_name: "Doe" });
    const user = Object.assign(new UserEntity(), {
      email: "admin@example.com",
      role: UserRole.ADMIN,
    });
    expect(
      adminDto(Object.assign(new AdminAccount(), { user })).display_name,
    ).toBe("admin@example.com");
  });
  it("rejects internal roles in public signup", () => {
    expect(
      signupSchema.safeParse({
        email: "public@example.com",
        password: "Public123!",
        confirm_password: "Public123!",
        role: "super_admin",
      }).success,
    ).toBe(false);
  });
  it("escapes invitation link HTML", () => {
    const result = adminInvitationEmail(
      'https://admin.example.com/setup#token="<test>',
    );
    expect(result.html).not.toContain('token="<test>');
    expect(result.text).toContain("24 hours");
  });
  it("rejects missing or foreign origins on mutations", () => {
    const next = jest.fn();
    checkAdminOrigin(
      { method: "POST", get: () => "https://evil.example" } as any,
      {} as any,
      next,
    );
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });
  it("allows the configured portal origin", () => {
    const next = jest.fn();
    checkAdminOrigin(
      { method: "POST", get: () => "http://localhost:3000" } as any,
      {} as any,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });
});
