"use client";

import { useState } from "react";

/**
 * UMUHLE DASHBOARD REFACTOR — PRODUCT DELETE
 *
 * Backend endpoint: DELETE /api/products/[id]
 *
 * Important behaviour:
 * - Products with no order/wishlist dependencies can be permanently deleted.
 * - Products referenced by order history or customer wishlists are removed
 *   from sale instead, preserving those historical/customer records.
 * - Ownership is enforced by the server; the browser never supplies a
 *   partner_id for authorization.
 *
 * CONTINUATION NOTE:
 * This component is intentionally standalone so it can be added to the
 * existing ProductsManager without rewriting the monolithic dashboard file.
 * When ProductsManager is extracted, keep this component as the action used
 * beside Edit and Live/Hidden.
 */
interface ProductDeleteButtonProps {
  productId: string;
  productName?: string;
  onDeleted?: (result: { permanent: boolean; message: string }) => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function ProductDeleteButton({
  productId,
  productName,
  onDeleted,
  className = "btn-outline",
  style,
}: ProductDeleteButtonProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    if (deleting) return;

    const confirmed = window.confirm(
      productName
        ? `Delete "${productName}"?`
        : "Delete this product?"
    );
    if (!confirmed) return;

    setDeleting(true);
    setError("");

    try {
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Couldn't delete this product.");
      }

      onDeleted?.({
        permanent: Boolean(data.permanent),
        message: data.message || "Product deleted successfully.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete this product.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "0.25rem",
      }}
    >
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className={className}
        style={{ padding: "0.4rem 1rem", fontSize: "0.78rem", ...style }}
        aria-label={productName ? `Delete ${productName}` : "Delete product"}
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
      {error && (
        <span style={{ color: "#C62828", fontSize: "0.7rem" }}>{error}</span>
      )}
    </span>
  );
}
