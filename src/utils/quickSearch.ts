import { supabase } from "@/integrations/supabase/client";
import type { ProductAttributeDef } from "@/utils/products";

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
  attributes: Record<string, string | number | null>;
  schema_id: string;
  status: StockStatus;
  status_label: string;
};

export function deriveStockStatus(p: {
  current_stock: number;
  min_stock: number;
  reorder_point: number;
}): { status: StockStatus; label: string } {
  const stock = Number(p.current_stock) || 0;
  const reorder = Number(p.reorder_point) || 0;
  const min = Number(p.min_stock) || 0;
  if (stock <= 0) return { status: "out", label: "AGOTADO" };
  if (stock <= reorder) return { status: "critical", label: "QUEDAN POCAS" };
  if (min > 0 && stock <= min * 1.5) return { status: "low", label: "STOCK BAJO" };
  return { status: "available", label: "DISPONIBLE" };
}

const LEADING_PATTERNS: RegExp[] = [
  /^buscar\s+/i,
  /^busca\s+/i,
  /^cu[áa]nto\s+(?:hay\s+)?de\s+/i,
  /^cu[áa]ntos\s+(?:hay\s+)?de\s+/i,
  /^tienes\s+/i,
  /^revisa\s+/i,
  /^revisar\s+/i,
  /^muestra(?:me)?\s+/i,
  /^enseñ[ae]me\s+/i,
];

export function preprocessVoiceQuery(raw: string): string {
  let q = (raw ?? "").trim();
  for (const p of LEADING_PATTERNS) q = q.replace(p, "");
  return q.replace(/[¿?¡!\.]+$/g, "").trim();
}

const FETCH_LIMIT = 30; // fetch a bit more than 10 so we can filter/rank, then trim
const RESULT_LIMIT = 10;

function rankResults(
  rows: QuickSearchResult[],
  term: string,
): QuickSearchResult[] {
  const lowered = term.toLowerCase();
  const tokens = lowered.split(/\s+/).filter(Boolean);

  const scored = rows.map((r) => {
    const sku = r.sku.toLowerCase();
    const name = r.name.toLowerCase();
    let score = 0;
    if (sku === lowered) score += 1000;
    if (sku.startsWith(lowered)) score += 200;
    if (name.startsWith(lowered)) score += 100;
    if (sku.includes(lowered)) score += 30;
    if (name.includes(lowered)) score += 20;
    // attribute token matches
    if (tokens.length > 1) {
      const attrValues = Object.values(r.attributes ?? {})
        .map((v) => (v == null ? "" : String(v).toLowerCase()))
        .join(" ");
      for (const t of tokens) {
        if (attrValues.includes(t)) score += 15;
        if (name.includes(t)) score += 5;
      }
    }
    // stock state: in-stock outranks out-of-stock
    if (r.status !== "out") score += 10;
    return { r, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.r.name.localeCompare(b.r.name, "es");
  });

  return scored.map((s) => s.r);
}

export async function quickSearch(
  tenantId: string,
  rawQuery: string,
): Promise<{ results: QuickSearchResult[]; hasMore: boolean }> {
  const term = rawQuery.trim();
  if (term.length < 2) return { results: [], hasMore: false };
  const safe = term.replace(/[%_]/g, "");
  const tokens = safe.toLowerCase().split(/\s+/).filter(Boolean);

  // Build OR for first token + the full string, to broaden recall when there
  // are multiple words (e.g. "perfil 80 blanco" → match "perfil" rows too).
  const orParts: string[] = [
    `sku.ilike.%${safe}%`,
    `name.ilike.%${safe}%`,
  ];
  if (tokens.length > 1) {
    orParts.push(`name.ilike.%${tokens[0]}%`);
    orParts.push(`sku.ilike.%${tokens[0]}%`);
  }

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, sku, name, current_stock, min_stock, reorder_point, price, unit, location, attributes, schema_id",
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .or(orParts.join(","))
    .limit(FETCH_LIMIT);

  if (error) {
    console.error("quickSearch", error);
    return { results: [], hasMore: false };
  }

  let rows: QuickSearchResult[] = (data ?? []).map((p) => {
    const status = deriveStockStatus({
      current_stock: Number(p.current_stock),
      min_stock: Number(p.min_stock),
      reorder_point: Number(p.reorder_point),
    });
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      current_stock: Number(p.current_stock),
      min_stock: Number(p.min_stock),
      reorder_point: Number(p.reorder_point),
      price: Number(p.price),
      unit: p.unit,
      location: p.location,
      attributes: (p.attributes ?? {}) as Record<string, string | number | null>,
      schema_id: p.schema_id,
      status: status.status,
      status_label: status.label,
    };
  });

  // For multi-word queries, prefer results that match more tokens across name+sku+attrs.
  if (tokens.length > 1) {
    const filtered = rows.filter((r) => {
      const hay = (
        r.name +
        " " +
        r.sku +
        " " +
        Object.values(r.attributes ?? {})
          .map((v) => (v == null ? "" : String(v)))
          .join(" ")
      ).toLowerCase();
      // Require at least 1 token to match (already guaranteed by SQL OR), but rank by # matched
      return tokens.some((t) => hay.includes(t));
    });
    rows = filtered;
  }

  const ranked = rankResults(rows, safe);
  const hasMore = ranked.length > RESULT_LIMIT;
  return { results: ranked.slice(0, RESULT_LIMIT), hasMore };
}

