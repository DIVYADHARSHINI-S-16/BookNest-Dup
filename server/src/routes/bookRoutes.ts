import { Router } from "express";
import {
  listBooks,
  getBookById,
  createBook,
  updateBook,
  updateInventory,
  deleteBook,
} from "../controllers/bookController";
import { requireAuth, requireRole } from "../middleware/auth";
import reviewRoutes from "./reviewRoutes";
import secondHandRoutes from "./secondHandRoutes";
import { getBookStoreListings } from "../controllers/storeController";

const router = Router();

// Public: browse, search, filter, details
router.get("/", listBooks);
router.get("/:id", getBookById);

// Nested resources
router.use("/:bookId/reviews", reviewRoutes);
router.use("/:bookId/second-hand", secondHandRoutes);
router.get("/:bookId/store-listings", getBookStoreListings);

// Admin only: manage catalog
router.post("/", requireAuth, requireRole("admin"), createBook);
router.put("/:id", requireAuth, requireRole("admin"), updateBook);
router.patch("/:id/inventory", requireAuth, requireRole("admin"), updateInventory);
router.delete("/:id", requireAuth, requireRole("admin"), deleteBook);

export default router;
