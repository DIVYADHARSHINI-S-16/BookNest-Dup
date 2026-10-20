import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { validateStoreInput, isValidUuid } from "../utils/validation";
import { getCache, setCache, invalidateStoreListingCaches } from "../utils/cache";
import { parseCoordinatePair } from "../utils/geo";

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function serializeStore(row: any) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getStorePayload(body: any) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : normalizeSlug(name);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  const postalCode = typeof body.postalCode === "string"
    ? body.postalCode.trim()
    : typeof body.postal_code === "string"
      ? body.postal_code.trim()
      : "";
  const country = typeof body.country === "string" ? body.country.trim() : "US";
  const phone = typeof body.phone === "string" ? body.phone.trim() : null;
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const latitude = body.latitude !== undefined && body.latitude !== null && body.latitude !== "" ? Number(body.latitude) : null;
  const longitude = body.longitude !== undefined && body.longitude !== null && body.longitude !== "" ? Number(body.longitude) : null;

  return {
    name,
    slug: normalizeSlug(slug),
    email,
    address,
    city,
    state,
    postalCode,
    country: country || "US",
    phone: phone || null,
    description: description || null,
    latitude,
    longitude,
  };
}

/**
 * GET /api/books/:bookId/store-listings
 * Public. Shows every store currently offering this book — active listings
 * with quantity > 0 only, so customers never see an out-of-stock or
 * deactivated option to pick from.
 */
export async function getBookStoreListings(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookId } = req.params;
    if (!isValidUuid(bookId)) throw new AppError("Invalid book ID.", 400);

    const cacheKey = `book:store-listings:${bookId}`;
    const cached = await getCache<any>(cacheKey);
    if (cached) return res.json(cached);

    const bookExists = await pool.query("SELECT id FROM books WHERE id = $1", [bookId]);
    if (bookExists.rows.length === 0) throw new AppError("Book not found.", 404);

    const result = await pool.query(
      `SELECT sbi.id AS listing_id, sbi.price, sbi.quantity, sbi.reserved,
              s.id AS store_id, s.name AS store_name, s.city, s.state
       FROM store_book_inventory sbi
       JOIN stores s ON s.id = sbi.store_id
       WHERE sbi.book_id = $1
         AND sbi.is_active = true
         AND s.is_active = true
         AND (sbi.quantity - sbi.reserved) > 0
       ORDER BY sbi.price ASC`,
      [bookId]
    );

    const responseBody = {
      listings: result.rows.map((row) => ({
        listingId: row.listing_id,
        storeId: row.store_id,
        storeName: row.store_name,
        city: row.city,
        state: row.state,
        price: Number(row.price),
        availableQuantity: Math.max(row.quantity - row.reserved, 0),
      })),
    };

    await setCache(cacheKey, responseBody, 60);
    res.json(responseBody);
  } catch (err) {
    next(err);
  }
}

export async function listStoresForAdmin(_req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      "SELECT * FROM stores ORDER BY created_at DESC"
    );
    res.json({ stores: result.rows.map(serializeStore) });
  } catch (err) {
    next(err);
  }
}

export async function getMyStore(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      "SELECT * FROM stores WHERE owner_user_id = $1",
      [req.user!.userId]
    );

    if (result.rows.length === 0) {
      throw new AppError("You do not have a store yet.", 404);
    }

    res.json({ store: serializeStore(result.rows[0]) });
  } catch (err) {
    next(err);
  }
}

