import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { LoadingState, EmptyState, ErrorState } from "./StateBlocks";

interface InventoryListing {
  id: string;
  bookId: string;
  title: string;
  author: string;
  price: number;
  quantity: number;
  reserved: number;
  availableQuantity: number;
  isActive: boolean;
}

interface BookOption {
  id: string;
  title: string;
  author: string;
}

export default function StoreInventoryPanel() {
  const { showToast } = useToast();

  const [inventory, setInventory] = useState<InventoryListing[] | null>(null);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newBookId, setNewBookId] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newQuantity, setNewQuantity] = useState("0");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Per-row edit state, keyed by bookId, so each row edits independently.
  const [edits, setEdits] = useState<Record<string, { price: string; quantity: string }>>({});
  const [savingBookId, setSavingBookId] = useState<string | null>(null);

  async function loadInventory() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ inventory: InventoryListing[] }>("/stores/inventory");
      setInventory(res.inventory);
      const nextEdits: Record<string, { price: string; quantity: string }> = {};
      res.inventory.forEach((item) => {
        nextEdits[item.bookId] = { price: String(item.price), quantity: String(item.quantity) };
      });
      setEdits(nextEdits);
    } catch (err: any) {
      setError(err.message || "Unable to load your inventory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInventory();
    api
      .get<{ books: BookOption[] }>("/books?limit=100&sort=title")
      .then((res) => setBooks(res.books))
      .catch(() => setBooks([]));
  }, []);

  async function handleAddBook(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);

    if (!newBookId) {
      setAddError("Choose a book to add.");
      return;
    }
    const priceNum = Number(newPrice);
    if (newPrice === "" || Number.isNaN(priceNum) || priceNum < 0) {
      setAddError("Enter a valid, non-negative price.");
      return;
    }
    const qtyNum = Number(newQuantity);
    if (!Number.isInteger(qtyNum) || qtyNum < 0) {
      setAddError("Enter a valid, non-negative whole-number quantity.");
      return;
    }

    setAdding(true);
    try {
      await api.post("/stores/inventory", { bookId: newBookId, price: priceNum, quantity: qtyNum });
      showToast("Book added to your store.", "success");
      setNewBookId("");
      setNewPrice("");
      setNewQuantity("0");
      setShowAddForm(false);
      await loadInventory();
    } catch (err: any) {
      setAddError(err.message || "Unable to add this book.");
    } finally {
      setAdding(false);
    }
  }

  async function handleSave(item: InventoryListing) {
    const edit = edits[item.bookId];
    const priceNum = Number(edit.price);
    const qtyNum = Number(edit.quantity);
    if (Number.isNaN(priceNum) || priceNum < 0) {
      showToast("Enter a valid, non-negative price.", "error");
      return;
    }
    if (!Number.isInteger(qtyNum) || qtyNum < 0) {
      showToast("Enter a valid, non-negative whole-number quantity.", "error");
      return;
    }

    setSavingBookId(item.bookId);
    try {
      await api.patch(`/stores/inventory/${item.bookId}`, { price: priceNum, quantity: qtyNum });
      showToast("Listing updated.", "success");
      await loadInventory();
    } catch (err: any) {
      showToast(err.message || "Unable to update this listing.", "error");
    } finally {
      setSavingBookId(null);
    }
  }

  async function handleToggleActive(item: InventoryListing) {
    setSavingBookId(item.bookId);
    try {
      await api.patch(`/stores/inventory/${item.bookId}`, { isActive: !item.isActive });
      showToast(item.isActive ? "Listing deactivated." : "Listing activated.", "success");
      await loadInventory();
    } catch (err: any) {
      showToast(err.message || "Unable to update this listing.", "error");
    } finally {
      setSavingBookId(null);
    }
  }

  async function handleRemove(item: InventoryListing) {
    if (!window.confirm(`Remove "${item.title}" from your store?`)) return;
    setSavingBookId(item.bookId);
    try {
      await api.delete(`/stores/inventory/${item.bookId}`);
      showToast("Listing removed.", "success");
      await loadInventory();
    } catch (err: any) {
      showToast(err.message || "Unable to remove this listing.", "error");
    } finally {
      setSavingBookId(null);
    }
  }

  if (loading) return <LoadingState label="Loading your inventory…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="page-title" style={{ fontSize: "1.2rem", margin: 0 }}>
          My Store Inventory
        </h2>
        <button className="btn btn-sm" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "Add Book"}
        </button>
      </div>

      {showAddForm && (
        <form className="card" style={{ padding: "1rem", margin: "1rem 0" }} onSubmit={handleAddBook}>
          {addError && <div className="form-error">{addError}</div>}
          <div className="form-field">
            <label>Book</label>
            <select value={newBookId} onChange={(e) => setNewBookId(e.target.value)} required>
              <option value="">Select an existing book…</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} — {b.author}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-2">
            <div className="form-field">
              <label>Price (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label>Quantity</label>
              <input
                type="number"
                min="0"
                step="1"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                required
              />
            </div>
          </div>
          <button className="btn btn-sm" type="submit" disabled={adding}>
            {adding ? "Adding…" : "Add to Inventory"}
          </button>
        </form>
      )}

      {!inventory || inventory.length === 0 ? (
        <EmptyState
          title="No books in your store yet"
          hint="Use Add Book to list an existing BookNest title with your own price and quantity."
        />
      ) : (
        <table className="table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Book</th>
              <th>Price (₹)</th>
              <th>Quantity</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item) => {
              const edit = edits[item.bookId] || { price: String(item.price), quantity: String(item.quantity) };
              const dirty = edit.price !== String(item.price) || edit.quantity !== String(item.quantity);
              const saving = savingBookId === item.bookId;
              return (
                <tr key={item.id}>
                  <td>
                    {item.title}
                    <br />
                    <small>{item.author}</small>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      style={{ width: 90 }}
                      value={edit.price}
                      onChange={(e) =>
                        setEdits((prev) => ({ ...prev, [item.bookId]: { ...edit, price: e.target.value } }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      style={{ width: 70 }}
                      value={edit.quantity}
                      onChange={(e) =>
                        setEdits((prev) => ({ ...prev, [item.bookId]: { ...edit, quantity: e.target.value } }))
                      }
                    />
                    {item.reserved > 0 && (
                      <div>
                        <small>{item.reserved} reserved in carts</small>
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${item.isActive ? "badge-success" : "badge-danger"}`}>
                      {item.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={!dirty || saving}
                      onClick={() => handleSave(item)}
                    >
                      Save
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={saving}
                      onClick={() => handleToggleActive(item)}
                    >
                      {item.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ background: "transparent", color: "var(--color-danger)" }}
                      disabled={saving}
                      onClick={() => handleRemove(item)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
