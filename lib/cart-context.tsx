// lib/cart-context.tsx
"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import type { Product } from "@/types";

const STORAGE_KEY = "umuhle_cart_v1";
const PENDING_ADD_KEY = "umuhle_pending_cart_add";

// ── Pending "add to cart" intent ────────────────────────────────────────────
// Used when an unauthenticated visitor clicks "Add to cart": the cart itself
// persists fine across login (it's in localStorage), but the *click* that
// triggered the login modal would otherwise be lost. We stash the intent in
// sessionStorage, redirect through auth with a `next` back to the page the
// visitor was on, then the page re-applies the pending add once the user is
// confirmed signed in.
export interface PendingCartAdd {
  productId: string;
  quantity: number;
}

export function setPendingCartAdd(productId: string, quantity: number) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_ADD_KEY, JSON.stringify({ productId, quantity }));
  } catch {
    // sessionStorage unavailable — the add will just need to be redone manually
  }
}

export function getPendingCartAdd(): PendingCartAdd | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_ADD_KEY);
    return raw ? (JSON.parse(raw) as PendingCartAdd) : null;
  } catch {
    return null;
  }
}

export function clearPendingCartAdd() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_ADD_KEY);
  } catch {
    // ignore
  }
}

export interface CartLine {
  product: Product;
  quantity: number;
}

interface CartContextValue {
  items: CartLine[];
  count: number;
  subtotal: number; // cents
  hydrated: boolean;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage once, client-side only (avoids SSR mismatch)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      // corrupt/old cart data — ignore and start fresh
    } finally {
      setHydrated(true);
    }
  }, []);

  // Persist on every change, after initial hydration
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // storage full / unavailable — cart just won't survive a refresh
    }
  }, [items, hydrated]);

  const addItem = useCallback((product: Product, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + quantity } : l
        );
      }
      return [...prev, { product, quantity }];
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((l) => l.product.id !== productId));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setItems((prev) => {
      if (quantity <= 0) return prev.filter((l) => l.product.id !== productId);
      return prev.map((l) => (l.product.id === productId ? { ...l, quantity } : l));
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = useMemo(() => items.reduce((s, l) => s + l.quantity, 0), [items]);
  const subtotal = useMemo(
    () => items.reduce((s, l) => s + l.product.price * l.quantity, 0),
    [items]
  );

  const value: CartContextValue = { items, count, subtotal, hydrated, addItem, removeItem, setQuantity, clear };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}