import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LoadingState } from "../components/StateBlocks";

export function RequireStoreOwner() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.role !== "store_owner") return <Navigate to="/" replace />;

  return <Outlet />;
}
