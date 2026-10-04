import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../api/client";
import { LoadingState } from "../components/StateBlocks";
import StoreInventoryPanel from "../components/StoreInventoryPanel";

interface StoreFormState {
  name: string;
  slug: string;
  description: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

const emptyForm: StoreFormState = {
  name: "",
  slug: "",
  description: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

export default function StoreOwnerPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [store, setStore] = useState<any | null>(null);
  const [form, setForm] = useState<StoreFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  function mapStoreToForm(nextStore: any): StoreFormState {
    return {
      name: nextStore.name || "",
      slug: nextStore.slug || "",
      description: nextStore.description || "",
      email: nextStore.email || "",
      phone: nextStore.phone || "",
      address: nextStore.address || "",
      city: nextStore.city || "",
      state: nextStore.state || "",
      postalCode: nextStore.postalCode || "",
      country: nextStore.country || "US",
    };
  }

  async function loadStore() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ store: any }>('/stores');
      setStore(res.store);
      setForm(mapStoreToForm(res.store));
    } catch (err: any) {
      if (err.status === 404) {
        setStore(null);
        setForm(emptyForm);
        return;
      }
      setError(err.message || "Unable to load your store.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'store_owner') {
      void loadStore();
    }
  }, [user]);

  function updateField(field: keyof StoreFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const payload = {
        ...form,
        postalCode: form.postalCode,
      };

      const res = store
        ? await api.put<{ store: any }>('/stores', payload)
        : await api.post<{ store: any }>('/stores', payload);

      setStore(res.store);
      setForm(mapStoreToForm(res.store));
      showToast(store ? 'Store updated successfully.' : 'Store created successfully.', 'success');
    } catch (err: any) {
      setError(err.message || 'Unable to save the store.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading your store…" />;

  return (
    <div className="container page-shell" style={{ maxWidth: "920px" }}>
      <div className="card" style={{ padding: "2rem" }}>
        <h1 className="page-title">{store ? 'Your bookstore' : 'Create your bookstore'}</h1>
        <p className="page-subtitle">
          {store
            ? 'Manage the store information for your bookstore.'
            : 'Set up your BookNest storefront and publish your details.'}
        </p>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="grid grid-2">
            <div className="form-field">
              <label htmlFor="name">Store name</label>
              <input id="name" value={form.name} onChange={(e) => updateField('name', e.target.value)} required />
            </div>
            <div className="form-field">
              <label htmlFor="slug">Slug</label>
              <input id="slug" value={form.slug} onChange={(e) => updateField('slug', e.target.value)} required />
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="description">Description</label>
            <textarea id="description" value={form.description} onChange={(e) => updateField('description', e.target.value)} rows={4} />
          </div>

          <div className="grid grid-2">
            <div className="form-field">
              <label htmlFor="email">Store email</label>
              <input id="email" type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} required />
            </div>
            <div className="form-field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} />
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="address">Address</label>
            <input id="address" value={form.address} onChange={(e) => updateField('address', e.target.value)} required />
          </div>

          <div className="grid grid-3">
            <div className="form-field">
              <label htmlFor="city">City</label>
              <input id="city" value={form.city} onChange={(e) => updateField('city', e.target.value)} required />
            </div>
            <div className="form-field">
              <label htmlFor="state">State</label>
              <input id="state" value={form.state} onChange={(e) => updateField('state', e.target.value)} required />
            </div>
            <div className="form-field">
              <label htmlFor="postalCode">Postal code</label>
              <input id="postalCode" value={form.postalCode} onChange={(e) => updateField('postalCode', e.target.value)} required />
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="country">Country</label>
            <input id="country" value={form.country} onChange={(e) => updateField('country', e.target.value)} required />
          </div>

          <button className="btn btn-block" type="submit" disabled={submitting}>
            {submitting ? (store ? 'Saving changes…' : 'Creating store…') : (store ? 'Update store' : 'Create store')}
          </button>
        </form>
      </div>

      {store && (
        <div className="card" style={{ padding: "2rem", marginTop: "1.5rem" }}>
          <StoreInventoryPanel />
        </div>
      )}
    </div>
  );
}
