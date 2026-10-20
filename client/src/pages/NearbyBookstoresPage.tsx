import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/StateBlocks";
import "../styles/nearby.css";

interface NearbyStore {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  distanceKm: number | null;
  availableBookCount: number;
}

interface NearbyResponse {
  stores: NearbyStore[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  search: { mode: "distance" | "text" | "browse"; radiusKm: number | null; unlocatedStoreCount?: number };
}

interface Point {
  latitude: number;
  longitude: number;
}

const RADIUS_OPTIONS = [5, 10, 25, 50, 100, 250];
const PAGE_SIZE = 12;

function describeGeoError(err: GeolocationPositionError | { code: number }): string {
  switch (err.code) {
    case 1: // PERMISSION_DENIED
      return "Location access was blocked, so we can't find stores near you automatically. You can search by city or postal code below, or enter coordinates manually.";
    case 2: // POSITION_UNAVAILABLE
      return "Your device couldn't work out its location right now. Please search by city or postal code below.";
    case 3: // TIMEOUT
      return "Finding your location took too long. Try again, or search by city or postal code below.";
    default:
      return "We couldn't get your location. Please search by city or postal code below.";
  }
}

export function formatAddress(s: Pick<NearbyStore, "address" | "city" | "state" | "postalCode" | "country">): string {
  const line2 = [s.city, [s.state, s.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [s.address, line2, s.country].filter(Boolean).join(" · ") || "Address not provided";
}

export default function NearbyBookstoresPage() {
  // The customer's location is held in component state only: never put in the URL,
  // localStorage, or any request other than the search itself.
  const [point, setPoint] = useState<Point | null>(null);
  const [radiusKm, setRadiusKm] = useState(25);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<NearbyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const requestId = useRef(0); // ignore responses from superseded searches

  const runSearch = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { page, limit: PAGE_SIZE };
      if (query) body.query = query;
      if (point) {
        body.latitude = point.latitude;
        body.longitude = point.longitude;
        body.radiusKm = radiusKm;
      }
      const res = await api.post<NearbyResponse>("/stores/nearby", body);
      if (id === requestId.current) setData(res);
    } catch (err: any) {
      if (id === requestId.current) {
        setData(null);
        setError(err?.message || "Unable to load bookstores.");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [point, radiusKm, query, page]);

  // Runs on first load (browse all stores, no location needed) and whenever the search changes.
  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  function handleUseMyLocation() {
    // Only ever called from a button click: the browser's permission prompt is user-initiated.
    setGeoMessage(null);
    if (!("geolocation" in navigator)) {
      setGeoMessage("Your browser doesn't support location lookup. Please search by city or postal code below.");
      setManualOpen(true);
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false);
        setPage(1);
        setPoint({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      (err) => {
        setGeoBusy(false);
        setGeoMessage(describeGeoError(err));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }

  function submitText(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  function submitManualCoordinates(e: React.FormEvent) {
    e.preventDefault();
    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (latInput.trim() === "" || lngInput.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setManualError("Enter both a latitude and a longitude as numbers, e.g. 13.0827 and 80.2707.");
      return;
    }
    if (lat < -90 || lat > 90) return setManualError("Latitude must be between -90 and 90.");
    if (lng < -180 || lng > 180) return setManualError("Longitude must be between -180 and 180.");
    setManualError(null);
    setGeoMessage(null);
    setPage(1);
    setPoint({ latitude: lat, longitude: lng });
  }

  function clearLocation() {
    setPoint(null);
    setGeoMessage(null);
    setPage(1);
  }

  function clearAll() {
    setPoint(null);
    setQuery("");
    setQueryInput("");
    setGeoMessage(null);
    setPage(1);
  }

  const mode = data?.search.mode;
  const unlocated = data?.search.unlocatedStoreCount ?? 0;

  return (
    <div className="nearby-page">
      <h1 className="page-title">Nearby Bookstores</h1>
      <p className="page-subtitle">
        Find independent bookstores on BookNest, see what they have in stock, and shop from the one closest to you.
      </p>

      <div className="card nearby-controls">
        <div className="nearby-controls-row">
          <button type="button" className="btn" onClick={handleUseMyLocation} disabled={geoBusy}>
            {geoBusy ? "Finding your location…" : point ? "Update my location" : "Use my current location"}
          </button>
          {point && (
            <button type="button" className="btn btn-outline" onClick={clearLocation}>
              Stop using my location
            </button>
          )}
          <div className="nearby-radius">
            <label htmlFor="nearby-radius">Within</label>
            <select
              id="nearby-radius"
              value={radiusKm}
              disabled={!point}
              onChange={(e) => {
                setPage(1);
                setRadiusKm(Number(e.target.value));
              }}
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="nearby-privacy">
          Location is optional. It is only used for this search, is never saved, and you can use the rest of BookNest
          without sharing it.
        </p>

        {geoMessage && (
          <div className="form-error" role="alert">
            {geoMessage}
          </div>
        )}

        <form className="nearby-search" onSubmit={submitText}>
          <label htmlFor="nearby-query" className="sr-only">
            City, area, postal code or store name
          </label>
          <input
            id="nearby-query"
            type="search"
            placeholder="Search by city, area, postal code or store name"
            value={queryInput}
            maxLength={100}
            onChange={(e) => setQueryInput(e.target.value)}
          />
          <button type="submit" className="btn btn-outline">
            Search
          </button>
        </form>

        <button
          type="button"
          className="nearby-link-button"
          aria-expanded={manualOpen}
          onClick={() => setManualOpen((v) => !v)}
        >
          {manualOpen ? "Hide manual coordinates" : "Enter coordinates manually"}
        </button>
        {manualOpen && (
          <form className="nearby-manual" onSubmit={submitManualCoordinates}>
            <div className="form-field">
              <label htmlFor="nearby-lat">Latitude</label>
              <input id="nearby-lat" inputMode="decimal" placeholder="13.0827" value={latInput} onChange={(e) => setLatInput(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="nearby-lng">Longitude</label>
              <input id="nearby-lng" inputMode="decimal" placeholder="80.2707" value={lngInput} onChange={(e) => setLngInput(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-outline">
              Use these coordinates
            </button>
            {manualError && <div className="form-error">{manualError}</div>}
          </form>
        )}
      </div>

      {loading && <LoadingState label="Finding bookstores…" />}

      {!loading && error && (
        <>
          <ErrorState message={error} />
          <div style={{ textAlign: "center" }}>
            <button type="button" className="btn btn-outline" onClick={() => void runSearch()}>
              Try again
            </button>
          </div>
        </>
      )}

      {!loading && !error && data && (
        <>
          <p className="section-count" aria-live="polite">
            {mode === "distance" && `${data.pagination.total} bookstore${data.pagination.total === 1 ? "" : "s"} within ${data.search.radiusKm} km, nearest first`}
            {mode === "text" && `${data.pagination.total} bookstore${data.pagination.total === 1 ? "" : "s"} matching "${query}"`}
            {mode === "browse" && `${data.pagination.total} participating bookstore${data.pagination.total === 1 ? "" : "s"}`}
          </p>

          {data.stores.length === 0 ? (
            <>
              <EmptyState
                title={mode === "distance" ? "No bookstores within this distance" : "No bookstores found"}
                hint={
                  mode === "distance"
                    ? `Try a larger radius${unlocated > 0 ? ", or browse all stores (some stores haven't set their map location yet)" : ""}.`
                    : "Try a different city, postal code or store name."
                }
              />
              <div style={{ textAlign: "center" }}>
                {mode === "distance" && radiusKm < 250 && (
                  <button type="button" className="btn" onClick={() => setRadiusKm(Math.min(250, radiusKm * 2))} style={{ marginRight: "0.5rem" }}>
                    Search within {Math.min(250, radiusKm * 2)} km
                  </button>
                )}
                <button type="button" className="btn btn-outline" onClick={clearAll}>
                  Browse all bookstores
                </button>
              </div>
            </>
          ) : (
            <ul className="nearby-list">
              {data.stores.map((store) => (
                <li key={store.id} className="card nearby-store">
                  <div className="nearby-store-main">
                    <h2 className="nearby-store-name">{store.name}</h2>
                    <p className="nearby-store-address">{formatAddress(store)}</p>
                    {store.description && <p className="nearby-store-desc">{store.description}</p>}
                    <p className="nearby-store-meta">
                      {store.distanceKm !== null && <span className="badge badge-success">{store.distanceKm} km away</span>}{" "}
                      <span className="badge">
                        {store.availableBookCount} book{store.availableBookCount === 1 ? "" : "s"} in stock
                      </span>
                    </p>
                  </div>
                  <Link className="btn btn-outline" to={`/nearby-stores/${store.id}`}>
                    View books
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {mode === "distance" && unlocated > 0 && data.stores.length > 0 && (
            <p className="nearby-note">
              {unlocated} other store{unlocated === 1 ? "" : "s"} {unlocated === 1 ? "hasn't" : "haven't"} set a map location yet and
              can't be ranked by distance.{" "}
              <button type="button" className="nearby-link-button" onClick={clearAll}>
                Browse all bookstores
              </button>
            </p>
          )}

          {data.pagination.totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-outline btn-sm" disabled={data.pagination.page <= 1} onClick={() => setPage(data.pagination.page - 1)}>
                Previous
              </button>
              <span>
                Page {data.pagination.page} of {data.pagination.totalPages}
              </span>
              <button
                className="btn btn-outline btn-sm"
                disabled={data.pagination.page >= data.pagination.totalPages}
                onClick={() => setPage(data.pagination.page + 1)}
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
