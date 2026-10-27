import { randomBytes } from "crypto";
import config from "config";
import type { Request, Response, NextFunction } from "express";
import { saveAuthChallenge, consumeAuthChallenge } from "./authSecurityStore";
import asyncHandler from "@src/middlewares/asyncHandler";
import { UnauthorizedError } from "@src/exceptions/unauthorizedError";

const cookieOptions = (req: Request) => ({
  httpOnly: true,
  secure: req.secure || req.headers["x-forwarded-proto"] === "https",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 10 * 60 * 1000,
});

export function validateOAuthRedirect(value: unknown): string {
  const frontend = new URL(config.get<string>("FRONTEND_URL"));
  const url = new URL(typeof value === "string" ? value : frontend.href);
  if (
    url.origin !== frontend.origin ||
    url.username ||
    url.password ||
    !["https:", "http:"].includes(url.protocol)
  ) {
    throw new UnauthorizedError("Invalid OAuth redirect URI");
  }
  return url.href;
}

export async function createOAuthState(
  req: Request,
  res: Response,
  provider: string,
) {
  const redirect = validateOAuthRedirect(req.query.redirect_uri);
  const state = randomBytes(32).toString("hex");
  const nonce = randomBytes(32).toString("hex");
  await saveAuthChallenge(
    `oauth:${provider}:${state}`,
    nonce,
    { redirect },
    600,
  );
  res.cookie(`oauth_${provider}`, nonce, cookieOptions(req));
  return state;
}

export const validateOAuthState = (provider: string) =>
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const state = req.query.state;
    const nonce = req.cookies?.[`oauth_${provider}`];
    if (
      typeof state !== "string" ||
      !/^[a-f0-9]{64}$/.test(state) ||
      typeof nonce !== "string"
    ) {
      throw new UnauthorizedError("Invalid OAuth state");
    }
    const stored = await consumeAuthChallenge(
      `oauth:${provider}:${state}`,
      nonce,
    );
    if (!stored) throw new UnauthorizedError("Invalid or expired OAuth state");
    res.clearCookie(`oauth_${provider}`, {
      ...cookieOptions(req),
      maxAge: undefined,
    });
    res.locals.oauthRedirect = validateOAuthRedirect(stored.redirect);
    next();
  });
