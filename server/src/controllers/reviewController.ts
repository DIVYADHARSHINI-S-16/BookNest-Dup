import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";

/**
 * GET /api/books/:bookId/reviews
 * Public. Returns all reviews for a book plus the average rating and count.
 */
export async function listReviews(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);

    const bookExists = await pool.query("SELECT id FROM books WHERE id = $1", [bookId]);
    if (bookExists.rows.length === 0) throw new AppError("Book not found.", 404);

    const reviewsResult = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS reviewer_name
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.book_id = $1
       ORDER BY r.created_at DESC`,
      [bookId]
    );

    const summaryResult = await pool.query(
      `SELECT COUNT(*)::int AS review_count, COALESCE(AVG(rating), 0) AS average_rating
       FROM reviews WHERE book_id = $1`,
      [bookId]
    );
    const summary = summaryResult.rows[0];

    res.json({
      reviews: reviewsResult.rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        comment: row.comment,
        reviewerName: row.reviewer_name,
        createdAt: row.created_at,
      })),
      reviewCount: summary.review_count,
      averageRating: Number(Number(summary.average_rating).toFixed(2)),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/books/:bookId/reviews  { rating: 1-5, comment?: string }
 * Customer only. One review per customer per book.
 */
export async function addReview(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);
    const { rating, comment } = req.body;

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      throw new AppError("rating must be an integer from 1 to 5.", 422);
    }
    if (comment !== undefined && typeof comment !== "string") {
      throw new AppError("comment must be text.", 422);
    }

    const bookExists = await pool.query("SELECT id FROM books WHERE id = $1", [bookId]);
    if (bookExists.rows.length === 0) throw new AppError("Book not found.", 404);

    const existing = await pool.query(
      "SELECT id FROM reviews WHERE book_id = $1 AND user_id = $2",
      [bookId, req.user!.userId]
    );
    if (existing.rows.length > 0) {
      throw new AppError("You have already reviewed this book.", 409);
    }

    const result = await pool.query(
      `INSERT INTO reviews (book_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING id, rating, comment, created_at`,
      [bookId, req.user!.userId, ratingNum, comment?.trim() || null]
    );

    res.status(201).json({ review: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/admin/reviews  (moderation view — every review, newest first)
 * DELETE /api/books/:bookId/reviews/:reviewId  (admin removes a review)
 * These live alongside the customer-facing review endpoints since they
 * operate on the same table.
 */
export async function listAllReviewsForAdmin(_req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              b.id AS book_id, b.title AS book_title,
              u.name AS reviewer_name, u.email AS reviewer_email
       FROM reviews r
       JOIN books b ON b.id = r.book_id
       JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`
    );
    res.json({
      reviews: result.rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        comment: row.comment,
        createdAt: row.created_at,
        book: { id: row.book_id, title: row.book_title },
        reviewer: { name: row.reviewer_name, email: row.reviewer_email },
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteReviewAsAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { reviewId } = req.params;
    if (!isValidUuid(reviewId)) throw new AppError("Invalid review ID.", 400);
    const result = await pool.query("DELETE FROM reviews WHERE id = $1 RETURNING id", [reviewId]);
    if (result.rows.length === 0) throw new AppError("Review not found.", 404);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}