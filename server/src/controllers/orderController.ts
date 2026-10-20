import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";
import { getOrCreateCartId, lockCartRow } from "./cartController";
import { invalidateAvailabilityCaches } from "../utils/cache";
import {
  ORDER_STATUSES,
  allowedNextStatuses,
  canCancelStatus,
  cancelOrderInTransaction,
  isOrderStatus,
} from "../utils/orderLifecycle";

/**
 * MOCK PAYMENT
 * ------------
 * This project does not integrate a real payment gateway. Checkout always
 * "succeeds" instantly and is recorded as payment_method = 'MOCK',
 * payment_status = 'MOCK_PAID'. No card details are collected or stored.
 */
function processMockPayment(_amount: number): { paymentMethod: string; paymentStatus: string } {
  return { paymentMethod: "MOCK", paymentStatus: "MOCK_PAID" };
}

function formatOrderSummary(row: any) {
  return {
    id: row.id,
    status: row.status,
    subtotal: Number(row.subtotal),
    total: Number(row.total),
    shippingAddress: row.shipping_address,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at ?? null,
    canCancel: canCancelStatus(row.status),
  };
}

interface PriceChange {
  bookId: string;
  title: string;
  storeId: string;
  storeName: string | null;
  quantity: number;
  previousPrice: number;
  currentPrice: number;
}

/** Thrown inside the checkout transaction to roll it back and ask the customer to re-confirm. */
class PriceChangedError extends Error {
  constructor(public priceChanges: PriceChange[], public previousTotal: number, public newTotal: number) {
    super("Some prices have changed since you added these items to your cart.");
  }
}

const toCents = (amount: number) => Math.round(amount * 100);

/**
 * Validates the optional `confirmedPrices` checkout field: the exact prices
 * the customer reviewed and agreed to after a PRICE_CHANGED response.
 */
function parseConfirmedPrices(raw: unknown): { bookId: string; storeId: string; unitPrice: number }[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AppError("confirmedPrices must be a list.", 422);
  return raw.map((entry) => {
    const { bookId, storeId, unitPrice } = (entry || {}) as Record<string, unknown>;
    if (!isValidUuid(bookId) || !isValidUuid(storeId) || typeof unitPrice !== "number" || !Number.isFinite(unitPrice)) {
      throw new AppError("Each confirmed price needs a bookId, storeId and numeric unitPrice.", 422);
    }
    return { bookId: bookId as string, storeId: storeId as string, unitPrice };
  });
}

/**
 * POST /api/orders/checkout
 * body: { shippingAddress: string, confirmedPrices?: [{ bookId, storeId, unitPrice }] }
 *
 * Locks the cart and each book's stock row, re-validates stock against the
 * current cart, creates the order + order_items, decrements stock, and
 * clears the cart — all inside a single transaction so nothing can end up
 * half-applied.
 *
 * Price safety: a store line remembers the price the customer was shown when
 * they added it. If the store's price has changed since, checkout refuses
 * with 409 { code: "PRICE_CHANGED", priceChanges, newTotal } and changes
 * nothing. The customer reviews the new prices and calls checkout again,
 * passing those prices back in `confirmedPrices`. Carts whose prices have
 * not changed need no extra field, so the normal flow is unchanged.
 */
