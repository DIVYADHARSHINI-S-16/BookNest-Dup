import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * A real bcrypt hash (same cost as real passwords) used when a login names an
 * email that does not exist, so that case does the same amount of work as a
 * wrong password and response time does not reveal which emails are registered.
 * Computed once, lazily; nobody knows the password it was made from.
 */
export function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(`dummy-${Math.random().toString(36)}-${Date.now()}`);
  }
  return dummyHashPromise;
}
