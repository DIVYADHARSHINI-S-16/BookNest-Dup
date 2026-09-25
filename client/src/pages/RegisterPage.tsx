import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

export default function RegisterPage() {
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"customer" | "store_owner">("customer");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName.length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("A valid email is required.");
      return;
    }
    if (password.length < 6 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Password must be at least 6 characters and include letters and numbers.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/auth/register", {
        name: trimmedName,
        email: trimmedEmail,
        password,
        role,
      });
      // Registration signs in server-side (sets the cookie); re-run login
      // flow client-side so AuthContext picks up the new session.
      await login(email, password);
      showToast("Account created. Welcome to BookNest!", "success");
      navigate(role === "store_owner" ? "/store-owner" : "/", { replace: true });
    } catch (err: any) {
      setError(err.message || "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="form-card card">
      <h1 className="page-title">Create an account</h1>
      <p className="page-subtitle">Join BookNest to buy, review, and track orders.</p>

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="name">Full name</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="role">Account type</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as "customer" | "store_owner")}>
            <option value="customer">Customer</option>
            <option value="store_owner">Store Owner</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <small style={{ color: "var(--color-ink-soft)" }}>
            At least 6 characters, with letters and numbers.
          </small>
        </div>
        <button className="btn btn-block" type="submit" disabled={submitting}>
          {submitting ? "Creating account…" : "Sign up"}
        </button>
      </form>

      <p style={{ marginTop: "1rem", fontSize: "0.88rem" }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
