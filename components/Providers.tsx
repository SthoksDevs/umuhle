// components/Providers.tsx
"use client";

import { CartProvider } from "@/lib/cart-context";
import { ProductWishlistProvider } from "@/lib/product-wishlist-context";
import CompleteProfileGate from "@/components/CompleteProfileGate";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <ProductWishlistProvider>
        {children}
        <CompleteProfileGate />
      </ProductWishlistProvider>
    </CartProvider>
  );
}