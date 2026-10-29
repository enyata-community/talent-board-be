import { Router } from "express";
import { getAvatar } from "./files.controller";
const router = Router();
router.get("/avatars/:filename", getAvatar);
export default router;
