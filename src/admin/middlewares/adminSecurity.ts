import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import AppDataSource from "../../datasource";
import { AdminRole } from "../../entities/adminAccount.entity";
import { AppError } from "../../exceptions/appError";
import asyncHandler from "../../middlewares/asyncHandler";
import { adminConfig } from "../admin.config";
import { audit, AuditContext } from "../adminAudit.service";
import { AdminAuthService } from "../adminAuth.service";
import { digest, equalSecret } from "../admin.utils";

export const context = (req: Request): AuditContext => ({
  actor: req.admin,
  requestId: req.adminRequestId,
  ip: req.ip,
});
export const adminRequest = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  req.adminRequestId = randomUUID();
  res.setHeader("X-Request-Id", req.adminRequestId);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
};
export const checkAdminOrigin = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("origin") !== adminConfig().frontend.origin
  )
    return next(new AppError("Invalid admin origin", 403));
  next();
};
export const authenticateAdmin = asyncHandler(async (req, _res, next) => {
  let result: Awaited<ReturnType<AdminAuthService["authenticate"]>>;
  try {
    result = await new AdminAuthService().authenticate(
      req.cookies?.[adminConfig(req.adminRealm).cookie] ?? "",
      req.adminRealm,
    );
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401)
      await audit(
        AppDataSource.manager,
        "admin.authentication",
        "denied",
        context(req),
      );
    throw error;
  }
  req.admin = result.account;
  req.adminSession = result.session;
  next();
});
export const requireAdminCsrf = asyncHandler(async (req, _res, next) => {
  if (
    !req.adminSession ||
    !equalSecret(req.get("x-admin-csrf") ?? "", req.adminSession.csrf_token)
  ) {
    await audit(AppDataSource.manager, "admin.csrf", "denied", context(req));
    throw new AppError("Invalid CSRF token", 403);
  }
  next();
});
export const requireSuperAdmin = asyncHandler(async (req, _res, next) => {
  if (req.admin?.role !== AdminRole.SUPER_ADMIN) {
    await audit(
      AppDataSource.manager,
      "admin.authorization",
      "denied",
      context(req),
    );
    throw new AppError("Super Admin required", 403);
  }
  next();
});
export const throttleAdmin = (scope: string, limit: number, byEmail = false) =>
  asyncHandler(async (req, res, next) => {
    // Fixed windows are bounded by server time; upsert increments are atomic across instances.
    const window = Math.floor(Date.now() / 900000);
    const keys = [`${scope}:ip:${digest(req.ip ?? "unknown")}:${window}`];
    if (byEmail && typeof req.body?.email === "string")
      keys.push(
        `${scope}:email:${digest(req.body.email.trim().toLowerCase())}:${window}`,
      );
    const counts = await AppDataSource.transaction(async (tx) => {
      const values: number[] = [];
      for (const key of keys.sort()) {
        const rows = await tx.query(
          `INSERT INTO admin_auth_throttles (key, attempts, expires_at) VALUES ($1, 1, $2)
        ON CONFLICT (key) DO UPDATE SET attempts = admin_auth_throttles.attempts + 1 RETURNING attempts`,
          [key, new Date((window + 1) * 900000)],
        );
        values.push(rows[0].attempts);
      }
      return values;
    });
    if (counts.some((count) => count > limit)) {
      res.setHeader(
        "Retry-After",
        Math.ceil(((window + 1) * 900000 - Date.now()) / 1000),
      );
      await audit(
        AppDataSource.manager,
        "admin.throttle",
        "denied",
        context(req),
      );
      throw new AppError("Too many attempts. Try again later", 429);
    }
    next();
  });
