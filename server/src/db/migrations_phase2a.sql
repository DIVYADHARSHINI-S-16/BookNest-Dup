-- Phase 2A migration: enforce one store per owner.
-- This is a safe additive constraint to prevent duplicate storefront creation
-- for the same store_owner while preserving the existing stores table.

ALTER TABLE stores
    ADD CONSTRAINT stores_owner_user_id_unique UNIQUE (owner_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_owner_user_id_unique
    ON stores(owner_user_id);
