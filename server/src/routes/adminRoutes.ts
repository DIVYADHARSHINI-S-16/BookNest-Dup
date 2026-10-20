import { Router } from "express";
import { getDashboardStats } from "../controllers/adminController";
import { listAllReviewsForAdmin, deleteReviewAsAdmin } from "../controllers/reviewController";
import {
  listBookRequestsAdmin,
  getBookRequestAdmin,
  updateBookRequestAdmin,
} from "../controllers/adminBookRequestController";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// Every route in this file is admin-only.
router.use(requireAuth, requireRole("admin"));

router.get("/dashboard", getDashboardStats);
router.get("/reviews", listAllReviewsForAdmin);
router.delete("/reviews/:reviewId", deleteReviewAsAdmin);

router.get("/book-requests", listBookRequestsAdmin);
router.get("/book-requests/:id", getBookRequestAdmin);
router.patch("/book-requests/:id", updateBookRequestAdmin);

export default router;
