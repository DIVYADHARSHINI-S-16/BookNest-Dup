import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";

export interface CartItem {
  cartItemId: string;
  bookId: string;
  title: string;
  author: string;
  unitPrice: number;
  /** What the store charges right now; differs from unitPrice if the store changed its price. */
  currentPrice?: number;
  priceChanged?: boolean;
  coverImageUrl: string;
  quantity: number;
  availableQuantity: number;
  exceedsStock: boolean;
  storeId?: string | null;
  storeName?: string | null;
  /** false when the line's store has stopped accepting purchases. */
  storeActive?: boolean;
}

export interface CartData {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  total: number;
  hasPriceChanges?: boolean;
}

const emptyCart: CartData = { items: [], itemCount: 0, subtotal: 0, total: 0 };

interface CartContextValue {
  cart: CartData;
  loading: boolean;
  refresh: () => Promise<void>;
  addToCart: (bookId: string, quantity?: number, storeId?: string) => Promise<void>;
  changeQuantity: (bookId: string, action: "increase" | "decrease") => Promise<void>;
  removeItem: (bookId: string) => Promise<void>;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [cart, setCart] = useState<CartData>(emptyCart);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || user.role !== "customer") {
      setCart(emptyCart);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<CartData>("/cart");
      setCart(res);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addToCart(bookId: string, quantity = 1, storeId?: string) {
    const res = await api.post<CartData>("/cart", { bookId, quantity, storeId });
    setCart(res);
  }

  async function changeQuantity(bookId: string, action: "increase" | "decrease") {
    const res = await api.patch<CartData>(`/cart/${bookId}`, { action });
    setCart(res);
  }

  async function removeItem(bookId: string) {
    const res = await api.delete<CartData>(`/cart/${bookId}`);
    setCart(res);
  }

  return (
    <CartContext.Provider value={{ cart, loading, refresh, addToCart, changeQuantity, removeItem }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
