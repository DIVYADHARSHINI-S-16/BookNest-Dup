import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";

async function getOrCreateCartId(userId: string): Promise<string> {
  const existing = await pool.query("SELECT id FROM cart WHERE user_id = $1", [userId]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const created = await pool.query(
    "INSERT INTO cart (user_id) VALUES ($1) RETURNING id",
    [userId]
  );
  return created.rows[0].id;
}

function summarize(items: any[]) {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: Number(subtotal.toFixed(2)),
    total: Number(subtotal.toFixed(2)), // no tax/shipping in Phase 1
  };
}

async function loadCart(userId: string) {
  const cartId = await getOrCreateCartId(userId);
  const result = await pool.query(
    `SELECT
       ci.id AS cart_item_id, ci.quantity, ci.store_id, ci.store_price,
       b.id AS book_id, b.title, b.author, b.price, b.cover_image_url,
       COALESCE(i.quantity - i.reserved, 0) AS available_quantity,
       s.name AS store_name,
       COALESCE(sbi.quantity - sbi.reserved, 0) AS store_available_quantity
     FROM cart_items ci
     JOIN books b ON b.id = ci.book_id
     LEFT JOIN inventory i ON i.book_id = b.id
     LEFT JOIN stores s ON s.id = ci.store_id
     LEFT JOIN store_book_inventory sbi ON sbi.store_id = ci.store_id AND sbi.book_id = ci.book_id
     WHERE ci.cart_id = $1
     ORDER BY ci.added_at ASC`,
    [cartId]
  );

  // "available_quantity" here already excludes this cart's own reservation
  // (since it was subtracted from reserved), so add this item's quantity
  // back on to show the true remaining stock a customer could still add.
  // Store-sourced lines use the store's own listing stock instead of the
  // legacy global inventory table.
  const items = result.rows.map((row) => {
    const isStoreItem = Boolean(row.store_id);
    const baseAvailable = isStoreItem
      ? Number(row.store_available_quantity) || 0
      : Number(row.available_quantity) || 0;
    return {
      cartItemId: row.cart_item_id,
      bookId: row.book_id,
      title: row.title,
      author: row.author,
      unitPrice: isStoreItem ? Number(row.store_price) : Number(row.price),
      coverImageUrl: row.cover_image_url,
      quantity: row.quantity,
      availableQuantity: baseAvailable + row.quantity,
      exceedsStock: false,
      storeId: row.store_id,
      storeName: row.store_name,
    };
  });

  return { cartId, ...summarize(items) };
}

