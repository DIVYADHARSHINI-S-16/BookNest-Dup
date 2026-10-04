import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import BookCard, { BookSummary } from "../components/BookCard";
import { LoadingState, ErrorState, EmptyState } from "../components/StateBlocks";

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface BooksResponse {
  books: BookSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export default function BooksPage() {
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [data, setData] = useState<BooksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const q = params.get("q") || "";
  const category = params.get("category") || "";
  const availability = params.get("availability") || "";
  const sort = params.get("sort") || "newest";
  const page = params.get("page") || "1";
  const minPrice = params.get("minPrice") || "";
  const maxPrice = params.get("maxPrice") || "";
  const secondHand = params.get("secondHand") || "";

  useEffect(() => {
    api.get<{ categories: Category[] }>("/categories").then((res) => setCategories(res.categories));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (category) query.set("category", category);
    if (availability) query.set("availability", availability);
    if (minPrice) query.set("minPrice", minPrice);
    if (maxPrice) query.set("maxPrice", maxPrice);
    if (secondHand) query.set("secondHand", secondHand);
    query.set("sort", sort);
    query.set("page", page);
    query.set("limit", "15");

    api
      .get<BooksResponse>(`/books?${query.toString()}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    }, [q, category, availability, sort, page, minPrice, maxPrice, secondHand]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page"); // reset pagination on filter change only
    setParams(next);
  }

  return (
    <div>
          <h1 className="page-title">{secondHand === "true" ? "Second-Hand Books" : "Browse Books"}</h1>
      <p className="page-subtitle">
        {secondHand === "true"
          ? "Pre-loved copies, condition disclosed upfront."
          : "Search, filter, and sort the full catalog."}
      </p>

      <div className="filters-bar card">
        <input
          type="search"
          placeholder="Search title, author, ISBN..."
          defaultValue={q}
          onKeyDown={(e) => {
            if (e.key === "Enter") updateParam("q", (e.target as HTMLInputElement).value);
          }}
          onBlur={(e) => updateParam("q", e.target.value)}
        />

        <select value={category} onChange={(e) => updateParam("category", e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>

        <select value={availability} onChange={(e) => updateParam("availability", e.target.value)}>
          <option value="">Any availability</option>
          <option value="in_stock">In stock</option>
          <option value="out_of_stock">Out of stock</option>
        </select>

        <select value={secondHand} onChange={(e) => updateParam("secondHand", e.target.value)}>
          <option value="">New and second-hand</option>
          <option value="false">New only</option>
          <option value="true">Second-hand only</option>
        </select>

        <input
          type="number"
          placeholder="Min ₹"
          defaultValue={minPrice}
          onBlur={(e) => updateParam("minPrice", e.target.value)}
          style={{ width: 90 }}
        />
        <input
          type="number"
          placeholder="Max ₹"
          defaultValue={maxPrice}
          onBlur={(e) => updateParam("maxPrice", e.target.value)}
          style={{ width: 90 }}
        />

        <select value={sort} onChange={(e) => updateParam("sort", e.target.value)}>
          <option value="newest">Newest</option>
          <option value="title">Title A–Z</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="rating">Top rated</option>
        </select>
      </div>

      {error && <ErrorState message={error} />}
      {loading && <LoadingState label="Searching…" />}
      {!loading && data && data.books.length === 0 && (
        <EmptyState title="No books match your filters" hint="Try broadening your search." />
      )}
      {!loading && data && data.books.length > 0 && (
        <>
          <div className="grid-books">
            {data.books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>

          {data.pagination.totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-outline btn-sm"
                disabled={data.pagination.page <= 1}
                onClick={() => updateParam("page", String(data.pagination.page - 1))}
              >
                Previous
              </button>
              <span>
                Page {data.pagination.page} of {data.pagination.totalPages}
              </span>
              <button
                className="btn btn-outline btn-sm"
                disabled={data.pagination.page >= data.pagination.totalPages}
                onClick={() => updateParam("page", String(data.pagination.page + 1))}
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
