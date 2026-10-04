-- Phase 2A migration: enforce one store per owner (safe to re-run).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_owner_user_id_unique') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_owner_user_id_unique UNIQUE (owner_user_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_owner_user_id_unique
    ON stores(owner_user_id);