import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { orderStatusBadge, orderStatusLabel } from "../components/orderStatus";
import { LoadingState, ErrorState } from "../components/StateBlocks";

interface OrderItem {
  id: string;
  title: string;
  author: string;
  coverImageUrl: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  storeId?: string | null;
  storeName?: string | null;
}

interface OrderDetail {
  id: string;
  status: string;
  subtotal: number;
  total: number;
  shippingAddress: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  canCancel?: boolean;
  items: OrderItem[];
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    if (!id) return;
    const res = await api.get<{ order: OrderDetail }>(`/orders/${id}`);
    setOrder(res.order);
  }, [id]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function handleCancel() {
    if (!window.confirm("Cancel this order? The books will be returned to stock.")) return;
    setCancelling(true);
    try {
      await api.post(`/orders/${id}/cancel`);
      showToast("Order cancelled.", "success");
    } catch (err: any) {
      showToast(err.message, "error"); // e.g. it was packed in the meantime
    } finally {
      setCancelling(false);
      await load().catch(() => undefined); // always show the order's real current status
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!order) return <LoadingState label="Loading order…" />;

  return (
    <div>
      <h1 className="page-title">Order #{order.id.slice(0, 8)}</h1>
      <p className="page-subtitle">
        Placed {new Date(order.createdAt).toLocaleString()} · Status:{" "}
        <span className={orderStatusBadge(order.status)}>{orderStatusLabel(order.status)}</span>
      </p>
      {order.canCancel && (
        <button className="btn btn-outline btn-sm" style={{ marginBottom: "1rem" }} disabled={cancelling} onClick={handleCancel}>
          {cancelling ? "Cancelling…" : "Cancel order"}
        </button>
      )}

      <div className="cart-layout">
        <div>
          <table className="table" style={{ marginBottom: "1.5rem" }}>
            <thead>
              <tr>
                <th>Book</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.title}
                    {item.storeName && (
                      <>
                        <br />
                        <small className="badge">From {item.storeName}</small>
                      </>
                    )}
                  </td>
                  <td>{item.quantity}</td>
                  <td>₹{item.unitPrice.toFixed(2)}</td>
                  <td>₹{item.lineTotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="card" style={{ padding: "1rem 1.1rem" }}>
            <strong>Shipping address</strong>
            <p style={{ margin: "0.3rem 0 0" }}>{order.shippingAddress}</p>
          </div>
        </div>

        <div className="card cart-summary">
          <h3>Payment</h3>
          <div className="cart-summary-row">
            <span>Method</span>
            <span>{order.paymentMethod} (mock)</span>
          </div>
          <div className="cart-summary-row">
            <span>Status</span>
            <span>{order.paymentStatus}</span>
          </div>
          <div className="cart-summary-row">
            <span>Subtotal</span>
            <span>₹{order.subtotal.toFixed(2)}</span>
          </div>
          <div className="cart-summary-row cart-summary-total">
            <span>Total</span>
            <span>₹{order.total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
