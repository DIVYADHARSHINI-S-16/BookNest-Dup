import React, { useEffect, useState } from "react";
import { api } from "../../api/client";

interface Book {
  id: string;
  title: string;
  author: string;
  quantity: number;
}

export default function AdminInventory() {
  const [books, setBooks] = useState<Book[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ books: Book[] }>("/books?limit=50&sort=title");
    setBooks(res.books);
    const initialDrafts: Record<string, string> = {};
    res.books.forEach((b) => (initialDrafts[b.id] = String(b.quantity)));
    setDrafts(initialDrafts);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function saveQuantity(bookId: string) {
    const nextQuantity = Number(drafts[bookId]);
    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
      setError("Stock quantity must be a non-negative whole number.");
      return;
    }
    setError(null);
    setSavingId(bookId);
    try {
      await api.patch(`/books/${bookId}/inventory`, { quantity: nextQuantity });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Inventory</h1>
      {error && <p className="admin-error">{error}</p>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Author</th>
            <th>Total Stock</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
            <tr key={book.id}>
              <td>{book.title}</td>
              <td>{book.author}</td>
              <td>
                <input
                  type="number"
                  min="0"
                  style={{ width: 80, padding: "0.3rem" }}
                  value={drafts[book.id] ?? ""}
                  onChange={(e) => setDrafts({ ...drafts, [book.id]: e.target.value })}
                />
              </td>
              <td>
                <button
                  className="admin-btn"
                  disabled={savingId === book.id}
                  onClick={() => saveQuantity(book.id)}
                >
                  {savingId === book.id ? "Saving…" : "Update"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
