import { Request, Response, NextFunction } from "express";
import { PoolClient } from "pg";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { getCache, setCache, invalidateBookCaches } from "../utils/cache";
import { isValidUuid, parseIntegerId, parseNonNegativeInt, normalizeIsbn } from "../utils/validation";

const SORTABLE_COLUMNS: Record<string, string> = {
  title: "b.title",
  price_asc: "b.price",
  price_desc: "b.price",
  newest: "b.created_at",
  rating: "COALESCE(r.average_rating, 0)",
};

/**
 * GET /api/books
 * Query params: q, category (slug), minPrice, maxPrice, availability
 * (in_stock|out_of_stock), sort (title|price_asc|price_desc|newest|rating),
 * page, limit
 */
export async function listBooks(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      q,
      category,
      minPrice,
      maxPrice,
      availability,
      secondHand,
      sort = "newest",
      page = "1",
      limit = "12",
    } = req.query as Record<string, string>;

    const cacheKey = `books:list:${q || ""}:${category || ""}:${minPrice || ""}:${maxPrice || ""}:${availability || ""}:${secondHand || ""}:${sort}:${page}:${limit}`;
    const cached = await getCache<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const conditions: string[] = [];
    const values: any[] = [];

    if (q && q.trim()) {
      values.push(`%${q.trim()}%`);
      const idx = values.length;
      conditions.push(
        `(b.title ILIKE $${idx} OR b.author ILIKE $${idx} OR b.description ILIKE $${idx} OR b.isbn ILIKE $${idx})`
      );
    }

    if (category && category.trim()) {
      values.push(category.trim());
      conditions.push(`c.slug = $${values.length}`);
    }

    if (minPrice && !Number.isNaN(Number(minPrice))) {
      values.push(Number(minPrice));
      conditions.push(`b.price >= $${values.length}`);
    }

    if (maxPrice && !Number.isNaN(Number(maxPrice))) {
      values.push(Number(maxPrice));
      conditions.push(`b.price <= $${values.length}`);
    }

    if (availability === "in_stock") {
      conditions.push(`COALESCE(i.quantity - i.reserved, 0) > 0`);
    } else if (availability === "out_of_stock") {
      conditions.push(`COALESCE(i.quantity - i.reserved, 0) <= 0`);
    }

    if (secondHand === "true") {
      conditions.push(`b.is_second_hand = true`);
    } else if (secondHand === "false") {
      conditions.push(`b.is_second_hand = false`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const sortColumn = SORTABLE_COLUMNS[sort] || SORTABLE_COLUMNS.newest;
    const sortDirection = ["price_desc", "newest", "rating"].includes(sort) ? "DESC" : "ASC";

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 12));
    const offset = (pageNum - 1) * limitNum;

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM books b
      JOIN categories c ON c.id = b.category_id
      LEFT JOIN inventory i ON i.book_id = b.id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, values);
    const total = countResult.rows[0]?.count || 0;

    const dataValues = [...values, limitNum, offset];
    const dataQuery = `
      SELECT
        b.id, b.title, b.author, b.description, b.isbn, b.price,
        b.cover_image_url, b.is_second_hand, b.created_at,
        c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
        COALESCE(i.quantity, 0) AS raw_quantity,
        COALESCE(i.quantity - i.reserved, 0) AS available_quantity,
        COALESCE(r.review_count, 0) AS review_count,
        COALESCE(r.average_rating, 0) AS average_rating,
        shc.price_override
      FROM books b
      JOIN categories c ON c.id = b.category_id
      LEFT JOIN inventory i ON i.book_id = b.id
      LEFT JOIN second_hand_conditions shc ON shc.book_id = b.id
      LEFT JOIN (
        SELECT book_id, COUNT(*)::int AS review_count, AVG(rating) AS average_rating
        FROM reviews GROUP BY book_id
      ) r ON r.book_id = b.id
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}, b.id
      LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}
    `;
    const dataResult = await pool.query(dataQuery, dataValues);

    const responseBody = {
      books: dataResult.rows.map(formatBookRow),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };

    await setCache(cacheKey, responseBody, 60);
    res.json(responseBody);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/books/:id
 * Includes second-hand condition rows when applicable.
 */
