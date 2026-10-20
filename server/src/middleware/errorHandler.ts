import { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// PostgreSQL error codes mapped to client-safe responses. Messages are fixed
// strings: the database's own message/detail can contain table names, values
// and constraint names, so it is never sent to the client.
const PG_ERROR_MAP: Record<string, { status: number; message: string }> = {
  "23505": { status: 409, message: "A record with that value already exists." },
  "23503": {
    status: 409,
    message: "The request refers to a record that does not exist, or the record is still in use by other data.",
  },
  "23514": { status: 422, message: "One of the submitted values is not allowed." },
  "23502": { status: 422, message: "A required value is missing." },
  "22P02": { status: 422, message: "One of the submitted values has an invalid format." },
  "22003": { status: 422, message: "One of the submitted numbers is out of range." },
  "22001": { status: 422, message: "One of the submitted values is too long." },
};

function logError(err: any): void {
  if (process.env.NODE_ENV === "production") {
    // No stack traces or raw objects (they may include query text or values).
    console.error("Error:", {
      name: err?.name,
      code: err?.code,
      message: typeof err?.message === "string" ? err.message.slice(0, 300) : undefined,
    });
  } else {
    console.error("Error:", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Malformed / oversized request bodies (raised by express.json / body-parser).
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "The request body is not valid JSON." });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "The request body is too large." });
    return;
  }
  const status = Number(err?.status ?? err?.statusCode);
  if (typeof err?.type === "string" && status >= 400 && status < 500) {
    res.status(status).json({ error: "The request could not be processed." });
    return;
  }

  const mapped = typeof err?.code === "string" ? PG_ERROR_MAP[err.code] : undefined;
  if (mapped) {
    res.status(mapped.status).json({ error: mapped.message });
    return;
  }

  logError(err);
  res.status(500).json({ error: "Internal server error." });
}
