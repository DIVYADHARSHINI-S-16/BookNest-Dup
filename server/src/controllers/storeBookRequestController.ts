import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";
import { OPEN_STATUSES, RESPONSE_TYPES, parsePage, paginationOf } from "../utils/bookRequests";

/**
 * Store-owner side of book requests.
 *  - The store is resolved from req.user.userId, never from client input.
 *  - Inactive stores are refused (403) for both viewing and responding.
 *  - Owners see only open requests, with no customer identity, and only their
 *    own response (never other stores' responses or notes, never admin notes).
 *  - A response can only be created/changed by the store that owns it, and only
 *    while the request is open.
 */

async function getActiveStoreOrThrow(ownerUserId: string): Promise<string> {
  const r = await pool.query("SELECT id, is_active FROM stores WHERE owner_user_id = $1", [ownerUserId]);
  if (r.rows.length === 0) throw new AppError("You need to create your store before viewing book requests.", 404);
  if (!r.rows[0].is_active) throw new AppError("Your store is inactive and cannot view or respond to book requests.", 403);
  return r.rows[0].id as string;
}

/** GET /api/stores/book-requests?responded=true|false&page=&limit= */
export async function listRequestsForStore(req: Request, res: Response, next: NextFunction) {
  try {
    const storeId = await getActiveStoreOrThrow(req.user!.userId);
    const { page, limit, offset } = parsePage(req.query);
    const responded = req.query.responded;

    const params: unknown[] = [storeId, OPEN_STATUSES];
    let where = "WHERE r.status = ANY($2::text[])";
    if (responded === "true") where += " AND my.id IS NOT NULL";
    else if (responded === "false") where += " AND my.id IS NULL";
    const from = `FROM book_requests r LEFT JOIN book_request_responses my ON my.request_id = r.id AND my.store_id = $1`;

    const total = Number((await pool.query(`SELECT COUNT(*) ${from} ${where}`, params)).rows[0].count);
    const rows = await pool.query(
      `SELECT r.id, r.title, r.author, r.isbn, r.notes, r.status, r.created_at,
              my.response AS my_response, my.note AS my_note, my.updated_at AS my_responded_at
       ${from} ${where}
       ORDER BY r.created_at DESC, r.id DESC LIMIT $3 OFFSET $4`,
      [...params, limit, offset]
    );
    res.json({
      requests: rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        isbn: r.isbn,
        notes: r.notes,
        status: r.status,
        createdAt: r.created_at,
        myResponse: r.my_response ? { response: r.my_response, note: r.my_note, respondedAt: r.my_responded_at } : null,
      })),
      pagination: paginationOf(total, page, limit),
    });
  } catch (err) {
    next(err);
  }
}

function parseResponseBody(body: any) {
  const response = body?.response;
  if (!RESPONSE_TYPES.includes(response)) throw new AppError("Response must be CAN_SUPPLY or CANNOT_SUPPLY.", 422);
  let note: string | null = null;
  if (body?.note !== undefined && body?.note !== null) {
    if (typeof body.note !== "string") throw new AppError("Note must be text.", 422);
    const n = body.note.trim();
    if (n.length > 500) throw new AppError("Note must be at most 500 characters.", 422);
    note = n || null;
  }
  return { response: response as string, note };
}

async function saveResponse(req: Request, res: Response, next: NextFunction, mode: "create" | "update") {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    if (!isValidUuid(requestId)) throw new AppError("Invalid request ID.", 400);
    const { response, note } = parseResponseBody(req.body);
    const storeId = await getActiveStoreOrThrow(req.user!.userId);

    await client.query("BEGIN");
    // FOR SHARE: blocks a concurrent cancel/status change until we commit, so a
    // response can never be added to a request that just became closed.
    const reqRow = await client.query("SELECT status FROM book_requests WHERE id = $1 FOR SHARE", [requestId]);
    if (reqRow.rows.length === 0) throw new AppError("Book request not found.", 404);
    if (!OPEN_STATUSES.includes(reqRow.rows[0].status)) {
      throw new AppError("This request is closed and no longer accepts responses.", 409);
    }

    let saved;
    if (mode === "create") {
      saved = await client.query(
        `INSERT INTO book_request_responses (request_id, store_id, response, note)
         VALUES ($1, $2, $3, $4) ON CONFLICT (request_id, store_id) DO NOTHING
         RETURNING response, note, updated_at`,
        [requestId, storeId, response, note]
      );
      if (saved.rows.length === 0) throw new AppError("Your store has already responded to this request.", 409);
    } else {
      saved = await client.query(
        `UPDATE book_request_responses SET response = $3, note = $4, updated_at = now()
         WHERE request_id = $1 AND store_id = $2 RETURNING response, note, updated_at`,
        [requestId, storeId, response, note]
      );
      if (saved.rows.length === 0) throw new AppError("Your store has not responded to this request yet.", 404);
    }
    await client.query("COMMIT");
    const s = saved.rows[0];
    res.status(mode === "create" ? 201 : 200).json({
      myResponse: { response: s.response, note: s.note, respondedAt: s.updated_at },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(err);
  } finally {
    client.release();
  }
}

/** POST /api/stores/book-requests/:requestId/response (first response only) */
export const createStoreResponse = (req: Request, res: Response, next: NextFunction) => saveResponse(req, res, next, "create");
/** PUT /api/stores/book-requests/:requestId/response (edit own response while the request is open) */
export const updateStoreResponse = (req: Request, res: Response, next: NextFunction) => saveResponse(req, res, next, "update");
