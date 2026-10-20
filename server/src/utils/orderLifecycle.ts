import { PoolClient } from "pg";
import { AppError } from "../middleware/errorHandler";

export const ORDER_STATUSES = ["PLACED", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The only forward moves an administrator can make. DELIVERED and CANCELLED are final;
 * nothing moves backwards. Cancelling is allowed only before the order is packed.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

/** Statuses from which an order may be cancelled (by its customer or an administrator). */
export const CANCELLABLE_STATUSES: OrderStatus[] = ["PLACED", "CONFIRMED"];

export const isOrderStatus = (v: unknown): v is OrderStatus => typeof v === "string" && (ORDER_STATUSES as readonly string[]).includes(v);
export const canCancelStatus = (status: string): boolean => (CANCELLABLE_STATUSES as string[]).includes(status);
export const allowedNextStatuses = (status: string): OrderStatus[] => ORDER_TRANSITIONS[status as OrderStatus] ?? [];

export interface CancelResult {
  bookIds: string[];
  /** Lines whose stock row no longer exists (listing or inventory row deleted), so nothing could be restored. */
  unrestoredLines: number;
}

/**
 * Cancels an order and puts its stock back. MUST be called inside an open transaction
 * (BEGIN already issued) on `client`, with the order row already locked FOR UPDATE and
 * its current status verified as cancellable by the caller. The caller commits.
 *
 * Exactly-once: the status flip is guarded by `status IN (cancellable) AND stock_restored_at IS NULL`,
 * so even if a caller skipped the lock, only one transaction can win that UPDATE; the stock is
 * restored only by the winner. Because everything runs in the caller's transaction, any failure
 * rolls back the status change and every stock change together.
 *
 * Stock model (mirrors checkout): a line with store_id restores to that store's
 * store_book_inventory.quantity; a line with NULL store_id restores to legacy inventory.quantity.
 * `reserved` is not touched: checkout already released it when the order was placed.
 */
export async function cancelOrderInTransaction(client: PoolClient, orderId: string): Promise<CancelResult> {
  const flipped = await client.query(
    `UPDATE orders
        SET status = 'CANCELLED', cancelled_at = now(), stock_restored_at = now(),
            payment_status = 'MOCK_REFUNDED', updated_at = now()
      WHERE id = $1 AND status = ANY($2::text[]) AND stock_restored_at IS NULL`,
    [orderId, CANCELLABLE_STATUSES]
  );
  if (flipped.rowCount !== 1) {
    throw new AppError("This order can no longer be cancelled.", 409);
  }

  // Aggregate per stock row and lock in the same order checkout does (book_id first) so
  // concurrent checkouts and cancellations cannot deadlock on each other.
  const lines = await client.query(
    `SELECT book_id, store_id, SUM(quantity)::int AS quantity
       FROM order_items WHERE order_id = $1
      GROUP BY book_id, store_id
      ORDER BY book_id, store_id NULLS FIRST`,
    [orderId]
  );

  let unrestoredLines = 0;
  for (const line of lines.rows) {
    const updated = line.store_id
      ? await client.query(
          `UPDATE store_book_inventory SET quantity = quantity + $1, last_updated = now()
            WHERE store_id = $2 AND book_id = $3`,
          [line.quantity, line.store_id, line.book_id]
        )
      : await client.query(
          `UPDATE inventory SET quantity = quantity + $1, updated_at = now() WHERE book_id = $2`,
          [line.quantity, line.book_id]
        );
    if (updated.rowCount === 0) unrestoredLines += 1;
  }
  return { bookIds: lines.rows.map((l: any) => l.book_id as string), unrestoredLines };
}
