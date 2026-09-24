import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import BookCard, { BookSummary } from "../components/BookCard";
import { EmptyState, ErrorState } from "../components/StateBlocks";

interface Category {
  id: number;
  name: string;
  slug: string;
}

type RecommendationBook = BookSummary & {
  category: { name: string; slug?: string };
};

interface RecommendationItem {
  book: RecommendationBook;
  score: number;
  reasons: string[];
}

function getPriceBucketLabel(priceRange: string) {
  if (priceRange === "under_300") return "Under ₹300";
  if (priceRange === "300_600") return "₹300 – ₹600";
  if (priceRange === "over_600") return "Over ₹600";
  return "Any price";
}

function scoreBook(
  book: RecommendationBook,
  prefs: { category: string; priceRange: string; availability: string; condition: string }
) {
  let score = 0;
  const reasons: string[] = [];

  if (prefs.category && book.category.slug === prefs.category) {
    score += 45;
    reasons.push("Matching genre");
  }

  if (prefs.priceRange) {
    const price = Number(book.price);
    if (prefs.priceRange === "under_300" && price <= 300) {
      score += 30;
      reasons.push("Budget fit");
    } else if (prefs.priceRange === "300_600" && price >= 300 && price <= 600) {
      score += 30;
      reasons.push("Budget fit");
    } else if (prefs.priceRange === "over_600" && price > 600) {
      score += 30;
      reasons.push("Budget fit");
    } else if (prefs.priceRange === "under_300" && price <= 350) {
      score += 12;
      reasons.push("Close to budget");
    } else if (prefs.priceRange === "300_600" && price >= 250 && price <= 700) {
      score += 12;
      reasons.push("Close to budget");
    } else if (prefs.priceRange === "over_600" && price >= 500) {
      score += 12;
      reasons.push("Close to budget");
    }
  }

  if (prefs.availability === "in_stock" && book.inStock) {
    score += 25;
    reasons.push("Ready to ship");
  } else if (prefs.availability === "in_stock" && !book.inStock) {
    score -= 20;
  }

  if (prefs.condition === "true" && book.isSecondHand) {
    score += 25;
    reasons.push("Second-hand match");
  } else if (prefs.condition === "false" && !book.isSecondHand) {
    score += 25;
    reasons.push("New copy match");
  } else if (prefs.condition === "true" && !book.isSecondHand) {
    score -= 15;
  } else if (prefs.condition === "false" && book.isSecondHand) {
    score -= 15;
  }

  if (book.inStock) {
    score += 8;
    reasons.push("Available now");
  }

  if (typeof book.averageRating === "number" && book.averageRating > 0) {
    score += Math.min(15, Math.round(book.averageRating * 3));
    reasons.push("Popular with readers");
  }

  return { score, reasons };
}

export default function HelpMeChoosePage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [category, setCategory] = useState("");
  const [priceRange, setPriceRange] = useState("");
  const [availability, setAvailability] = useState("in_stock");
  const [condition, setCondition] = useState("");

  useEffect(() => {
    api.get<{ categories: Category[] }>("/categories").then((res) => setCategories(res.categories));
  }, []);

  const rankedResults = useMemo(
    () => [...recommendations].sort((a, b) => b.score - a.score).slice(0, 12),
    [recommendations]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSubmitted(true);

    try {
      const query = new URLSearchParams();
      query.set("limit", "50");
      query.set("sort", "rating");
      if (category) query.set("category", category);
      if (availability) query.set("availability", availability);
      if (condition) query.set("secondHand", condition);
      if (priceRange === "under_300") query.set("maxPrice", "300");
      if (priceRange === "300_600") {
        query.set("minPrice", "300");
        query.set("maxPrice", "600");
      }
      if (priceRange === "over_600") query.set("minPrice", "600");

      const res = await api.get<{ books: RecommendationBook[] }>(`/books?${query.toString()}`);

      const prefs = { category, priceRange, availability, condition };
      const nextRecommendations = res.books
        .map((book) => {
          const { score, reasons } = scoreBook(book, prefs);
          return { book, score, reasons };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

      setRecommendations(nextRecommendations);
    } catch (err: any) {
      setRecommendations([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Help Me Choose a Book</h1>
      <p className="page-subtitle">
        Answer a few quick questions and we'll rank the best matches for you.
      </p>

      <form
        className="filters-bar card"
        style={{ flexDirection: "column", alignItems: "stretch", gap: "1rem", maxWidth: 420 }}
        onSubmit={handleSubmit}
      >
        <label>
          What genre are you in the mood for?
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any genre</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          What&apos;s your budget?
          <select value={priceRange} onChange={(e) => setPriceRange(e.target.value)}>
            <option value="">Any price</option>
            <option value="under_300">Under ₹300</option>
            <option value="300_600">₹300 – ₹600</option>
            <option value="over_600">Over ₹600</option>
          </select>
        </label>

        <label>
          Should it be ready to ship now?
          <select value={availability} onChange={(e) => setAvailability(e.target.value)}>
            <option value="">Doesn&apos;t matter</option>
            <option value="in_stock">Yes, in stock only</option>
          </select>
        </label>

        <label>
          New or second-hand?
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">Either is fine</option>
            <option value="false">New only</option>
            <option value="true">Second-hand only</option>
          </select>
        </label>

        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Finding matches…" : "Show me books"}
        </button>
      </form>

      {submitted && !loading && (
        <div style={{ marginTop: "1.5rem" }}>
          {error ? (
            <ErrorState message={error} />
          ) : rankedResults.length === 0 ? (
            <EmptyState
              title="No books match your selected preferences"
              hint="Try broadening your price, category, or availability choices."
            />
          ) : (
            <>
              <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
                <strong>Recommended for you:</strong> books are matched based on your selected category,
                budget, availability, and format preferences, then ranked by relevance.
              </div>

              <div className="grid-books">
                {rankedResults.map(({ book, score, reasons }, index) => (
                  <div key={book.id} style={{ position: "relative" }}>
                    {index === 0 && (
                      <span className="badge" style={{ position: "absolute", top: 10, right: 10, zIndex: 1 }}>
                        Best match
                      </span>
                    )}
                    <div style={{ marginBottom: "0.35rem", fontSize: "0.75rem", color: "#546" }}>
                      Match score: {score} · {reasons[0]}
                    </div>
                    <BookCard book={book} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!submitted && !loading && (
        <div className="card" style={{ marginTop: "1.5rem", padding: "1rem" }}>
          Choose your preferences to see the strongest matches from the current catalog.
        </div>
      )}

      {submitted && recommendations.length > 0 && !loading && (
        <p className="page-subtitle" style={{ marginTop: "1rem" }}>
          Showing {rankedResults.length} best matches for {getPriceBucketLabel(priceRange)}
          {category ? ` in ${categories.find((c) => c.slug === category)?.name || "this category"}` : " across the catalog"}
          {condition === "true" ? " in second-hand format" : condition === "false" ? " as new titles" : ""}.
        </p>
      )}
    </div>
  );
}
