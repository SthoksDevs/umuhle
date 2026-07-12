// lib/product-wishlist-context.tsx
"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product } from "@/types";

// ── Pending "heart" intent ───────────────────────────────────────────────────
// Same pattern as the pending "add to cart" intent in lib/cart-context.tsx:
// if someone hearts a product while signed out, remember it in sessionStorage,
// send them through auth, and replay the heart once they land back signed in.
const PENDING_KEY = "umuhle_pending_wishlist_add";

export function setPendingWishlistAdd(productId: string) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(PENDING_KEY, productId); } catch { /* ignore */ }
}
export function getPendingWishlistAdd(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage.getItem(PENDING_KEY); } catch { return null; }
}
export function clearPendingWishlistAdd() {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

export interface WishlistLine {
  product_id: string;
  created_at: string;
  products: Product;
}

interface ProductWishlistContextValue {
  ids: Set<string>;
  items: WishlistLine[];
  loading: boolean;
  count: number;
  isWishlisted: (productId: string) => boolean;
  toggle: (product: Product, onNeedsAuth?: () => void) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const ProductWishlistContext = createContext<ProductWishlistContextValue | null>(null);

export function ProductWishlistProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null | undefined>(undefined); // undefined = not checked yet
  const [items, setItems] = useState<WishlistLine[]>([]);
  const [loading, setLoading] = useState(false);

  // Track auth state
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUserId(s?.user?.id ?? null));
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) { setItems([]); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/wishlist/products");
      if (res.ok) {
        const data = await res.json();
        setItems((data.items ?? []).filter((i: WishlistLine) => i.products));
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Load on sign-in, clear on sign-out
  useEffect(() => {
    if (userId) refresh();
    else setItems([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const ids = useMemo(() => new Set(items.map(i => i.product_id)), [items]);
  const isWishlisted = useCallback((productId: string) => ids.has(productId), [ids]);

  const toggle = useCallback(async (product: Product, onNeedsAuth?: () => void) => {
    if (!userId) {
      setPendingWishlistAdd(product.id);
      onNeedsAuth?.();
      return;
    }
    const already = ids.has(product.id);
    if (already) {
      setItems(prev => prev.filter(i => i.product_id !== product.id));
      await fetch(`/api/wishlist/products?productId=${product.id}`, { method: "DELETE" });
    } else {
      setItems(prev => [{ product_id: product.id, created_at: new Date().toISOString(), products: product }, ...prev]);
      await fetch("/api/wishlist/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, ids]);

  const remove = useCallback(async (productId: string) => {
    setItems(prev => prev.filter(i => i.product_id !== productId));
    await fetch(`/api/wishlist/products?productId=${productId}`, { method: "DELETE" });
  }, []);

  const count = items.length;

  const value: ProductWishlistContextValue = { ids, items, loading, count, isWishlisted, toggle, remove, refresh };

  return <ProductWishlistContext.Provider value={value}>{children}</ProductWishlistContext.Provider>;
}

export function useProductWishlist(): ProductWishlistContextValue {
  const ctx = useContext(ProductWishlistContext);
  if (!ctx) throw new Error("useProductWishlist must be used within a ProductWishlistProvider");
  return ctx;
}
