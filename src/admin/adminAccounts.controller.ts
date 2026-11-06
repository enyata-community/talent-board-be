import asyncHandler from "../middlewares/asyncHandler";
import { AdminAccountService } from "./adminAccounts.service";
import { context } from "./middlewares/adminSecurity";
import { adminAccountsSchema } from "./schemas/admin.schema";

const accounts = new AdminAccountService();
export const listAdmins = asyncHandler(async (req, res) => {
  res.json({
    status: "success",
    data: await accounts.list(adminAccountsSchema.parse(req.query)),
  });
});
export const changeAdminRole = asyncHandler(async (req, res) => {
  res.json({
    status: "success",
    data: await accounts.changeRole(
      String(req.params.id),
      req.body.role,
      context(req),
    ),
  });
});
export const changeAdminStatus = asyncHandler(async (req, res) => {
  res.json({
    status: "success",
    data: await accounts.deactivate(String(req.params.id), context(req)),
  });
});
