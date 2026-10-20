import { Request, Response, NextFunction } from "express";
import { verifyToken, JwtPayload } from "../utils/jwt";
import { pool } from "../db/pool";

function extractToken(req: Request): string | null {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  return req.cookies?.token || bearer;
}

/**
 * Verifies the token, then loads the user from the database so a deleted or
 * demoted account cannot keep using stale JWT permissions. The role and email
 * used for the request always come from the database, not the token.
 * Returns null if the token is invalid or the account no longer exists.
 */
async function resolveUser(token: string): Promise<JwtPayload | null> {
  let decoded: JwtPayload;
  try {
    decoded = verifyToken(token);
  } catch {
    return null;
  }
  const result = await pool.query("SELECT id, email, role FROM users WHERE id = $1", [decoded.userId]);
  const row = result.rows[0];
  if (!row) return null;
  return { userId: row.id, email: row.email, role: row.role };
}

/**
 * Reads the JWT from either the httpOnly cookie (preferred) or the
 * Authorization: Bearer header, verifies it, confirms the account still
 * exists, and attaches the current user (role from the database) to req.user.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const user = await resolveUser(token);
    if (!user) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    // Database failure: do not fall back to trusting the token.
    next(err);
  }
}

/**
 * Restricts a route to one or more roles. Must run after requireAuth.
 */
export function requireRole(...roles: Array<"customer" | "admin" | "store_owner">) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "You do not have access to this resource." });
      return;
    }
    next();
  };
}

/**
 * Attaches req.user if a valid token for an existing account is present, but
 * never blocks the request. If the database check fails the request simply
 * continues anonymously (least privilege).
 */
export async function attachUserIfPresent(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractToken(req);
  if (token) {
    try {
      const user = await resolveUser(token);
      if (user) req.user = user;
    } catch {
      // ignore in optional mode
    }
  }
  next();
}
