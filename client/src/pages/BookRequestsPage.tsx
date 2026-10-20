import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { LoadingState, ErrorState, EmptyState } from "../components/StateBlocks";
import { Pagination, REQUEST_STATUS_BADGE, REQUEST_STATUS_LABEL } from "../components/bookRequestShared";

interface BookRequest {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  notes: string | null;
  status: string;
  responseCount: number;
  offerCount: number;
  canCancel: boolean;
  createdAt: string;
}

const PAGE_SIZE = 10;
const ISBN_PATTERN = /^(\d{9}[\dX]|\d{13})$/;

export default function BookRequestsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [requests, setRequests] = useState<BookRequest[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ requests: BookRequest[]; pagination: Pagination }>(
        `/book-requests?page=${page}&limit=${PAGE_SIZE}`
      );
      setRequests(res.requests);
      setPagination(res.pagination);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  function validate(): string | null {
    if (title.trim().length < 2) return "Please enter the book title (at least 2 characters).";
    if (author.trim().length < 2) return "Please enter the author (at least 2 characters).";
    const compact = isbn.trim().replace(/[-\s]/g, "").toUpperCase();
    if (compact && !ISBN_PATTERN.test(compact)) return "ISBN must be 10 or 13 characters (digits, last may be X).";
    if (notes.length > 1000) return "Notes must be at most 1000 characters.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate(); // the server validates again; this is only for quick feedback
    if (problem) {
      setFormError(problem);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post("/book-requests", { title, author, isbn: isbn || undefined, notes: notes || undefined });
      showToast("Book request submitted.", "success");
      setTitle("");
      setAuthor("");
      setIsbn("");
      setNotes("");
      if (page === 1) await load();
      else setPage(1);
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    if (!window.confirm("Cancel this book request?")) return;
    setCancellingId(id);
    try {
      await api.post(`/book-requests/${id}/cancel`);
      showToast("Request cancelled.", "success");
      await load();
    } catch (err: any) {
      showToast(err.message, "error");
      await load();
    } finally {
      setCancellingId(null);
    }
  }

  if (user && user.role !== "customer") {
    return <EmptyState title="Customers only" hint="Book requests are submitted by customer accounts." />;
  }

  return (
    <div>
      <h1 className="page-title">Request a Book</h1>
      <p style={{ marginBottom: "1.25rem" }}>
        Can&rsquo;t find a book in our catalog? Tell us what you&rsquo;re looking for and participating stores will let us know
        if they can supply it. You can have up to 10 open requests, and submit up to 5 per 24 hours.
      </p>

      <div className="card" style={{ padding: "1.5rem", maxWidth: 560, marginBottom: "2rem" }}>
        <form onSubmit={handleSubmit} noValidate>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <div className="form-field">
            <label htmlFor="br-title">Title *</label>
            <input id="br-title" value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="br-author">Author *</label>
            <input id="br-author" value={author} maxLength={160} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="br-isbn">ISBN (optional)</label>
            <input id="br-isbn" value={isbn} maxLength={20} onChange={(e) => setIsbn(e.target.value)} placeholder="978-0-306-40615-7" />
          </div>
          <div className="form-field">
            <label htmlFor="br-notes">Anything else we should know? (optional)</label>
            <textarea id="br-notes" rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <button className="btn btn-block" type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </form>
      </div>

      <h2 style={{ marginBottom: "0.75rem" }}>Your requests</h2>
      {loadError ? (
        <ErrorState message={loadError} />
      ) : !requests ? (
        <LoadingState label="Loading your requests…" />
      ) : requests.length === 0 ? (
        <EmptyState title="No requests yet" hint="Requests you submit will appear here with their status." />
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Store responses</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      <br />
                      <small>
                        {r.author}
                        {r.isbn ? ` · ISBN ${r.isbn}` : ""}
                      </small>
                    </td>
                    <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td>
                      <span className={REQUEST_STATUS_BADGE[r.status] || "badge"}>
                        {REQUEST_STATUS_LABEL[r.status] || r.status}
                      </span>
                    </td>
                    <td>
                      {r.responseCount} {r.responseCount === 1 ? "response" : "responses"}
                      <br />
                      <small>
                        {r.offerCount} {r.offerCount === 1 ? "offer" : "offers"}
                      </small>
                    </td>
                    <td>
                      {r.canCancel && (
                        <button className="btn btn-outline btn-sm" disabled={cancellingId === r.id} onClick={() => handleCancel(r.id)}>
                          {cancellingId === r.id ? "Cancelling…" : "Cancel"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button className="btn btn-outline btn-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
