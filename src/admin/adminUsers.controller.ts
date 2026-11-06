import asyncHandler from "../middlewares/asyncHandler";
import { listSchema } from "./schemas/admin.schema";
import AppDataSource from "../datasource";
import { adminUsersSchema, UserStatusInput } from "./schemas/adminUsers.schema";
import { AdminUsersService } from "./adminUsers.service";
import {
  AdminUserStatusService,
  SUSPENSION_REASONS,
} from "./adminUserStatus.service";
import { audit, withFailureAudit } from "./adminAudit.service";
import { UserStatus } from "../entities/user.entity";
import { context } from "./middlewares/adminSecurity";

const users = new AdminUsersService();
const statuses = new AdminUserStatusService();
export const changeUserStatus = asyncHandler(async (req, res) => {
  const body = req.body as UserStatusInput;
  res.json({
    status: "success",
    data: await statuses.change(
      String(req.params.id),
      body.status,
      context(req),
      body.status === UserStatus.SUSPENDED ? body.reason : undefined,
      body.note,
    ),
  });
});
export const listSuspensionReasons = asyncHandler(async (_req, res) => {
  res.json({ status: "success", data: SUSPENSION_REASONS });
});

export const listUsers = asyncHandler(async (req, res) => {
  res.json({
    status: "success",
    data: await users.list(adminUsersSchema.parse(req.query)),
  });
});

export const getUser = asyncHandler(async (req, res) => {
  const { page, limit } = listSchema.parse(req.query);
  const id = String(req.params.id);
  const data = await withFailureAudit("user.view", context(req), id, () =>
    users.detail(id, page, limit),
  );
  // Fail closed: personal data is only returned once its access is recorded.
  await audit(AppDataSource.manager, "user.view", "success", context(req), id);
  res.json({ status: "success", data });
});
