import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { hashPassword, comparePassword, getDummyHash } from "../utils/password";
import { signToken, getTokenMaxAgeMs } from "../utils/jwt";
import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
} from "../utils/loginRateLimiter";
import { validateRegisterInput, validateLoginInput } from "../utils/validation";
import { AppError } from "../middleware/errorHandler";

const isProd = process.env.NODE_ENV === "production";

// Cookie lifetime follows JWT_EXPIRES_IN (default 7 days), read per call.
function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    maxAge: getTokenMaxAgeMs(),
  };
}

function publicUser(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
  };
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { valid, errors } = validateRegisterInput(req.body);
    if (!valid) throw new AppError(errors.join(" "), 422);

    const { name, email, password, role } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();
    const requestedRole = role === "store_owner" ? "store_owner" : "customer";

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    if (existing.rows.length > 0) {
      throw new AppError("An account with that email already exists.", 409);
    }

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [name.trim(), normalizedEmail, passwordHash, requestedRole]
    );

    const user = result.rows[0];
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.cookie("token", token, cookieOptions());
    res.status(201).json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { valid, errors } = validateLoginInput(req.body);
    if (!valid) throw new AppError(errors.join(" "), 422);

    const { email, password } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();
    const ip = req.ip || "unknown";

    // Temporary block after repeated failures (expires on its own).
    const gate = await checkLoginAllowed(ip, normalizedEmail);
    if (!gate.allowed) {
      res.set("Retry-After", String(gate.retryAfterSeconds));
      const minutes = Math.max(1, Math.ceil(gate.retryAfterSeconds / 60));
      throw new AppError(
        `Too many failed login attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        429
      );
    }

    const result = await pool.query(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = $1",
      [normalizedEmail]
    );
    const user = result.rows[0];

    // Always run one bcrypt compare (against a dummy hash for unknown emails)
    // so timing does not reveal which emails are registered.
    const hashToCheck = user ? user.password_hash : await getDummyHash();
    const passwordMatches = await comparePassword(password, hashToCheck);

    // Same generic error whether email is missing or password is wrong.
    if (!user || !passwordMatches) {
      await recordLoginFailure(ip, normalizedEmail);
      throw new AppError("Invalid email or password.", 401);
    }

    await clearLoginFailures(ip, normalizedEmail);

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.cookie("token", token, cookieOptions());
    res.status(200).json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie("token", { ...cookieOptions(), maxAge: undefined });
  res.status(200).json({ message: "Logged out." });
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role FROM users WHERE id = $1",
      [req.user!.userId]
    );
    const user = result.rows[0];
    if (!user) throw new AppError("User not found.", 404);
    res.status(200).json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}
