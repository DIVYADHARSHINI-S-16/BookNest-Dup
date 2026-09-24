import { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { AppError } from "../middleware/errorHandler";
import { getCache, setCache, invalidateBookCaches } from "../utils/cache";
import { isValidUuid } from "../utils/validation";

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

export async function createBook(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      title,
      author,
      description,
      isbn,
      price,
      coverImageUrl,
      categoryId,
      isSecondHand,
      quantity,
    } = req.body;

    const errors: string[] = [];
    if (!title || typeof title !== "string") errors.push("Title is required.");
    if (!author || typeof author !== "string") errors.push("Author is required.");
    if (price === undefined || Number.isNaN(Number(price)) || Number(price) < 0)
      errors.push("A valid, non-negative price is required.");
    if (!categoryId) errors.push("categoryId is required.");
    if (errors.length) throw new AppError(errors.join(" "), 422);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const bookResult = await client.query(
        `INSERT INTO books (title, author, description, isbn, price, cover_image_url, category_id, is_second_hand)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          title.trim(),
          author.trim(),
          description || null,
          isbn || null,
          Number(price),
          coverImageUrl || "",
          categoryId,
          Boolean(isSecondHand),
        ]
      );
      const bookId = bookResult.rows[0].id;

      await client.query(
        `INSERT INTO inventory (book_id, quantity) VALUES ($1, $2)`,
        [bookId, Number.isFinite(Number(quantity)) ? Number(quantity) : 0]
      );

      await client.query("COMMIT");
      await invalidateBookCaches();
      res.status(201).json({ id: bookId });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

export async function updateBook(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid book ID.", 400);
    const {
      title,
      author,
      description,
      isbn,
      price,
      coverImageUrl,
      categoryId,
      isSecondHand,
      quantity,
    } = req.body;

    const errors: string[] = [];
    if (!title || typeof title !== "string") errors.push("Title is required.");
    if (!author || typeof author !== "string") errors.push("Author is required.");
    if (price === undefined || Number.isNaN(Number(price)) || Number(price) < 0)
      errors.push("A valid, non-negative price is required.");
    if (!categoryId) errors.push("categoryId is required.");
    if (errors.length) throw new AppError(errors.join(" "), 422);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE books SET
          title = $1, author = $2, description = $3, isbn = $4,
          price = $5, cover_image_url = $6, category_id = $7, is_second_hand = $8
         WHERE id = $9 RETURNING id`,
        [
          title.trim(),
          author.trim(),
          description || null,
          isbn || null,
          Number(price),
          coverImageUrl || "",
          categoryId,
          Boolean(isSecondHand),
          id,
        ]
      );
      if (result.rows.length === 0) throw new AppError("Book not found.", 404);

      if (quantity !== undefined && !Number.isNaN(Number(quantity)) && Number(quantity) >= 0) {
        await client.query(
          `UPDATE inventory SET quantity = $1, updated_at = now() WHERE book_id = $2`,
          [Number(quantity), id]
        );
      }

      await client.query("COMMIT");
      await invalidateBookCaches(id);
      res.json({ id: result.rows[0].id });
    } catch (err) {
      await client.query("ROLLBACK");
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
    const { quantity } = req.body;
    if (quantity === undefined || Number.isNaN(Number(quantity)) || Number(quantity) < 0) {
      throw new AppError("A valid, non-negative quantity is required.", 422);
    }
    const result = await pool.query(
      `UPDATE inventory SET quantity = $1, updated_at = now() WHERE book_id = $2 RETURNING book_id`,
      [Number(quantity), id]
    );
    if (result.rows.length === 0) throw new AppError("Book inventory record not found.", 404);
    await invalidateBookCaches(id);
    res.json({ bookId: result.rows[0].book_id, quantity: Number(quantity) });
  } catch (err) {
    next(err);
  }
}

export async function deleteBook(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) throw new AppError("Invalid book ID.", 400);
    const result = await pool.query("DELETE FROM books WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) throw new AppError("Book not found.", 404);
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