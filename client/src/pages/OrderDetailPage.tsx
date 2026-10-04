import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
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
  items: OrderItem[];
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get<{ order: OrderDetail }>(`/orders/${id}`)
      .then((res) => setOrder(res.order))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <ErrorState message={error} />;
  if (!order) return <LoadingState label="Loading order…" />;

  return (
    <div>
      <h1 className="page-title">Order #{order.id.slice(0, 8)}</h1>
      <p className="page-subtitle">
        Placed {new Date(order.createdAt).toLocaleString()} · Status:{" "}
        <span className="badge">{order.status}</span>
      </p>

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
