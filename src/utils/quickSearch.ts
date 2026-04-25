import { supabase } from "@/integrations/supabase/client";

export type StockStatus = "available" | "low" | "critical" | "out";

export type QuickSearchResult = {
  id: string;
  sku: string;
  name: string;
  current_stock: number;
  min_stock: number;
  reorder_point: number;
  price: number;
  unit: string;
  location: string | null;
  attributes: Record<string, unknown>;
  schema_id: string;
  status: StockStatus;
  status_label: string;
};

export const STATUS_LABELS: Record<StockStatus, string> = {
  available: "DISPONIBLE",
  low: "STOCK BAJO",
  critical: "QUEDAN POCAS",
  out: "AGOTADO",
};

export function deriveStockStatus(p: {
  current_stock: number;
  min_stock: number;
  reorder_point: number;
}): StockStatus {
  const cs = Number(p.current_stock) || 0;
  const ms = Number(p.min_stock) || 0;
  const rp = Number(p.reorder_point) || 0;
  if (cs <= 0) return "out";
  if (cs <= rp) return "critical";
  if (cs <= ms * 1.5) return "low";
  return "available";
}

const LEADING_PATTERNS = [
  /^buscar\s+/i,
  /^busca\s+/i,
  /^cuánto\s+(?:hay\s+)?de\s+/i,
  /^cuanto\s+(?:hay\s+)?de\s+/i,
  /^tienes\s+/i,
  /^revisa\s+/i,
  /^revisar\s+/i,
];

export function preprocessVoiceQuery(raw: string): string {
  let q = raw.trim();
  for (const re of LEADING_PATTERNS) {
    if (re.test(q)) {
      q = q.replace(re, "");
      break;
    }
  }
  return q.trim();
}

const MAX_RESULTS = 10;

export async function quickSearch(
  tenantId: string,
  query: string,
): Promise<{ results: QuickSearchResult[]; hasMore: boolean }> {
  const term = query.trim();
  if (term.length < 2) return { results: [], hasMore: false };
  const safe = term.replace(/[%_]/g, "");
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, sku, name, current_stock, min_stock, reorder_point, price, unit, location, attributes, schema_id",
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .or(`sku.ilike.%${safe}%,name.ilike.%${safe}%`)
    .limit(MAX_RESULTS + 1);

  if (error) throw error;
  const rows = (data ?? []) as Omit<QuickSearchResult, "status" | "status_label">[];

  const tokens = term
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const lowerTerm = term.toLowerCase();
  const lowerSku = (s: string) => s.toLowerCase();

  const enriched: QuickSearchResult[] = rows.map((r) => {
    const status = deriveStockStatus(r);
    return {
      ...r,
      attributes: (r.attributes as Record<string, unknown>) ?? {},
      status,
      status_label: STATUS_LABELS[status],
    };
  });

  const score = (r: QuickSearchResult) => {
    let s = 0;
    if (lowerSku(r.sku) === lowerTerm) s += 1000;
    if (r.name.toLowerCase().startsWith(lowerTerm)) s += 500;
    if (r.current_stock > 0) s += 100;
    // Token boost on attributes
    const attrStr = Object.values(r.attributes ?? {})
      .map((v) => String(v).toLowerCase())
      .join(" ");
    for (const t of tokens) {
      if (attrStr.includes(t)) s += 5;
    }
    return s;
  };

  enriched.sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "es");
  });

  const hasMore = enriched.length > MAX_RESULTS;
  return { results: enriched.slice(0, MAX_RESULTS), hasMore };
}

export async function logSearch(input: {
  tenantId: string;
  userId: string;
  query: string;
  source: "text" | "voice";
  resultCount: number;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("search_log")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      query: input.query,
      source: input.source,
      result_count: input.resultCount,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.warn("search_log insert failed", error);
    return null;
  }
  return data?.id ?? null;
}

export async function logProductClick(
  searchId: string,
  productId: string,
): Promise<void> {
  const { error } = await supabase
    .from("search_log")
    .update({ product_clicked: productId })
    .eq("id", searchId);
  if (error) console.warn("search_log update failed", error);
}

export async function fetchPopularProducts(
  tenantId: string,
  limit = 6,
): Promise<QuickSearchResult[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: logs, error } = await supabase
    .from("search_log")
    .select("product_clicked")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .not("product_clicked", "is", null);
  if (error || !logs) return [];

  const counts = new Map<string, number>();
  for (const row of logs) {
    const id = row.product_clicked as string | null;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const topIds = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
  if (topIds.length === 0) return [];

  const { data: products } = await supabase
    .from("products")
    .select(
      "id, sku, name, current_stock, min_stock, reorder_point, price, unit, location, attributes, schema_id",
    )
    .in("id", topIds)
    .eq("is_active", true)
    .is("deleted_at", null);
  if (!products) return [];
  const byId = new Map(products.map((p) => [p.id, p]));
  return topIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((r) => {
      const status = deriveStockStatus(r);
      return {
        ...r,
        attributes: (r.attributes as Record<string, unknown>) ?? {},
        status,
        status_label: STATUS_LABELS[status],
      };
    });
}

export type SchemaAttribute = {
  key: string;
  label: string;
  type?: string;
};

export async function fetchDefaultSchemaAttributes(
  tenantId: string,
): Promise<SchemaAttribute[]> {
  const { data } = await supabase
    .from("product_schemas")
    .select("attributes")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .is("deleted_at", null)
    .maybeSingle();
  const arr = (data?.attributes as SchemaAttribute[] | null) ?? [];
  return Array.isArray(arr) ? arr : [];
}