export async function getCart(req: Request, res: Response, next: NextFunction) {
  try {
    const cart = await loadCart(req.user!.userId);
    res.json(cart);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/cart  { bookId, quantity }
 * Reserves stock immediately (inventory.reserved += qty) so the "in stock"
 * count shown to other shoppers drops right away, preventing overselling
 * on items sitting in someone's cart.
 */
export async function addToCart(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const { bookId, quantity = 1, storeId } = req.body;
    const qty = Number(quantity);

    if (!bookId) throw new AppError("bookId is required.", 422);
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);
    if (!Number.isInteger(qty) || qty < 1) {
      throw new AppError("quantity must be a positive integer.", 422);
    }
    if (storeId !== undefined && storeId !== null && !isValidUuid(storeId)) {
      throw new AppError("Invalid store ID.", 400);
    }

    await client.query("BEGIN");
    const cartId = await getOrCreateCartId(req.user!.userId);

    // A book can only have one line per cart (see migrations_phase2b.sql),
    // so adding it again — from the same or a different store — tops up
    // that existing line rather than creating a second one.
    const existing = await client.query(
      "SELECT id, quantity, store_id FROM cart_items WHERE cart_id = $1 AND book_id = $2",
      [cartId, bookId]
    );

    if (storeId) {
      // Store-sourced listing: reserve against store_book_inventory, not
      // the legacy global inventory table.
      const listingResult = await client.query(
        `SELECT id, price, quantity, reserved FROM store_book_inventory
         WHERE store_id = $1 AND book_id = $2 AND is_active = true FOR UPDATE`,
        [storeId, bookId]
      );
      const listing = listingResult.rows[0];
      if (!listing) throw new AppError("This store listing is no longer available.", 404);

      const available = listing.quantity - listing.reserved;
      if (qty > available) {
        throw new AppError(`Only ${available} copies are available from this store.`, 409);
      }

      if (existing.rows.length > 0) {
        await client.query(
          "UPDATE cart_items SET quantity = quantity + $1, store_id = $2, store_price = $3 WHERE id = $4",
          [qty, storeId, listing.price, existing.rows[0].id]
        );
      } else {
        await client.query(
          "INSERT INTO cart_items (cart_id, book_id, quantity, store_id, store_price) VALUES ($1, $2, $3, $4, $5)",
          [cartId, bookId, qty, storeId, listing.price]
        );
      }

      await client.query(
        "UPDATE store_book_inventory SET reserved = reserved + $1, last_updated = now() WHERE id = $2",
        [qty, listing.id]
      );
    } else {
      // Legacy flow — unchanged.
      const invResult = await client.query(
        "SELECT quantity, reserved FROM inventory WHERE book_id = $1 FOR UPDATE",
        [bookId]
      );
      const inv = invResult.rows[0];
      if (!inv) throw new AppError("Book not found.", 404);

      const available = inv.quantity - inv.reserved;
      if (qty > available) {
        throw new AppError(`Only ${available} copies of this book are in stock.`, 409);
      }

      if (existing.rows.length > 0) {
        await client.query("UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2", [
          qty,
          existing.rows[0].id,
        ]);
      } else {
        await client.query(
          "INSERT INTO cart_items (cart_id, book_id, quantity) VALUES ($1, $2, $3)",
          [cartId, bookId, qty]
        );
      }

      await client.query(
        "UPDATE inventory SET reserved = reserved + $1, updated_at = now() WHERE book_id = $2",
        [qty, bookId]
      );
    }

    await client.query("COMMIT");

    const cart = await loadCart(req.user!.userId);
    res.status(200).json(cart);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/cart/:bookId  { action: "increase" | "decrease" }
 * Keeps inventory.reserved in sync: +1 reserved on increase, -1 on
 * decrease (or releases the whole reservation if the item is removed by
 * decreasing from 1).
 */
export async function updateCartItemQuantity(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);
    const { action } = req.body;

    if (action !== "increase" && action !== "decrease") {
      throw new AppError('action must be "increase" or "decrease".', 422);
    }

    await client.query("BEGIN");

    const cartId = await getOrCreateCartId(req.user!.userId);
    const existing = await client.query(
      "SELECT id, quantity, store_id FROM cart_items WHERE cart_id = $1 AND book_id = $2",
      [cartId, bookId]
    );
    const item = existing.rows[0];
    if (!item) throw new AppError("Item not found in cart.", 404);
    const isStoreItem = Boolean(item.store_id);

    if (action === "decrease") {
      if (item.quantity <= 1) {
        await client.query("DELETE FROM cart_items WHERE id = $1", [item.id]);
      } else {
        await client.query("UPDATE cart_items SET quantity = quantity - 1 WHERE id = $1", [
          item.id,
        ]);
      }
      if (isStoreItem) {
        await client.query(
          "UPDATE store_book_inventory SET reserved = GREATEST(reserved - 1, 0), last_updated = now() WHERE store_id = $1 AND book_id = $2",
          [item.store_id, bookId]
        );
      } else {
        await client.query(
          "UPDATE inventory SET reserved = GREATEST(reserved - 1, 0), updated_at = now() WHERE book_id = $1",
          [bookId]
        );
      }
    } else if (isStoreItem) {
      const listingResult = await client.query(
        "SELECT quantity, reserved FROM store_book_inventory WHERE store_id = $1 AND book_id = $2 FOR UPDATE",
        [item.store_id, bookId]
      );
      const listing = listingResult.rows[0];
      const available = listing ? listing.quantity - listing.reserved : 0;
      if (available < 1) {
        throw new AppError("No more copies are available from this store.", 409);
      }
      await client.query("UPDATE cart_items SET quantity = quantity + 1 WHERE id = $1", [item.id]);
      await client.query(
        "UPDATE store_book_inventory SET reserved = reserved + 1, last_updated = now() WHERE store_id = $1 AND book_id = $2",
        [item.store_id, bookId]
      );
    } else {
      const invResult = await client.query(
        "SELECT quantity, reserved FROM inventory WHERE book_id = $1 FOR UPDATE",
        [bookId]
      );
      const inv = invResult.rows[0];
      const available = inv ? inv.quantity - inv.reserved : 0;
      if (available < 1) {
        throw new AppError("No more copies of this book are in stock.", 409);
      }
      await client.query("UPDATE cart_items SET quantity = quantity + 1 WHERE id = $1", [item.id]);
      await client.query(
        "UPDATE inventory SET reserved = reserved + 1, updated_at = now() WHERE book_id = $1",
        [bookId]
      );
    }

    await client.query("COMMIT");

    const cart = await loadCart(req.user!.userId);
    res.json(cart);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/cart/:bookId
 * Releases this item's entire reservation back to available stock.
 */
export async function removeFromCart(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);

    await client.query("BEGIN");

    const cartId = await getOrCreateCartId(req.user!.userId);
    const result = await client.query(
      "DELETE FROM cart_items WHERE cart_id = $1 AND book_id = $2 RETURNING quantity, store_id",
      [cartId, bookId]
    );
    if (result.rows.length === 0) throw new AppError("Item not found in cart.", 404);
    const removed = result.rows[0];

    if (removed.store_id) {
      await client.query(
        "UPDATE store_book_inventory SET reserved = GREATEST(reserved - $1, 0), last_updated = now() WHERE store_id = $2 AND book_id = $3",
        [removed.quantity, removed.store_id, bookId]
      );
    } else {
      await client.query(
        "UPDATE inventory SET reserved = GREATEST(reserved - $1, 0), updated_at = now() WHERE book_id = $2",
        [removed.quantity, bookId]
      );
    }

    await client.query("COMMIT");

    const cart = await loadCart(req.user!.userId);
    res.json(cart);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/cart
 * Releases every reservation held by this cart, then empties it.
 */
export async function clearCart(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cartId = await getOrCreateCartId(req.user!.userId);
    const items = await client.query(
      "SELECT book_id, quantity, store_id FROM cart_items WHERE cart_id = $1",
      [cartId]
    );

    for (const item of items.rows) {
      if (item.store_id) {
        await client.query(
          "UPDATE store_book_inventory SET reserved = GREATEST(reserved - $1, 0), last_updated = now() WHERE store_id = $2 AND book_id = $3",
          [item.quantity, item.store_id, item.book_id]
        );
      } else {
        await client.query(
          "UPDATE inventory SET reserved = GREATEST(reserved - $1, 0), updated_at = now() WHERE book_id = $2",
          [item.quantity, item.book_id]
        );
      }
    }

    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);

    await client.query("COMMIT");
    res.json({ items: [], itemCount: 0, subtotal: 0, total: 0 });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

// Exported for use by the order controller during checkout.
export { loadCart, getOrCreateCartId };