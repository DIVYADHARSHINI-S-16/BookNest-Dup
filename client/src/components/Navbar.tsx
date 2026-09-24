import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";

export default function Navbar() {
  const { user, logout } = useAuth();
  const { cart } = useCart();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="navbar-brand">
          BookNest
        </Link>

        <nav className="navbar-links">
          <Link to="/books">Books</Link>
          <Link to="/help-me-choose">Help Me Choose</Link>
          <Link to="/books?secondHand=true">Second-Hand</Link>
          {user?.role === "admin" && <Link to="/admin">Admin</Link>}
        </nav>

        <div className="navbar-actions">
          {user?.role === "customer" && (
            <Link to="/cart" className="navbar-cart">
              Cart
              {cart.itemCount > 0 && <span className="navbar-cart-badge">{cart.itemCount}</span>}
            </Link>
          )}

          {user ? (
            <div className="navbar-user">
              {user.role === "customer" && <Link to="/orders">Orders</Link>}
              <Link to="/profile">{user.name}</Link>
              <button className="btn btn-outline btn-sm" onClick={handleLogout}>
                Log out
              </button>
            </div>
          ) : (
            <div className="navbar-user">
              <Link to="/login">Log in</Link>
              <Link to="/register" className="btn btn-sm">
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
