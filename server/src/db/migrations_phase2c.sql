-- Phase 2C migration: let an order line record which store fulfilled it.
-- Additive and non-destructive: existing order_items rows (store_id = NULL)
-- are catalog-fulfilled orders and are completely unaffected.

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_store_id ON order_items(store_id);
