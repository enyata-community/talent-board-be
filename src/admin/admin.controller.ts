import { CookieOptions } from "express";
import AppDataSource from "../datasource";
import { AdminInvitation } from "../entities/adminInvitation.entity";
import { AdminAuditLog } from "../entities/adminAuditLog.entity";
import asyncHandler from "../middlewares/asyncHandler";
import { AppError } from "../exceptions/appError";
import { AdminRole } from "../entities/adminAccount.entity";
import { adminConfig } from "./admin.config";
import { AdminAuthService } from "./adminAuth.service";
import { AdminInvitationService } from "./adminInvitation.service";
import { adminDto, equalSecret } from "./admin.utils";
import { audit } from "./adminAudit.service";
import { context } from "./middlewares/adminSecurity";
import { auditListSchema, listSchema } from "./schemas/admin.schema";
const auth = new AdminAuthService();
const invitations = new AdminInvitationService();
export const cookieOptions = (
  role: AdminRole = AdminRole.ADMIN,
): CookieOptions => ({
  httpOnly: true,
  secure: adminConfig().production,
  sameSite: "strict",
  path: adminConfig(role).path,
});
export const login = asyncHandler(async (req, res) => {
  const result = await auth.login(
    req.body.email,
    req.body.password,
    context(req),
    req.adminRealm,
  );
  res.cookie(adminConfig(req.adminRealm).cookie, result.token, {
    ...cookieOptions(req.adminRealm),
    expires: result.session.expires_at,
  });
  res.json({
    status: "success",
    data: { admin: adminDto(result.account), csrf_token: result.csrfToken },
  });
});
export const me = asyncHandler(async (req, res) => {
  res.json({
    status: "success",
    data: {
      admin: adminDto(req.admin!),
      csrf_token: req.adminSession!.csrf_token,
    },
  });
});
export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[adminConfig(req.adminRealm).cookie];
  if (token) {
    let result:
      | Awaited<ReturnType<AdminAuthService["authenticate"]>>
      | undefined;
    try {
      result = await auth.authenticate(token, req.adminRealm);
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 401) throw error;
    }
    if (result) {
      if (
        !equalSecret(req.get("x-admin-csrf") ?? "", result.session.csrf_token)
      ) {
        await audit(AppDataSource.manager, "admin.csrf", "denied", {
          ...context(req),
          actor: result.account,
        });
        throw new AppError("Invalid CSRF token", 403);
      }
      await auth.logout(result.session, {
        ...context(req),
        actor: result.account,
      });
    }
  }
  res.clearCookie(
    adminConfig(req.adminRealm).cookie,
    cookieOptions(req.adminRealm),
  );
  res.status(204).send();
});
export const setupPassword = asyncHandler(async (req, res) => {
  await invitations.setup(
    req.body.token,
    req.body.password,
    req.body.display_name,
    context(req),
    req.adminRealm,
    { first_name: req.body.first_name, last_name: req.body.last_name },
  );
  res.json({ status: "success", message: "Password set. Please log in." });
});
export const invite = asyncHandler(async (req, res) => {
  res.status(201).json({
    status: "success",
    data: await invitations.invite(
      req.body.email,
      req.body.display_name,
      context(req),
      { first_name: req.body.first_name, last_name: req.body.last_name },
    ),
  });
});
export const resend = asyncHandler(async (req, res) => {
  res.json({
    status: "success",
    data: await invitations.change(String(req.params.id), true, context(req)),
  });
});
export const revoke = asyncHandler(async (req, res) => {
  await invitations.change(String(req.params.id), false, context(req));
  res.status(204).send();
});
export const listInvitations = asyncHandler(async (req, res) => {
  const { page, limit } = listSchema.parse(req.query);
  const [items, total] = await AppDataSource.getRepository(
    AdminInvitation,
  ).findAndCount({
    order: { created_at: "DESC", id: "DESC" },
    skip: (page - 1) * limit,
    take: limit,
  });
  res.json({ status: "success", data: { items, total, page, limit } });
});
export const listAudit = asyncHandler(async (req, res) => {
  const query = auditListSchema.parse(req.query);
  const qb =
    AppDataSource.getRepository(AdminAuditLog).createQueryBuilder("log");
  for (const key of ["actor_id", "action", "outcome"] as const)
    if (query[key]) qb.andWhere(`log.${key} = :${key}`, { [key]: query[key] });
  if (query.from) qb.andWhere("log.occurred_at >= :from", { from: query.from });
  if (query.to) qb.andWhere("log.occurred_at <= :to", { to: query.to });
  const [items, total] = await qb
    .orderBy("log.occurred_at", "DESC")
    .addOrderBy("log.id", "DESC")
    .skip((query.page - 1) * query.limit)
    .take(query.limit)
    .getManyAndCount();
  res.json({
    status: "success",
    data: { items, total, page: query.page, limit: query.limit },
  });
});
