-- Phase 1F migration: Multi-store database foundation
-- This migration is additive and non-destructive.
-- The existing global inventory table remains untouched for now so legacy
-- BookNest behavior continues unchanged while a future phase can map it to
-- store-specific inventory rows for each bookstore.

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('customer', 'admin', 'store_owner'));

CREATE TABLE IF NOT EXISTS stores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name            VARCHAR(160) NOT NULL,
    slug            VARCHAR(160) NOT NULL UNIQUE,
    description     TEXT,
    email           VARCHAR(160),
    phone           VARCHAR(40),
    address         VARCHAR(255),
    city            VARCHAR(120),
    state           VARCHAR(120),
    postal_code     VARCHAR(40),
    country         VARCHAR(120) NOT NULL DEFAULT 'US',
    latitude        NUMERIC(9, 6),
    longitude       NUMERIC(9, 6),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stores_owner_user_id ON stores(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_stores_is_active ON stores(is_active);
CREATE INDEX IF NOT EXISTS idx_stores_city ON stores(city);

CREATE TABLE IF NOT EXISTS store_book_inventory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    quantity        INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved        INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    price           NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (store_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_store_book_inventory_store_id ON store_book_inventory(store_id);
CREATE INDEX IF NOT EXISTS idx_store_book_inventory_book_id ON store_book_inventory(book_id);
CREATE INDEX IF NOT EXISTS idx_store_book_inventory_is_active ON store_book_inventory(is_active);

DROP TRIGGER IF EXISTS trg_stores_updated_at ON stores;
CREATE TRIGGER trg_stores_updated_at BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Safe migration strategy:
-- 1. Existing rows in inventory remain untouched and still represent the legacy
--    global catalog stock.
-- 2. In a later multi-store phase, a store owner can create a store and then
--    associate the legacy inventory by inserting appropriate rows into
--    store_book_inventory (for example, mapping the existing inventory values to a
--    newly created default store for that owner).
-- 3. Nothing is deleted or rewritten here, so current BookNest customers and
--    administrators keep the same operational inventory behavior.
