import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";
import { REQUEST_STATUSES, STATUS_TRANSITIONS, RequestStatus, parsePage, paginationOf } from "../utils/bookRequests";

/** Admin-only (the router enforces requireRole("admin")). Admin notes never appear in any non-admin endpoint. */

function serializeAdmin(r: any) {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    isbn: r.isbn,
    notes: r.notes,
    status: r.status,
    adminNotes: r.admin_notes,
    customer: { id: r.user_id, name: r.customer_name, email: r.customer_email },
    responseCount: Number(r.response_count ?? 0),
    offerCount: Number(r.offer_count ?? 0),
    allowedNextStatuses: STATUS_TRANSITIONS[r.status as RequestStatus] ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const ADMIN_SELECT = `
  SELECT r.*, u.name AS customer_name, u.email AS customer_email,
         (SELECT COUNT(*) FROM book_request_responses x WHERE x.request_id = r.id) AS response_count,
         (SELECT COUNT(*) FROM book_request_responses x WHERE x.request_id = r.id AND x.response = 'CAN_SUPPLY') AS offer_count
  FROM book_requests r JOIN users u ON u.id = r.user_id`;

/** GET /api/admin/book-requests?status=&q=&page=&limit= */
export async function listBookRequestsAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    if (status && !REQUEST_STATUSES.includes(status as any)) throw new AppError("Invalid status filter.", 400);
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";

    const params: unknown[] = [];
    const conds: string[] = [];
    if (status) {
      params.push(status);
      conds.push(`r.status = $${params.length}`);
    }
    if (q) {
      // Escape LIKE wildcards so user text is matched literally.
      params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
      conds.push(`(r.title ILIKE $${params.length} OR r.author ILIKE $${params.length} OR r.isbn ILIKE $${params.length})`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const total = Number((await pool.query(`SELECT COUNT(*) FROM book_requests r ${where}`, params)).rows[0].count);
    const rows = await pool.query(
      `${ADMIN_SELECT} ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ requests: rows.rows.map(serializeAdmin), pagination: paginationOf(total, page, limit) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/book-requests/:id  (request plus every store response, including store notes) */
export async function getBookRequestAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid request ID.", 400);
    const r = await pool.query(`${ADMIN_SELECT} WHERE r.id = $1`, [id]);
    if (r.rows.length === 0) throw new AppError("Book request not found.", 404);
    const resp = await pool.query(
      `SELECT x.id, x.response, x.note, x.created_at, x.updated_at, s.id AS store_id, s.name AS store_name, s.city
       FROM book_request_responses x JOIN stores s ON s.id = x.store_id
       WHERE x.request_id = $1 ORDER BY x.created_at`,
      [id]
    );
    res.json({
      request: serializeAdmin(r.rows[0]),
      responses: resp.rows.map((x) => ({
        id: x.id,
        storeId: x.store_id,
        storeName: x.store_name,
        city: x.city,
        response: x.response,
        note: x.note,
        createdAt: x.created_at,
        updatedAt: x.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/book-requests/:id  body: { status?, adminNotes? } */
export async function updateBookRequestAdmin(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid request ID.", 400);
    const { status, adminNotes } = req.body ?? {};
    if (status === undefined && adminNotes === undefined) throw new AppError("Provide a status and/or adminNotes.", 422);
    if (status !== undefined && !REQUEST_STATUSES.includes(status)) throw new AppError("Invalid status.", 422);
    let notes: string | null | undefined;
    if (adminNotes !== undefined) {
      if (adminNotes !== null && typeof adminNotes !== "string") throw new AppError("adminNotes must be text.", 422);
      const t = adminNotes === null ? "" : adminNotes.trim();
      if (t.length > 2000) throw new AppError("adminNotes must be at most 2000 characters.", 422);
      notes = t || null;
    }

    await client.query("BEGIN");
    const cur = await client.query("SELECT status FROM book_requests WHERE id = $1 FOR UPDATE", [id]);
    if (cur.rows.length === 0) throw new AppError("Book request not found.", 404);
    const from = cur.rows[0].status as RequestStatus;
    if (status !== undefined && status !== from && !STATUS_TRANSITIONS[from].includes(status)) {
      throw new AppError(`Cannot change status from ${from} to ${status}.`, 409);
    }
    const nextStatus = status ?? from;
    await client.query(
      `UPDATE book_requests SET status = $2, admin_notes = CASE WHEN $3::boolean THEN $4::text ELSE admin_notes END, updated_at = now()
       WHERE id = $1`,
      [id, nextStatus, notes !== undefined, notes ?? null]
    );
    await client.query("COMMIT");
    const row = (await pool.query(`${ADMIN_SELECT} WHERE r.id = $1`, [id])).rows[0];
    res.json({ request: serializeAdmin(row) });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    // Re-opening a request can collide with a newer open duplicate (unique index).
    if (err?.code === "23505") return next(new AppError("The customer already has another open request for this book.", 409));
    next(err);
  } finally {
    client.release();
  }
}
