// components/Providers.tsx
"use client";

import { CartProvider } from "@/lib/cart-context";
import { ProductWishlistProvider } from "@/lib/product-wishlist-context";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <ProductWishlistProvider>
        {children}
      </ProductWishlistProvider>
    </CartProvider>
  );
}