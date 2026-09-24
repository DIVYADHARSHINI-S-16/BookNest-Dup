import React, { useEffect, useState } from "react";
import { api } from "../../api/client";

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
}

export default function AdminCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ categories: Category[] }>("/categories");
    setCategories(res.categories);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  function startEdit(cat: Category) {
    setEditingId(cat.id);
    setName(cat.name);
    setDescription(cat.description || "");
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setError("Category name must be at least 2 characters.");
      return;
    }
    setError(null);
    try {
      if (editingId) {
        await api.put(`/categories/${editingId}`, { name: trimmedName, description: trimmedDescription });
      } else {
        await api.post("/categories", { name: trimmedName, description: trimmedDescription });
      }
      resetForm();
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this category?")) return;
    try {
      await api.delete(`/categories/${id}`);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Categories</h1>
      {error && <p className="admin-error">{error}</p>}

      <form className="admin-form" onSubmit={handleSubmit}>
        <strong>{editingId ? "Edit Category" : "Add Category"}</strong>
        <label>
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="admin-btn" type="submit">
            {editingId ? "Save Changes" : "Add Category"}
          </button>
          {editingId && (
            <button className="admin-btn secondary" type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Slug</th>
            <th>Description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr key={cat.id}>
              <td>{cat.name}</td>
              <td>{cat.slug}</td>
              <td>{cat.description}</td>
              <td style={{ display: "flex", gap: "0.4rem" }}>
                <button className="admin-btn secondary" onClick={() => startEdit(cat)}>
                  Edit
                </button>
                <button className="admin-btn danger" onClick={() => handleDelete(cat.id)}>
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
