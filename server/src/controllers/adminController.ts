import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";

const LOW_STOCK_THRESHOLD = 5;

/**
 * GET /api/admin/dashboard
 * Every figure is a live query against Postgres — nothing here is mocked
 * or cached.
 */
export async function getDashboardStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const [
      totalBooksResult,
      totalCustomersResult,
      totalOrdersResult,
      ordersByStatusResult,
      lowStockResult,
      totalReviewsResult,
      revenueResult,
      availableInventoryResult,
      recentOrdersResult,
      popularBooksResult,
      categoryStatsResult,
    ] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM books"),
      pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'customer'"),
      pool.query("SELECT COUNT(*)::int AS count FROM orders"),
      pool.query("SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status"),
      pool.query(
        `SELECT b.id, b.title, b.author, COALESCE(i.quantity - i.reserved, 0) AS available_quantity
         FROM books b LEFT JOIN inventory i ON i.book_id = b.id
         WHERE COALESCE(i.quantity - i.reserved, 0) <= $1
         ORDER BY available_quantity ASC`,
        [LOW_STOCK_THRESHOLD]
      ),
      pool.query("SELECT COUNT(*)::int AS count FROM reviews"),
      pool.query(
        `SELECT COALESCE(SUM(total), 0) AS revenue FROM orders WHERE status != 'CANCELLED'`
      ),
      // Total copies currently sellable across the whole catalog (quantity minus cart reservations).
      pool.query(
        `SELECT COALESCE(SUM(GREATEST(i.quantity - i.reserved, 0)), 0)::int AS available
         FROM inventory i`
      ),
      // Last 5 orders with the customer's name/email, newest first.
      pool.query(
        `SELECT o.id, o.status, o.total, o.created_at, u.name AS customer_name, u.email AS customer_email
         FROM orders o
         JOIN users u ON u.id = o.user_id
         ORDER BY o.created_at DESC
         LIMIT 5`
      ),
      // Top 5 books by units sold, derived from real order_items rows.
      pool.query(
        `SELECT b.id, b.title, b.author, SUM(oi.quantity)::int AS units_sold
         FROM order_items oi
         JOIN books b ON b.id = oi.book_id
         GROUP BY b.id, b.title, b.author
         ORDER BY units_sold DESC
         LIMIT 5`
      ),
      // Per-category book count and units sold (LEFT JOINs so empty categories still show 0s).
      pool.query(
        `SELECT c.id, c.name,
                COUNT(DISTINCT b.id)::int AS book_count,
                COALESCE(SUM(oi.quantity), 0)::int AS units_sold
         FROM categories c
         LEFT JOIN books b ON b.category_id = c.id
         LEFT JOIN order_items oi ON oi.book_id = b.id
         GROUP BY c.id, c.name
         ORDER BY c.name ASC`
      ),
    ]);

    const ordersByStatus: Record<string, number> = {};
    for (const row of ordersByStatusResult.rows) {
      ordersByStatus[row.status] = row.count;
    }

    res.json({
      totalBooks: totalBooksResult.rows[0].count,
      totalCustomers: totalCustomersResult.rows[0].count,
      totalOrders: totalOrdersResult.rows[0].count,
      totalReviews: totalReviewsResult.rows[0].count,
      totalRevenue: Number(revenueResult.rows[0].revenue),
      ordersByStatus,
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      lowStockBooks: lowStockResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        author: row.author,
        availableQuantity: Number(row.available_quantity) || 0,
      })),
      availableInventory: availableInventoryResult.rows[0].available,
      recentOrders: recentOrdersResult.rows.map((row) => ({
        id: row.id,
        status: row.status,
        total: Number(row.total),
        createdAt: row.created_at,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
      })),
      popularBooks: popularBooksResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        author: row.author,
        unitsSold: row.units_sold,
      })),
      categoryStats: categoryStatsResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        bookCount: row.book_count,
        unitsSold: row.units_sold,
      })),
    });
  } catch (err) {
    next(err);
  }
}