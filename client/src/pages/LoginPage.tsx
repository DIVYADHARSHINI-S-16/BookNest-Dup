import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

export default function LoginPage() {
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: Location } };

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!trimmedPassword) {
      setError("Password is required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(trimmedEmail, password);
      showToast(`Welcome back, ${user.name.split(" ")[0]}.`, "success");
      const dest =
        user.role === "admin"
          ? "/admin"
          : user.role === "store_owner"
            ? "/store-owner"
            : (location.state?.from as any)?.pathname || "/";
      navigate(dest, { replace: true });
    } catch (err: any) {
      setError(err.message || "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="form-card card">
      <h1 className="page-title">Log in</h1>
      <p className="page-subtitle">Welcome back to BookNest.</p>

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        <div className="form-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-block" type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p style={{ marginTop: "1rem", fontSize: "0.88rem" }}>
        New to BookNest? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}