export async function checkout(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  let committed = false;
  try {
    const { shippingAddress } = req.body;
    if (!shippingAddress || typeof shippingAddress !== "string" || shippingAddress.trim().length < 5) {
      throw new AppError("A valid shipping address is required.", 422);
    }

    const confirmedPrices = parseConfirmedPrices(req.body.confirmedPrices);

    const userId = req.user!.userId;

    await client.query("BEGIN");
    const cartId = await getOrCreateCartId(userId, client);

    // Lock the cart against concurrent cart changes / checkout attempts by
    // the same user (a duplicate click waits here, then finds an empty cart).
    await lockCartRow(client, cartId);

    // Sorted by book so every checkout locks stock rows in the same order
    // and two carts can never deadlock on each other.
    const cartItemsResult = await client.query(
      `SELECT ci.id, ci.book_id, ci.quantity, ci.store_id, ci.store_price, b.title, b.price
       FROM cart_items ci
       JOIN books b ON b.id = ci.book_id
       WHERE ci.cart_id = $1
       ORDER BY ci.book_id
       FOR UPDATE OF ci`,
      [cartId]
    );

    if (cartItemsResult.rows.length === 0) {
      throw new AppError("Your cart is empty.", 400);
    }

    let subtotal = 0;
    let previousTotal = 0;
    const unconfirmedChanges: PriceChange[] = [];
    const lineItems: {
      bookId: string;
      quantity: number;
      unitPrice: number;
      storeId: string | null;
    }[] = [];

    for (const item of cartItemsResult.rows) {
      if (item.store_id) {
        // Store-sourced line: lock the specific listing and re-validate it's
        // still active and has enough stock, since it may have changed since
        // it was added to the cart (owner deactivated it, lowered quantity,
        // or someone else's checkout raced ahead of this one).
        const listingResult = await client.query(
          `SELECT sbi.id, sbi.price, sbi.quantity, sbi.reserved, sbi.is_active,
                  s.name AS store_name, s.is_active AS store_is_active
           FROM store_book_inventory sbi
           JOIN stores s ON s.id = sbi.store_id
           WHERE sbi.store_id = $1 AND sbi.book_id = $2 FOR UPDATE OF sbi`,
          [item.store_id, item.book_id]
        );
        const listing = listingResult.rows[0];
        if (!listing || !listing.is_active) {
          throw new AppError(`"${item.title}" is no longer available from that store.`, 409);
        }
        // An inactive store accepts no new purchases. Existing orders and
        // inventory rows are untouched; the customer just has to remove the line.
        if (!listing.store_is_active) {
          throw new AppError(
            `${listing.store_name} is not currently accepting orders. Remove "${item.title}" from your cart or choose another source.`,
            409
          );
        }
        if (listing.quantity < item.quantity) {
          throw new AppError(
            `Only ${listing.quantity} copies of "${item.title}" are available from that store now.`,
            409
          );
        }

        // Price check: compare today's store price with the one the
        // customer saw in their cart. A change needs explicit confirmation.
        const shownPrice = Number(item.store_price);
        const currentPrice = Number(listing.price);
        previousTotal += shownPrice * item.quantity;
        if (toCents(shownPrice) !== toCents(currentPrice)) {
          const confirmed = confirmedPrices.some(
            (c) =>
              c.bookId === item.book_id &&
              c.storeId === item.store_id &&
              toCents(c.unitPrice) === toCents(currentPrice)
          );
          if (!confirmed) {
            unconfirmedChanges.push({
              bookId: item.book_id,
              title: item.title,
              storeId: item.store_id,
              storeName: listing.store_name,
              quantity: item.quantity,
              previousPrice: shownPrice,
              currentPrice,
            });
          }
        }

        subtotal += currentPrice * item.quantity;
        lineItems.push({
          bookId: item.book_id,
          quantity: item.quantity,
          unitPrice: currentPrice,
          storeId: item.store_id,
        });
      } else {
        // Catalog line: stock for this exact quantity was reserved
        // (inventory.reserved) when it was added to the cart. We still lock
        // the row and confirm the real quantity covers the line, so legacy
        // stock that has since fallen short (e.g. data edited before the
        // reserved-stock guard existed) gives a clear 409 instead of a
        // database check-constraint error.
        const stockResult = await client.query(
          "SELECT quantity, reserved FROM inventory WHERE book_id = $1 FOR UPDATE",
          [item.book_id]
        );
        const stock = stockResult.rows[0];
        if (!stock || stock.quantity < item.quantity) {
          const have = stock ? stock.quantity : 0;
          throw new AppError(
            `Only ${have} cop${have === 1 ? "y" : "ies"} of "${item.title}" ${have === 1 ? "is" : "are"} in stock now. Please reduce the quantity in your cart.`,
            409
          );
        }

        subtotal += Number(item.price) * item.quantity;
        previousTotal += Number(item.price) * item.quantity;
        lineItems.push({
          bookId: item.book_id,
          quantity: item.quantity,
          unitPrice: Number(item.price),
          storeId: null,
        });
      }
    }

    if (unconfirmedChanges.length > 0) {
      // Nothing has been written yet; the catch block rolls back and replies 409.
      throw new PriceChangedError(
        unconfirmedChanges,
        Number(previousTotal.toFixed(2)),
        Number(subtotal.toFixed(2))
      );
    }

    const total = subtotal; // no tax/shipping fee in Phase 1
    const { paymentMethod, paymentStatus } = processMockPayment(total);

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, status, subtotal, total, shipping_address, payment_method, payment_status)
       VALUES ($1, 'PLACED', $2, $3, $4, $5, $6)
       RETURNING id, status, subtotal, total, shipping_address, payment_method, payment_status, created_at, updated_at`,
      [userId, subtotal.toFixed(2), total.toFixed(2), shippingAddress.trim(), paymentMethod, paymentStatus]
    );
    const order = orderResult.rows[0];

    for (const line of lineItems) {
      await client.query(
        `INSERT INTO order_items (order_id, book_id, quantity, unit_price, store_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, line.bookId, line.quantity, line.unitPrice, line.storeId]
      );

      // Permanently deduct the purchased copies from real stock, and
      // release this cart's reservation for them at the same time (the
      // hold becomes an actual sale instead of a pending cart item).
      // Store-sourced lines deduct from that specific store's own listing;
      // catalog lines deduct from the shared legacy inventory table.
      if (line.storeId) {
        await client.query(
          `UPDATE store_book_inventory
           SET quantity = quantity - $1,
               reserved = GREATEST(reserved - $1, 0),
               last_updated = now()
           WHERE store_id = $2 AND book_id = $3`,
          [line.quantity, line.storeId, line.bookId]
        );
      } else {
        await client.query(
          `UPDATE inventory
           SET quantity = quantity - $1,
               reserved = GREATEST(reserved - $1, 0),
               updated_at = now()
           WHERE book_id = $2`,
          [line.quantity, line.bookId]
        );
      }
    }

    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);

    await client.query("COMMIT");
    committed = true;

    await invalidateAvailabilityCaches(lineItems.map((line) => line.bookId));

    res.status(201).json({
      message: "Order placed successfully (mock payment).",
      order: formatOrderSummary(order),
    });
  } catch (err) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof PriceChangedError) {
      res.status(409).json({
        error: err.message,
        code: "PRICE_CHANGED",
        message: "Please review the updated prices and confirm to place your order.",
        priceChanges: err.priceChanges,
        previousTotal: err.previousTotal,
        newTotal: err.newTotal,
      });
      return;
    }
    next(err);
  } finally {
    client.release();
  }
}

