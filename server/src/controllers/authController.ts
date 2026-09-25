import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { hashPassword, comparePassword } from "../utils/password";
import { signToken } from "../utils/jwt";
import { validateRegisterInput, validateLoginInput } from "../utils/validation";
import { AppError } from "../middleware/errorHandler";

const isProd = process.env.NODE_ENV === "production";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

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

    res.cookie("token", token, COOKIE_OPTIONS);
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

    const result = await pool.query(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = $1",
      [normalizedEmail]
    );
    const user = result.rows[0];

    // Same generic error whether email is missing or password is wrong,
    // so we don't leak which emails are registered.
    if (!user) throw new AppError("Invalid email or password.", 401);

    const passwordMatches = await comparePassword(password, user.password_hash);
    if (!passwordMatches) throw new AppError("Invalid email or password.", 401);

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.cookie("token", token, COOKIE_OPTIONS);
    res.status(200).json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie("token", { ...COOKIE_OPTIONS, maxAge: undefined });
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
