import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import StarRating from "../components/StarRating";
import { LoadingState, ErrorState } from "../components/StateBlocks";

interface SecondHandCondition {
  conditionGrade: string;
  conditionNotes: string | null;
  coverCondition: string | null;
  pageCondition: string | null;
  visibleWear: string | null;
  additionalNotes: string | null;
  priceOverride: number | null;
}

interface BookDetail {
  id: string;
  title: string;
  author: string;
  description: string | null;
  price: number;
  coverImageUrl: string;
  isSecondHand: boolean;
  availableQuantity: number;
  inStock: boolean;
  category: { name: string };
  averageRating: number;
  reviewCount: number;
  secondHandCondition: SecondHandCondition | null;
}

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  reviewerName: string;
  createdAt: string;
}

const GRADE_LABELS: Record<string, string> = {
  LIKE_NEW: "Like New",
  VERY_GOOD: "Very Good",
  GOOD: "Good",
  ACCEPTABLE: "Acceptable",
};

export default function BookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { addToCart } = useCart();
  const { showToast } = useToast();

  const [book, setBook] = useState<BookDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addingToCart, setAddingToCart] = useState(false);

  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);

  async function loadReviews() {
    const res = await api.get<{ reviews: Review[] }>(`/books/${id}/reviews`);
    setReviews(res.reviews);
  }

  useEffect(() => {
    if (!id) return;
    api
      .get<{ book: BookDetail }>(`/books/${id}`)
      .then((res) => setBook(res.book))
      .catch((err) => setError(err.message));
    loadReviews().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleAddToCart() {
    if (!id) return;
    setAddingToCart(true);
    try {
      await addToCart(id, 1);
      showToast("Added to cart.", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setAddingToCart(false);
    }
  }

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setReviewError(null);
    setSubmittingReview(true);
    try {
      await api.post(`/books/${id}/reviews`, { rating: reviewRating, comment: reviewComment });
      setReviewComment("");
      setReviewRating(5);
      await loadReviews();
      showToast("Review posted.", "success");
    } catch (err: any) {
      setReviewError(err.message);
    } finally {
      setSubmittingReview(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!book) return <LoadingState label="Loading book…" />;

  return (
    <div>
      <div className="book-detail">
        <div className="book-detail-cover">
          {book.coverImageUrl ? (
            <img src={book.coverImageUrl} alt={book.title} />
          ) : (
            <div className="book-card-cover-placeholder" style={{ fontSize: "3.5rem" }}>
              {book.title.charAt(0)}
            </div>
          )}
        </div>

        <div className="book-detail-info">
          <span className="badge">{book.category.name}</span>
          {book.isSecondHand && <span className="badge" style={{ marginLeft: "0.4rem" }}>Second-hand</span>}

          <h1 className="page-title" style={{ marginTop: "0.5rem" }}>
            {book.title}
          </h1>
          <p className="page-subtitle" style={{ marginBottom: "0.5rem" }}>
            by {book.author}
          </p>

          {book.reviewCount > 0 && <StarRating rating={book.averageRating} count={book.reviewCount} />}

          <p className="book-detail-price">₹{(book.secondHandCondition?.priceOverride ?? book.price).toFixed(2)}</p>

          {book.inStock ? (
            <span className="badge badge-success">In stock ({book.availableQuantity} left)</span>
          ) : (
            <span className="badge badge-danger">Out of stock</span>
          )}

          {book.description && <p className="book-detail-description">{book.description}</p>}

          {user?.role === "customer" && (
            <button
              className="btn"
              style={{ marginTop: "1rem" }}
              disabled={!book.inStock || addingToCart}
              onClick={handleAddToCart}
            >
              {addingToCart ? "Adding…" : book.inStock ? "Add to cart" : "Out of stock"}
            </button>
          )}
          {!user && <p style={{ marginTop: "1rem" }}>Log in as a customer to add this to your cart.</p>}

          {book.isSecondHand && book.secondHandCondition && (
            <div className="second-hand-box card">
              <h3 style={{ fontSize: "1rem" }}>
                Condition: {GRADE_LABELS[book.secondHandCondition.conditionGrade] || book.secondHandCondition.conditionGrade}
              </h3>
              <dl>
                {book.secondHandCondition.coverCondition && (
                  <>
                    <dt>Cover</dt>
                    <dd>{book.secondHandCondition.coverCondition}</dd>
                  </>
                )}
                {book.secondHandCondition.pageCondition && (
                  <>
                    <dt>Pages</dt>
                    <dd>{book.secondHandCondition.pageCondition}</dd>
                  </>
                )}
                {book.secondHandCondition.visibleWear && (
                  <>
                    <dt>Visible wear</dt>
                    <dd>{book.secondHandCondition.visibleWear}</dd>
                  </>
                )}
                {book.secondHandCondition.additionalNotes && (
                  <>
                    <dt>Notes</dt>
                    <dd>{book.secondHandCondition.additionalNotes}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>

      <section className="reviews-section">
        <h2 className="page-title" style={{ fontSize: "1.3rem" }}>
          Reviews {book.reviewCount > 0 && `(${book.reviewCount})`}
        </h2>

        {user?.role === "customer" && (
          <form className="card review-form" onSubmit={handleReviewSubmit}>
            {reviewError && <div className="form-error">{reviewError}</div>}
            <div className="form-field">
              <label>Your rating</label>
              <select value={reviewRating} onChange={(e) => setReviewRating(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} star{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Comment (optional)</label>
              <textarea
                rows={3}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
              />
            </div>
            <button className="btn btn-sm" type="submit" disabled={submittingReview}>
              {submittingReview ? "Posting…" : "Post review"}
            </button>
          </form>
        )}

        {reviews.length === 0 ? (
          <p className="page-subtitle">No reviews yet. Be the first to write one.</p>
        ) : (
          <ul className="review-list">
            {reviews.map((r) => (
              <li key={r.id} className="card review-item">
                <div className="review-item-header">
                  <StarRating rating={r.rating} size="sm" />
                  <span className="review-item-author">{r.reviewerName}</span>
                  <span className="review-item-date">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {r.comment && <p>{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
