import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Product ID is required." }, { status: 400 });
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, partner_id, image_url, name")
    .eq("id", id)
    .eq("partner_id", user.id)
    .maybeSingle();

  if (productError) {
    console.error("Product delete lookup failed:", productError);
    return NextResponse.json({ error: "Couldn't find that product." }, { status: 500 });
  }

  if (!product) {
    return NextResponse.json({ error: "Product not found or you don't own it." }, { status: 404 });
  }

  // Products that have already appeared in an order cannot be physically
  // deleted because order_items.product_id intentionally preserves order
  // history. Hide those products instead. New/unordered products can be
  // permanently deleted.
  const { count: orderItemCount, error: orderLookupError } = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);

  if (orderLookupError) {
    console.error("Product order-history lookup failed:", orderLookupError);
    return NextResponse.json({ error: "Couldn't check whether this product has order history." }, { status: 500 });
  }

  if ((orderItemCount ?? 0) > 0) {
    const { error } = await supabase
      .from("products")
      .update({ is_active: false, listing_status: "deleted" })
      .eq("id", id)
      .eq("partner_id", user.id);

    if (error) {
      console.error("Product soft-delete failed:", error);
      return NextResponse.json({ error: "Couldn't remove this product." }, { status: 500 });
    }

    return NextResponse.json({
      deleted: true,
      permanent: false,
      message: "This product has order history, so it was removed from sale while its order history was preserved.",
    });
  }

  const { error: deleteError } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("partner_id", user.id);

  if (deleteError) {
    console.error("Product delete failed:", deleteError);
    return NextResponse.json({ error: "Couldn't delete this product." }, { status: 500 });
  }

  // The database row does not own the Storage object. Remove the uploaded
  // image through the Storage API as well, so deleting a product doesn't
  // leave an orphaned file behind.
  if (product.image_url) {
    const marker = "/storage/v1/object/public/product-images/";
    const markerIndex = product.image_url.indexOf(marker);
    if (markerIndex >= 0) {
      const objectPath = decodeURIComponent(product.image_url.slice(markerIndex + marker.length).split("?")[0]);
      if (objectPath) {
        const { error: storageError } = await supabase.storage
          .from("product-images")
          .remove([objectPath]);
        if (storageError) {
          // The product is already deleted; don't turn a successful delete
          // into a false failure. Log the orphan so it can be cleaned up.
          console.error("Product image cleanup failed:", storageError);
        }
      }
    }
  }

  return NextResponse.json({
    deleted: true,
    permanent: true,
    message: "Product deleted successfully.",
  });
}
