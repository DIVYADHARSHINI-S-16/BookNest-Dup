import { AppError } from "../middleware/errorHandler";
import { normalizeIsbn } from "./validation";

export const REQUEST_STATUSES = ["PENDING", "SUPPLIER_FOUND", "FULFILLED", "UNAVAILABLE", "CANCELLED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const RESPONSE_TYPES = ["CAN_SUPPLY", "CANNOT_SUPPLY"] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

/** Statuses that count as "open": they count toward the 10-open limit, block duplicates, and accept store responses. */
export const OPEN_STATUSES: RequestStatus[] = ["PENDING", "SUPPLIER_FOUND"];
export const MAX_OPEN_REQUESTS = 10;
export const MAX_REQUESTS_PER_24H = 5;

/** Allowed admin status changes. FULFILLED, UNAVAILABLE and CANCELLED are final. */
export const STATUS_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  PENDING: ["SUPPLIER_FOUND", "UNAVAILABLE", "CANCELLED"],
  SUPPLIER_FOUND: ["PENDING", "FULFILLED", "UNAVAILABLE", "CANCELLED"],
  FULFILLED: [],
  UNAVAILABLE: [],
  CANCELLED: [],
};

/** Customers may cancel only open requests. */
export function isCustomerCancellable(status: string): boolean {
  return OPEN_STATUSES.includes(status as RequestStatus);
}

export function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
}

export function validateCreateRequest(body: any) {
  const errors: string[] = [];
  const title = cleanText(body?.title);
  const author = cleanText(body?.author);
  if (title.length < 2 || title.length > 255) errors.push("Title must be 2 to 255 characters.");
  if (author.length < 2 || author.length > 160) errors.push("Author must be 2 to 160 characters.");

  const isbn = normalizeIsbn(body?.isbn);
  if (!isbn.ok) errors.push("ISBN must be 10 or 13 characters (digits, last may be X).");

  let notes: string | null = null;
  if (body?.notes !== undefined && body?.notes !== null) {
    if (typeof body.notes !== "string") errors.push("Notes must be text.");
    else {
      const n = body.notes.trim();
      if (n.length > 1000) errors.push("Notes must be at most 1000 characters.");
      else notes = n || null;
    }
  }
  if (errors.length) throw new AppError(errors.join(" "), 422);
  return {
    title,
    author,
    isbn: (isbn as { ok: true; isbn: string | null }).isbn,
    titleNormalized: normalizeText(title),
    authorNormalized: normalizeText(author),
    notes,
  };
}

export function parsePage(query: any, defaultLimit = 20, maxLimit = 50) {
  const page = Math.max(1, Number.parseInt(String(query?.page ?? "1"), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(String(query?.limit ?? defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function paginationOf(total: number, page: number, limit: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
