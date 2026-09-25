import { Router } from "express";
import {
  createStore,
  getMyStore,
  listStoresForAdmin,
  updateStore,
} from "../controllers/storeController";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/admin", requireAuth, requireRole("admin"), listStoresForAdmin);
router.get("/", requireAuth, requireRole("store_owner"), getMyStore);
router.post("/", requireAuth, requireRole("store_owner"), createStore);
router.put("/", requireAuth, requireRole("store_owner"), updateStore);

export default router;
