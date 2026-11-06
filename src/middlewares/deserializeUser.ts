import config from "config";
import type { NextFunction, Request, Response } from "express";
import { EntityManager } from "typeorm";
import AppDataSource from "../datasource";
import { RefreshToken } from "../entities/refreshToken.entity";
import { UserEntity, isInternalRole } from "../entities/user.entity";
import { UnauthorizedError } from "../exceptions/unauthorizedError";
import { signToken, verifyToken } from "../utils/jwt";
import { recordUserActivity } from "../users/userActivity";
import asyncHandler from "./asyncHandler";
import { assertAccountAccess } from "../auth/accountAccess";

const extractTokens = (req: Request) => {
  let accessToken =
    req.headers.authorization?.split(" ")[1] || req.cookies.access_token;
  const refreshToken =
    req.cookies.refresh_token || req.headers["x-refresh-token"];

  if (!accessToken && !refreshToken) {
    throw new UnauthorizedError("Missing tokens. Please log in.");
  }

  return { accessToken, refreshToken };
};

const checkUserExists = async (userId: string, sessionVersion?: number) => {
  const user = await UserEntity.findOne({ where: { id: userId } });

  if (!user || isInternalRole(user.role)) {
    throw new UnauthorizedError("User not found");
  }
  assertAccountAccess(user, sessionVersion);

  return user;
};

const refreshAccessToken = async (
  refreshToken: string,
  entityManager: EntityManager,
  req: Request,
  res: Response,
): Promise<string | false> => {
  const decoded = verifyToken(refreshToken, "REFRESH_TOKEN_PUBLIC_KEY");
  if (!decoded) return false;

  const user = await checkUserExists(decoded.id, decoded.session_version ?? 0);
  if (!user) return false;

  return entityManager.transaction(async (tx) => {
    // Serialize session issuance with password changes which update this row.
    const current = await tx.findOne(UserEntity, {
      where: { id: user.id },
      lock: { mode: "pessimistic_write" },
    });
    assertAccountAccess(current, decoded.session_version ?? 0);
    const storedToken = await tx.findOne(RefreshToken, {
      where: { token: refreshToken, is_valid: true, user: { id: user.id } },
      lock: { mode: "pessimistic_write" },
    });
    if (!storedToken) return false;
    storedToken.is_valid = false;
    await tx.save(storedToken);
    const replacement = signToken(
      user.id,
      "REFRESH_TOKEN_PRIVATE_KEY",
      {
        expiresIn: config.get<string>("REFRESH_TOKEN_TTL"),
      },
      current.session_version ?? 0,
    );
    await tx.save(
      tx.create(RefreshToken, {
        token: replacement,
        user,
        is_valid: true,
        ip_address: storedToken.ip_address,
        user_agent: storedToken.user_agent,
      }),
    );
    res.cookie("refresh_token", replacement, {
      httpOnly: true,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
      sameSite: "lax",
      path: "/",
    });
    return signToken(
      user.id,
      "ACCESS_TOKEN_PRIVATE_KEY",
      {
        expiresIn: config.get<string>("ACCESS_TOKEN_TTL"),
      },
      current.session_version ?? 0,
    );
  });
};

export const deserializeUser = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { accessToken, refreshToken } = extractTokens(req);
    const entityManager = AppDataSource.manager;

    const decoded = accessToken
      ? verifyToken(accessToken, "ACCESS_TOKEN_PUBLIC_KEY")
      : null;

    if (decoded) {
      const currentUser = await checkUserExists(
        decoded.id,
        decoded.session_version ?? 0,
      );
      await recordUserActivity(currentUser, entityManager);
      req.user = currentUser;
      return next();
    }

    if (accessToken && !refreshToken) {
      return next(
        new UnauthorizedError("Invalid access token! Please log in again."),
      );
    }

    if (refreshToken) {
      const newAccessToken = await refreshAccessToken(
        refreshToken,
        entityManager,
        req,
        res,
      );

      if (!newAccessToken) {
        return next(
          new UnauthorizedError("Invalid refresh token! Please log in again."),
        );
      }

      res.setHeader("x-access-token", newAccessToken);

      const newDecoded = verifyToken(newAccessToken, "ACCESS_TOKEN_PUBLIC_KEY");
      const currentUser = await checkUserExists(
        newDecoded!.id,
        newDecoded!.session_version ?? 0,
      );
      await recordUserActivity(currentUser, entityManager);
      req.user = currentUser;
    }
    return next();
  },
);
