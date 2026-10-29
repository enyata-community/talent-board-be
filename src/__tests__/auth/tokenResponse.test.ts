import { createSendToken } from "@src/utils/createSendToken";
import { signToken } from "@src/utils/jwt";
jest.mock("@src/utils/jwt");

test("session responses keep refresh tokens exclusively in HttpOnly cookies", async () => {
  (signToken as jest.Mock).mockImplementation((_id, key) =>
    key === "ACCESS_TOKEN_PRIVATE_KEY" ? "access" : "refresh",
  );
  const manager: any = {
    update: jest.fn(),
    create: jest.fn((_entity, data) => data),
    save: jest.fn(),
  };
  const res: any = {
    cookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  await createSendToken(
    { id: "user", email: "a@example.com" } as any,
    200,
    "OK",
    { headers: {}, socket: {} } as any,
    res,
    manager,
  );
  expect(res.cookie).toHaveBeenCalledWith(
    "refresh_token",
    "refresh",
    expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
  );
  expect(res.json.mock.calls[0][0].tokens).toEqual({ access_token: "access" });
  expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('"refresh"');
});
