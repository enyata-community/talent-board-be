import { consumeAuthChallenge } from "@src/auth/authSecurityStore";
jest.mock("@src/auth/authSecurityStore");
import AppDataSource from "@src/datasource";
import { exchangeOAuthCode } from "@src/auth/oauthExchange";
import { createSendToken } from "@src/utils/createSendToken";
jest.mock("@src/datasource", () => ({
  __esModule: true,
  default: { manager: { findOne: jest.fn() } },
}));
jest.mock("@src/utils/createSendToken");

test("exchange issues a session once; expired and replayed codes fail", async () => {
  (consumeAuthChallenge as jest.Mock)
    .mockResolvedValueOnce({ userId: "user" })
    .mockResolvedValueOnce(null);
  (AppDataSource.manager.findOne as jest.Mock).mockResolvedValue({
    id: "user",
    role: "talent",
  });
  const req: any = {
    headers: {},
    cookies: { oauth_exchange: "browser" },
    body: { code: "a".repeat(64) },
  };
  const res: any = { setHeader: jest.fn(), clearCookie: jest.fn() };
  const next = jest.fn();
  await exchangeOAuthCode(req, res, next);
  expect(createSendToken).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  await exchangeOAuthCode(req, res, next);
  expect(createSendToken).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 401 }),
  );
});

test("exchange rejects codes from another browser before consuming them", async () => {
  (consumeAuthChallenge as jest.Mock).mockClear().mockResolvedValue(null);
  const next = jest.fn();
  await exchangeOAuthCode(
    {
      body: { code: "a".repeat(64) },
      cookies: { oauth_exchange: "wrong" },
    } as any,
    {} as any,
    next,
  );
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 401 }),
  );
  expect(consumeAuthChallenge).toHaveBeenCalledWith(
    `oauth-exchange:${"a".repeat(64)}`,
    "wrong",
  );
});
