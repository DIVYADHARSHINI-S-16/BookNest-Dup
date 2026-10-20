-- Phase 3, Task 5: Book Request Management.
-- Additive only: creates two new tables. No existing table or row is touched.
-- Idempotent (IF NOT EXISTS), so re-running db:migrate is safe.

CREATE TABLE IF NOT EXISTS book_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title               VARCHAR(255) NOT NULL,
    author              VARCHAR(160) NOT NULL,
    isbn                VARCHAR(13),
    -- Lower-cased, whitespace-collapsed copies used only for duplicate detection.
    title_normalized    VARCHAR(255) NOT NULL,
    author_normalized   VARCHAR(160) NOT NULL,
    notes               VARCHAR(1000),
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'SUPPLIER_FOUND', 'FULFILLED', 'UNAVAILABLE', 'CANCELLED')),
    admin_notes         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT book_requests_isbn_format CHECK (isbn IS NULL OR isbn ~ '^([0-9]{9}[0-9X]|[0-9]{13})$')
);

CREATE INDEX IF NOT EXISTS idx_book_requests_user_created ON book_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_book_requests_status_created ON book_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_book_requests_isbn ON book_requests(isbn) WHERE isbn IS NOT NULL;

-- Race-proof duplicate guards, per customer: at most one OPEN request per
-- ISBN, and one OPEN ISBN-less request per normalized title+author.
-- Open = PENDING or SUPPLIER_FOUND. Once a request is closed the customer may
-- request the same book again. (Scoped per customer so one customer's request
-- never blocks, or reveals itself to, another customer.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_book_requests_open_isbn
    ON book_requests(user_id, isbn)
    WHERE isbn IS NOT NULL AND status IN ('PENDING', 'SUPPLIER_FOUND');
CREATE UNIQUE INDEX IF NOT EXISTS uq_book_requests_open_title_author
    ON book_requests(user_id, title_normalized, author_normalized)
    WHERE isbn IS NULL AND status IN ('PENDING', 'SUPPLIER_FOUND');

CREATE TABLE IF NOT EXISTS book_request_responses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES book_requests(id) ON DELETE CASCADE,
    store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    response        VARCHAR(20) NOT NULL CHECK (response IN ('CAN_SUPPLY', 'CANNOT_SUPPLY')),
    note            VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT book_request_responses_one_per_store UNIQUE (request_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_book_request_responses_store ON book_request_responses(store_id);
