import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fetchAllBooks } from "../../api/client";

interface Book {
  id: string;
  title: string;
  author: string;
  price: number;
  isSecondHand: boolean;
  availableQuantity: number;
  category: { name: string };
}

export default function AdminBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadBooks() {
    // The API returns at most 50 books per page; load every page.
    setBooks(await fetchAllBooks<Book>("sort=title"));
  }

  useEffect(() => {
    loadBooks().catch((err) => setError(err.message));
  }, []);

  async function handleDelete(id: string) {
    if (
      !confirm(
        "Delete this book permanently? Books that are in orders, customer carts or store listings can't be deleted."
      )
    )
      return;
    setError(null);
    try {
      await api.delete(`/books/${id}`);
      await loadBooks();
    } catch (err: any) {
      // A 409 carries the server's explanation (e.g. the book is in existing orders).
      const title = books.find((b) => b.id === id)?.title;
      const reason = err?.message || "Unable to delete this book.";
      setError(title ? `"${title}": ${reason}` : reason);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="admin-page-title">Books</h1>
        <Link className="admin-btn" to="/admin/books/new">
          + Add Book
        </Link>
      </div>
      {error && <p className="admin-error">{error}</p>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Author</th>
            <th>Category</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Second-hand</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
            <tr key={book.id}>
              <td>{book.title}</td>
              <td>{book.author}</td>
              <td>{book.category?.name}</td>
              <td>₹{book.price.toFixed(2)}</td>
              <td>{book.availableQuantity}</td>
              <td>{book.isSecondHand ? "Yes" : "No"}</td>
              <td style={{ display: "flex", gap: "0.4rem" }}>
                <Link className="admin-btn secondary" to={`/admin/books/${book.id}/edit`}>
                  Edit
                </Link>
                <button className="admin-btn danger" onClick={() => handleDelete(book.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
