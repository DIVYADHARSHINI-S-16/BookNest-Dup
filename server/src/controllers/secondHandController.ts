import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { invalidateBookCaches } from "../utils/cache";
import { isValidUuid } from "../utils/validation";

const CONDITION_GRADES = ["LIKE_NEW", "VERY_GOOD", "GOOD", "ACCEPTABLE"];

function formatCondition(row: any) {
  return {
    id: row.id,
    bookId: row.book_id,
    conditionGrade: row.condition_grade,
    conditionNotes: row.condition_notes,
    coverCondition: row.cover_condition,
    pageCondition: row.page_condition,
    visibleWear: row.visible_wear,
    additionalNotes: row.additional_notes,
    priceOverride: row.price_override !== null ? Number(row.price_override) : null,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/books/:bookId/second-hand
 * Public — customers can see the exact condition before buying.
 */
export async function getSecondHandCondition(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);

    const bookResult = await pool.query(
      "SELECT id, is_second_hand FROM books WHERE id = $1",
      [bookId]
    );
    const book = bookResult.rows[0];
    if (!book) throw new AppError("Book not found.", 404);
    if (!book.is_second_hand) {
      throw new AppError("This book is not listed as second-hand.", 400);
    }

    const result = await pool.query(
      "SELECT * FROM second_hand_conditions WHERE book_id = $1",
      [bookId]
    );
    if (result.rows.length === 0) {
      throw new AppError("No condition details have been added for this book yet.", 404);
    }

    res.json({ condition: formatCondition(result.rows[0]) });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/books/:bookId/second-hand
 * Admin only — create or update the single condition record for a book.
 * Also flips books.is_second_hand = true so the flag and the detail record
 * can't drift apart.
 */
export async function upsertSecondHandCondition(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);
    const {
      conditionGrade,
      conditionNotes,
      coverCondition,
      pageCondition,
      visibleWear,
      additionalNotes,
      priceOverride,
    } = req.body;

    if (!CONDITION_GRADES.includes(conditionGrade)) {
      throw new AppError(`conditionGrade must be one of: ${CONDITION_GRADES.join(", ")}`, 422);
    }
    if (
      priceOverride !== undefined &&
      priceOverride !== null &&
      (Number.isNaN(Number(priceOverride)) || Number(priceOverride) < 0)
    ) {
      throw new AppError("priceOverride must be a non-negative number.", 422);
    }

    const bookResult = await pool.query("SELECT id FROM books WHERE id = $1", [bookId]);
    if (bookResult.rows.length === 0) throw new AppError("Book not found.", 404);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query("UPDATE books SET is_second_hand = true WHERE id = $1", [bookId]);

      const existing = await client.query(
        "SELECT id FROM second_hand_conditions WHERE book_id = $1",
        [bookId]
      );

      let result;
      if (existing.rows.length > 0) {
        result = await client.query(
          `UPDATE second_hand_conditions SET
             condition_grade = $1, condition_notes = $2, cover_condition = $3,
             page_condition = $4, visible_wear = $5, additional_notes = $6,
             price_override = $7, updated_at = now()
           WHERE book_id = $8
           RETURNING *`,
          [
            conditionGrade,
            conditionNotes || null,
            coverCondition || null,
            pageCondition || null,
            visibleWear || null,
            additionalNotes || null,
            priceOverride ?? null,
            bookId,
          ]
        );
      } else {
        result = await client.query(
          `INSERT INTO second_hand_conditions
             (book_id, condition_grade, condition_notes, cover_condition, page_condition, visible_wear, additional_notes, price_override)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            bookId,
            conditionGrade,
            conditionNotes || null,
            coverCondition || null,
            pageCondition || null,
            visibleWear || null,
            additionalNotes || null,
            priceOverride ?? null,
          ]
        );
      }

      await client.query("COMMIT");
      await invalidateBookCaches(bookId);
      res.status(200).json({ condition: formatCondition(result.rows[0]) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/books/:bookId/second-hand
 * Admin only — remove condition details and un-mark the book as second-hand.
 */
export async function deleteSecondHandCondition(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM second_hand_conditions WHERE book_id = $1", [bookId]);
      await client.query("UPDATE books SET is_second_hand = false WHERE id = $1", [bookId]);
      await client.query("COMMIT");
      await invalidateBookCaches(bookId);
      res.status(204).send();
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}
