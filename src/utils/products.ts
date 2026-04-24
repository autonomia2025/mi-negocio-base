import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/admin-utils";

export type ProductAttributeDef = {
  key: string;
  label: string;
  type: "text" | "number" | "enum";
  required?: boolean;
  options?: string[];
};

export type ProductSchema = {
  id: string;
  name: string;
  attributes: ProductAttributeDef[];
  is_default: boolean;
};

export type ProductRow = {
  id: string;
  tenant_id: string;
  schema_id: string;
  sku: string;
  name: string;
  attributes: Record<string, string | number | null>;
  unit: string;
  cost_avg: number;
  price: number;
  current_stock: number;
  min_stock: number;
  reorder_point: number;
  reorder_qty: number;
  location: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ProductInput = {
  schema_id: string;
  sku: string;
  name: string;
  attributes: Record<string, string | number | null>;
  unit: string;
  cost_avg: number;
  price: number;
  current_stock: number;
  min_stock: number;
  reorder_point: number;
  reorder_qty: number;
  location: string | null;
  is_active: boolean;
};

export type ProductFilters = {
  search?: string;
  onlyActive?: boolean;
  lowStockOnly?: boolean;
};

export const PAGE_SIZE = 25;

export const UNIT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "pieza", label: "Pieza" },
  { value: "kilogramo", label: "Kilogramo" },
  { value: "metro", label: "Metro" },
  { value: "metro2", label: "Metro cuadrado" },
  { value: "metro3", label: "Metro cúbico" },
  { value: "litro", label: "Litro" },
  { value: "caja", label: "Caja" },
  { value: "paquete", label: "Paquete" },
  { value: "otro", label: "Otro" },
];

export async function fetchDefaultSchema(tenantId: string): Promise<ProductSchema | null> {
  const { data, error } = await supabase
    .from("product_schemas")
    .select("id, name, attributes, is_default")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("fetchDefaultSchema", error);
    return null;
  }
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    is_default: data.is_default,
    attributes: Array.isArray(data.attributes)
      ? (data.attributes as unknown as ProductAttributeDef[])
      : [],
  };
}

export async function fetchSchemaById(schemaId: string): Promise<ProductSchema | null> {
  const { data, error } = await supabase
    .from("product_schemas")
    .select("id, name, attributes, is_default")
    .eq("id", schemaId)
    .maybeSingle();
  if (error) {
    console.error("fetchSchemaById", error);
    return null;
  }
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    is_default: data.is_default,
    attributes: Array.isArray(data.attributes)
      ? (data.attributes as unknown as ProductAttributeDef[])
      : [],
  };
}

export async function fetchProducts(
  tenantId: string,
  filters: ProductFilters,
  page: number,
): Promise<{ rows: ProductRow[]; total: number }> {
  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);

  if (filters.onlyActive !== false) {
    query = query.eq("is_active", true);
  }
  if (filters.search && filters.search.trim().length > 0) {
    const term = filters.search.trim().replace(/[%_]/g, "");
    query = query.or(`sku.ilike.%${term}%,name.ilike.%${term}%`);
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;
  let rows = (data ?? []) as unknown as ProductRow[];
  if (filters.lowStockOnly) {
    rows = rows.filter((r) => Number(r.current_stock) <= Number(r.reorder_point));
  }
  return { rows, total: count ?? rows.length };
}

export async function fetchProductById(id: string, tenantId: string): Promise<ProductRow | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    console.error("fetchProductById", error);
    return null;
  }
  return (data as unknown as ProductRow | null) ?? null;
}

export async function isSkuTaken(tenantId: string, sku: string, excludeId?: string): Promise<boolean> {
  let q = supabase
    .from("products")
    .select("id", { head: true, count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("sku", sku)
    .is("deleted_at", null);
  if (excludeId) q = q.neq("id", excludeId);
  const { count, error } = await q;
  if (error) {
    console.error("isSkuTaken", error);
    return false;
  }
  return (count ?? 0) > 0;
}

export async function createProduct(tenantId: string, input: ProductInput): Promise<ProductRow> {
  const { data, error } = await supabase
    .from("products")
    .insert({ ...input, tenant_id: tenantId })
    .select("*")
    .single();
  if (error) throw error;
  const row = data as unknown as ProductRow;
  await logAudit({
    tenantId,
    action: "product.created",
    entityType: "product",
    entityId: row.id,
    changes: { created: row as unknown as Record<string, unknown> },
  });
  return row;
}

export async function updateProduct(
  id: string,
  tenantId: string,
  before: ProductRow,
  patch: Partial<ProductInput>,
): Promise<ProductRow> {
  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) throw error;
  const after = data as unknown as ProductRow;
  // diff: only changed top-level fields
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of Object.keys(patch) as Array<keyof ProductInput>) {
    const b = (before as unknown as Record<string, unknown>)[k as string];
    const a = (after as unknown as Record<string, unknown>)[k as string];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      diff[k as string] = { before: b, after: a };
    }
  }
  await logAudit({
    tenantId,
    action: "product.updated",
    entityType: "product",
    entityId: id,
    changes: diff,
  });
  return after;
}

export async function softDeleteProduct(id: string, tenantId: string): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) throw error;
  await logAudit({
    tenantId,
    action: "product.deleted",
    entityType: "product",
    entityId: id,
    changes: { soft_deleted: true },
  });
}

export type StockTone = "danger" | "warning" | "ok";

export function stockTone(row: Pick<ProductRow, "current_stock" | "reorder_point" | "min_stock">): StockTone {
  const stock = Number(row.current_stock);
  const reorder = Number(row.reorder_point);
  const min = Number(row.min_stock);
  if (stock <= reorder) return "danger";
  if (min > 0 && stock <= min * 1.5) return "warning";
  return "ok";
}

export function canEditProducts(role: string | undefined | null): boolean {
  return role === "tenant_owner" || role === "gerente" || role === "almacenista";
}

export function canDeleteProducts(role: string | undefined | null): boolean {
  return role === "tenant_owner" || role === "gerente";
}