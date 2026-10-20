import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useCart } from "../context/CartContext";
import { EmptyState } from "../components/StateBlocks";

interface PriceChange {
  bookId: string;
  title: string;
  storeId: string;
  storeName: string | null;
  quantity: number;
  previousPrice: number;
  currentPrice: number;
}

interface PriceReview {
  priceChanges: PriceChange[];
  previousTotal: number;
  newTotal: number;
}

export default function CheckoutPage() {
  const { cart, refresh } = useCart();
  const navigate = useNavigate();

  const [shippingAddress, setShippingAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  // Set when the server says store prices changed; the customer must confirm them.
  const [priceReview, setPriceReview] = useState<PriceReview | null>(null);

  if (cart.items.length === 0) {
    return <EmptyState title="Your cart is empty" hint="Add a book before checking out." />;
  }

  async function handlePlaceOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPlacing(true);
    try {
      // After the customer has seen the updated prices, send them back as
      // confirmedPrices so the server knows they agreed to exactly these.
      const confirmedPrices = priceReview?.priceChanges.map((c) => ({
        bookId: c.bookId,
        storeId: c.storeId,
        unitPrice: c.currentPrice,
      }));
      const res = await api.post<{ order: { id: string } }>("/orders/checkout", {
        shippingAddress,
        ...(confirmedPrices ? { confirmedPrices } : {}),
      });
      await refresh();
      navigate("/order-success", { state: { orderId: res.order.id } });
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.data?.code === "PRICE_CHANGED") {
        // Nothing was charged. Show the new prices and wait for confirmation.
        setPriceReview({
          priceChanges: err.data.priceChanges,
          previousTotal: err.data.previousTotal,
          newTotal: err.data.newTotal,
        });
        await refresh();
      } else {
        setPriceReview(null);
        setError(err.message);
      }
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Checkout</h1>
      <p className="page-subtitle">Review your order and confirm shipping details.</p>

      <div className="cart-layout">
        <form className="card checkout-form" onSubmit={handlePlaceOrder}>
          {error && <div className="form-error">{error}</div>}

          {priceReview && (
            <div className="form-error" role="alert">
              <strong>Prices changed since you added these books.</strong>
              <ul>
                {priceReview.priceChanges.map((c) => (
                  <li key={c.bookId}>
                    {c.title}
                    {c.storeName ? ` (${c.storeName})` : ""}: ₹{c.previousPrice.toFixed(2)} → ₹
                    {c.currentPrice.toFixed(2)} × {c.quantity}
                  </li>
                ))}
              </ul>
              <p>
                Your new total is ₹{priceReview.newTotal.toFixed(2)} (was ₹
                {priceReview.previousTotal.toFixed(2)}). Nothing has been charged. Review and
                confirm below to place your order at the new price.
              </p>
            </div>
          )}

          <div className="form-field">
            <label htmlFor="address">Shipping address</label>
            <textarea
              id="address"
              rows={4}
              required
              minLength={5}
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
              placeholder="Street, city, state, PIN code"
            />
          </div>

          <div className="mock-payment-box">
            <strong>Payment</strong>
            <p>
              MOCK PAYMENT — no real payment gateway is connected. Placing this order will
              mark it as paid instantly for demonstration purposes only.
            </p>
          </div>

          <button className="btn btn-block" type="submit" disabled={placing}>
            {placing
              ? "Placing order…"
              : priceReview
                ? `Confirm new price — ₹${priceReview.newTotal.toFixed(2)}`
                : `Place order — ₹${cart.total.toFixed(2)}`}
          </button>
        </form>

        <div className="card cart-summary">
          <h3>Order Summary</h3>
          {cart.items.map((item) => (
            <div className="cart-summary-row" key={item.cartItemId}>
              <span>
                {item.title} × {item.quantity}
              </span>
              <span>₹{(item.unitPrice * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div className="cart-summary-row cart-summary-total">
            <span>Total</span>
            <span>₹{cart.total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