export async function getBookById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid book ID.", 400);

    const cacheKey = `book:detail:${id}`;
    const cached = await getCache<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const bookResult = await pool.query(
      `SELECT
        b.id, b.title, b.author, b.description, b.isbn, b.price,
        b.cover_image_url, b.is_second_hand, b.created_at,
        c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
        COALESCE(i.quantity, 0) AS raw_quantity,
        COALESCE(i.quantity - i.reserved, 0) AS available_quantity
       FROM books b
       JOIN categories c ON c.id = b.category_id
       LEFT JOIN inventory i ON i.book_id = b.id
       WHERE b.id = $1`,
      [id]
    );

    const book = bookResult.rows[0];
    if (!book) throw new AppError("Book not found.", 404);

    let secondHandCondition = null;
    if (book.is_second_hand) {
      const condResult = await pool.query(
        `SELECT id, condition_grade, condition_notes, cover_condition, page_condition,
                visible_wear, additional_notes, price_override
         FROM second_hand_conditions WHERE book_id = $1`,
        [id]
      );
      const row = condResult.rows[0];
      secondHandCondition = row
        ? {
            id: row.id,
            conditionGrade: row.condition_grade,
            conditionNotes: row.condition_notes,
            coverCondition: row.cover_condition,
            pageCondition: row.page_condition,
            visibleWear: row.visible_wear,
            additionalNotes: row.additional_notes,
            priceOverride: row.price_override !== null ? Number(row.price_override) : null,
          }
        : null;
    }

    const ratingResult = await pool.query(
      `SELECT COUNT(*)::int AS review_count, COALESCE(AVG(rating), 0) AS average_rating
       FROM reviews WHERE book_id = $1`,
      [id]
    );
    const ratingRow = ratingResult.rows[0];

    const responseBody = {
      book: {
        ...formatBookRow(book),
        secondHandCondition,
        reviewCount: ratingRow.review_count,
        averageRating: Number(Number(ratingRow.average_rating).toFixed(2)),
      },
    };

    await setCache(cacheKey, responseBody, 60);
    res.json(responseBody);
  } catch (err) {
    next(err);
  }
}

interface BookInput {
  title: string;
  author: string;
  description: string | null;
  isbn: string | null;
  price: number;
  coverImageUrl: string;
  categoryId: number;
  isSecondHand: boolean;
  quantity: number | undefined;
}

/**
 * Validates the create/update book body. Throws a 422 listing every problem.
 * `quantity` is optional; when given it must be a non-negative whole number.
 */
function parseBookInput(body: any): BookInput {
  const { title, author, description, isbn, price, coverImageUrl, categoryId, isSecondHand, quantity } =
    body || {};
  const errors: string[] = [];

  if (!title || typeof title !== "string" || !title.trim()) errors.push("Title is required.");
  else if (title.trim().length > 255) errors.push("Title must be 255 characters or fewer.");

  if (!author || typeof author !== "string" || !author.trim()) errors.push("Author is required.");
  else if (author.trim().length > 160) errors.push("Author must be 160 characters or fewer.");

  if (
    price === undefined ||
    price === null ||
    price === "" ||
    Number.isNaN(Number(price)) ||
    !Number.isFinite(Number(price)) ||
    Number(price) < 0
  ) {
    errors.push("A valid, non-negative price is required.");
  }

  const parsedCategoryId = parseIntegerId(categoryId);
  if (parsedCategoryId === null) errors.push("categoryId must be a valid category ID (a whole number).");

  const isbnResult = normalizeIsbn(isbn);
  if (!isbnResult.ok) errors.push("ISBN must be 10 or 13 characters (digits; hyphens and spaces are ignored).");

  let parsedQuantity: number | undefined;
  if (quantity !== undefined && quantity !== null && quantity !== "") {
    const q = parseNonNegativeInt(quantity);
    if (q === null) errors.push("Quantity must be a non-negative whole number.");
    else parsedQuantity = q;
  }

  if (errors.length) throw new AppError(errors.join(" "), 422);

  return {
    title: title.trim(),
    author: author.trim(),
    description: description || null,
    isbn: isbnResult.ok ? isbnResult.isbn : null,
    price: Number(price),
    coverImageUrl: coverImageUrl || "",
    categoryId: parsedCategoryId as number,
    isSecondHand: Boolean(isSecondHand),
    quantity: parsedQuantity,
  };
}

async function assertCategoryExists(client: PoolClient, categoryId: number): Promise<void> {
  const result = await client.query("SELECT 1 FROM categories WHERE id = $1", [categoryId]);
  if (result.rows.length === 0) throw new AppError("That category does not exist.", 422);
}

