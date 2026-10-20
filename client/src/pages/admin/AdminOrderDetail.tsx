import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { orderStatusLabel } from "../../components/orderStatus";

export default function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ order: any }>(`/orders/${id}`);
    setOrder(res.order);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleStatusChange(status: string) {
    if (status === "CANCELLED" && !window.confirm("Cancel this order? Its stock will be returned to inventory.")) return;
    setUpdating(true);
    setActionError(null);
    try {
      await api.patch(`/orders/${id}/status`, { status });
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setUpdating(false);
      await load().catch((err) => setError(err.message)); // always show the real current status
    }
  }

  if (error) return <p className="admin-error">{error}</p>;
  if (!order) return <p>Loading order…</p>;

  return (
    <div>
      <Link to="/admin/orders">&larr; Back to orders</Link>
      <h1 className="admin-page-title" style={{ marginTop: "0.5rem" }}>
        Order #{order.id.slice(0, 8)}
      </h1>
      <p>Placed {new Date(order.createdAt).toLocaleString()}</p>

      {actionError && <p className="admin-error">{actionError}</p>}

      <label style={{ display: "block", maxWidth: 220, marginBottom: "1.5rem" }}>
        Status
        <select
          value={order.status}
          disabled={updating || order.allowedNextStatuses.length === 0}
          onChange={(e) => handleStatusChange(e.target.value)}
        >
          {[order.status, ...order.allowedNextStatuses].map((s: string) => (
            <option key={s} value={s}>
              {orderStatusLabel(s)}
            </option>
          ))}
        </select>
      </label>

      <table className="admin-table" style={{ marginBottom: "1.5rem" }}>
        <thead>
          <tr>
            <th>Book</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Line Total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item: any) => (
            <tr key={item.id}>
              <td>
                {item.title}
                {item.storeName && (
                  <>
                    <br />
                    <small>From {item.storeName}</small>
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

      <p>
        <strong>Shipping address:</strong> {order.shippingAddress}
      </p>
      <p>
        <strong>Payment:</strong> {order.paymentMethod} ({order.paymentStatus})
      </p>
      <p>
        <strong>Total:</strong> ₹{order.total.toFixed(2)}
      </p>
    </div>
  );
}
