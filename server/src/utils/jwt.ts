import jwt, { SignOptions } from "jsonwebtoken";
import { isValidUuid } from "./validation";

const JWT_ALGORITHM = "HS256" as const;
const MIN_SECRET_LENGTH = 32;
const DEFAULT_EXPIRES_IN = "7d";
const DEFAULT_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ROLES = ["customer", "admin", "store_owner"] as const;

// Placeholder values that ship in docs/examples. They are public, so a server
// running with one of them would accept forged tokens.
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "dev_secret_change_me",
  "replace_this_with_a_long_random_string",
  "changeme",
  "secret",
]);

export interface JwtPayload {
  userId: string;
  email: string;
  role: "customer" | "admin" | "store_owner";
}

export class JwtConfigError extends Error {}

/**
 * Returns the signing secret or throws. The error message never contains the
 * secret itself. Outside NODE_ENV=test the secret must be present, at least
 * 32 characters long and not a known placeholder.
 */
function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new JwtConfigError("JWT_SECRET is not set. Set it to a long random string before starting the server.");
  }
  if (process.env.NODE_ENV !== "test") {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new JwtConfigError(
        `JWT_SECRET is too short (minimum ${MIN_SECRET_LENGTH} characters). Use a long random string.`
      );
    }
    if (KNOWN_PLACEHOLDER_SECRETS.has(secret.trim().toLowerCase())) {
      throw new JwtConfigError("JWT_SECRET is a placeholder value. Replace it with a long random string.");
    }
  }
  return secret;
}

/** Call once at startup so a bad configuration stops the server immediately. */
export function assertJwtConfig(): void {
  getSecret();
}

function getExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN;
}

/**
 * Cookie lifetime that follows JWT_EXPIRES_IN ("7d", "12h", "30m", or plain
 * seconds) so the cookie and the token expire together.
 */
export function getTokenMaxAgeMs(): number {
  const match = /^(\d+)\s*([smhd]?)$/i.exec(getExpiresIn().trim());
  if (!match) return DEFAULT_COOKIE_MAX_AGE_MS;
  const value = Number(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  const factor = unit === "d" ? 86400000 : unit === "h" ? 3600000 : unit === "m" ? 60000 : 1000;
  const ms = value * factor;
  return ms > 0 ? ms : DEFAULT_COOKIE_MAX_AGE_MS;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(
    { userId: payload.userId, email: payload.email, role: payload.role },
    getSecret(),
    { algorithm: JWT_ALGORITHM, expiresIn: getExpiresIn() } as SignOptions
  );
}

/**
 * Verifies signature (HS256 only) and expiry, then checks the payload shape.
 * Throws on anything invalid; callers treat every failure as "not logged in".
 */
export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getSecret(), { algorithms: [JWT_ALGORITHM] });
  if (!decoded || typeof decoded !== "object") throw new Error("Invalid token payload.");
  const { userId, email, role } = decoded as Record<string, unknown>;
  if (
    !isValidUuid(userId) ||
    typeof email !== "string" ||
    !email ||
    typeof role !== "string" ||
    !(ROLES as readonly string[]).includes(role)
  ) {
    throw new Error("Invalid token payload.");
  }
  return { userId: userId as string, email, role: role as JwtPayload["role"] };
}
