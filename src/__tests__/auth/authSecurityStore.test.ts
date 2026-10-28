import { createHash } from "crypto";
import AppDataSource from "@src/datasource";
import {
  consumeAuthChallenge,
  incrementAuthCounter,
  saveAuthChallenge,
} from "@src/auth/authSecurityStore";
jest.mock("@src/datasource", () => ({
  __esModule: true,
  default: { manager: { query: jest.fn() } },
}));
jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomInt: () => 1,
}));
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
beforeEach(() => jest.clearAllMocks());

test("stores only hashed challenge secrets and an explicit database expiry", async () => {
  await saveAuthChallenge(
    "secret-code",
    "browser-secret",
    { userId: "user" },
    60,
  );
  expect(AppDataSource.manager.query).toHaveBeenCalledWith(
    expect.stringContaining("INTERVAL '1 second'"),
    [hash("secret-code"), hash("browser-secret"), '{"userId":"user"}', 60],
  );
});

test("redemption atomically deletes only matching unexpired challenges", async () => {
  (AppDataSource.manager.query as jest.Mock)
    .mockResolvedValueOnce([{ payload: { userId: "user" } }])
    .mockResolvedValueOnce([]);
  expect(await consumeAuthChallenge("code", "cookie")).toEqual({
    userId: "user",
  });
  expect(await consumeAuthChallenge("code", "cookie")).toBeNull();
  expect(AppDataSource.manager.query).toHaveBeenCalledWith(
    expect.stringMatching(
      /DELETE[\s\S]+binding_hash = \$2 AND expires_at > NOW\(\)[\s\S]+RETURNING payload/,
    ),
    [hash("code"), hash("cookie")],
  );
});

test("rate counters use an atomic shared database increment", async () => {
  (AppDataSource.manager.query as jest.Mock).mockResolvedValue([{ hits: 21 }]);
  expect(await incrementAuthCounter("bucket", 900)).toBe(21);
  expect(AppDataSource.manager.query).toHaveBeenCalledWith(
    expect.stringContaining(
      "ON CONFLICT (key) DO UPDATE SET hits = auth_security_state.hits + 1",
    ),
    [hash("bucket"), 900],
  );
});
