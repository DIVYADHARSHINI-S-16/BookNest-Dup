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

export function isValidNonNegativeInteger(value: unknown): boolean {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0;
}

export function validateRegisterInput(body: any): ValidationResult {
  const errors: string[] = [];
  const { name, email, password } = body || {};

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
