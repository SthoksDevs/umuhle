"use client";

import { useState } from "react";

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
        ? `Delete “${productName}”?\n\nIf this product has order history or is saved by a customer, it will be removed from sale instead so those records remain intact.`
        : "Delete this product?\n\nIf it has order history or is saved by a customer, it will be removed from sale instead so those records remain intact."
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
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "0.25rem" }}>
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
      {error && <span style={{ color: "#C62828", fontSize: "0.7rem" }}>{error}</span>}
    </span>
  );
}