export async function logSearch(input: {
  tenantId: string;
  userId: string | null;
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
    .single();
  if (error) {
    console.warn("logSearch", error.message);
    return null;
  }
  return data.id;
}

export async function logProductClick(searchId: string, productId: string): Promise<void> {
  const { error } = await supabase
    .from("search_log")
    .update({ product_clicked: productId })
    .eq("id", searchId);
  if (error) console.warn("logProductClick", error.message);
}

export type PopularProduct = {
  id: string;
  sku: string;
  name: string;
  click_count: number;
};

export async function fetchPopularProducts(
  tenantId: string,
  limit = 6,
): Promise<PopularProduct[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: clicks, error } = await supabase
    .from("search_log")
    .select("product_clicked")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .not("product_clicked", "is", null)
    .limit(500);
  if (error || !clicks) return [];

  const counts = new Map<string, number>();
  for (const row of clicks) {
    const id = row.product_clicked as string | null;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  if (top.length === 0) return [];

  const ids = top.map(([id]) => id);
  const { data: products } = await supabase
    .from("products")
    .select("id, sku, name")
    .in("id", ids)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .eq("is_active", true);

  const byId = new Map<string, { id: string; sku: string; name: string }>();
  for (const p of products ?? []) byId.set(p.id, p);

  return top
    .map(([id, count]) => {
      const p = byId.get(id);
      if (!p) return null;
      return { id: p.id, sku: p.sku, name: p.name, click_count: count };
    })
    .filter((x): x is PopularProduct => x !== null);
}

// Cache schemas per session — they don't change often.
const schemaCache = new Map<string, ProductAttributeDef[]>();

export async function fetchSchemaAttributes(schemaId: string): Promise<ProductAttributeDef[]> {
  const cached = schemaCache.get(schemaId);
  if (cached) return cached;
  const { data } = await supabase
    .from("product_schemas")
    .select("attributes")
    .eq("id", schemaId)
    .maybeSingle();
  const attrs = Array.isArray(data?.attributes)
    ? (data!.attributes as unknown as ProductAttributeDef[])
    : [];
  schemaCache.set(schemaId, attrs);
  return attrs;
}

export function formatAttributesInline(
  attrs: Record<string, string | number | null>,
  schema: ProductAttributeDef[],
): string {
  const parts: string[] = [];
  for (const def of schema) {
    const v = attrs[def.key];
    if (v == null || v === "") continue;
    parts.push(`${def.label}: ${v}`);
  }
  return parts.join(" · ");
}