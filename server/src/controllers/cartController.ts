import { Request, Response, NextFunction } from "express";
import { PoolClient } from "pg";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";
import { invalidateAvailabilityCaches } from "../utils/cache";

// Anything with a .query() — the shared pool or a checked-out transaction client.
type Queryable = Pick<PoolClient, "query">;

async function getOrCreateCartId(userId: string, db: Queryable = pool): Promise<string> {
  const existing = await db.query("SELECT id FROM cart WHERE user_id = $1", [userId]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  // Two simultaneous first requests from the same new customer would both try to
  // insert (cart.user_id is UNIQUE). ON CONFLICT lets the loser fall through to
  // re-reading the row the winner created instead of failing with a 409.
  const created = await db.query(
    "INSERT INTO cart (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING id",
    [userId]
  );
  if (created.rows.length > 0) return created.rows[0].id;
  const raced = await db.query("SELECT id FROM cart WHERE user_id = $1", [userId]);
  return raced.rows[0].id;
}

/**
 * Locks this customer's cart row for the rest of the transaction. Every
 * cart-changing request (add, +/-, remove, clear, checkout) takes this lock
 * first, so two requests from the same customer can never interleave and
 * leave a reservation half-moved.
 */
async function lockCartRow(client: PoolClient, cartId: string): Promise<void> {
  await client.query("SELECT id FROM cart WHERE id = $1 FOR UPDATE", [cartId]);
}

/**
 * A "stock source" is either the legacy global inventory table
 * (storeId = null) or one store's listing in store_book_inventory.
 */
interface StockSource {
  quantity: number;
  reserved: number;
  price?: string; // store listings only
  is_active?: boolean; // store listings only (the listing itself)
  store_is_active?: boolean; // store listings only (the store; false = not accepting purchases)
}

async function lockStockSource(
  client: PoolClient,
  bookId: string,
  storeId: string | null
): Promise<StockSource | undefined> {
  if (storeId) {
    const result = await client.query(
      `SELECT sbi.price, sbi.quantity, sbi.reserved, sbi.is_active, s.is_active AS store_is_active
       FROM store_book_inventory sbi
       JOIN stores s ON s.id = sbi.store_id
       WHERE sbi.store_id = $1 AND sbi.book_id = $2 FOR UPDATE OF sbi`,
      [storeId, bookId]
    );
    return result.rows[0];
  }
  const result = await client.query(
    "SELECT quantity, reserved FROM inventory WHERE book_id = $1 FOR UPDATE",
    [bookId]
  );
  return result.rows[0];
}

/**
 * Locks the stock rows for one book in a fixed order (legacy inventory
 * first, then stores by id) so two requests touching the same sources can
 * never wait on each other in a circle (deadlock).
 */
async function lockStockSources(
  client: PoolClient,
  bookId: string,
  storeIds: (string | null)[]
): Promise<Map<string | null, StockSource | undefined>> {
  const ordered = Array.from(new Set(storeIds)).sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a < b ? -1 : 1;
  });
  const locked = new Map<string | null, StockSource | undefined>();
  for (const storeId of ordered) {
    locked.set(storeId, await lockStockSource(client, bookId, storeId));
  }
  return locked;
}

/** Adds (positive) or releases (negative) reserved copies at one stock source. */
async function changeReserved(
  client: PoolClient,
  bookId: string,
  storeId: string | null,
  delta: number
): Promise<void> {
  if (storeId) {
    await client.query(
      `UPDATE store_book_inventory
       SET reserved = GREATEST(reserved + $1, 0), last_updated = now()
       WHERE store_id = $2 AND book_id = $3`,
      [delta, storeId, bookId]
    );
  } else {
    await client.query(
      `UPDATE inventory SET reserved = GREATEST(reserved + $1, 0), updated_at = now()
       WHERE book_id = $2`,
      [delta, bookId]
    );
  }
}

function summarize(items: any[]) {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: Number(subtotal.toFixed(2)),
    total: Number(subtotal.toFixed(2)), // no tax/shipping in Phase 1
    hasPriceChanges: items.some((item) => item.priceChanged),
  };
}

