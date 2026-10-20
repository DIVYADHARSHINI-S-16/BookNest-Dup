import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";

/**
 * Store-owner order visibility (read-only).
 *
 * Access control lives entirely here and in the route middleware:
 *  - the store is resolved from req.user!.userId (never from client input),
 *  - every query filters order_items by that store's id, so an owner can only
 *    ever see the lines their own store sold,
 *  - an order with none of the owner's lines is reported as "not found", so
 *    its existence is never revealed.
 *
 * Privacy: customers are exposed to the owner only as a name plus the order's
 * shipping address (needed to fulfil it). No email, user id, payment details,
 * whole-order totals, other stores' lines or legacy (store_id IS NULL) lines
 * are ever returned.
 */

async function getOwnStoreIdOrThrow(ownerUserId: string): Promise<string> {
  const result = await pool.query("SELECT id FROM stores WHERE owner_user_id = $1", [ownerUserId]);
  if (result.rows.length === 0) {
    throw new AppError("You need to create your store before viewing orders.", 404);
  }
  return result.rows[0].id as string;
}

/**
 * Loads this store's lines for the given orders and groups them per order,
 * keeping the order of `orderIds`. Money is computed in SQL (NUMERIC) so
 * there is no floating-point drift on line totals.
 */
async function loadStoreOrders(storeId: string, orderIds: string[]) {
  if (orderIds.length === 0) return [];

  const result = await pool.query(
    `SELECT o.id AS order_id, o.status, o.shipping_address, o.created_at,
            u.name AS customer_name,
            oi.id AS item_id, oi.book_id, oi.quantity, oi.unit_price,
            (oi.quantity * oi.unit_price) AS line_total,
            b.title, b.author
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN users u ON u.id = o.user_id
     JOIN books b ON b.id = oi.book_id
     WHERE oi.store_id = $1 AND oi.order_id = ANY($2::uuid[])
     ORDER BY o.created_at DESC, o.id DESC, b.title, oi.id`,
    [storeId, orderIds]
  );

  const byOrder = new Map<string, any>();
  for (const row of result.rows) {
    let order = byOrder.get(row.order_id);
    if (!order) {
      order = {
        id: row.order_id,
        status: row.status,
        createdAt: row.created_at,
        customer: { name: row.customer_name, shippingAddress: row.shipping_address },
        items: [],
        storeTotalCents: 0,
      };
      byOrder.set(row.order_id, order);
    }
    const lineTotal = Number(row.line_total);
    order.items.push({
      id: row.item_id,
      bookId: row.book_id,
      title: row.title,
      author: row.author,
      quantity: row.quantity,
      unitPrice: Number(row.unit_price),
      lineTotal,
    });
    order.storeTotalCents += Math.round(lineTotal * 100);
  }

  return orderIds
    .map((id) => byOrder.get(id))
    .filter(Boolean)
    .map(({ storeTotalCents, ...order }) => ({
      ...order,
      storeTotal: storeTotalCents / 100,
    }));
}

/**
 * GET /api/stores/orders?page=1&limit=10
 * The owner's own order lines, grouped by order, newest first. Pagination is
 * per ORDER (not per line) and follows the books list convention:
 * { orders, pagination: { page, limit, total, totalPages } }.
 */
export async function getMyStoreOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const storeId = await getOwnStoreIdOrThrow(req.user!.userId);

    const { page = "1", limit = "10" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const countResult = await pool.query(
      "SELECT COUNT(DISTINCT order_id)::int AS total FROM order_items WHERE store_id = $1",
      [storeId]
    );
    const total: number = countResult.rows[0].total;

    const idResult = await pool.query(
      `SELECT o.id
       FROM orders o
       WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.store_id = $1)
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT $2 OFFSET $3`,
      [storeId, limitNum, offset]
    );
    const orders = await loadStoreOrders(
      storeId,
      idResult.rows.map((r) => r.id as string)
    );

    res.set("Cache-Control", "no-store"); // contains customer fulfilment details
    res.json({
      orders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/stores/orders/:orderId
 * Only this owner's lines of one order. 404 when the order has none of them
 * (or does not exist) so other stores' orders are indistinguishable from
 * missing ones.
 */
export async function getMyStoreOrderById(req: Request, res: Response, next: NextFunction) {
  try {
    const { orderId } = req.params;
    if (!isValidUuid(orderId)) throw new AppError("Invalid order ID.", 400);

    const storeId = await getOwnStoreIdOrThrow(req.user!.userId);
    const [order] = await loadStoreOrders(storeId, [orderId.trim().toLowerCase()]);
    if (!order) throw new AppError("Order not found.", 404);

    res.set("Cache-Control", "no-store");
    res.json({ order });
  } catch (err) {
    next(err);
  }
}
