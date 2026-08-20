// lib/upsells.ts
//
// Persists the explicit product picks made in
// components/UpsellProductPicker.tsx once the parent service form has
// saved the service itself and knows its real id. Simple replace-all sync
// (delete anything no longer selected, insert anything new) rather than a
// diff — these lists are always short (a handful of products at most), so
// the extra round trip isn't worth the complexity a real diff would add.
//
// Used by both service forms in app/dashboard/page.tsx:
//   PricedServicesManager (artist services) → service_upsell_products
//   ServiceManager (salon services)         → salon_service_upsell_products

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any;

export async function syncServiceUpsells(
  supabase: SupabaseAny,
  table: "service_upsell_products" | "salon_service_upsell_products",
  idColumn: "service_id" | "salon_service_id",
  entityId: string,
  productIds: string[]
): Promise<void> {
  await supabase.from(table).delete().eq(idColumn, entityId);
  if (productIds.length === 0) return;

  const rows = productIds.map((product_id, i) => ({
    [idColumn]: entityId,
    product_id,
    display_order: i,
  }));
  const { error } = await supabase.from(table).insert(rows);
  if (error) console.error(`[syncServiceUpsells] failed to insert ${table}:`, error);
}

export async function loadServiceUpsellIds(
  supabase: SupabaseAny,
  table: "service_upsell_products" | "salon_service_upsell_products",
  idColumn: "service_id" | "salon_service_id",
  entityId: string
): Promise<string[]> {
  const { data } = await supabase
    .from(table)
    .select("product_id")
    .eq(idColumn, entityId)
    .order("display_order", { ascending: true });
  return (data ?? []).map((r: { product_id: string }) => r.product_id);
}
