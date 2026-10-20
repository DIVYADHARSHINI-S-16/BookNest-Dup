import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { isValidUuid } from "../utils/validation";
import {
  EARTH_RADIUS_KM,
  escapeLike,
  isBlank,
  latitudeBandDegrees,
  parseCoordinatePair,
  parseRadiusKm,
} from "../utils/geo";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_TEXT_LENGTH = 100;

/**
 * The ONLY store fields ever returned by the public discovery endpoints.
 * Deliberately excluded: owner_user_id, store email, phone, timestamps, and the
 * raw latitude/longitude (customers get a distance, not coordinates).
 */
function serializePublicStore(row: any) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    address: row.address,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
  };
}

function parsePositiveInt(value: unknown, fallback: number, max: number, label: string): number {
  if (isBlank(value)) return fallback;
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new AppError(`${label} must be a whole number between 1 and ${max}.`, 422);
  }
  return n;
}

function parseOptionalText(value: unknown, label: string): string | null {
  if (isBlank(value)) return null;
  if (typeof value !== "string") throw new AppError(`${label} must be text.`, 422);
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new AppError(`${label} must be at most ${MAX_TEXT_LENGTH} characters.`, 422);
  }
  return trimmed;
}

/**
 * POST /api/stores/nearby   (public)
 *
 * Body: { latitude?, longitude?, radiusKm?, query?, page?, limit? }
 *
 * Why POST: this is a read-only search, but the customer's coordinates must not
 * appear in a URL (request loggers such as morgan, proxies and browser history
 * record URLs). Request bodies are not logged by this server.
 *
 * Modes:
 *  - latitude + longitude  -> "distance": active stores with valid coordinates
 *    within radiusKm, sorted nearest-first. Distances are computed here from the
 *    database's stored coordinates; nothing the client sends is trusted as a distance.
 *  - query only            -> "text": active stores whose name/address/city/state/
 *    postal code contains the text (manual-location fallback; no geocoding needed).
 *  - neither               -> "browse": all active stores, A-Z.
 *
 * The customer's coordinates are used only inside this request's SQL parameters.
 * They are not stored, cached, logged, or echoed back.
 */
