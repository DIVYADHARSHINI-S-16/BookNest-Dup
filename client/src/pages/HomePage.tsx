import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import BookCard, { BookSummary } from "../components/BookCard";
import { LoadingState, ErrorState, EmptyState } from "../components/StateBlocks";

interface Category {
  id: number;
  name: string;
  slug: string;
}

export default function HomePage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState(""); // "" = All
  const [searchTerm, setSearchTerm] = useState("");
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ categories: Category[] }>("/categories")
      .then((res) => setCategories(res.categories))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setBooks(null);
    setError(null);
    const query = new URLSearchParams();
    if (searchTerm.trim()) query.set("q", searchTerm.trim());
    if (activeCategory) query.set("category", activeCategory);
    query.set("sort", "newest");
    query.set("limit", "15");

    api
      .get<{ books: BookSummary[]; pagination: { total: number } }>(`/books?${query.toString()}`)
      .then((res) => {
        setBooks(res.books);
        setTotal(res.pagination.total);
      })
      .catch((err) => setError(err.message));
  }, [searchTerm, activeCategory]);

  return (
    <div>
      <section className="hero hero-centered">
        <p className="hero-eyebrow">Independent books, thoughtfully chosen</p>
        <h1 className="hero-title hero-title-centered">Discover your next book</h1>
        <p className="hero-subtitle hero-subtitle-centered">
          Explore books from independent bookstores.
        </p>

        <div className="hero-search-bar">
          <span className="hero-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            placeholder="Search books by title or author…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="category-pills">
          <button
            className={"category-pill" + (activeCategory === "" ? " active" : "")}
            onClick={() => setActiveCategory("")}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={"category-pill" + (activeCategory === c.slug ? " active" : "")}
              onClick={() => setActiveCategory(c.slug)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </section>

      <div className="section-heading-row">
        <h2 className="page-title" style={{ fontSize: "1.3rem", marginBottom: 0 }}>
          Our books
        </h2>
        {books && <span className="section-count">{total} title{total === 1 ? "" : "s"}</span>}
      </div>

      {error && <ErrorState message={error} />}
      {!error && !books && <LoadingState label="Loading books…" />}
      {books && books.length === 0 && (
        <EmptyState title="No books match your search" hint="Try a different title, author, or category." />
      )}
      {books && books.length > 0 && (
        <div className="grid-books" style={{ marginTop: "1rem" }}>
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}

      {books && total > books.length && (
        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <Link to="/books" className="btn btn-outline">
            View all {total} books →
          </Link>
        </div>
      )}
    </div>
  );
}