/** GET /api/orders — the logged-in customer's own order history */
export async function getMyOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT id, status, subtotal, total, shipping_address, payment_method, payment_status, created_at, updated_at, cancelled_at
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user!.userId]
    );
    res.json({ orders: result.rows.map(formatOrderSummary) });
  } catch (err) {
    next(err);
  }
}

async function fetchOrderWithItems(orderId: string) {
  const orderResult = await pool.query(
    `SELECT id, user_id, status, subtotal, total, shipping_address, payment_method, payment_status, created_at, updated_at, cancelled_at
     FROM orders WHERE id = $1`,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await pool.query(
    `SELECT oi.id, oi.book_id, oi.quantity, oi.unit_price, oi.store_id,
            b.title, b.author, b.cover_image_url, s.name AS store_name
     FROM order_items oi
     JOIN books b ON b.id = oi.book_id
     LEFT JOIN stores s ON s.id = oi.store_id
     WHERE oi.order_id = $1`,
    [orderId]
  );

  return {
    ...formatOrderSummary(order),
    userId: order.user_id,
    items: itemsResult.rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      title: row.title,
      author: row.author,
      coverImageUrl: row.cover_image_url,
      quantity: row.quantity,
      unitPrice: Number(row.unit_price),
      lineTotal: Number((row.unit_price * row.quantity).toFixed(2)),
      storeId: row.store_id,
      storeName: row.store_name,
    })),
  };
}

