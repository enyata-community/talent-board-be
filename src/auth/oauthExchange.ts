import AppDataSource from "@src/datasource";
import { UserEntity, isInternalRole } from "@src/entities/user.entity";
import { UnauthorizedError } from "@src/exceptions/unauthorizedError";
import asyncHandler from "@src/middlewares/asyncHandler";
import { createSendToken } from "@src/utils/createSendToken";
import { saveAuthChallenge, consumeAuthChallenge } from "./authSecurityStore";
import { randomBytes } from "crypto";
import type { Request, Response } from "express";

const exchangeCookieOptions = (req: Request) => ({
  httpOnly: true,
  secure: req.secure || req.headers["x-forwarded-proto"] === "https",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60000,
});
export async function createOAuthExchangeCode(
  userId: string,
  req: Request,
  res: Response,
): Promise<string> {
  const code = randomBytes(32).toString("hex");
  const binding = randomBytes(32).toString("hex");
  await saveAuthChallenge(`oauth-exchange:${code}`, binding, { userId }, 60);
  res.cookie("oauth_exchange", binding, exchangeCookieOptions(req));
  return code;
}

export const exchangeOAuthCode = asyncHandler(
  async (req: Request, res: Response) => {
    const code = req.body?.code;
    if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code))
      throw new UnauthorizedError("Invalid OAuth code");
    const binding = req.cookies?.oauth_exchange;
    if (typeof binding !== "string")
      throw new UnauthorizedError("Invalid OAuth browser binding");
    const stored = await consumeAuthChallenge(
      `oauth-exchange:${code}`,
      binding,
    );
    if (!stored) throw new UnauthorizedError("Invalid or expired OAuth code");
    res.clearCookie("oauth_exchange", {
      ...exchangeCookieOptions(req),
      maxAge: undefined,
    });
    const userId = stored.userId;
    const user = await AppDataSource.manager.findOne(UserEntity, {
      where: { id: userId },
    });
    if (!user || isInternalRole(user.role))
      throw new UnauthorizedError("Invalid OAuth account");
    res.setHeader("Cache-Control", "no-store");
    await createSendToken(
      user,
      200,
      "OAuth successful",
      req,
      res,
      AppDataSource.manager,
    );
  },
);
