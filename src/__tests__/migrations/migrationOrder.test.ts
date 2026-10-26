import { readdirSync } from "fs";
import path from "path";

const directory = path.join(__dirname, "../../migrations");
const migrations = readdirSync(directory)
  .filter((file) => file.endsWith(".ts"))
  .sort()
  .map((file) => {
    const exports = require(path.join(directory, file));
    const Migration = Object.values(exports).find(
      (value: any) =>
        typeof value === "function" && typeof value.prototype.up === "function",
    ) as new () => { name?: string };
    const migration = new Migration();
    return {
      file,
      name: migration.name ?? Migration.name,
      timestamp: Number(file.slice(0, 13)),
    };
  });

describe("Migration ordering and dependency integrity", () => {
  it("keeps every filename timestamp aligned with its TypeORM execution name", () => {
    for (const migration of migrations) {
      expect(migration.file).toMatch(/^\d{13}-[a-z0-9-]+\.ts$/);
      expect(Number(migration.name.slice(-13))).toBe(migration.timestamp);
    }
    expect(
      new Set(migrations.map((migration) => migration.timestamp)).size,
    ).toBe(migrations.length);
  });
  it("starts with the initial schema followed by password reset tokens", () => {
    expect(migrations[0].name).toBe("InitialMigration1745418605537");
    expect(migrations[1].name).toBe(
      "CreatePasswordResetTokensTable1745418605538",
    );
    expect(migrations[migrations.length - 1].name).toBe(
      "UnifyAdminUserIdentities1793000002000",
    );
  });
  it.each([
    ["InitialMigration", "Onboarding"],
    ["InitialMigration", "AddDeviceContextToRefreshTokens"],
    ["Onboarding", "SplitUserProfilesAndAdjustFields"],
    ["SplitUserProfilesAndAdjustFields", "TalentDashboardEntities"],
    ["SplitUserProfilesAndAdjustFields", "EnableTrgmAndSkillsIndex"],
    ["EnableTrgmAndSkillsIndex", "AddSkillsTable"],
    ["CreateEmailOtps", "AddUsedAtToEmailOtps"],
    ["CreateEmailOtps", "AddAuditColumnsToEmailOtps"],
    ["AddAuthColumnsToUsers", "AddIncompleteSignupReminderFields"],
    ["CreateAdminPortal", "EnforceSingleSuperAdmin"],
    ["EnforceSingleSuperAdmin", "UnifyAdminUserIdentities"],
  ])("runs %s before %s", (prerequisite, dependent) => {
    const before = migrations.findIndex((migration) =>
      migration.name.startsWith(prerequisite),
    );
    const after = migrations.findIndex((migration) =>
      migration.name.startsWith(dependent),
    );
    expect(before).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThan(before);
  });
});
