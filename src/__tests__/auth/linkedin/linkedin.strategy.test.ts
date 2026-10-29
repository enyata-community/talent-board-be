import axios from "axios";
import { verify } from "jsonwebtoken";
import passport from "passport";
import "../../../auth/linkedin/linkedin.strategy";
import { closeLogger } from "../../../utils/logger";

jest.mock("axios");
jest.mock("jsonwebtoken");

const mockDone = jest.fn();

describe("LinkedIn Strategy", () => {
  const strategy = (passport as any)._strategies.linkedin;

  afterAll(async () => {
    await closeLogger();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should register the LinkedIn strategy under the 'linkedin' key", () => {
    const strategies = (passport as any)._strategies;
    expect(strategies).toHaveProperty("linkedin");
    expect(strategies.linkedin).toBeDefined();
    expect((strategies.linkedin as any).name).toBe("custom");
  });

  it("should succeed and call done with profile data", async () => {
    const mockDecoded = {
      given_name: "Jane",
      family_name: "Doe",
      email: "jane.doe@example.com",
      picture: "https://avatar.com/jane.png",
    };

    (axios.post as jest.Mock).mockResolvedValue({
      data: { id_token: "valid-token" },
    });

    (verify as jest.Mock).mockImplementation((_t, _k, _o, cb) =>
      cb(null, mockDecoded),
    );

    const req = { query: { code: "valid-code" } };
    await (strategy as any)._verify(req, mockDone);

    expect(verify).toHaveBeenCalledWith(
      "valid-token",
      expect.any(Function),
      expect.objectContaining({
        algorithms: ["RS256"],
        issuer: "https://www.linkedin.com/oauth",
        audience: expect.any(String),
      }),
      expect.any(Function),
    );
    expect(mockDone).toHaveBeenCalledWith(null, {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane.doe@example.com",
      avatar: "https://avatar.com/jane.png",
    });
  });

  it("validates signed tokens against the discovery issuer and configured audience", async () => {
    const jwt = jest.requireActual("jsonwebtoken");
    const { generateKeyPairSync } = jest.requireActual("crypto");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    let options: any;
    (axios.post as jest.Mock).mockResolvedValue({
      data: { id_token: "capture-options" },
    });
    (verify as jest.Mock).mockImplementation((_token, _key, opts, cb) => {
      options = opts;
      cb(new Error("capture options"));
    });
    await strategy._verify({ query: { code: "code" } }, mockDone);
    const token = (issuer: string, audience: string) =>
      jwt.sign({}, privateKey, {
        algorithm: "RS256",
        issuer,
        audience,
        expiresIn: "1m",
      });
    expect(() =>
      jwt.verify(
        token("https://www.linkedin.com/oauth", options.audience),
        publicKey,
        options,
      ),
    ).not.toThrow();
    expect(() =>
      jwt.verify(
        token("https://www.linkedin.com", options.audience),
        publicKey,
        options,
      ),
    ).toThrow(/issuer/);
    expect(() =>
      jwt.verify(
        token("https://www.linkedin.com/oauth", "different-app"),
        publicKey,
        options,
      ),
    ).toThrow(/audience/);
  });

  it("should fail if no code is present", async () => {
    const req = { query: {} };
    await (strategy as any)._verify(req, mockDone);
    expect(mockDone).toHaveBeenCalledWith(expect.any(Error), null);
    expect(mockDone.mock.calls[0][0].message).toMatch(/No code received/);
  });

  it("should fail if LinkedIn does not return id_token", async () => {
    (axios.post as jest.Mock).mockResolvedValue({
      data: {},
    });

    const req = { query: { code: "fake-code" } };
    await (strategy as any)._verify(req, mockDone);
    expect(mockDone).toHaveBeenCalledWith(expect.any(Error), null);
    expect(mockDone.mock.calls[0][0].message).toMatch(/ID Token not provided/);
  });

  it("should fail if id_token verification throws", async () => {
    (axios.post as jest.Mock).mockResolvedValue({
      data: { id_token: "bad-token" },
    });
    (verify as jest.Mock).mockImplementation((_t, _k, _o, cb) =>
      cb(new Error("JWT verification failed")),
    );

    const req = { query: { code: "valid-code" } };
    await strategy._verify(req, mockDone);
    expect(mockDone).toHaveBeenCalledWith(expect.any(Error), null);
    expect(mockDone.mock.calls[0][0].message).toMatch(/Invalid ID token/);
  });

  it("should fail if LinkedIn token request throws", async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error("Network fail"));

    const req = { query: { code: "valid-code" } };
    await strategy._verify(req, mockDone);
    expect(mockDone).toHaveBeenCalledWith(expect.any(Error), null);
    expect(mockDone.mock.calls[0][0].message).toMatch(/Network fail/);
  });
});
