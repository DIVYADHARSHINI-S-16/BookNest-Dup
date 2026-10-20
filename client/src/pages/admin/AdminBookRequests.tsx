import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { Pagination, REQUEST_STATUS_LABEL } from "../../components/bookRequestShared";

interface AdminRequest {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  notes: string | null;
  status: string;
  adminNotes: string | null;
  customer: { id: string; name: string; email: string };
  responseCount: number;
  offerCount: number;
  allowedNextStatuses: string[];
  createdAt: string;
}
interface AdminResponse {
  id: string;
  storeName: string;
  city: string | null;
  response: string;
  note: string | null;
  updatedAt: string;
}

const STATUSES = ["PENDING", "SUPPLIER_FOUND", "FULFILLED", "UNAVAILABLE", "CANCELLED"];
const PAGE_SIZE = 15;

export default function AdminBookRequests() {
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [openId, setOpenId] = useState<string | null>(null);
  const [responses, setResponses] = useState<AdminResponse[]>([]);
  const [nextStatus, setNextStatus] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (statusFilter) params.set("status", statusFilter);
      if (query) params.set("q", query);
      const res = await api.get<{ requests: AdminRequest[]; pagination: Pagination }>(`/admin/book-requests?${params}`);
      setRequests(res.requests);
      setPagination(res.pagination);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, query]);

  useEffect(() => {
    load();
  }, [load]);

  async function open(r: AdminRequest) {
    if (openId === r.id) {
      setOpenId(null);
      return;
    }
    setOpenId(r.id);
    setNextStatus("");
    setAdminNotes(r.adminNotes ?? "");
    setResponses([]);
    try {
      const res = await api.get<{ responses: AdminResponse[] }>(`/admin/book-requests/${r.id}`);
      setResponses(res.responses);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function save(r: AdminRequest) {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (nextStatus) body.status = nextStatus;
      if (adminNotes !== (r.adminNotes ?? "")) body.adminNotes = adminNotes;
      if (Object.keys(body).length === 0) {
        setError("Nothing to save: change the status or the notes first.");
        return;
      }
      await api.patch(`/admin/book-requests/${r.id}`, body);
      setOpenId(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Book Requests</h1>
      {error && <p className="admin-error">{error}</p>}

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem", alignItems: "flex-end" }}>
        <label style={{ maxWidth: 220 }}>
          Filter by status
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{REQUEST_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()); }} style={{ display: "flex", gap: "0.5rem" }}>
          <input type="search" placeholder="Title, author or ISBN" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="admin-btn secondary" type="submit">Search</button>
        </form>
      </div>

      {loading && <p className="admin-loading">Loading…</p>}
      {!loading && requests.length === 0 && <p>No book requests found.</p>}

      {requests.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Book</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Responses</th>
                <th>Submitted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td>
                      {r.title}
                      <br />
                      <small>{r.author}{r.isbn ? ` · ${r.isbn}` : ""}</small>
                    </td>
                    <td>
                      {r.customer.name}
                      <br />
                      <small>{r.customer.email}</small>
                    </td>
                    <td>{REQUEST_STATUS_LABEL[r.status] || r.status}</td>
                    <td>{r.responseCount} ({r.offerCount} can supply)</td>
                    <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button className="admin-btn secondary" onClick={() => open(r)}>{openId === r.id ? "Close" : "Review"}</button>
                    </td>
                  </tr>
                  {openId === r.id && (
                    <tr>
                      <td colSpan={6}>
                        {r.notes && <p><strong>Customer note:</strong> {r.notes}</p>}
                        <h3>Store responses</h3>
                        {responses.length === 0 ? (
                          <p>No store has responded yet.</p>
                        ) : (
                          <ul>
                            {responses.map((x) => (
                              <li key={x.id}>
                                <strong>{x.storeName}</strong>{x.city ? ` (${x.city})` : ""}: {x.response === "CAN_SUPPLY" ? "Can supply" : "Cannot supply"}
                                {x.note ? ` — ${x.note}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="admin-form" style={{ marginTop: "1rem" }}>
                          <label>
                            Change status
                            {r.allowedNextStatuses.length === 0 ? (
                              <select disabled><option>Final status — no changes allowed</option></select>
                            ) : (
                              <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                                <option value="">Keep {REQUEST_STATUS_LABEL[r.status]}</option>
                                {r.allowedNextStatuses.map((s) => (
                                  <option key={s} value={s}>{REQUEST_STATUS_LABEL[s]}</option>
                                ))}
                              </select>
                            )}
                          </label>
                          <label>
                            Administrator notes (never shown to customers or stores)
                            <textarea rows={3} maxLength={2000} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
                          </label>
                          <button className="admin-btn" disabled={saving} onClick={() => save(r)}>{saving ? "Saving…" : "Save changes"}</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button className="admin-btn secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <button className="admin-btn secondary" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
