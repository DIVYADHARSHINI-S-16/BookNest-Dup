-- Phase 3, Task 7: Nearby Bookstore Discovery
--
-- stores.address, city, state, postal_code, country, latitude and longitude
-- already exist (migrations_phase1f.sql), so NO columns are added here.
-- This migration is additive, idempotent and never rewrites or rejects data.

-- 1. Range checks, added NOT VALID.
--    NOT VALID means PostgreSQL enforces the rule for every INSERT/UPDATE from now
--    on but does NOT scan existing rows, so a legacy store holding an out-of-range
--    value cannot make this migration fail. (The search query also guards against
--    such legacy values at read time.) Comparisons with NUMERIC 'NaN' are false,
--    so NaN is rejected as well.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_latitude_range') THEN
        ALTER TABLE stores
            ADD CONSTRAINT stores_latitude_range
            CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_longitude_range') THEN
        ALTER TABLE stores
            ADD CONSTRAINT stores_longitude_range
            CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_coordinates_pair') THEN
        ALTER TABLE stores
            ADD CONSTRAINT stores_coordinates_pair
            CHECK ((latitude IS NULL) = (longitude IS NULL)) NOT VALID;
    END IF;
END $$;

-- 2. Partial B-tree index used by the nearby search's latitude-band prefilter
--    (WHERE is_active AND latitude BETWEEN x AND y). This is a plain B-tree, NOT
--    a spatial (GiST/PostGIS) index; the exact Haversine test runs on the rows
--    that survive the band. On a very small table PostgreSQL may still choose a
--    sequential scan, which is fine and expected.
CREATE INDEX IF NOT EXISTS idx_stores_active_latitude
    ON stores (latitude)
    WHERE is_active = true AND latitude IS NOT NULL AND longitude IS NOT NULL;
