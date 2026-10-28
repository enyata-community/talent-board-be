import config from "config";
import {
  saveAuthChallenge,
  consumeAuthChallenge,
  incrementAuthCounter,
} from "@src/auth/authSecurityStore";
jest.mock("@src/auth/authSecurityStore");
import {
  createOAuthState,
  validateOAuthState,
  validateOAuthRedirect,
} from "@src/auth/oauthState";
import { authRateLimit } from "@src/auth/authRateLimit";
import { LocalAuthService } from "@src/auth/local/local.service";
import { UserProvider } from "@src/entities/user.entity";
import { RefreshToken } from "@src/entities/refreshToken.entity";
import { verify, hash } from "argon2";
import { buildTalentQuery } from "@src/talents/utils/talent.utils";
import AppDataSource from "@src/datasource";
import { TalentProfileEntity } from "@src/entities/talentProfile.entity";
import { SavedTalentEntity } from "@src/entities/savedTalent.entity";

jest.mock("@src/utils/email", () => ({ EmailService: {} }));
jest.mock("argon2", () => ({ verify: jest.fn(), hash: jest.fn() }));

const response = () => {
  const res: any = {
    locals: {},
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    setHeader: jest.fn(),
  };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

test("redirects reject foreign origins, credentials, and lookalike hosts", () => {
  const frontend = new URL(config.get<string>("FRONTEND_URL"));
  expect(validateOAuthRedirect(frontend.href)).toBe(frontend.href);
  for (const uri of [
    "https://evil.example",
    `${frontend.protocol}//${frontend.host}.evil.example`,
    `${frontend.protocol}//user:pass@${frontend.host}`,
  ]) {
    expect(() => validateOAuthRedirect(uri)).toThrow();
  }
});

test("OAuth callback requires browser binding and consumes state once", async () => {
  const res = response();
  const req: any = { query: {}, headers: {}, cookies: {} };
  const state = await createOAuthState(req, res, "google");
  const [, nonce, stored] = (saveAuthChallenge as jest.Mock).mock.calls[0];
  (consumeAuthChallenge as jest.Mock)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(stored)
    .mockResolvedValueOnce(null);
  req.query.state = state;
  req.cookies.oauth_google = "wrong";
  const next = jest.fn();
  await validateOAuthState("google")(req, res, next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));
  expect(consumeAuthChallenge).toHaveBeenCalledWith(
    `oauth:google:${state}`,
    "wrong",
  );
  next.mockClear();
  req.cookies.oauth_google = nonce;

  await validateOAuthState("google")(req, res, next);
  expect(next).toHaveBeenCalledWith();
  next.mockClear();
  await validateOAuthState("google")(req, res, next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));
});

test("account rate limit applies even when the IP limit has not been reached", async () => {
  (incrementAuthCounter as jest.Mock)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(21);
  const res = response();
  const next = jest.fn();
  await authRateLimit(
    { ip: "127.0.0.1", body: { email: "TEST@example.com" } } as any,
    res,
    next,
  );
  expect(res.status).toHaveBeenCalledWith(429);
  expect(next).not.toHaveBeenCalled();
});

test("five wrong attempts permanently consume the OTP; success cannot replay it", async () => {
  const record: any = {
    otp: "123456",
    expires_at: new Date(Date.now() + 60000),
    used_at: null,
    failed_attempts: 0,
  };
  const user: any = { provider: UserProvider.LOCAL, role: "talent" };
  const tx: any = {
    findOne: jest
      .fn()
      .mockImplementation((entity) =>
        Promise.resolve(entity.name === "EmailOtpEntity" ? record : user),
      ),
    save: jest.fn(),
  };
  tx.transaction = (cb: any) => cb(tx);
  const service = new LocalAuthService();
  for (let i = 0; i < 5; i++)
    expect(await service.verifyEmail("a@example.com", "000000", tx)).toBeNull();
  expect(record.failed_attempts).toBe(5);
  expect(record.used_at).toBeInstanceOf(Date);
  expect(await service.verifyEmail("a@example.com", "123456", tx)).toBeNull();
  expect(tx.findOne.mock.calls[0][1].lock.mode).toBe("pessimistic_write");
  record.used_at = null;
  record.failed_attempts = 0;
  expect(await service.verifyEmail("a@example.com", "123456", tx)).toBe(user);
  expect(await service.verifyEmail("a@example.com", "123456", tx)).toBeNull();
});

test("password reset revokes refresh sessions inside the password transaction", async () => {
  const record = { token: "hash", expires_at: new Date(Date.now() + 60000) };
  const tx: any = {
    findOne: jest
      .fn()
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce({ id: "user" }),
    update: jest.fn(),
    save: jest.fn(),
  };
  tx.transaction = (cb: any) => cb(tx);
  (verify as jest.Mock).mockResolvedValue(true);
  (hash as jest.Mock).mockResolvedValue("new-hash");
  await new LocalAuthService().resetPassword(
    { email: "a@example.com", token: "secret", password: "newPassword1!" },
    tx,
  );
  expect(tx.update).toHaveBeenCalledWith(
    RefreshToken,
    { user: { id: "user" }, is_valid: true },
    { is_valid: false },
  );
});

test("search OR terms remain grouped after recruiter and approval restrictions", async () => {
  // Build actual TypeORM SQL without opening a connection.
  await (AppDataSource as any).buildMetadatas();
  for (const source of ["talent", "saved"] as const) {
    const qb =
      source === "talent"
        ? AppDataSource.getRepository(TalentProfileEntity).createQueryBuilder(
            "talent",
          )
        : AppDataSource.getRepository(SavedTalentEntity).createQueryBuilder(
            "save",
          );
    buildTalentQuery(qb, { q: "Jane" } as any, source, "recruiter");
    const [sql, parameters] = qb.getQueryAndParameters();
    expect(sql).toMatch(/AND \(similarity[\s\S]+OR[\s\S]+OR[\s\S]+\)/);
    expect(sql).toContain("profile_status");
    if (source === "saved") expect(parameters).toContain("recruiter");
  }
});
