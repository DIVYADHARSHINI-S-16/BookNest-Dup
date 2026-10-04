import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";
import { deleteCacheByPrefix } from "../utils/cache";

/**
 * All handlers below resolve the caller's store strictly from
 * req.user!.userId (never from a client-supplied store id), so a store
 * owner can only ever read or write their own store_book_inventory rows.
 * This is the backend enforcement required by the ownership rules —
 * frontend routing is a convenience only.
 */
async function getOwnStoreOrThrow(ownerUserId: string) {
  const result = await pool.query("SELECT id, name FROM stores WHERE owner_user_id = $1", [
    ownerUserId,
  ]);
  if (result.rows.length === 0) {
    throw new AppError("You need to create your store before managing inventory.", 404);
  }
  return result.rows[0];
}

function serializeListing(row: any) {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    author: row.author,
    coverImageUrl: row.cover_image_url,
    price: Number(row.price),
    quantity: row.quantity,
    reserved: row.reserved,
    availableQuantity: Math.max(row.quantity - row.reserved, 0),
    isActive: row.is_active,
    updatedAt: row.last_updated,
  };
}

async function invalidateListingCaches(bookId: string) {
  // Store availability is shown as part of a book's detail page, so clear
  // both the dedicated listings cache and the book detail cache for it.
  await deleteCacheByPrefix(`book:store-listings:${bookId}`);
  await deleteCacheByPrefix(`book:detail:${bookId}`);
}

/** GET /api/stores/inventory — the logged-in owner's own store inventory */
export async function getMyStoreInventory(req: Request, res: Response, next: NextFunction) {
  try {
    const store = await getOwnStoreOrThrow(req.user!.userId);

    const result = await pool.query(
      `SELECT sbi.id, sbi.book_id, sbi.price, sbi.quantity, sbi.reserved, sbi.is_active, sbi.last_updated,
              b.title, b.author, b.cover_image_url
       FROM store_book_inventory sbi
       JOIN books b ON b.id = sbi.book_id
       WHERE sbi.store_id = $1
       ORDER BY sbi.last_updated DESC`,
      [store.id]
    );

    res.json({ storeId: store.id, inventory: result.rows.map(serializeListing) });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/stores/inventory  { bookId, price, quantity }
 * Adds an existing BookNest book to the owner's store with a store-specific
 * price and quantity. Never creates a new book record.
 */
export async function addStoreInventoryItem(req: Request, res: Response, next: NextFunction) {
  try {
    const store = await getOwnStoreOrThrow(req.user!.userId);
    const { bookId, price, quantity } = req.body;

    if (!bookId || !isValidUuid(bookId)) {
      throw new AppError("A valid bookId is required.", 422);
    }
    if (price === undefined || Number.isNaN(Number(price)) || Number(price) < 0) {
      throw new AppError("A valid, non-negative price is required.", 422);
    }
    const qty = quantity === undefined ? 0 : Number(quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      throw new AppError("A valid, non-negative quantity is required.", 422);
    }

    const bookResult = await pool.query("SELECT id FROM books WHERE id = $1", [bookId]);
    if (bookResult.rows.length === 0) throw new AppError("Book not found.", 404);

    const existing = await pool.query(
      "SELECT id FROM store_book_inventory WHERE store_id = $1 AND book_id = $2",
      [store.id, bookId]
    );
    if (existing.rows.length > 0) {
      throw new AppError("This book is already listed in your store. Edit it instead.", 409);
    }

    const result = await pool.query(
      `INSERT INTO store_book_inventory (store_id, book_id, price, quantity, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [store.id, bookId, Number(price), qty]
    );

    await invalidateListingCaches(bookId);
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/stores/inventory/:bookId  { price?, quantity?, isActive? }
 * Partial update — only the fields provided are changed. Scoped to the
 * caller's own store via the WHERE clause below.
 */
export async function updateStoreInventoryItem(req: Request, res: Response, next: NextFunction) {
  try {
    const store = await getOwnStoreOrThrow(req.user!.userId);
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);

    const { price, quantity, isActive } = req.body;

    const existing = await pool.query(
      "SELECT * FROM store_book_inventory WHERE store_id = $1 AND book_id = $2",
      [store.id, bookId]
    );
    const listing = existing.rows[0];
    if (!listing) throw new AppError("This book is not listed in your store.", 404);

    const nextPrice = price !== undefined ? Number(price) : Number(listing.price);
    if (Number.isNaN(nextPrice) || nextPrice < 0) {
      throw new AppError("Price must be a valid, non-negative number.", 422);
    }

    const nextQuantity = quantity !== undefined ? Number(quantity) : listing.quantity;
    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
      throw new AppError("Quantity must be a valid, non-negative whole number.", 422);
    }
    if (nextQuantity < listing.reserved) {
      throw new AppError(
        `Quantity can't be less than ${listing.reserved}, the amount currently reserved in customer carts.`,
        422
      );
    }

    const nextIsActive = isActive !== undefined ? Boolean(isActive) : listing.is_active;

    const result = await pool.query(
      `UPDATE store_book_inventory
       SET price = $1, quantity = $2, is_active = $3, last_updated = now()
       WHERE id = $4
       RETURNING id`,
      [nextPrice, nextQuantity, nextIsActive, listing.id]
    );

    await invalidateListingCaches(bookId);
    res.json({ id: result.rows[0].id });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/stores/inventory/:bookId
 * Removes the listing outright. Blocked while customers have copies of it
 * reserved in an active cart — the owner should deactivate it instead so
 * those carts don't break; once nothing is reserved, removal is safe.
 */
export async function removeStoreInventoryItem(req: Request, res: Response, next: NextFunction) {
  try {
    const store = await getOwnStoreOrThrow(req.user!.userId);
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);

    const existing = await pool.query(
      "SELECT id, reserved FROM store_book_inventory WHERE store_id = $1 AND book_id = $2",
      [store.id, bookId]
    );
    const listing = existing.rows[0];
    if (!listing) throw new AppError("This book is not listed in your store.", 404);

    if (listing.reserved > 0) {
      throw new AppError(
        "This listing has copies reserved in customer carts. Deactivate it instead of removing it.",
        409
      );
    }

    await pool.query("DELETE FROM store_book_inventory WHERE id = $1", [listing.id]);
    await invalidateListingCaches(bookId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
