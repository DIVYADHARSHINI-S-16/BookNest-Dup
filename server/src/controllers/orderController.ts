import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";
import { getOrCreateCartId } from "./cartController";

const ORDER_STATUSES = ["PLACED", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"];

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
  };
}

/**
 * POST /api/orders/checkout
 * body: { shippingAddress: string }
 *
 * Locks each book's inventory row, re-validates stock against the current
 * cart, creates the order + order_items, decrements inventory, and clears
 * the cart — all inside a single transaction so nothing can end up
 * half-applied.
 */
export async function checkout(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const { shippingAddress } = req.body;
    if (!shippingAddress || typeof shippingAddress !== "string" || shippingAddress.trim().length < 5) {
      throw new AppError("A valid shipping address is required.", 422);
    }

    const userId = req.user!.userId;
    const cartId = await getOrCreateCartId(userId);

    await client.query("BEGIN");

    // Lock the cart's rows against concurrent checkout attempts by the same user.
    const cartItemsResult = await client.query(
      `SELECT ci.id, ci.book_id, ci.quantity, b.title, b.price
       FROM cart_items ci
       JOIN books b ON b.id = ci.book_id
       WHERE ci.cart_id = $1
       FOR UPDATE OF ci`,
      [cartId]
    );

    if (cartItemsResult.rows.length === 0) {
      throw new AppError("Your cart is empty.", 400);
    }

    let subtotal = 0;
    const lineItems: { bookId: string; quantity: number; unitPrice: number }[] = [];

    for (const item of cartItemsResult.rows) {
      // Stock for this exact quantity was already reserved (inventory.reserved)
      // the moment it was added to the cart, so there is no separate
      // over-stock check to do here — we just lock the row before writing
      // to it so two simultaneous checkouts can't race on the same book.
      await client.query("SELECT quantity, reserved FROM inventory WHERE book_id = $1 FOR UPDATE", [
        item.book_id,
      ]);

      subtotal += Number(item.price) * item.quantity;
      lineItems.push({ bookId: item.book_id, quantity: item.quantity, unitPrice: Number(item.price) });
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
        `INSERT INTO order_items (order_id, book_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, line.bookId, line.quantity, line.unitPrice]
      );

      // Permanently deduct the purchased copies from real stock, and
      // release this cart's reservation for them at the same time (the
      // hold becomes an actual sale instead of a pending cart item).
      await client.query(
        `UPDATE inventory
         SET quantity = quantity - $1,
             reserved = GREATEST(reserved - $1, 0),
             updated_at = now()
         WHERE book_id = $2`,
        [line.quantity, line.bookId]
      );
    }

    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);

    await client.query("COMMIT");

    res.status(201).json({
      message: "Order placed successfully (mock payment).",
      order: formatOrderSummary(order),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

/** GET /api/orders — the logged-in customer's own order history */
export async function getMyOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT id, status, subtotal, total, shipping_address, payment_method, payment_status, created_at, updated_at
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
    `SELECT id, user_id, status, subtotal, total, shipping_address, payment_method, payment_status, created_at, updated_at
     FROM orders WHERE id = $1`,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await pool.query(
    `SELECT oi.id, oi.book_id, oi.quantity, oi.unit_price, b.title, b.author, b.cover_image_url
     FROM order_items oi JOIN books b ON b.id = oi.book_id
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

    res.json({ order });
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
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT o.id, o.status, o.subtotal, o.total, o.shipping_address,
              o.payment_method, o.payment_status, o.created_at, o.updated_at,
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
        customer: { name: row.customer_name, email: row.customer_email },
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/orders/:id/status — admin updates order status */
export async function updateOrderStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ORDER_STATUSES.includes(status)) {
      throw new AppError(`status must be one of: ${ORDER_STATUSES.join(", ")}`, 422);
    }

    const result = await pool.query(
      `UPDATE orders SET status = $1, updated_at = now() WHERE id = $2
       RETURNING id, status, subtotal, total, shipping_address, payment_method, payment_status, created_at, updated_at`,
      [status, id]
    );
    if (result.rows.length === 0) throw new AppError("Order not found.", 404);

    res.json({ order: formatOrderSummary(result.rows[0]) });
  } catch (err) {
    next(err);
  }
}
