import { validateSync } from "class-validator";
import {
  UserEntity,
  UserProvider,
  UserRole,
  UserStatus,
} from "../../entities/user.entity";

describe("User status defaults before persistence", () => {
  it.each(Object.values(UserRole))(
    "validates a new %s identity before the database applies defaults",
    async (role) => {
      const user = Object.assign(new UserEntity(), {
        first_name: "Barry",
        last_name: "Jay",
        email: "new@example.com",
        provider: UserProvider.LOCAL,
        role,
        profile_completed: false,
      });
      expect(user.status).toBe(UserStatus.ACTIVE);
      const previous = process.env.NODE_ENV;
      try {
        // The normal test environment skips the production insertion hook.
        process.env.NODE_ENV = "development";
        await expect(user.validateOnInsert()).resolves.toBeUndefined();
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    },
  );

  it("preserves explicit suspension and rejects invalid statuses", () => {
    const user = Object.assign(new UserEntity(), {
      status: UserStatus.SUSPENDED,
    });
    expect(user.status).toBe(UserStatus.SUSPENDED);
    expect(
      validateSync(user).some((error) => error.property === "status"),
    ).toBe(false);
    user.status = "invalid" as UserStatus;
    expect(
      validateSync(user).find((error) => error.property === "status")
        ?.constraints,
    ).toHaveProperty("isEnum");
  });
});
