import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import { EmptyState, LoadingState } from "../components/StateBlocks";

export default function CartPage() {
  const { cart, loading, changeQuantity, removeItem } = useCart();
  const { showToast } = useToast();
  const navigate = useNavigate();

  async function handleQuantityChange(bookId: string, action: "increase" | "decrease") {
    try {
      await changeQuantity(bookId, action);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  async function handleRemove(bookId: string) {
    try {
      await removeItem(bookId);
      showToast("Removed from cart.", "info");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  }

  if (loading && cart.items.length === 0) return <LoadingState label="Loading your cart…" />;

  if (cart.items.length === 0) {
    return (
      <EmptyState title="Your cart is empty" hint="Browse the catalog to find something to read." />
    );
  }

  const hasStockIssue = cart.items.some((i) => i.exceedsStock);

  return (
    <div>
      <h1 className="page-title">Your Cart</h1>
      <p className="page-subtitle">{cart.itemCount} item(s)</p>

      <div className="cart-layout">
        <ul className="cart-list">
          {cart.items.map((item) => (
            <li key={item.cartItemId} className="card cart-item">
              <Link to={`/books/${item.bookId}`} className="cart-item-cover">
                {item.coverImageUrl ? (
                  <img src={item.coverImageUrl} alt={item.title} />
                ) : (
                  <div className="book-card-cover-placeholder">{item.title.charAt(0)}</div>
                )}
              </Link>
              <div className="cart-item-info">
                <Link to={`/books/${item.bookId}`} className="cart-item-title">
                  {item.title}
                </Link>
                <p className="cart-item-author">{item.author}</p>
                {item.storeName && (
                  <p className="badge" style={{ marginTop: "0.25rem" }}>
                    From {item.storeName}
                  </p>
                )}
                {item.exceedsStock && (
                  <p className="badge badge-danger">
                    Only {item.availableQuantity} in stock — reduce quantity
                  </p>
                )}
                <div className="cart-item-controls">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => handleQuantityChange(item.bookId, "decrease")}
                  >
                    −
                  </button>
                  <span>{item.quantity}</span>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => handleQuantityChange(item.bookId, "increase")}
                  >
                    +
                  </button>
                  <button
                    className="btn btn-sm"
                    style={{ marginLeft: "1rem", background: "transparent", color: "var(--color-danger)" }}
                    onClick={() => handleRemove(item.bookId)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="cart-item-price">₹{(item.unitPrice * item.quantity).toFixed(2)}</div>
            </li>
          ))}
        </ul>

        <div className="card cart-summary">
          <h3>Order Summary</h3>
          <div className="cart-summary-row">
            <span>Subtotal</span>
            <span>₹{cart.subtotal.toFixed(2)}</span>
          </div>
          <div className="cart-summary-row cart-summary-total">
            <span>Total</span>
            <span>₹{cart.total.toFixed(2)}</span>
          </div>
          <button
            className="btn btn-block"
            disabled={hasStockIssue}
            onClick={() => navigate("/checkout")}
          >
            Proceed to checkout
          </button>
          {hasStockIssue && (
            <p style={{ color: "var(--color-danger)", fontSize: "0.8rem", marginTop: "0.5rem" }}>
              Resolve the stock issue above before checking out.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
