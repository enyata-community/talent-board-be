import { formatTalentResult } from "@src/talents/utils/talent.utils";
import { sanitizeUser } from "@src/utils/sanitizeUser";
import { UserEntity, UserRole } from "@src/entities/user.entity";
import { TalentProfileEntity } from "@src/entities/talentProfile.entity";
import { updateProfileSchema } from "@src/users/schemas/updateProfile.schema";
import { injectResumePath } from "@src/middlewares/injectResumePath";

const user = Object.assign(new UserEntity(), {
  id: "talent",
  role: UserRole.TALENT,
  email: "private@example.com",
  created_at: new Date(),
  first_name: "Jane",
  last_name: "Doe",
});
const profile = Object.assign(new TalentProfileEntity(), {
  user,
  resume_path: "uploads/resumes/private.pdf",
  skills: [],
});
user.talent_profile = profile;

test("public talent projections omit email, storage paths, and download URLs", () => {
  for (const input of [profile, user, { talent: user }]) {
    const formatted = formatTalentResult(input as any);
    expect(formatted).not.toHaveProperty("email");
    expect(formatted).not.toHaveProperty("resume_path");
    expect(formatted).not.toHaveProperty("resume_download_url");
    expect(JSON.stringify(formatted)).not.toContain("private.pdf");
  }
});

test("owner and authorized detail responses contain an API download URL rather than a storage key", () => {
  const owner = sanitizeUser(user);
  expect(owner.profile).not.toHaveProperty("resume_path");
  expect(owner.profile.resume_download_url).toContain("/talents/talent/resume");
  const recruiter = formatTalentResult(user, {
    include_resume_download_url: true,
  });
  expect(recruiter.resume_download_url).toContain("/talents/talent/resume");
});

test("client avatar paths cannot be assigned via profile updates", () => {
  expect(
    updateProfileSchema.safeParse({
      first_name: "Jane",
      last_name: "Doe",
      avatar: "https://evil.example/file.html",
    }).success,
  ).toBe(false);
});

test("client résumé paths never satisfy the upload requirement", () => {
  const req: any = {
    body: { resume_path: "uploads/resumes/someone-else.pdf" },
  };
  injectResumePath(req, {} as any, jest.fn());
  expect(req.body.resume_path).toBeUndefined();
});