export async function createBook(req: Request, res: Response, next: NextFunction) {
  try {
    const input = parseBookInput(req.body);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertCategoryExists(client, input.categoryId);

      const bookResult = await client.query(
        `INSERT INTO books (title, author, description, isbn, price, cover_image_url, category_id, is_second_hand)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          input.title,
          input.author,
          input.description,
          input.isbn,
          input.price,
          input.coverImageUrl,
          input.categoryId,
          input.isSecondHand,
        ]
      );
      const bookId = bookResult.rows[0].id;

      await client.query(`INSERT INTO inventory (book_id, quantity) VALUES ($1, $2)`, [
        bookId,
        input.quantity ?? 0,
      ]);

      await client.query("COMMIT");
      await invalidateBookCaches();
      res.status(201).json({ id: bookId });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/**
 * Sets legacy stock for a book without ever dropping it below the amount
 * currently reserved in carts. The check lives in the UPDATE's WHERE clause,
 * so it is evaluated atomically against the row's committed `reserved` value:
 * a cart reservation that commits first makes this update fail cleanly, and
 * one that arrives later waits on the row lock and sees the new quantity.
 * Returns false if the book has no inventory row.
 */
async function setLegacyQuantity(client: PoolClient, bookId: string, quantity: number): Promise<boolean> {
  const updated = await client.query(
    `UPDATE inventory SET quantity = $1, updated_at = now()
     WHERE book_id = $2 AND reserved <= $1
     RETURNING book_id`,
    [quantity, bookId]
  );
  if (updated.rows.length > 0) return true;

  const current = await client.query("SELECT reserved FROM inventory WHERE book_id = $1", [bookId]);
  if (current.rows.length === 0) return false;
  throw new AppError(
    `Quantity can't be less than ${current.rows[0].reserved}, the amount currently reserved in customer carts.`,
    422
  );
}

export async function updateBook(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid book ID.", 400);
    const input = parseBookInput(req.body);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertCategoryExists(client, input.categoryId);

      // Same lock order as deleteBook/cart/checkout: stock row first, book second.
      await client.query("SELECT id FROM inventory WHERE book_id = $1 FOR UPDATE", [id]);

      const result = await client.query(
        `UPDATE books SET
          title = $1, author = $2, description = $3, isbn = $4,
          price = $5, cover_image_url = $6, category_id = $7, is_second_hand = $8
         WHERE id = $9 RETURNING id`,
        [
          input.title,
          input.author,
          input.description,
          input.isbn,
          input.price,
          input.coverImageUrl,
          input.categoryId,
          input.isSecondHand,
          id,
        ]
      );
      if (result.rows.length === 0) throw new AppError("Book not found.", 404);

      if (input.quantity !== undefined) {
        // A 422 here rolls back the book edit too, so nothing is half-saved.
        await setLegacyQuantity(client, id, input.quantity);
      }

      await client.query("COMMIT");
      await invalidateBookCaches(id);
      res.json({ id: result.rows[0].id });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

export async function updateInventory(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid book ID.", 400);
    const quantity = parseNonNegativeInt(req.body?.quantity);
    if (quantity === null) {
      throw new AppError("A valid, non-negative whole-number quantity is required.", 422);
    }

    const client = await pool.connect();
    try {
      const found = await setLegacyQuantity(client, id, quantity);
      if (!found) throw new AppError("Book inventory record not found.", 404);
    } finally {
      client.release();
    }
    await invalidateBookCaches(id);
    res.json({ bookId: id, quantity });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/books/:id
 * Refuses (409) while any order, cart or store listing references the book,
 * and deletes nothing in that case. The book row is locked first
 * (SELECT ... FOR UPDATE): inserting a cart line, order line or store listing
 * takes a conflicting lock through its foreign key, so one cannot slip in
 * between the reference check and the delete. Legacy inventory, reviews and
 * second-hand condition rows still go with the book, as before.
 */
export async function deleteBook(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid book ID.", 400);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock order matters: cart and checkout lock the stock row BEFORE they
      // insert a cart/order line (which needs a share lock on the book), so
      // this takes the legacy stock row first and the book second. The same
      // order everywhere means no pair of requests can wait on each other.
      await client.query("SELECT id FROM inventory WHERE book_id = $1 FOR UPDATE", [id]);
      const locked = await client.query("SELECT id FROM books WHERE id = $1 FOR UPDATE", [id]);
      if (locked.rows.length === 0) throw new AppError("Book not found.", 404);

      const refs = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM order_items WHERE book_id = $1) AS orders,
           (SELECT COUNT(*)::int FROM cart_items WHERE book_id = $1) AS carts,
           (SELECT COUNT(*)::int FROM store_book_inventory WHERE book_id = $1) AS store_listings`,
        [id]
      );
      const { orders, carts, store_listings: storeListings } = refs.rows[0];
      const blockers: string[] = [];
      if (orders > 0) blockers.push("existing orders");
      if (carts > 0) blockers.push("customer carts");
      if (storeListings > 0) blockers.push("store listings");
      if (blockers.length > 0) {
        throw new AppError(
          `This book can't be deleted because it is still referenced by ${blockers.join(", ")}. ` +
            `Remove those references first; nothing was deleted.`,
          409
        );
      }

      await client.query("DELETE FROM books WHERE id = $1", [id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    await invalidateBookCaches(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

function formatBookRow(row: any) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    isbn: row.isbn,
    price:
      row.price_override !== null && row.price_override !== undefined
        ? Number(row.price_override)
        : Number(row.price),
    coverImageUrl: row.cover_image_url,
    isSecondHand: row.is_second_hand,
    createdAt: row.created_at,
    category: {
      id: row.category_id,
      name: row.category_name,
      slug: row.category_slug,
    },
    availableQuantity: Number(row.available_quantity) || 0,
    quantity: Number(row.raw_quantity) || 0,
    inStock: (Number(row.available_quantity) || 0) > 0,
    reviewCount: row.review_count !== undefined ? Number(row.review_count) : undefined,
    averageRating:
      row.average_rating !== undefined ? Number(Number(row.average_rating).toFixed(2)) : undefined,
  };
}