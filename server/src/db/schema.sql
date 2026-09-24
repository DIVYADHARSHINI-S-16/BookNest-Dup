-- BookNest Phase 1 Database Schema
-- PostgreSQL

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- USERS
-- =========================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(120) NOT NULL,
    email           VARCHAR(160) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'customer'
                        CHECK (role IN ('customer', 'admin')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- CATEGORIES
-- =========================
CREATE TABLE IF NOT EXISTS categories (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(80) NOT NULL UNIQUE,
    slug            VARCHAR(80) NOT NULL UNIQUE,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- BOOKS
-- =========================
CREATE TABLE IF NOT EXISTS books (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(255) NOT NULL,
    author          VARCHAR(160) NOT NULL,
    description     TEXT,
    isbn            VARCHAR(20) UNIQUE,
    price           NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    cover_image_url TEXT,
    category_id     INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    is_second_hand  BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_books_category_id ON books(category_id);
CREATE INDEX IF NOT EXISTS idx_books_title ON books USING gin (to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_books_author ON books USING gin (to_tsvector('english', author));

-- =========================
-- SECOND-HAND CONDITIONS
-- =========================
CREATE TABLE IF NOT EXISTS second_hand_conditions (
    id              SERIAL PRIMARY KEY,
    book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    condition_grade VARCHAR(20) NOT NULL
                        CHECK (condition_grade IN ('LIKE_NEW', 'VERY_GOOD', 'GOOD', 'ACCEPTABLE')),
    condition_notes TEXT,
    price_override  NUMERIC(10, 2) CHECK (price_override >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_second_hand_book_id ON second_hand_conditions(book_id);

-- =========================
-- INVENTORY
-- =========================
CREATE TABLE IF NOT EXISTS inventory (
    id              SERIAL PRIMARY KEY,
    book_id         UUID NOT NULL UNIQUE REFERENCES books(id) ON DELETE CASCADE,
    quantity        INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved        INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- CART
-- =========================
CREATE TABLE IF NOT EXISTS cart (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id         UUID NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
    book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cart_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);

-- =========================
-- ORDERS
-- =========================
CREATE TABLE IF NOT EXISTS orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status          VARCHAR(20) NOT NULL DEFAULT 'PLACED'
                        CHECK (status IN ('PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
    subtotal        NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
    total           NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
    shipping_address TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    book_id         UUID NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- =========================
-- REVIEWS
-- =========================
CREATE TABLE IF NOT EXISTS reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (book_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_book_id ON reviews(book_id);

-- =========================
-- updated_at auto-touch trigger
-- =========================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_books_updated_at ON books;
CREATE TRIGGER trg_books_updated_at BEFORE UPDATE ON books
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_cart_updated_at ON cart;
CREATE TRIGGER trg_cart_updated_at BEFORE UPDATE ON cart
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();