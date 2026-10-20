import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, AuthUser } from "../context/AuthContext";
import { LoadingState } from "../components/StateBlocks";

/**
 * Requires a logged-in user. Pass `roles` to also restrict the pages inside to
 * those roles (e.g. customer-only pages such as the cart): anyone else is sent
 * home instead of landing on a page whose API calls the server answers with 403.
 * The server's requireRole() remains the real enforcement.
 */
export function RequireAuth({ roles }: { roles?: AuthUser["role"][] } = {}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;

  return <Outlet />;
}
