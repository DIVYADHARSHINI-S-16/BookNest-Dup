import { Router } from "express";
import {
  getMyStoreInventory,
  addStoreInventoryItem,
  updateStoreInventoryItem,
  removeStoreInventoryItem,
} from "../controllers/storeInventoryController";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.use(requireAuth, requireRole("store_owner"));

router.get("/", getMyStoreInventory);
router.post("/", addStoreInventoryItem);
router.patch("/:bookId", updateStoreInventoryItem);
router.delete("/:bookId", removeStoreInventoryItem);

export default router;
