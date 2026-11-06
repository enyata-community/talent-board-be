import { userStatusSchema } from "../../admin/schemas/adminUsers.schema";
import {
  UserEntity,
  UserRole,
  UserStatus,
  SuspensionReason,
} from "../../entities/user.entity";
import { assertAccountAccess } from "../../auth/accountAccess";
import {
  AdminUserStatusService,
  SUSPENSION_REASONS,
} from "../../admin/adminUserStatus.service";
import AppDataSource from "../../datasource";
import { AppError } from "../../exceptions/appError";
import { withFailureAudit } from "../../admin/adminAudit.service";

const insert = jest.fn();
jest.mock("../../datasource", () => ({
  __esModule: true,
  default: { manager: {} },
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() },
}));

describe("Account suspension contracts", () => {
  beforeEach(() => {
    insert.mockReset();
    (AppDataSource as any).manager = { insert };
  });
  it.each(Object.values(SuspensionReason))(
    "accepts suspension reason %s",
    (reason) => {
      expect(
        userStatusSchema.safeParse({
          status: "suspended",
          reason,
          note: " Review requested ",
        }).success,
      ).toBe(true);
    },
  );
  it.each([
    {},
    { status: "suspended" },
    { status: "suspended", reason: "INVALID" },
    { status: "suspended", reason: "OTHER" },
    { status: "suspended", reason: "OTHER", note: " " },
    { status: "suspended", reason: "USER_REQUEST", note: "a".repeat(1001) },
    { status: "suspended", reason: "USER_REQUEST", role: "super_admin" },
    { status: "active", reason: "USER_REQUEST" },
    { status: "toggle" },
    { reason: "USER_REQUEST" },
  ])("rejects invalid status change %j", (input) =>
    expect(userStatusSchema.safeParse(input).success).toBe(false),
  );
  it("accepts reactivation with an optional trimmed note", () => {
    expect(userStatusSchema.parse({ status: "active" })).toEqual({
      status: "active",
    });
    expect(
      userStatusSchema.parse({ status: "active", note: " Reviewed " }),
    ).toEqual({ status: "active", note: "Reviewed" });
  });
  it("offers every suspension reason in the dropdown, flagging OTHER", () => {
    expect(SUSPENSION_REASONS.map((reason) => reason.value)).toEqual(
      Object.values(SuspensionReason),
    );
    expect(
      SUSPENSION_REASONS.filter((reason) => reason.note_required).map(
        (reason) => reason.value,
      ),
    ).toEqual([SuspensionReason.OTHER]);
  });
  it.each([UserRole.TALENT, UserRole.RECRUITER])(
    "rejects suspended %s even with a current token version",
    (role) => {
      const user = Object.assign(new UserEntity(), {
        role,
        status: UserStatus.SUSPENDED,
        session_version: 3,
      });
      expect(() => assertAccountAccess(user, 3)).toThrow(
        "Account access denied",
      );
    },
  );
  it("accepts legacy version zero but rejects tokens revoked before reactivation", () => {
    const user = Object.assign(new UserEntity(), { role: UserRole.TALENT });
    expect(() => assertAccountAccess(user, 0)).not.toThrow();
    user.session_version = 1;
    expect(() => assertAccountAccess(user, 0)).toThrow("Account access denied");
    expect(() => assertAccountAccess(user, 1)).not.toThrow();
  });
  it("requires an authorized admin actor even when called outside a route", async () => {
    await expect(
      new AdminUserStatusService().change(
        "id",
        UserStatus.SUSPENDED,
        {},
        SuspensionReason.USER_REQUEST,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "user.suspend",
        outcome: "denied",
        target_id: "id",
        metadata: expect.objectContaining({ status_code: 403 }),
      }),
    );
  });
});

describe("Failure auditing", () => {
  beforeEach(() => {
    insert.mockReset();
    (AppDataSource as any).manager = { insert };
  });
  it("does not write a failure record when the action succeeds", async () => {
    await expect(
      withFailureAudit("user.view", {}, "id", async () => "ok"),
    ).resolves.toBe("ok");
    expect(insert).not.toHaveBeenCalled();
  });
  it.each([
    [new AppError("Account is already suspended", 409), "failure", 409],
    [
      new AppError("Access denied. Requires role: super_admin", 403),
      "denied",
      403,
    ],
    [new Error("connection reset"), "failure", 500],
  ])("records %s as %s and rethrows it", async (error, outcome, statusCode) => {
    await expect(
      withFailureAudit(
        "user.suspend",
        { requestId: "req", ip: "::ffff:10.0.0.1" },
        "id",
        async () => {
          throw error;
        },
        { status: "suspended" },
      ),
    ).rejects.toBe(error);
    expect(insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "user.suspend",
        outcome,
        target_id: "id",
        request_id: "req",
        ip_address: "10.0.0.1",
        metadata: {
          status: "suspended",
          status_code: statusCode,
          // Unexpected errors never leak internal messages into the log.
          error: error instanceof AppError ? error.message : "Internal error",
        },
      }),
    );
  });
  it("rethrows the original error when the audit write itself fails", async () => {
    insert.mockRejectedValue(new Error("audit unavailable"));
    const error = new AppError("Account is already active", 409);
    await expect(
      withFailureAudit("user.reactivate", {}, "id", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
