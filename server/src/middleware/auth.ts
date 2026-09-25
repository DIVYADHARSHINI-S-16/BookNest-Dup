import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";

/**
 * Reads the JWT from either the httpOnly cookie (preferred) or the
 * Authorization: Bearer header, verifies it, and attaches the decoded
 * payload to req.user.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.token || bearer;

  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session." });
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
 * Attaches req.user if a valid token is present, but never blocks the
 * request. Useful for routes whose behavior differs slightly when the
 * caller happens to be logged in (not used by auth routes themselves).
 */
export function attachUserIfPresent(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.token || bearer;

  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      // ignore invalid token in optional mode
    }
  }
  next();
}