export async function searchNearbyStores(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new AppError("Request body must be a JSON object.", 400);
    }

    const coords = parseCoordinatePair(body.latitude, body.longitude);
    if (!coords.ok) throw new AppError(coords.error, 422);

    const radius = parseRadiusKm(body.radiusKm);
    if (!radius.ok) throw new AppError(radius.error, 422);

    const text = parseOptionalText(body.query, "Search text");
    const page = parsePositiveInt(body.page, 1, 100000, "Page");
    const limit = parsePositiveInt(body.limit, DEFAULT_LIMIT, MAX_LIMIT, "Limit");
    const offset = (page - 1) * limit;

    const params: unknown[] = [];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    // Optional text filter, shared by every mode. Wildcards in user text are escaped.
    let textClause = "TRUE";
    if (text) {
      const p = bind(`%${escapeLike(text)}%`);
      textClause = `(s.name ILIKE ${p} ESCAPE '\\' OR s.address ILIKE ${p} ESCAPE '\\' OR s.city ILIKE ${p} ESCAPE '\\'
                     OR s.state ILIKE ${p} ESCAPE '\\' OR s.postal_code ILIKE ${p} ESCAPE '\\')`;
    }

    const availableBooks = `(SELECT COUNT(*) FROM store_book_inventory sbi
                              WHERE sbi.store_id = s.id AND sbi.is_active = true
                                AND (sbi.quantity - sbi.reserved) > 0)::int`;

    let sql: string;
    let mode: "distance" | "text" | "browse";

    if (coords.value) {
      mode = "distance";
      const lat = bind(coords.value.latitude);
      const lng = bind(coords.value.longitude);
      const radiusP = bind(radius.value);
      const band = latitudeBandDegrees(radius.value);
      const latMin = bind(coords.value.latitude - band);
      const latMax = bind(coords.value.latitude + band);
      const limitP = bind(limit);
      const offsetP = bind(offset);

      // 1. candidate: active stores with valid coordinates inside the latitude band
      //    (cheap, uses idx_stores_active_latitude). The range guard also skips any
      //    legacy row holding out-of-range values instead of letting it break the math.
      // 2. dist: exact Haversine distance, with the argument of asin() clamped to [0,1].
      // 3. keep stores within the radius, nearest first (ties: name, then id).
      sql = `
        WITH candidate AS (
          SELECT s.id, s.name, s.slug, s.description, s.address, s.city, s.state, s.postal_code, s.country,
                 s.latitude::float8 AS lat, s.longitude::float8 AS lng,
                 ${availableBooks} AS available_book_count
          FROM stores s
          WHERE s.is_active = true
            AND s.latitude  IS NOT NULL AND s.longitude IS NOT NULL
            AND s.latitude  BETWEEN -90  AND 90
            AND s.longitude BETWEEN -180 AND 180
            AND s.latitude  BETWEEN ${latMin}::float8 AND ${latMax}::float8
            AND ${textClause}
        ), dist AS (
          SELECT c.*,
                 2 * ${EARTH_RADIUS_KM}::float8 * asin(sqrt(least(1::float8, greatest(0::float8,
                   power(sin(radians(c.lat - ${lat}::float8) / 2), 2)
                   + cos(radians(${lat}::float8)) * cos(radians(c.lat))
                     * power(sin(radians(c.lng - ${lng}::float8) / 2), 2)
                 )))) AS distance_km
          FROM candidate c
        )
        SELECT d.*, COUNT(*) OVER()::int AS total
        FROM dist d
        WHERE d.distance_km <= ${radiusP}::float8
        ORDER BY d.distance_km ASC, d.name ASC, d.id ASC
        LIMIT ${limitP} OFFSET ${offsetP}`;
    } else {
      mode = text ? "text" : "browse";
      const limitP = bind(limit);
      const offsetP = bind(offset);
      sql = `
        SELECT s.id, s.name, s.slug, s.description, s.address, s.city, s.state, s.postal_code, s.country,
               NULL::float8 AS distance_km,
               ${availableBooks} AS available_book_count,
               COUNT(*) OVER()::int AS total
        FROM stores s
        WHERE s.is_active = true AND ${textClause}
        ORDER BY s.name ASC, s.id ASC
        LIMIT ${limitP} OFFSET ${offsetP}`;
    }

    const result = await pool.query(sql, params);
    const total: number = result.rows[0]?.total ?? 0;

    // Helps the UI explain "some stores can't be ranked": active stores with no usable coordinates.
    let unlocatedStoreCount: number | undefined;
    if (mode === "distance") {
      const unlocated = await pool.query(
        `SELECT COUNT(*)::int AS n FROM stores
         WHERE is_active = true
           AND (latitude IS NULL OR longitude IS NULL
                OR latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180)`
      );
      unlocatedStoreCount = unlocated.rows[0].n;
    }

    // Search results depend on a private location and must never be cached by a browser or proxy.
    res.set("Cache-Control", "no-store");
    res.json({
      stores: result.rows.map((row) => ({
        ...serializePublicStore(row),
        // One decimal place (100 m) is plenty for display; null when no customer location was used.
        distanceKm: row.distance_km === null ? null : Math.round(row.distance_km * 10) / 10,
        availableBookCount: row.available_book_count,
      })),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      search: {
        mode,
        radiusKm: mode === "distance" ? radius.value : null,
        ...(unlocatedStoreCount !== undefined ? { unlocatedStoreCount } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/stores/:storeId/books   (public)
 *
 * Lists the books an ACTIVE store currently has available, with the store's own
 * price and available quantity (quantity - reserved). Inactive stores and
 * unknown ids both return 404 so inactive stores are not revealed.
 * Query: ?search=<title or author>&page=&limit=
 */
export async function getPublicStoreBooks(req: Request, res: Response, next: NextFunction) {
  try {
    const { storeId } = req.params;
    if (!isValidUuid(storeId)) throw new AppError("Invalid store ID.", 400);

    const search = parseOptionalText(req.query.search, "Search text");
    const page = parsePositiveInt(req.query.page, 1, 100000, "Page");
    const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT, "Limit");
    const offset = (page - 1) * limit;

    const store = await pool.query(
      `SELECT id, name, slug, description, address, city, state, postal_code, country
       FROM stores WHERE id = $1 AND is_active = true`,
      [storeId]
    );
    if (store.rows.length === 0) throw new AppError("Store not found.", 404);

    const params: unknown[] = [storeId];
    let searchClause = "TRUE";
    if (search) {
      params.push(`%${escapeLike(search)}%`);
      searchClause = `(b.title ILIKE $2 ESCAPE '\\' OR b.author ILIKE $2 ESCAPE '\\')`;
    }
    params.push(limit, offset);
    const limitP = `$${params.length - 1}`;
    const offsetP = `$${params.length}`;

    const result = await pool.query(
      `SELECT sbi.id AS listing_id, sbi.price, sbi.quantity, sbi.reserved,
              b.id AS book_id, b.title, b.author, b.cover_image_url, b.is_second_hand,
              COUNT(*) OVER()::int AS total
       FROM store_book_inventory sbi
       JOIN books b ON b.id = sbi.book_id
       WHERE sbi.store_id = $1
         AND sbi.is_active = true
         AND (sbi.quantity - sbi.reserved) > 0
         AND ${searchClause}
       ORDER BY b.title ASC, b.id ASC
       LIMIT ${limitP} OFFSET ${offsetP}`,
      params
    );
    const total: number = result.rows[0]?.total ?? 0;

    res.json({
      store: serializePublicStore(store.rows[0]),
      books: result.rows.map((row) => ({
        listingId: row.listing_id,
        bookId: row.book_id,
        title: row.title,
        author: row.author,
        coverImageUrl: row.cover_image_url,
        isSecondHand: row.is_second_hand,
        price: Number(row.price),
        availableQuantity: Math.max(row.quantity - row.reserved, 0),
      })),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    next(err);
  }
}