export async function createStore(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = getStorePayload(req.body);
    const { valid, errors } = validateStoreInput({ ...req.body, postalCode: payload.postalCode, country: payload.country, name: payload.name, slug: payload.slug, email: payload.email, address: payload.address, city: payload.city, state: payload.state });

    if (!valid) {
      throw new AppError(errors.join(" "), 422);
    }

    // Optional location: both coordinates or neither, each range-checked (-90..90 / -180..180).
    const coords = parseCoordinatePair(req.body.latitude, req.body.longitude);
    if (!coords.ok) {
      throw new AppError(coords.error, 422);
    }

    const existingStore = await pool.query(
      "SELECT id FROM stores WHERE owner_user_id = $1",
      [req.user!.userId]
    );

    if (existingStore.rows.length > 0) {
      throw new AppError("You already have a store. Use update instead.", 409);
    }

    const slugExists = await pool.query(
      "SELECT id FROM stores WHERE slug = $1",
      [payload.slug]
    );
    if (slugExists.rows.length > 0) {
      throw new AppError("A store with that slug already exists.", 409);
    }

    const result = await pool.query(
      `INSERT INTO stores (
        owner_user_id, name, slug, description, email, phone, address, city, state,
        postal_code, country, latitude, longitude, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)
       RETURNING *`,
      [
        req.user!.userId,
        payload.name,
        payload.slug,
        payload.description,
        payload.email,
        payload.phone,
        payload.address,
        payload.city,
        payload.state,
        payload.postalCode,
        payload.country,
        coords.value ? coords.value.latitude : null,
        coords.value ? coords.value.longitude : null,
      ]
    );

    res.status(201).json({ store: serializeStore(result.rows[0]) });
  } catch (err) {
    next(err);
  }
}

export async function updateStore(req: Request, res: Response, next: NextFunction) {
  try {
    const current = await pool.query(
      "SELECT * FROM stores WHERE owner_user_id = $1",
      [req.user!.userId]
    );

    if (current.rows.length === 0) {
      throw new AppError("You do not have a store yet.", 404);
    }

    const existing = current.rows[0];
    const payload = getStorePayload({ ...existing, ...req.body });
    const { valid, errors } = validateStoreInput({
      ...existing,
      ...req.body,
      postalCode: payload.postalCode,
      country: payload.country,
      name: payload.name,
      slug: payload.slug,
      email: payload.email,
      address: payload.address,
      city: payload.city,
      state: payload.state,
    });

    if (!valid) {
      throw new AppError(errors.join(" "), 422);
    }

    if (req.body.slug && req.body.slug !== existing.slug) {
      const slugConflict = await pool.query(
        "SELECT id FROM stores WHERE slug = $1 AND id <> $2",
        [payload.slug, existing.id]
      );
      if (slugConflict.rows.length > 0) {
        throw new AppError("A store with that slug already exists.", 409);
      }
    }

    // Location is only re-validated and rewritten when the request actually contains
    // latitude/longitude; otherwise the stored values are left exactly as they are, so an
    // owner can edit other fields even if a legacy row holds odd coordinates.
    const body = req.body && typeof req.body === "object" ? req.body : {};
    let nextLatitude: number | string | null = existing.latitude;
    let nextLongitude: number | string | null = existing.longitude;
    if ("latitude" in body || "longitude" in body) {
      const coords = parseCoordinatePair(
        "latitude" in body ? body.latitude : existing.latitude,
        "longitude" in body ? body.longitude : existing.longitude
      );
      if (!coords.ok) {
        throw new AppError(coords.error, 422);
      }
      nextLatitude = coords.value ? coords.value.latitude : null;
      nextLongitude = coords.value ? coords.value.longitude : null;
    }

    const result = await pool.query(
      `UPDATE stores
       SET name = $1,
           slug = $2,
           description = $3,
           email = $4,
           phone = $5,
           address = $6,
           city = $7,
           state = $8,
           postal_code = $9,
           country = $10,
           latitude = $11,
           longitude = $12,
           updated_at = now()
       WHERE owner_user_id = $13
       RETURNING *`,
      [
        payload.name,
        payload.slug,
        payload.description,
        payload.email,
        payload.phone,
        payload.address,
        payload.city,
        payload.state,
        payload.postalCode,
        payload.country,
        nextLatitude,
        nextLongitude,
        req.user!.userId,
      ]
    );

    // Listings show the store's name/city/state, so cached copies are stale now.
    await invalidateStoreListingCaches();
    res.json({ store: serializeStore(result.rows[0]) });
  } catch (err) {
    next(err);
  }
}
