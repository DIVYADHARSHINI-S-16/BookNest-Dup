import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { LoadingState, EmptyState, ErrorState } from "./StateBlocks";
import { Pagination, REQUEST_STATUS_BADGE, REQUEST_STATUS_LABEL } from "./bookRequestShared";

interface MyResponse {
  response: "CAN_SUPPLY" | "CANNOT_SUPPLY";
  note: string | null;
  respondedAt: string;
}
interface StoreRequest {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  myResponse: MyResponse | null;
}

const PAGE_SIZE = 10;

/** Open customer book requests for this store. The server decides what is visible; nothing here filters for security. */
export default function StoreBookRequestsPanel() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<StoreRequest[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"" | "false" | "true">("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [choice, setChoice] = useState<"CAN_SUPPLY" | "CANNOT_SUPPLY">("CAN_SUPPLY");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = filter ? `&responded=${filter}` : "";
      const res = await api.get<{ requests: StoreRequest[]; pagination: Pagination }>(
        `/stores/book-requests?page=${page}&limit=${PAGE_SIZE}${q}`
      );
      setRequests(res.requests);
      setPagination(res.pagination);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [page, filter]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(r: StoreRequest) {
    setEditingId(r.id);
    setChoice(r.myResponse?.response ?? "CAN_SUPPLY");
    setNote(r.myResponse?.note ?? "");
  }

  async function save(r: StoreRequest) {
    if (note.length > 500) {
      showToast("Note must be at most 500 characters.", "error");
      return;
    }
    setSaving(true);
    try {
      const body = { response: choice, note: note || undefined };
      if (r.myResponse) await api.put(`/stores/book-requests/${r.id}/response`, { response: choice, note: note || null });
      else await api.post(`/stores/book-requests/${r.id}/response`, body);
      showToast("Response saved.", "success");
      setEditingId(null);
      await load();
    } catch (err: any) {
      showToast(err.message, "error");
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginBottom: "0.5rem" }}>Customer book requests</h2>
      <p style={{ marginBottom: "1rem" }}>Books customers are looking for that aren&rsquo;t in the catalog. Tell us whether your store can supply them.</p>

      <label style={{ display: "block", maxWidth: 220, marginBottom: "1rem" }}>
        Show
        <select value={filter} onChange={(e) => { setFilter(e.target.value as any); setPage(1); }}>
          <option value="">All open requests</option>
          <option value="false">Not yet answered</option>
          <option value="true">Answered by my store</option>
        </select>
      </label>

      {error ? (
        <ErrorState message={error} />
      ) : !requests ? (
        <LoadingState label="Loading requests…" />
      ) : requests.length === 0 ? (
        <EmptyState title="No open requests" hint="New customer requests will appear here." />
      ) : (
        <>
          {requests.map((r) => (
            <div key={r.id} className="card" style={{ padding: "1rem", marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <strong>{r.title}</strong>
                  <div><small>{r.author}{r.isbn ? ` · ISBN ${r.isbn}` : ""}</small></div>
                  {r.notes && <div style={{ marginTop: "0.25rem" }}><small>Customer note: {r.notes}</small></div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={REQUEST_STATUS_BADGE[r.status] || "badge"}>{REQUEST_STATUS_LABEL[r.status] || r.status}</span>
                  <div><small>{new Date(r.createdAt).toLocaleDateString()}</small></div>
                </div>
              </div>

              {editingId === r.id ? (
                <div style={{ marginTop: "0.75rem" }}>
                  <div className="form-field">
                    <label htmlFor={`resp-${r.id}`}>Your response</label>
                    <select id={`resp-${r.id}`} value={choice} onChange={(e) => setChoice(e.target.value as any)}>
                      <option value="CAN_SUPPLY">We can supply this</option>
                      <option value="CANNOT_SUPPLY">We cannot supply this</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor={`note-${r.id}`}>Note (optional, visible to administrators only)</label>
                    <textarea id={`note-${r.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                  <button className="btn btn-sm" disabled={saving} onClick={() => save(r)}>{saving ? "Saving…" : "Save response"}</button>{" "}
                  <button className="btn btn-outline btn-sm" disabled={saving} onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <div style={{ marginTop: "0.75rem" }}>
                  {r.myResponse ? (
                    <>
                      <span className={r.myResponse.response === "CAN_SUPPLY" ? "badge badge-success" : "badge badge-danger"}>
                        {r.myResponse.response === "CAN_SUPPLY" ? "You can supply" : "You cannot supply"}
                      </span>
                      {r.myResponse.note && <small> · {r.myResponse.note}</small>}{" "}
                      <button className="btn btn-outline btn-sm" onClick={() => startEdit(r)}>Edit response</button>
                    </>
                  ) : (
                    <button className="btn btn-sm" onClick={() => startEdit(r)}>Respond</button>
                  )}
                </div>
              )}
            </div>
          ))}
          {pagination && pagination.totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {pagination.page} of {pagination.totalPages}</span>
              <button className="btn btn-outline btn-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
