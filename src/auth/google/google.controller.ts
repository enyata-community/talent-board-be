import { createOAuthState } from "../oauthState";
import { GOOGLE_SCOPES } from "@src/auth/auth.constants";
import AppDataSource from "@src/datasource";
import { UnauthorizedError } from "@src/exceptions/unauthorizedError";
import asyncHandler from "@src/middlewares/asyncHandler";
import { createOAuthExchangeCode } from "../oauthExchange";
import type { NextFunction, Request, Response } from "express";
import passport from "passport";
import { GoogleAuthService } from "./google.service";

const googleAuthService = new GoogleAuthService();

export const googleOAuth = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const state = await createOAuthState(req, res, "google");
    passport.authenticate("google", { scope: GOOGLE_SCOPES, state })(
      req,
      res,
      next,
    );
  },
);

export const googleOAuthCallback = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const entityManager = AppDataSource.manager;

    if (!req.user) {
      return next(new UnauthorizedError("Google authentication failed"));
    }

    const profile = req.user as unknown as {
      first_name: string;
      last_name: string;
      email: string;
      avatar?: string;
    };

    const user = await googleAuthService.authenticateOrCreateUser(
      profile,
      entityManager,
    );

    const redirectUri = res.locals.oauthRedirect;

    const code = await createOAuthExchangeCode(user.id, req, res);
    const destination = new URL(redirectUri);
    destination.searchParams.set("code", code);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(destination.href);
  },
);
