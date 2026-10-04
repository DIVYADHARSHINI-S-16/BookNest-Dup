-- Phase 2B migration: let a cart line optionally reference the specific
-- store listing it was added from. This is additive and non-destructive:
-- existing cart_items rows (store_id = NULL) keep working exactly as
-- before through the legacy global `inventory` table. A row only gets a
-- store_id when the customer explicitly adds a book from a store's
-- "Available at Stores" listing.

ALTER TABLE cart_items
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS store_price NUMERIC(10, 2);

CREATE INDEX IF NOT EXISTS idx_cart_items_store_id ON cart_items(store_id);

-- Note: cart_items keeps its existing UNIQUE (cart_id, book_id) constraint,
-- so a cart can only hold one line per book at a time, regardless of which
-- store it came from. Switching a line's store is done by changing its
-- store_id, not by adding a second row. This keeps the cart model simple
-- and matches the "no full multi-store checkout redesign in this phase"
-- scope — see migrations_phase2b notes in the Phase 2 summary.
