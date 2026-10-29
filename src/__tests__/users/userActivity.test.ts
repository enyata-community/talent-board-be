import { EntityManager } from "typeorm";
import { UserEntity, UserRole } from "../../entities/user.entity";
import {
  recordUserActivity,
  ACTIVITY_UPDATE_INTERVAL_MS,
} from "../../users/userActivity";
import logger from "../../utils/logger";

describe("User activity tracking", () => {
  let update: jest.Mock;
  let manager: EntityManager;
  const now = new Date("2026-10-29T12:00:00Z");
  const user = (values: Partial<UserEntity> = {}) =>
    Object.assign(new UserEntity(), {
      id: "user",
      role: UserRole.TALENT,
      last_activity_at: null,
      ...values,
    });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    update = jest.fn().mockResolvedValue({ affected: 1 });
    manager = { update } as unknown as EntityManager;
  });
  afterEach(() => jest.useRealTimers());

  it("records first activity and skips subsequent requests within five minutes", async () => {
    const account = user();
    await recordUserActivity(account, manager);
    expect(account.last_activity_at).toEqual(now);
    await recordUserActivity(account, manager);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("records stale recruiter activity without changing the profile edit timestamp", async () => {
    const account = user({
      role: UserRole.RECRUITER,
      last_activity_at: new Date(
        now.getTime() - ACTIVITY_UPDATE_INTERVAL_MS - 1,
      ),
    });
    await recordUserActivity(account, manager);
    expect(update.mock.calls[0][2].last_activity_at).toEqual(now);
    expect(update.mock.calls[0][2].updated_at()).toBe('"updated_at"');
    expect(account.last_activity_at).toEqual(now);
  });

  it("does not replace local state when another request already updated the database", async () => {
    update.mockResolvedValue({ affected: 0 });
    const account = user();
    await recordUserActivity(account, manager);
    expect(account.last_activity_at).toBeNull();
  });

  it("does not move a future observation backwards", async () => {
    const account = user({ last_activity_at: new Date(now.getTime() + 1000) });
    await recordUserActivity(account, manager);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN, null])(
    "ignores non-marketplace role %s",
    async (role) => {
      await recordUserActivity(user({ role }), manager);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("keeps activity-store failures from failing authentication", async () => {
    update.mockRejectedValue(new Error("storage unavailable"));
    const account = user();
    await expect(recordUserActivity(account, manager)).resolves.toBeUndefined();
    expect(account.last_activity_at).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith("Unable to record user activity");
  });
});
