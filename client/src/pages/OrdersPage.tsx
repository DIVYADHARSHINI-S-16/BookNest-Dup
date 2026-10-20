import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { LoadingState, ErrorState, EmptyState } from "../components/StateBlocks";
import { orderStatusBadge, orderStatusLabel } from "../components/orderStatus";

interface Order {
  id: string;
  status: string;
  total: number;
  createdAt: string;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ orders: Order[] }>("/orders")
      .then((res) => setOrders(res.orders))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!orders) return <LoadingState label="Loading your orders…" />;
  if (orders.length === 0) {
    return <EmptyState title="No orders yet" hint="Your placed orders will show up here." />;
  }

  return (
    <div>
      <h1 className="page-title">Your Orders</h1>

      <table className="table" style={{ maxWidth: 720 }}>
        <thead>
          <tr>
            <th>Order</th>
            <th>Placed</th>
            <th>Total</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>{order.id.slice(0, 8)}…</td>
              <td>{new Date(order.createdAt).toLocaleDateString()}</td>
              <td>₹{order.total.toFixed(2)}</td>
              <td>
                <span className={orderStatusBadge(order.status)}>{orderStatusLabel(order.status)}</span>
              </td>
              <td>
                <Link to={`/orders/${order.id}`}>View details</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
