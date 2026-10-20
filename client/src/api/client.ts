const BASE_URL = "/api";

export class ApiError extends Error {
  status: number;
  /** Full JSON error body, e.g. the price-change details on a 409 checkout. */
  data?: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: "include", // send the httpOnly auth cookie
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, res.status, body);
  }

  return body as T;
}

// The server caps /books at 50 results per page, so anything that needs the
// whole catalog (admin pages, the store-owner book picker) has to walk the pages.
const BOOKS_PAGE_SIZE = 50;
const MAX_BOOK_PAGES = 200; // safety stop (10,000 books)

/**
 * Fetches every page of GET /books and returns all books in order.
 * `query` is extra query-string parameters, e.g. "sort=title".
 */
export async function fetchAllBooks<T>(query = "sort=title"): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await request<{ books: T[]; pagination?: { totalPages?: number } }>(
      `/books?${query}&limit=${BOOKS_PAGE_SIZE}&page=${page}`
    );
    all.push(...res.books);
    totalPages = res.pagination?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages && page <= MAX_BOOK_PAGES);
  return all;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