/** GET /api/orders/:id — customers can view only their own order; admins can view any */
export async function getOrderById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid order ID.", 400);
    const order = await fetchOrderWithItems(id);
    if (!order) throw new AppError("Order not found.", 404);

    if (req.user!.role !== "admin" && order.userId !== req.user!.userId) {
      throw new AppError("You do not have access to this order.", 403);
    }

    res.json({
      order: req.user!.role === "admin" ? { ...order, allowedNextStatuses: allowedNextStatuses(order.status) } : order,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/orders/admin/all — admin view of every order, most recent first */
export async function getAllOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const { status } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const values: any[] = [];

    if (status) {
      if (!isOrderStatus(status)) throw new AppError(`status must be one of: ${ORDER_STATUSES.join(", ")}`, 400);
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT o.id, o.status, o.subtotal, o.total, o.shipping_address,
              o.payment_method, o.payment_status, o.created_at, o.updated_at, o.cancelled_at,
              u.name AS customer_name, u.email AS customer_email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ${whereClause}
       ORDER BY o.created_at DESC`,
      values
    );

    res.json({
      orders: result.rows.map((row) => ({
        ...formatOrderSummary(row),
        allowedNextStatuses: allowedNextStatuses(row.status),
        customer: { name: row.customer_name, email: row.customer_email },
      })),
    });
  } catch (err) {
    next(err);
  }
}

const ORDER_RETURNING =
  "id, status, subtotal, total, shipping_address, payment_method, payment_status, created_at, updated_at, cancelled_at";

/**
 * Locks the order row, applies `apply` inside one transaction and commits. Used by both
 * cancellation entry points so they share one code path. `apply` runs with the order locked
 * and returns the book ids whose availability changed (for cache invalidation).
 */
async function withLockedOrder(
  orderId: string,
  apply: (client: any, order: any) => Promise<{ bookIds: string[]; unrestoredLines: number }>
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT id, user_id, status FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (locked.rows.length === 0) throw new AppError("Order not found.", 404);
    const result = await apply(client, locked.rows[0]);
    const fresh = await client.query(`SELECT ${ORDER_RETURNING} FROM orders WHERE id = $1`, [orderId]);
    await client.query("COMMIT");
    return { order: fresh.rows[0], ...result };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * POST /api/orders/:id/cancel — a customer cancels their own order.
 * 400 bad id, 403 someone else's order, 404 unknown, 409 not cancellable (already cancelled
 * or already packed/shipped/delivered). Repeating or racing the request restores stock once.
 */
export async function cancelMyOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid order ID.", 400);
    const out = await withLockedOrder(id, async (client, order) => {
      if (order.user_id !== req.user!.userId) throw new AppError("You do not have access to this order.", 403);
      if (!canCancelStatus(order.status)) {
        throw new AppError(
          order.status === "CANCELLED"
            ? "This order has already been cancelled."
            : `An order that is ${order.status} can no longer be cancelled.`,
          409
        );
      }
      return cancelOrderInTransaction(client, id);
    });
    await invalidateAvailabilityCaches(out.bookIds);
    res.json({ message: "Order cancelled and stock restored.", order: formatOrderSummary(out.order), unrestoredLines: out.unrestoredLines });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/orders/:id/status — administrator moves an order along ORDER_TRANSITIONS.
 * Setting CANCELLED runs the same transactional cancel + stock restoration as the customer endpoint.
 */
export async function updateOrderStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { status } = req.body ?? {};
    if (!isValidUuid(id)) throw new AppError("Invalid order ID.", 400);
    if (!isOrderStatus(status)) {
      throw new AppError(`status must be one of: ${ORDER_STATUSES.join(", ")}`, 422);
    }

    const out = await withLockedOrder(id, async (client, order) => {
      if (!allowedNextStatuses(order.status).includes(status)) {
        throw new AppError(`Cannot change an order from ${order.status} to ${status}.`, 409);
      }
      if (status === "CANCELLED") return cancelOrderInTransaction(client, id);
      await client.query("UPDATE orders SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
      return { bookIds: [] as string[], unrestoredLines: 0 };
    });
    if (out.bookIds.length > 0) await invalidateAvailabilityCaches(out.bookIds);
    res.json({
      order: { ...formatOrderSummary(out.order), allowedNextStatuses: allowedNextStatuses(out.order.status) },
      unrestoredLines: out.unrestoredLines,
    });
  } catch (err) {
    next(err);
  }
}
