import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { LoadingState, EmptyState, ErrorState } from "./StateBlocks";
import { orderStatusBadge, orderStatusLabel } from "./orderStatus";

interface StoreOrderItem {
  id: string;
  bookId: string;
  title: string;
  author: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface StoreOrder {
  id: string;
  status: string;
  createdAt: string;
  customer: { name: string; shippingAddress: string | null };
  items: StoreOrderItem[];
  storeTotal: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 10;
const money = (amount: number) => `₹${amount.toFixed(2)}`;

/**
 * Read-only list of orders containing this store's books. The server only
 * ever returns this store's own lines — nothing here filters for security.
 */
export default function StoreOrdersPanel() {
  const [orders, setOrders] = useState<StoreOrder[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ orders: StoreOrder[]; pagination: Pagination }>(`/stores/orders?page=${page}&limit=${PAGE_SIZE}`)
      .then((res) => {
        if (cancelled) return;
        setOrders(res.orders);
        setPagination(res.pagination);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || "Unable to load your orders.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  if (loading && !orders) return <LoadingState label="Loading your orders…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <h2 className="page-title" style={{ fontSize: "1.2rem", margin: 0 }}>
        My Store Orders
      </h2>
      <p className="page-subtitle">
        Orders that include books from your store. Only your own items are shown.
      </p>

      {!orders || orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          hint="When a customer buys a book from your store, the order will appear here."
        />
      ) : (
        <>
          {orders.map((order) => (
            <div key={order.id} className="card" style={{ padding: "1rem", marginTop: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <strong>Order #{order.id.slice(0, 8).toUpperCase()}</strong>
                  <br />
                  <small>{new Date(order.createdAt).toLocaleString()}</small>
                </div>
                <span className={orderStatusBadge(order.status)} style={{ alignSelf: "flex-start" }}>
                  {orderStatusLabel(order.status)}
                </span>
              </div>

              <p style={{ margin: "0.75rem 0 0" }}>
                <small>
                  <strong>Ship to:</strong> {order.customer.name}
                  <br />
                  {order.customer.shippingAddress || "No shipping address recorded."}
                </small>
              </p>

              <table className="table" style={{ marginTop: "0.75rem" }}>
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
                        <br />
                        <small>{item.author}</small>
                      </td>
                      <td>{item.quantity}</td>
                      <td>{money(item.unitPrice)}</td>
                      <td>{money(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: "right" }}>
                      <strong>Your store total</strong>
                    </td>
                    <td>
                      <strong>{money(order.storeTotal)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}

          {pagination && pagination.totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", marginTop: "1rem" }}>
              <button
                className="btn btn-outline btn-sm"
                disabled={loading || pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <small>
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} orders
              </small>
              <button
                className="btn btn-outline btn-sm"
                disabled={loading || pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
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
