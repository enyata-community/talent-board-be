import { googleOAuthCallback } from "@src/auth/google/google.controller";
import { GoogleAuthService } from "@src/auth/google/google.service";
import { createOAuthExchangeCode } from "@src/auth/oauthExchange";
jest.mock("@src/auth/google/google.service");
jest.mock("@src/auth/oauthExchange");

test("google redirects with an exchange code and preserves existing query parameters", async () => {
  (
    GoogleAuthService.prototype.authenticateOrCreateUser as jest.Mock
  ).mockResolvedValue({ id: "user" });
  (createOAuthExchangeCode as jest.Mock).mockResolvedValue("single-use-code");
  const res: any = {
    locals: { oauthRedirect: "https://frontend.example/callback?next=home" },
    redirect: jest.fn(),
    setHeader: jest.fn(),
  };
  const next = jest.fn();
  await googleOAuthCallback(
    { user: { email: "a@example.com" } } as any,
    res,
    next,
  );
  expect(next).not.toHaveBeenCalled();
  const destination = new URL(res.redirect.mock.calls[0][0]);
  expect(destination.searchParams.get("code")).toBe("single-use-code");
  expect(destination.searchParams.get("next")).toBe("home");
  expect(destination.searchParams.has("access_token")).toBe(false);
  expect(destination.searchParams.has("refresh_token")).toBe(false);
});

test("google rejects a missing authenticated profile", async () => {
  const next = jest.fn();
  await googleOAuthCallback({} as any, {} as any, next);
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 401 }),
  );
});
