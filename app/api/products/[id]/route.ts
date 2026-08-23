import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Product ID is required." }, { status: 400 });

  const { data: product, error: lookupError } = await supabase
    .from("products")
    .select("id, partner_id, image_url, name")
    .eq("id", id)
    .eq("partner_id", user.id)
    .maybeSingle();

  if (lookupError) {
    console.error("Product delete lookup failed:", lookupError);
    return NextResponse.json({ error: "Couldn't find that product." }, { status: 500 });
  }
  if (!product) return NextResponse.json({ error: "Product not found or you don't own it." }, { status: 404 });

  // order_items and product_wishlists are NO ACTION foreign keys. If either
  // exists, physically deleting the product would either break order history
  // or violate the FK. In that case "delete" means remove it from sale.
  const [{ count: orderItemCount, error: orderError }, { count: wishlistCount, error: wishlistError }] = await Promise.all([
    supabase.from("order_items").select("id", { count: "exact", head: true }).eq("product_id", id),
    supabase.from("product_wishlists").select("id", { count: "exact", head: true }).eq("product_id", id),
  ]);

  if (orderError || wishlistError) {
    console.error("Product dependency check failed:", { orderError, wishlistError });
    return NextResponse.json({ error: "Couldn't check whether this product can be permanently deleted." }, { status: 500 });
  }

  if ((orderItemCount ?? 0) > 0 || (wishlistCount ?? 0) > 0) {
    const { error } = await supabase
      .from("products")
      .update({ is_active: false })
      .eq("id", id)
      .eq("partner_id", user.id);

    if (error) {
      console.error("Product soft-delete failed:", error);
      return NextResponse.json({ error: "Couldn't remove this product." }, { status: 500 });
    }

    return NextResponse.json({
      deleted: true,
      permanent: false,
      message: (orderItemCount ?? 0) > 0
        ? "This product has order history, so it was removed from sale while its history was preserved."
        : "This product is saved by a customer, so it was removed from sale while that saved item is preserved.",
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

  if (product.image_url) {
    const marker = "/storage/v1/object/public/product-images/";
    const markerIndex = product.image_url.indexOf(marker);
    if (markerIndex >= 0) {
      const objectPath = decodeURIComponent(product.image_url.slice(markerIndex + marker.length).split("?")[0]);
      if (objectPath) {
        const { error: storageError } = await supabase.storage.from("product-images").remove([objectPath]);
        if (storageError) console.error("Product image cleanup failed:", storageError);
      }
    }
  }

  return NextResponse.json({ deleted: true, permanent: true, message: "Product deleted successfully." });
}
