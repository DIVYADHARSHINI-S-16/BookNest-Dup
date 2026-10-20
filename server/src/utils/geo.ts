/**
 * Geographic helpers for Nearby Bookstore Discovery.
 *
 * Everything here is pure (no database, no I/O) so it can be unit-tested.
 * Distances use the Haversine great-circle formula on a spherical Earth
 * (mean radius 6371.0088 km), which is accurate to roughly 0.5% - plenty for
 * "which bookstore is closest".
 */

export const EARTH_RADIUS_KM = 6371.0088;

export const DEFAULT_RADIUS_KM = 25;
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 500;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DECIMAL_STRING = /^-?\d{1,3}(?:\.\d+)?$/;

/** True when the caller left the value out (undefined, null, or an empty/blank string). */
export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Accepts a finite number or a plain decimal string ("12.97", "-77.5").
 * Rejects booleans, arrays, objects, "NaN", "Infinity", exponent notation, etc.
 */
function toStrictNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!DECIMAL_STRING.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Rounds to 6 decimal places (about 0.1 m), matching the NUMERIC(9,6) columns. */
export function roundCoordinate(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function parseLatitude(value: unknown): ParseResult<number> {
  const n = toStrictNumber(value);
  if (n === null) return { ok: false, error: "Latitude must be a number between -90 and 90." };
  if (n < -90 || n > 90) return { ok: false, error: "Latitude must be between -90 and 90." };
  return { ok: true, value: roundCoordinate(n) };
}

export function parseLongitude(value: unknown): ParseResult<number> {
  const n = toStrictNumber(value);
  if (n === null) return { ok: false, error: "Longitude must be a number between -180 and 180." };
  if (n < -180 || n > 180) return { ok: false, error: "Longitude must be between -180 and 180." };
  return { ok: true, value: roundCoordinate(n) };
}

/**
 * Validates an optional latitude/longitude pair.
 *  - both blank          -> { ok: true, value: null }   (no coordinates)
 *  - exactly one blank   -> error (a single coordinate is meaningless)
 *  - both present        -> each range-checked, rounded to 6 decimals
 */
export function parseCoordinatePair(latitude: unknown, longitude: unknown): ParseResult<Coordinates | null> {
  const latBlank = isBlank(latitude);
  const lngBlank = isBlank(longitude);
  if (latBlank && lngBlank) return { ok: true, value: null };
  if (latBlank || lngBlank) {
    return { ok: false, error: "Latitude and longitude must be provided together." };
  }
  const lat = parseLatitude(latitude);
  if (!lat.ok) return lat;
  const lng = parseLongitude(longitude);
  if (!lng.ok) return lng;
  return { ok: true, value: { latitude: lat.value, longitude: lng.value } };
}

export function parseRadiusKm(value: unknown): ParseResult<number> {
  if (isBlank(value)) return { ok: true, value: DEFAULT_RADIUS_KM };
  let n: number | null = null;
  if (typeof value === "number") n = Number.isFinite(value) ? value : null;
  else if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) n = Number(value.trim());
  if (n === null || n < MIN_RADIUS_KM || n > MAX_RADIUS_KM) {
    return { ok: false, error: `Radius must be a number between ${MIN_RADIUS_KM} and ${MAX_RADIUS_KM} km.` };
  }
  return { ok: true, value: n };
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two points (Haversine). */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  // Clamp: floating-point error can push h marginally outside [0, 1] for antipodal points.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/**
 * Half-height, in degrees of latitude, of a band that is guaranteed to contain
 * every point within `radiusKm` of the origin. Used as a cheap, index-friendly
 * prefilter before the exact Haversine test (two points `d` km apart can never
 * differ in latitude by more than d / R radians).
 */
export function latitudeBandDegrees(radiusKm: number): number {
  return (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI) + 1e-6;
}

/** Escapes LIKE/ILIKE wildcards so user text is matched literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
