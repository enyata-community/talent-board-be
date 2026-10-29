import asyncHandler from "../middlewares/asyncHandler";
import { listSchema } from "./schemas/admin.schema";
import { adminUsersSchema } from "./schemas/adminUsers.schema";
import { AdminUsersService } from "./adminUsers.service";

const users = new AdminUsersService();

export const listUsers = asyncHandler(async (req, res) => {
  res.json({
    status: "success",
    data: await users.list(adminUsersSchema.parse(req.query)),
  });
});

export const getUser = asyncHandler(async (req, res) => {
  const { page, limit } = listSchema.parse(req.query);
  res.json({
    status: "success",
    data: await users.detail(String(req.params.id), page, limit),
  });
});
