-- Phase 3, Task 2: order lifecycle and cancellation with transactional stock restoration.
-- Additive and idempotent. Existing rows and constraints are untouched; orders that
-- were already CANCELLED before this migration keep NULL timestamps (their stock was
-- never restored and is deliberately not guessed at).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
-- Set in the same statement that flips the order to CANCELLED. Non-NULL means the
-- order's stock has been put back; it is the "restored exactly once" marker.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_restored_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_stock_restored_only_if_cancelled') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_stock_restored_only_if_cancelled
        CHECK (stock_restored_at IS NULL OR status = 'CANCELLED');
  END IF;
END $$;
