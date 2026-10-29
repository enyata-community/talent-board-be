import { onboardTalent } from "@src/onboarding/onboarding.controller";
import { OnboardingService } from "@src/onboarding/onboarding.service";
import { updateProfile } from "@src/users/users.controller";
import { UserService } from "@src/users/users.service";
import { storeUploadedFile } from "@src/files/storeUploadedFile";
import { getFileStorage } from "@src/files/storage/fileStorage";
import { createSendToken } from "@src/utils/createSendToken";
import { EmailService } from "@src/utils/email";
jest.mock("@src/onboarding/onboarding.service");
jest.mock("@src/users/users.service");
jest.mock("@src/files/storeUploadedFile");
jest.mock("@src/files/storage/fileStorage");
jest.mock("@src/utils/createSendToken");
jest.mock("@src/utils/email", () => ({
  EmailService: { sendWelcome: jest.fn() },
}));
const remove = jest.fn();
const req = () =>
  ({
    user: { id: "talent", role: "talent" },
    body: { first_name: "Jane", last_name: "Doe", resume_path: "forged" },
    file: { buffer: Buffer.from("file") },
  }) as any;
beforeEach(() => {
  jest.clearAllMocks();
  remove.mockResolvedValue(undefined);
  (getFileStorage as jest.Mock).mockReturnValue({ remove });
  (storeUploadedFile as jest.Mock).mockResolvedValue("resumes/random.pdf");
  (EmailService.sendWelcome as jest.Mock).mockResolvedValue(undefined);
  (createSendToken as jest.Mock).mockResolvedValue(undefined);
});

test("failed onboarding cleans up the newly stored résumé", async () => {
  (OnboardingService.prototype.onboardUser as jest.Mock).mockRejectedValue(
    new Error("database rejected"),
  );
  const next = jest.fn();
  await onboardTalent(req(), {} as any, next);
  expect(remove).toHaveBeenCalledWith("resumes/random.pdf");
  expect(next).toHaveBeenCalledWith(expect.any(Error));
});

test("a committed résumé survives a later token-response failure", async () => {
  (OnboardingService.prototype.onboardUser as jest.Mock).mockResolvedValue({
    id: "talent",
    email: "a@example.com",
  });
  (createSendToken as jest.Mock).mockRejectedValue(
    new Error("token write failed"),
  );
  const next = jest.fn();
  await onboardTalent(req(), {} as any, next);
  expect(OnboardingService.prototype.onboardUser).toHaveBeenCalledWith(
    "talent",
    expect.objectContaining({ resume_path: "resumes/random.pdf" }),
    "talent",
  );
  expect(remove).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith(expect.any(Error));
});

test("failed profile update cleans up the new avatar", async () => {
  (storeUploadedFile as jest.Mock).mockResolvedValue("avatars/random.png");
  (UserService.prototype.updateProfile as jest.Mock).mockRejectedValue(
    new Error("database rejected"),
  );
  const next = jest.fn();
  await updateProfile(req(), {} as any, next);
  expect(remove).toHaveBeenCalledWith("avatars/random.png");
  expect(next).toHaveBeenCalledWith(expect.any(Error));
});
