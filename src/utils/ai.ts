import { supabase } from "@/integrations/supabase/client";

export type Intent = "inventory_in" | "inventory_out" | "sale" | "catalog" | "unknown";

export const INTENT_LABELS: Record<Intent, string> = {
  inventory_in: "Entrada de inventario",
  inventory_out: "Salida de inventario",
  sale: "Venta",
  catalog: "Nuevo producto",
  unknown: "No detectado",
};

export const INTENT_ICONS: Record<Intent, string> = {
  inventory_in: "📦",
  inventory_out: "📤",
  sale: "💰",
  catalog: "➕",
  unknown: "❓",
};

export type ExtractedItem = {
  product_query?: string;
  sku_hint?: string;
  name_hint?: string;
  quantity: number;
  unit_price?: number | null;
  unit_cost?: number | null;
  attributes?: Record<string, string | number | boolean | null>;
  notes?: string;
  /** Resolved during confirmation UI (not from AI). */
  product_id?: string | null;
  /** Optional: user explicitly chose to create new product from this line. */
  create_new?: boolean;
};

export type ExtractedData = {
  intent: Intent;
  confidence: number;
  items: ExtractedItem[];
  customer_name?: string | null;
  payment_method?: string | null;
  warnings?: string[];
};

export type AiIngestionRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  mode: "photo" | "audio" | "text";
  intent: Intent;
  input_text: string | null;
  input_image_path: string | null;
  raw_response: unknown;
  extracted_data: ExtractedData;
  final_data: ExtractedData | null;
  status: "pending" | "confirmed" | "discarded" | "failed";
  confirmed_at: string | null;
  confirmed_by: string | null;
  error_message: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
  created_at: string;
};

/** AI quota helpers reading tenants.settings.ai */
export type AiQuota = {
  limit_monthly: number;
  used_current_month: number;
  reset_date: string;
};

export function readAiQuota(settings: unknown): AiQuota {
  const fallback: AiQuota = {
    limit_monthly: 500,
    used_current_month: 0,
    reset_date: "",
  };
  if (!settings || typeof settings !== "object") return fallback;
  const s = settings as { ai?: Partial<AiQuota> };
  if (!s.ai) return fallback;
  return {
    limit_monthly: Number(s.ai.limit_monthly ?? 500),
    used_current_month: Number(s.ai.used_current_month ?? 0),
    reset_date: String(s.ai.reset_date ?? ""),
  };
}

export function getAiQuotaPct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function getAiQuotaColor(used: number, limit: number): "green" | "amber" | "red" {
  const p = getAiQuotaPct(used, limit);
  if (p >= 90) return "red";
  if (p >= 70) return "amber";
  return "green";
}

export function formatAiQuota(used: number, limit: number): string {
  return `${used.toLocaleString("es-MX")} de ${limit.toLocaleString("es-MX")}`;
}

/** Server-function wrappers (lazy import to avoid bundling server code in client). */
export async function extractFromText(
  tenantId: string,
  text: string,
  intentHint?: Intent,
): Promise<{ ingestionId: string; extracted: ExtractedData }> {
  const { extractFromTextFn } = await import("@/utils/ai.functions");
  const r = await extractFromTextFn({
    data: { tenantId, text, intentHint: intentHint ?? null },
  });
  return r as { ingestionId: string; extracted: ExtractedData };
}

export async function extractFromImage(
  tenantId: string,
  file: File,
): Promise<{ ingestionId: string; extracted: ExtractedData; imagePath: string }> {
  const { extractFromImageFn } = await import("@/utils/ai.functions");
  const base64 = await fileToBase64(file);
  const r = await extractFromImageFn({
    data: { tenantId, imageBase64: base64, mimeType: file.type || "image/jpeg" },
  });
  return r as { ingestionId: string; extracted: ExtractedData; imagePath: string };
}

export async function confirmIngestion(
  ingestionId: string,
  finalData: ExtractedData,
  action: "confirm" | "discard",
): Promise<{ ok: true; references: string[] }> {
  const { confirmIngestionFn } = await import("@/utils/ai.functions");
  const r = await confirmIngestionFn({ data: { ingestionId, finalData, action } });
  return r as { ok: true; references: string[] };
}

export async function discardIngestion(ingestionId: string): Promise<void> {
  await confirmIngestion(ingestionId, { intent: "unknown", confidence: 0, items: [] }, "discard");
}

/** Fuzzy product lookup — top 5 matches by name/SKU substring (client-side, RLS applies). */
export async function searchProductForIngestion(
  tenantId: string,
  query: string,
): Promise<Array<{ id: string; sku: string; name: string; price: number; cost_avg: number; current_stock: number; schema_id: string }>> {
  const q = query.trim();
  if (!q) return [];
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (k: string, v: unknown) => {
          is: (k: string, v: unknown) => {
            or: (s: string) => {
              limit: (n: number) => Promise<{
                data: Array<{
                  id: string;
                  sku: string;
                  name: string;
                  price: number;
                  cost_avg: number;
                  current_stock: number;
                  schema_id: string;
                }> | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
  };
  const safe = q.replace(/[%_,()]/g, "");
  const { data } = await sb
    .from("products")
    .select("id, sku, name, price, cost_avg, current_stock, schema_id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .or(`sku.ilike.%${safe}%,name.ilike.%${safe}%`)
    .limit(5);
  return data ?? [];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip "data:image/...;base64,"
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Map our error codes from the server back to friendly Spanish messages. */
export function aiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("AI_QUOTA_EXCEEDED")) {
    return "Has alcanzado el límite mensual de operaciones IA. Contacta a tu administrador.";
  }
  if (raw.includes("AI_RATE_LIMIT")) {
    return "Demasiadas solicitudes a la IA, intenta en un momento.";
  }
  if (raw.includes("AI_PAYMENT_REQUIRED")) {
    return "El proveedor de IA reportó saldo insuficiente. Contacta a soporte.";
  }
  if (raw.includes("AI_INVALID_OUTPUT")) {
    return "La IA no pudo interpretar tu entrada. Intenta de otra forma o registra manualmente.";
  }
  if (raw.includes("AI_REQUEST_FAILED")) {
    return "Falló la llamada al servicio de IA. Intenta de nuevo.";
  }
  return raw;
}