async function loadCart(userId: string) {
  const cartId = await getOrCreateCartId(userId);
  const result = await pool.query(
    `SELECT
       ci.id AS cart_item_id, ci.quantity, ci.store_id, ci.store_price,
       sbi.price AS current_store_price,
       b.id AS book_id, b.title, b.author, b.price, b.cover_image_url,
       COALESCE(i.quantity - i.reserved, 0) AS available_quantity,
       s.name AS store_name, s.is_active AS store_is_active,
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
    // unitPrice is the price the customer was shown when they added the
    // line. currentPrice is what the store charges now; if they differ,
    // checkout will ask the customer to review and confirm the new price.
    const unitPrice = isStoreItem ? Number(row.store_price) : Number(row.price);
    const currentPrice =
      isStoreItem && row.current_store_price !== null ? Number(row.current_store_price) : unitPrice;
    return {
      cartItemId: row.cart_item_id,
      bookId: row.book_id,
      title: row.title,
      author: row.author,
      unitPrice,
      currentPrice,
      priceChanged: Math.round(currentPrice * 100) !== Math.round(unitPrice * 100),
      coverImageUrl: row.cover_image_url,
      quantity: row.quantity,
      availableQuantity: baseAvailable + row.quantity,
      exceedsStock: false,
      storeId: row.store_id,
      storeName: row.store_name,
      // false when this line's store has stopped accepting purchases; the
      // customer can still remove or reduce the line but cannot buy it.
      storeActive: isStoreItem ? row.store_is_active !== false : true,
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
 * POST /api/cart  { bookId, quantity, storeId? }
 * Reserves stock immediately (reserved += qty) so the "in stock" count shown
 * to other shoppers drops right away, preventing overselling on items
 * sitting in someone's cart.
 *
 * A book has one line per cart (see migrations_phase2b.sql). Adding it again
 * from the SAME source (same store, or legacy again) tops that line up.
 * Adding it from a DIFFERENT source (another store, or legacy <-> store)
 * moves the whole line to the new source: the old reservation is released
 * and the full new quantity (existing + requested) is reserved at the new
 * source, all in one transaction. If the new source can't cover it, nothing
 * changes — the cart and both stock rows stay exactly as they were.
 */
export async function addToCart(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  let committed = false;
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
    const targetStoreId: string | null = storeId || null;

    await client.query("BEGIN");
    const cartId = await getOrCreateCartId(req.user!.userId, client);
    await lockCartRow(client, cartId);

    const existingResult = await client.query(
      "SELECT id, quantity, store_id FROM cart_items WHERE cart_id = $1 AND book_id = $2 FOR UPDATE",
      [cartId, bookId]
    );
    const existing = existingResult.rows[0];
    const oldStoreId: string | null = existing ? existing.store_id || null : null;
    const isSwitch = Boolean(existing) && oldStoreId !== targetStoreId;

    // Copies that must be reserved at the target source by this request.
    // A switch carries the whole existing line over to the new source.
    const carriedQuantity = isSwitch ? existing.quantity : 0;
    const needed = qty + carriedQuantity;

    // Lock both the old and the new stock rows (in a fixed order).
    const sources = await lockStockSources(
      client,
      bookId,
      isSwitch ? [oldStoreId, targetStoreId] : [targetStoreId]
    );
    const target = sources.get(targetStoreId);

    if (targetStoreId) {
      if (!target || !target.is_active) {
        throw new AppError("This store listing is no longer available.", 404);
      }
      if (!target.store_is_active) {
        throw new AppError("This store is not currently accepting orders.", 409);
      }
      const available = target.quantity - target.reserved;
      if (needed > available) {
        throw new AppError(
          isSwitch
            ? `Only ${available} copies are available from this store, but your cart needs ${needed} (including the ${carriedQuantity} already in your cart).`
            : `Only ${available} copies are available from this store.`,
          409
        );
      }
    } else {
      if (!target) throw new AppError("Book not found.", 404);
      const available = target.quantity - target.reserved;
      if (needed > available) {
        throw new AppError(
          isSwitch
            ? `Only ${available} copies of this book are in stock, but your cart needs ${needed} (including the ${carriedQuantity} already in your cart).`
            : `Only ${available} copies of this book are in stock.`,
          409
        );
      }
    }

    // All checks passed — now write. Any failure below rolls everything back.
    if (!existing) {
      await client.query(
        "INSERT INTO cart_items (cart_id, book_id, quantity, store_id, store_price) VALUES ($1, $2, $3, $4, $5)",
        [cartId, bookId, qty, targetStoreId, targetStoreId ? target!.price : null]
      );
    } else if (isSwitch) {
      await changeReserved(client, bookId, oldStoreId, -existing.quantity);
      await client.query(
        "UPDATE cart_items SET quantity = $1, store_id = $2, store_price = $3 WHERE id = $4",
        [needed, targetStoreId, targetStoreId ? target!.price : null, existing.id]
      );
    } else {
      // Same source: top up. The price the customer was shown (store_price)
      // is deliberately NOT refreshed here, so a store price change can't be
      // slipped in unnoticed — checkout asks the customer to confirm it.
      await client.query("UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2", [
        qty,
        existing.id,
      ]);
    }
    await changeReserved(client, bookId, targetStoreId, needed);

    await client.query("COMMIT");
    committed = true;

    await invalidateAvailabilityCaches([bookId]);
    const cart = await loadCart(req.user!.userId);
    res.status(200).json(cart);
  } catch (err) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    next(err);
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/cart/:bookId  { action: "increase" | "decrease" }
 * Keeps reserved stock in sync: +1 reserved on increase, -1 on decrease (or
 * releases the whole reservation if the item is removed by decreasing from 1).
 */
export async function updateCartItemQuantity(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  let committed = false;
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);
    const { action } = req.body;

    if (action !== "increase" && action !== "decrease") {
      throw new AppError('action must be "increase" or "decrease".', 422);
    }

    await client.query("BEGIN");

    const cartId = await getOrCreateCartId(req.user!.userId, client);
    await lockCartRow(client, cartId);
    const existing = await client.query(
      "SELECT id, quantity, store_id FROM cart_items WHERE cart_id = $1 AND book_id = $2 FOR UPDATE",
      [cartId, bookId]
    );
    const item = existing.rows[0];
    if (!item) throw new AppError("Item not found in cart.", 404);
    const itemStoreId: string | null = item.store_id || null;

    if (action === "decrease") {
      if (item.quantity <= 1) {
        await client.query("DELETE FROM cart_items WHERE id = $1", [item.id]);
      } else {
        await client.query("UPDATE cart_items SET quantity = quantity - 1 WHERE id = $1", [
          item.id,
        ]);
      }
      await changeReserved(client, bookId, itemStoreId, -1);
    } else {
      const source = await lockStockSource(client, bookId, itemStoreId);
      if (itemStoreId && source && !source.store_is_active) {
        throw new AppError("This store is not currently accepting orders.", 409);
      }
      const available = source ? source.quantity - source.reserved : 0;
      if (available < 1) {
        throw new AppError(
          itemStoreId
            ? "No more copies are available from this store."
            : "No more copies of this book are in stock.",
          409
        );
      }
      await client.query("UPDATE cart_items SET quantity = quantity + 1 WHERE id = $1", [item.id]);
      await changeReserved(client, bookId, itemStoreId, 1);
    }

    await client.query("COMMIT");
    committed = true;

    await invalidateAvailabilityCaches([bookId]);
    const cart = await loadCart(req.user!.userId);
    res.json(cart);
  } catch (err) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
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
  let committed = false;
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);

    await client.query("BEGIN");

    const cartId = await getOrCreateCartId(req.user!.userId, client);
    await lockCartRow(client, cartId);
    const result = await client.query(
      "DELETE FROM cart_items WHERE cart_id = $1 AND book_id = $2 RETURNING quantity, store_id",
      [cartId, bookId]
    );
    if (result.rows.length === 0) throw new AppError("Item not found in cart.", 404);
    const removed = result.rows[0];

    await changeReserved(client, bookId, removed.store_id || null, -removed.quantity);

    await client.query("COMMIT");
    committed = true;

    await invalidateAvailabilityCaches([bookId]);
    const cart = await loadCart(req.user!.userId);
    res.json(cart);
  } catch (err) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
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
  let committed = false;
  try {
    await client.query("BEGIN");

    const cartId = await getOrCreateCartId(req.user!.userId, client);
    await lockCartRow(client, cartId);
    // Sorted by book so stock rows are always locked in the same order as checkout.
    const items = await client.query(
      "SELECT book_id, quantity, store_id FROM cart_items WHERE cart_id = $1 ORDER BY book_id",
      [cartId]
    );

    for (const item of items.rows) {
      await changeReserved(client, item.book_id, item.store_id || null, -item.quantity);
    }

    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);

    await client.query("COMMIT");
    committed = true;

    await invalidateAvailabilityCaches(items.rows.map((row) => row.book_id));
    res.json({ items: [], itemCount: 0, subtotal: 0, total: 0, hasPriceChanges: false });
  } catch (err) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    next(err);
  } finally {
    client.release();
  }
}

// Exported for use by the order controller during checkout.
export { loadCart, getOrCreateCartId, lockCartRow };
