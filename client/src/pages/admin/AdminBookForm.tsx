import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";

interface Category {
  id: number;
  name: string;
}

const emptyForm = {
  title: "",
  author: "",
  description: "",
  isbn: "",
  price: "",
  coverImageUrl: "",
  categoryId: "",
  isSecondHand: false,
  quantity: "0",
};

export default function AdminBookForm() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ categories: Category[] }>("/categories")
      .then((res) => setCategories(res.categories))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!id) return;
    api
      .get<{ book: any }>(`/books/${id}`)
      .then((res) => {
        const b = res.book;
        setForm({
          title: b.title,
          author: b.author,
          description: b.description || "",
          isbn: b.isbn || "",
          price: String(b.price),
          coverImageUrl: b.coverImageUrl || "",
          categoryId: "", // category id not resolvable from slug-only response; admin re-selects
          isSecondHand: b.isSecondHand,
          quantity: String(b.availableQuantity),
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const title = form.title.trim();
    const author = form.author.trim();
    const price = Number(form.price);
    const quantity = Number(form.quantity);

    if (!title || !author) {
      setError("Title and author are required.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError("Price must be a valid non-negative number.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      setError("Stock quantity must be a non-negative whole number.");
      return;
    }
    if (!form.categoryId) {
      setError("Please select a category.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const payload = {
        title,
        author,
        description: form.description.trim() || undefined,
        isbn: form.isbn.trim() || undefined,
        price,
        coverImageUrl: form.coverImageUrl.trim(),
        categoryId: Number(form.categoryId),
        isSecondHand: form.isSecondHand,
        quantity,
      };

      if (isEditing) {
        await api.put(`/books/${id}`, payload);
      } else {
        await api.post("/books", payload);
      }
      navigate("/admin/books");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading book…</p>;

  return (
    <div>
      <h1 className="admin-page-title">{isEditing ? "Edit Book" : "Add Book"}</h1>
      {error && <p className="admin-error">{error}</p>}

      <form className="admin-form" onSubmit={handleSubmit}>
        <label>
          Title
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label>
          Author
          <input
            required
            value={form.author}
            onChange={(e) => setForm({ ...form, author: e.target.value })}
          />
        </label>
        <label>
          Description
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label>
          ISBN
          <input value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} />
        </label>
        <label>
          Price
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        </label>
        <label>
          Cover Image URL
          <input
            value={form.coverImageUrl}
            onChange={(e) => setForm({ ...form, coverImageUrl: e.target.value })}
          />
        </label>
        <label>
          Category
          <select
            required
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            <option value="">
              {isEditing ? "Re-select category" : "Select a category"}
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stock Quantity
          <input
            required
            type="number"
            min="0"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={form.isSecondHand}
            onChange={(e) => setForm({ ...form, isSecondHand: e.target.checked })}
          />
          Second-hand book
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="admin-btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : isEditing ? "Save Changes" : "Add Book"}
          </button>
          <button
            className="admin-btn secondary"
            type="button"
            onClick={() => navigate("/admin/books")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
