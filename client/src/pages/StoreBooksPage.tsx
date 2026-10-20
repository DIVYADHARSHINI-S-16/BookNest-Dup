import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/StateBlocks";
import { formatAddress } from "./NearbyBookstoresPage";
import "../styles/nearby.css";

interface StoreBook {
  listingId: string;
  bookId: string;
  title: string;
  author: string;
  coverImageUrl: string | null;
  isSecondHand: boolean;
  price: number;
  availableQuantity: number;
}

interface StoreBooksResponse {
  store: {
    id: string;
    name: string;
    description: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
  books: StoreBook[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const PAGE_SIZE = 12;

export default function StoreBooksPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const [data, setData] = useState<StoreBooksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!storeId) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search) qs.set("search", search);
      const res = await api.get<StoreBooksResponse>(`/stores/${encodeURIComponent(storeId)}/books?${qs.toString()}`);
      if (id === requestId.current) setData(res);
    } catch (err: any) {
      if (id === requestId.current) {
        setData(null);
        setError({
          message: err?.status === 404 || err?.status === 400 ? "This bookstore isn't available." : err?.message || "Unable to load this bookstore.",
          notFound: err?.status === 404 || err?.status === 400,
        });
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [storeId, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const backLink = (
    <p>
      <Link to="/nearby-stores">← Back to Nearby Bookstores</Link>
    </p>
  );

  if (loading && !data) return <LoadingState label="Loading bookstore…" />;

  if (error && !data) {
    return (
      <div className="nearby-page">
        {backLink}
        <ErrorState message={error.message} />
        {!error.notFound && (
          <div style={{ textAlign: "center" }}>
            <button type="button" className="btn btn-outline" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="nearby-page">
      {backLink}
      <h1 className="page-title">{data.store.name}</h1>
      <p className="nearby-store-address">{formatAddress(data.store)}</p>
      {data.store.description && <p className="page-subtitle">{data.store.description}</p>}

      <form
        className="nearby-search"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <label htmlFor="store-book-search" className="sr-only">
          Search this store's books
        </label>
        <input
          id="store-book-search"
          type="search"
          placeholder="Search this store by title or author"
          value={searchInput}
          maxLength={100}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" className="btn btn-outline">
          Search
        </button>
      </form>

      {loading && <LoadingState label="Loading books…" />}
      {!loading && error && <ErrorState message={error.message} />}

      {!loading && !error && (
        <>
          <p className="section-count" aria-live="polite">
            {data.pagination.total} book{data.pagination.total === 1 ? "" : "s"} available{search ? ` matching "${search}"` : ""}
          </p>

          {data.books.length === 0 ? (
            <EmptyState
              title={search ? "No matching books in this store" : "This store has no books in stock right now"}
              hint={search ? "Try a different title or author." : "Check back soon, or browse another bookstore."}
            />
          ) : (
            <ul className="nearby-list">
              {data.books.map((book) => (
                <li key={book.listingId} className="card nearby-store">
                  <div className="nearby-store-main">
                    <h2 className="nearby-store-name">{book.title}</h2>
                    <p className="nearby-store-address">by {book.author}</p>
                    <p className="nearby-store-meta">
                      <strong>₹{book.price.toFixed(2)}</strong>{" "}
                      <span className={`badge ${book.availableQuantity <= 3 ? "badge-warning" : "badge-success"}`}>
                        {book.availableQuantity <= 3 ? `Only ${book.availableQuantity} left` : `${book.availableQuantity} available`}
                      </span>{" "}
                      {book.isSecondHand && <span className="badge">Second-hand</span>}
                    </p>
                  </div>
                  <Link className="btn btn-outline" to={`/books/${book.bookId}`}>
                    View book
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {data.pagination.totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-outline btn-sm" disabled={data.pagination.page <= 1} onClick={() => setPage(data.pagination.page - 1)}>
                Previous
              </button>
              <span>
                Page {data.pagination.page} of {data.pagination.totalPages}
              </span>
              <button
                className="btn btn-outline btn-sm"
                disabled={data.pagination.page >= data.pagination.totalPages}
                onClick={() => setPage(data.pagination.page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
