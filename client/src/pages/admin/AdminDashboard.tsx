import React, { useEffect, useState } from "react";
import { api } from "../../api/client";

interface DashboardStats {
  totalBooks: number;
  totalCustomers: number;
  totalOrders: number;
  totalReviews: number;
  totalRevenue: number;
  ordersByStatus: Record<string, number>;
  lowStockThreshold: number;
  lowStockBooks: { id: string; title: string; author: string; availableQuantity: number }[];
  availableInventory: number;
  recentOrders: {
    id: string;
    status: string;
    total: number;
    createdAt: string;
    customerName: string;
    customerEmail: string;
  }[];
  popularBooks: { id: string; title: string; author: string; unitsSold: number }[];
  categoryStats: { id: number; name: string; bookCount: number; unitsSold: number }[];
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardStats>("/admin/dashboard")
      .then(setStats)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="admin-error">{error}</p>;
  if (!stats) return <p>Loading dashboard…</p>;

  return (
    <div>
      <h1 className="admin-page-title">Dashboard</h1>

      <div className="admin-stat-grid">
        <StatCard label="Total Books" value={stats.totalBooks} />
        <StatCard label="Total Customers" value={stats.totalCustomers} />
        <StatCard label="Total Orders" value={stats.totalOrders} />
        <StatCard label="Total Reviews" value={stats.totalReviews} />
        <StatCard label="Revenue (non-cancelled)" value={`₹${stats.totalRevenue.toFixed(2)}`} />
        <StatCard label="Low-Stock Books" value={stats.lowStockBooks.length} />
        <StatCard label="Available Inventory" value={stats.availableInventory} />
      </div>

      <h2 className="admin-page-title" style={{ fontSize: "1.1rem" }}>
        Orders by Status
      </h2>
      <table className="admin-table" style={{ marginBottom: "2rem", maxWidth: 480 }}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(stats.ordersByStatus).map(([status, count]) => (
            <tr key={status}>
              <td>{status}</td>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="admin-page-title" style={{ fontSize: "1.1rem" }}>
        Low Stock (≤ {stats.lowStockThreshold} copies)
      </h2>
      {stats.lowStockBooks.length === 0 ? (
        <p>No books are currently low on stock.</p>
      ) : (
        <table className="admin-table" style={{ maxWidth: 600 }}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Author</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {stats.lowStockBooks.map((book) => (
              <tr key={book.id}>
                <td>{book.title}</td>
                <td>{book.author}</td>
                <td>
                  <span
                    className={"admin-badge" + (book.availableQuantity === 0 ? " low" : "")}
                  >
                    {book.availableQuantity}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="admin-page-title" style={{ fontSize: "1.1rem" }}>
        Recent Orders
      </h2>
      {stats.recentOrders.length === 0 ? (
        <p>No orders yet.</p>
      ) : (
        <table className="admin-table" style={{ marginBottom: "2rem", maxWidth: 700 }}>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {stats.recentOrders.map((order) => (
              <tr key={order.id}>
                <td>
                  {order.customerName}
                  <br />
                  <small>{order.customerEmail}</small>
                </td>
                <td>{order.status}</td>
                <td>₹{order.total.toFixed(2)}</td>
                <td>{new Date(order.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="admin-page-title" style={{ fontSize: "1.1rem" }}>
        Popular Books
      </h2>
      {stats.popularBooks.length === 0 ? (
        <p>No books have been ordered yet.</p>
      ) : (
        <table className="admin-table" style={{ marginBottom: "2rem", maxWidth: 600 }}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Author</th>
              <th>Units Sold</th>
            </tr>
          </thead>
          <tbody>
            {stats.popularBooks.map((book) => (
              <tr key={book.id}>
                <td>{book.title}</td>
                <td>{book.author}</td>
                <td>{book.unitsSold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="admin-page-title" style={{ fontSize: "1.1rem" }}>
        Category Breakdown
      </h2>
      {stats.categoryStats.length === 0 ? (
        <p>No categories yet.</p>
      ) : (
        <table className="admin-table" style={{ maxWidth: 600 }}>
          <thead>
            <tr>
              <th>Category</th>
              <th>Books</th>
              <th>Units Sold</th>
            </tr>
          </thead>
          <tbody>
            {stats.categoryStats.map((cat) => (
              <tr key={cat.id}>
                <td>{cat.name}</td>
                <td>{cat.bookCount}</td>
                <td>{cat.unitsSold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="admin-stat-card">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
