import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../api/client";
import { LoadingState } from "../components/StateBlocks";
import StoreInventoryPanel from "../components/StoreInventoryPanel";
import StoreOrdersPanel from "../components/StoreOrdersPanel";
import StoreBookRequestsPanel from "../components/StoreBookRequestsPanel";

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
  latitude: string;
  longitude: string;
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
  latitude: "",
  longitude: "",
};

export default function StoreOwnerPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [store, setStore] = useState<any | null>(null);
  const [form, setForm] = useState<StoreFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

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
      // The API returns NUMERIC columns as strings like "13.082700"; show them without trailing zeros.
      latitude: nextStore.latitude != null && nextStore.latitude !== "" ? String(Number(nextStore.latitude)) : "",
      longitude: nextStore.longitude != null && nextStore.longitude !== "" ? String(Number(nextStore.longitude)) : "",
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

  // Explicit click only: fills the coordinate fields from this device's location (the owner is
  // normally standing in the shop). Nothing is saved until "Update store" is pressed.
  function fillFromDeviceLocation() {
    setLocationNote(null);
    if (!("geolocation" in navigator)) {
      setLocationNote("This browser can't look up your location. Enter the coordinates manually.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setForm((prev) => ({
          ...prev,
          latitude: String(Math.round(pos.coords.latitude * 1e6) / 1e6),
          longitude: String(Math.round(pos.coords.longitude * 1e6) / 1e6),
        }));
        setLocationNote("Coordinates filled in from this device. Check them, then press the save button.");
      },
      () => {
        setLocating(false);
        setLocationNote("Couldn't get this device's location. Enter the coordinates manually.");
      },
      { timeout: 10000 }
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const latBlank = form.latitude.trim() === "";
    const lngBlank = form.longitude.trim() === "";
    if (latBlank !== lngBlank) {
      setError("Enter both latitude and longitude, or leave both empty.");
      return;
    }
    if (!latBlank) {
      const lat = Number(form.latitude);
      const lng = Number(form.longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        setError("Latitude must be a number between -90 and 90.");
        return;
      }
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        setError("Longitude must be a number between -180 and 180.");
        return;
      }
    }
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

          <fieldset style={{ border: "1px solid var(--color-border)", borderRadius: "8px", padding: "1rem", margin: "0 0 1.25rem" }}>
            <legend style={{ padding: "0 0.4rem", fontWeight: 600 }}>Map location (optional)</legend>
            <p style={{ fontSize: "0.88rem", color: "var(--color-ink-soft)", marginTop: 0 }}>
              Add your shop's coordinates so customers can find you in <strong>Nearby Bookstores</strong> and see how far you are.
              Without them you still appear in the store list and in searches by city or postal code, just not ranked by
              distance. Tip: in Google Maps, right-click your shop and click the numbers to copy them.
            </p>
            <div className="grid grid-2">
              <div className="form-field">
                <label htmlFor="latitude">Latitude (-90 to 90)</label>
                <input id="latitude" inputMode="decimal" placeholder="e.g. 13.0827" value={form.latitude} onChange={(e) => updateField('latitude', e.target.value)} />
              </div>
              <div className="form-field">
                <label htmlFor="longitude">Longitude (-180 to 180)</label>
                <input id="longitude" inputMode="decimal" placeholder="e.g. 80.2707" value={form.longitude} onChange={(e) => updateField('longitude', e.target.value)} />
              </div>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={fillFromDeviceLocation} disabled={locating}>
              {locating ? 'Finding location…' : 'Fill from this device\'s location'}
            </button>
            {locationNote && <p style={{ fontSize: "0.85rem", margin: "0.6rem 0 0" }} role="status">{locationNote}</p>}
          </fieldset>

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

      {store && (
        <div className="card" style={{ padding: "2rem", marginTop: "1.5rem" }}>
          <StoreOrdersPanel />
        </div>
      )}

      {store && store.isActive && (
        <div className="card" style={{ padding: "2rem", marginTop: "1.5rem" }}>
          <StoreBookRequestsPanel />
        </div>
      )}
    </div>
  );
}
