export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidUuid(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

const INT32_MAX = 2147483647;

/**
 * Parses a SERIAL (integer) database id such as categories.id. Accepts a
 * positive whole number or a string of digits; anything else gives null.
 */
export function parseIntegerId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 && value <= INT32_MAX ? value : null;
  }
  if (typeof value === "string" && /^\d{1,10}$/.test(value.trim())) {
    const n = Number(value.trim());
    return n >= 1 && n <= INT32_MAX ? n : null;
  }
  return null;
}

/**
 * Strict whole-number parser for quantities: accepts a non-negative integer
 * or a string of digits. Rejects "", null, booleans, decimals, negatives,
 * NaN and values too large for a Postgres INTEGER (returns null).
 */
export function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= INT32_MAX ? value : null;
  }
  if (typeof value === "string" && /^\d{1,10}$/.test(value.trim())) {
    const n = Number(value.trim());
    return n <= INT32_MAX ? n : null;
  }
  return null;
}

/**
 * ISBN input is optional. Hyphens and spaces are stripped; what remains must
 * be 10 characters (digits, last may be X) or 13 digits. The checksum is not
 * enforced so existing catalog data keeps saving. Returns the stored form.
 */
export function normalizeIsbn(
  value: unknown
): { ok: true; isbn: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, isbn: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, isbn: null };
  const compact = trimmed.replace(/[-\s]/g, "").toUpperCase();
  if (/^(\d{9}[\dX]|\d{13})$/.test(compact)) return { ok: true, isbn: compact };
  return { ok: false };
}

export function isValidNonNegativeInteger(value: unknown): boolean {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0;
}

export function validateRegisterInput(body: any): ValidationResult {
  const errors: string[] = [];
  const { name, email, password, role } = body || {};

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    errors.push("Name must be at least 2 characters.");
  }
  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    errors.push("A valid email is required.");
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    errors.push("Password must be at least 6 characters.");
  }
  if (
    password &&
    (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
  ) {
    errors.push("Password must contain both letters and numbers.");
  }
  if (role !== undefined && role !== "customer" && role !== "store_owner") {
    errors.push("Role must be either customer or store_owner.");
  }

  return { valid: errors.length === 0, errors };
}

export function validateStoreInput(body: any): ValidationResult {
  const errors: string[] = [];
  const {
    name,
    slug,
    email,
    address,
    city,
    state,
    postalCode,
    postal_code,
    country,
    phone,
    description,
  } = body || {};

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    errors.push("Store name must be at least 2 characters.");
  }

  const safeSlug = typeof slug === "string" ? slug.trim() : "";
  if (!safeSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(safeSlug)) {
    errors.push("Store slug is required and may only contain lowercase letters, numbers, and hyphens.");
  }

  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    errors.push("A valid store email is required.");
  }

  if (!address || typeof address !== "string" || address.trim().length < 4) {
    errors.push("Store address is required.");
  }
  if (!city || typeof city !== "string" || city.trim().length < 2) {
    errors.push("Store city is required.");
  }
  if (!state || typeof state !== "string" || state.trim().length < 2) {
    errors.push("Store state is required.");
  }

  const normalizedPostalCode = typeof postalCode === "string"
    ? postalCode
    : typeof postal_code === "string"
      ? postal_code
      : "";
  if (!normalizedPostalCode || normalizedPostalCode.trim().length < 2) {
    errors.push("Store postal code is required.");
  }
  if (!country || typeof country !== "string" || country.trim().length < 2) {
    errors.push("Store country is required.");
  }
  if (phone !== undefined && phone !== null && (typeof phone !== "string" || phone.trim().length < 3)) {
    errors.push("Store phone must be a valid phone number if provided.");
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    errors.push("Store description must be text.");
  }

  return { valid: errors.length === 0, errors };
}

export function validateLoginInput(body: any): ValidationResult {
  const errors: string[] = [];
  const { email, password } = body || {};

  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    errors.push("A valid email is required.");
  }
  if (!password || typeof password !== "string" || !password.trim()) {
    errors.push("Password is required.");
  }

  return { valid: errors.length === 0, errors };
}
