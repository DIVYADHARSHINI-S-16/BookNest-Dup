import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles/global.css";
import "./components/admin/admin.css";

import { AuthProvider } from "./context/AuthContext";
import { CartProvider } from "./context/CartContext";
import { ToastProvider } from "./context/ToastContext";
import { RequireAuth } from "./routes/RequireAuth";
import { RequireAdmin } from "./routes/RequireAdmin";

import StorefrontLayout from "./components/StorefrontLayout";
import AdminLayout from "./components/admin/AdminLayout";

// Customer pages
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import BooksPage from "./pages/BooksPage";
import HelpMeChoosePage from "./pages/HelpMeChoosePage";
import BookDetailPage from "./pages/BookDetailPage";
import CategoriesPage from "./pages/CategoriesPage";
import CartPage from "./pages/CartPage";
import CheckoutPage from "./pages/CheckoutPage";
import OrderSuccessPage from "./pages/OrderSuccessPage";
import OrdersPage from "./pages/OrdersPage";
import OrderDetailPage from "./pages/OrderDetailPage";
import ProfilePage from "./pages/ProfilePage";

// Admin pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminBooks from "./pages/admin/AdminBooks";
import AdminBookForm from "./pages/admin/AdminBookForm";
import AdminCategories from "./pages/admin/AdminCategories";
import AdminInventory from "./pages/admin/AdminInventory";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminOrderDetail from "./pages/admin/AdminOrderDetail";
import AdminReviews from "./pages/admin/AdminReviews";
import AdminSecondHand from "./pages/admin/AdminSecondHand";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <CartProvider>
            <Routes>
              {/* Storefront (customer-facing, public + auth-required mixed) */}
              <Route element={<StorefrontLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/books" element={<BooksPage />} />
                <Route path="/help-me-choose" element={<HelpMeChoosePage />} />
                <Route path="/books/:id" element={<BookDetailPage />} />
                <Route path="/categories" element={<CategoriesPage />} />

                {/* Requires login (customer or admin) */}
                <Route element={<RequireAuth />}>
                  <Route path="/cart" element={<CartPage />} />
                  <Route path="/checkout" element={<CheckoutPage />} />
                  <Route path="/order-success" element={<OrderSuccessPage />} />
                  <Route path="/orders" element={<OrdersPage />} />
                  <Route path="/orders/:id" element={<OrderDetailPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                </Route>
              </Route>

              {/* Admin (role-protected) */}
              <Route element={<RequireAdmin />}>
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="books" element={<AdminBooks />} />
                  <Route path="books/new" element={<AdminBookForm />} />
                  <Route path="books/:id/edit" element={<AdminBookForm />} />
                  <Route path="categories" element={<AdminCategories />} />
                  <Route path="inventory" element={<AdminInventory />} />
                  <Route path="orders" element={<AdminOrders />} />
                  <Route path="orders/:id" element={<AdminOrderDetail />} />
                  <Route path="reviews" element={<AdminReviews />} />
                  <Route path="second-hand" element={<AdminSecondHand />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </CartProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
