import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";
import {
  OPEN_STATUSES,
  MAX_OPEN_REQUESTS,
  MAX_REQUESTS_PER_24H,
  REQUEST_STATUSES,
  isCustomerCancellable,
  validateCreateRequest,
  parsePage,
  paginationOf,
} from "../utils/bookRequests";

/**
 * Customer book requests. Every query is scoped to req.user.userId; a request
 * that belongs to someone else is reported as 404 so its existence is hidden.
 * Customers only ever receive status plus response/offer COUNTS: no store
 * identities, store notes or admin notes. Nothing here is cached (private data).
 */

function serializeForCustomer(row: any) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    notes: row.notes,
    status: row.status,
    responseCount: Number(row.response_count ?? 0),
    offerCount: Number(row.offer_count ?? 0),
    canCancel: isCustomerCancellable(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CUSTOMER_SELECT = `
  SELECT r.id, r.title, r.author, r.isbn, r.notes, r.status, r.created_at, r.updated_at,
         (SELECT COUNT(*) FROM book_request_responses x WHERE x.request_id = r.id) AS response_count,
         (SELECT COUNT(*) FROM book_request_responses x WHERE x.request_id = r.id AND x.response = 'CAN_SUPPLY') AS offer_count
  FROM book_requests r`;

/** POST /api/book-requests */
export async function createBookRequest(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const data = validateCreateRequest(req.body);
    const userId = req.user!.userId;

    await client.query("BEGIN");
    // Serialize this customer's submissions so two parallel requests cannot
    // both slip past the 10-open / 5-per-24h counts.
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);

    const counts = await client.query(
      `SELECT COUNT(*) FILTER (WHERE status = ANY($2::text[])) AS open_count,
              COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS recent_count
       FROM book_requests WHERE user_id = $1`,
      [userId, OPEN_STATUSES]
    );
    if (Number(counts.rows[0].open_count) >= MAX_OPEN_REQUESTS) {
      throw new AppError(`You can have at most ${MAX_OPEN_REQUESTS} open requests. Cancel one or wait for a response.`, 429);
    }
    if (Number(counts.rows[0].recent_count) >= MAX_REQUESTS_PER_24H) {
      throw new AppError(`You can submit at most ${MAX_REQUESTS_PER_24H} new requests in 24 hours. Please try again later.`, 429);
    }

    if (data.isbn) {
      const inCatalog = await client.query("SELECT 1 FROM books WHERE isbn = $1 LIMIT 1", [data.isbn]);
      if (inCatalog.rows.length > 0) throw new AppError("This book is already in the catalog.", 409);
    }

    const dup = data.isbn
      ? await client.query(
          "SELECT 1 FROM book_requests WHERE user_id = $1 AND isbn = $2 AND status = ANY($3::text[])",
          [userId, data.isbn, OPEN_STATUSES]
        )
      : await client.query(
          `SELECT 1 FROM book_requests WHERE user_id = $1 AND isbn IS NULL
             AND title_normalized = $2 AND author_normalized = $3 AND status = ANY($4::text[])`,
          [userId, data.titleNormalized, data.authorNormalized, OPEN_STATUSES]
        );
    if (dup.rows.length > 0) throw new AppError("You already have an open request for this book.", 409);

    const inserted = await client.query(
      `INSERT INTO book_requests (user_id, title, author, isbn, title_normalized, author_normalized, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, data.title, data.author, data.isbn, data.titleNormalized, data.authorNormalized, data.notes]
    );
    await client.query("COMMIT");

    const row = (await pool.query(`${CUSTOMER_SELECT} WHERE r.id = $1`, [inserted.rows[0].id])).rows[0];
    res.status(201).json({ request: serializeForCustomer(row) });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    // Unique-index backstop for the duplicate rule.
    if (err?.code === "23505") return next(new AppError("You already have an open request for this book.", 409));
    next(err);
  } finally {
    client.release();
  }
}

/** GET /api/book-requests?status=&page=&limit= */
export async function listMyBookRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !REQUEST_STATUSES.includes(status as any)) throw new AppError("Invalid status filter.", 400);

    const params: unknown[] = [req.user!.userId];
    let where = "WHERE r.user_id = $1";
    if (status) {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }
    const total = Number((await pool.query(`SELECT COUNT(*) FROM book_requests r ${where}`, params)).rows[0].count);
    const rows = await pool.query(
      `${CUSTOMER_SELECT} ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ requests: rows.rows.map(serializeForCustomer), pagination: paginationOf(total, page, limit) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/book-requests/:id */
export async function getMyBookRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid request ID.", 400);
    const r = await pool.query(`${CUSTOMER_SELECT} WHERE r.id = $1 AND r.user_id = $2`, [id, req.user!.userId]);
    if (r.rows.length === 0) throw new AppError("Book request not found.", 404);
    res.json({ request: serializeForCustomer(r.rows[0]) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/book-requests/:id/cancel */
export async function cancelMyBookRequest(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid request ID.", 400);
    await client.query("BEGIN");
    const cur = await client.query("SELECT status FROM book_requests WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, req.user!.userId]);
    if (cur.rows.length === 0) throw new AppError("Book request not found.", 404);
    if (!isCustomerCancellable(cur.rows[0].status)) {
      throw new AppError(`A request with status ${cur.rows[0].status} cannot be cancelled.`, 409);
    }
    await client.query("UPDATE book_requests SET status = 'CANCELLED', updated_at = now() WHERE id = $1", [id]);
    await client.query("COMMIT");
    const row = (await pool.query(`${CUSTOMER_SELECT} WHERE r.id = $1`, [id])).rows[0];
    res.json({ request: serializeForCustomer(row) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(err);
  } finally {
    client.release();
  }
}
