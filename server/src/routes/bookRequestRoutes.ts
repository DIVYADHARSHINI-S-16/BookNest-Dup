import { Router } from "express";
import {
  createBookRequest,
  listMyBookRequests,
  getMyBookRequest,
  cancelMyBookRequest,
} from "../controllers/bookRequestController";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// Customers only (own requests; ownership enforced in the controller).
router.use(requireAuth, requireRole("customer"));
router.post("/", createBookRequest);
router.get("/", listMyBookRequests);
router.get("/:id", getMyBookRequest);
router.post("/:id/cancel", cancelMyBookRequest);

export default router;
