import { Router } from "express";
import {
  createStore,
  getMyStore,
  listStoresForAdmin,
  updateStore,
} from "../controllers/storeController";
import { getMyStoreOrders, getMyStoreOrderById } from "../controllers/storeOrderController";
import {
  listRequestsForStore,
  createStoreResponse,
  updateStoreResponse,
} from "../controllers/storeBookRequestController";
import { searchNearbyStores, getPublicStoreBooks } from "../controllers/storeDiscoveryController";
import { requireAuth, requireRole } from "../middleware/auth";
import { discoveryRateLimiter } from "../middleware/rateLimit";
import storeInventoryRoutes from "./storeInventoryRoutes";

const router = Router();

router.get("/admin", requireAuth, requireRole("admin"), listStoresForAdmin);
router.get("/", requireAuth, requireRole("store_owner"), getMyStore);
router.post("/", requireAuth, requireRole("store_owner"), createStore);
router.put("/", requireAuth, requireRole("store_owner"), updateStore);

// Store-owner inventory management (own store only — enforced in the controller).
router.use("/inventory", storeInventoryRoutes);

// Store-owner order visibility (read-only, own store's lines only — enforced in the controller).
router.get("/orders", requireAuth, requireRole("store_owner"), getMyStoreOrders);
router.get("/orders/:orderId", requireAuth, requireRole("store_owner"), getMyStoreOrderById);

// Store-owner book requests (active store only, own response only — enforced in the controller).
router.get("/book-requests", requireAuth, requireRole("store_owner"), listRequestsForStore);
router.post("/book-requests/:requestId/response", requireAuth, requireRole("store_owner"), createStoreResponse);
router.put("/book-requests/:requestId/response", requireAuth, requireRole("store_owner"), updateStoreResponse);

// Public nearby-store discovery (no login). Declared last so the fixed, authenticated
// paths above (/admin, /inventory, /orders, /book-requests) always take precedence.
// POST (not GET) so a customer's coordinates are never part of a logged URL.
// Both public routes share one per-client rate limit (middleware/rateLimit.ts).
router.post("/nearby", discoveryRateLimiter, searchNearbyStores);
router.get("/:storeId/books", discoveryRateLimiter, getPublicStoreBooks);

export default router;
