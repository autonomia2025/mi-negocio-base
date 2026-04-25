import { supabase } from "@/integrations/supabase/client";

export type PaymentMethod =
  | "efectivo"
  | "transferencia"
  | "tarjeta_debito"
  | "tarjeta_credito"
  | "credito"
  | "mixto"
  | "otro";

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta_debito: "Tarjeta de débito",
  tarjeta_credito: "Tarjeta de crédito",
  credito: "Crédito directo",
  mixto: "Mixto",
  otro: "Otro",
};

export const PAYMENT_METHODS: PaymentMethod[] = [
  "efectivo",
  "transferencia",
  "tarjeta_debito",
  "tarjeta_credito",
  "credito",
  "otro",
];

export type CartItem = {
  product_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit_price: number;
  current_stock: number;
  cost_avg: number;
};

export type SaleStatus = "completed" | "voided";

export type SaleRow = {
  id: string;
  tenant_id: string;
  sale_number: number;
  customer_name: string | null;
  customer_email: string | null;
  payment_method: PaymentMethod;
  subtotal: number;
  tax_amount: number;
  total: number;
  profit: number;
  notes: string | null;
  status: SaleStatus;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  pdf_path: string | null;
  created_by: string;
  created_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  product_name_at_sale: string;
  product_sku_at_sale: string;
  quantity: number;
  unit_price: number;
  unit_cost_at_sale: number;
  line_subtotal: number;
  line_profit: number;
  created_at: string;
};

export type SaleWithItems = SaleRow & {
  items: SaleItem[];
};

type SbAny = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (t: string) => unknown;
};

/** Calls register_sale RPC. Returns new sale id. */
export async function registerSale(input: {
  tenantId: string;
  paymentMethod: PaymentMethod;
  customerName?: string;
  customerEmail?: string;
  notes?: string;
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
}): Promise<string> {
  const sb = supabase as unknown as SbAny;
  const { data, error } = await sb.rpc("register_sale", {
    p_tenant_id: input.tenantId,
    p_payment_method: input.paymentMethod,
    p_customer_name: input.customerName ?? null,
    p_customer_email: input.customerEmail ?? null,
    p_notes: input.notes ?? null,
    p_items: input.items,
  });
  if (error) {
    const msg = error.message ?? "No se pudo registrar la venta";
    throw new Error(msg.replace(/^.*?:\s*/, ""));
  }
  if (!data || typeof data !== "string") {
    throw new Error("No se pudo registrar la venta");
  }
  return data;
}

/** Calls void_sale RPC. */
export async function voidSale(saleId: string, reason: string): Promise<void> {
  const sb = supabase as unknown as SbAny;
  const { error } = await sb.rpc("void_sale", {
    p_sale_id: saleId,
    p_reason: reason,
  });
  if (error) {
    const msg = error.message ?? "No se pudo cancelar la venta";
    throw new Error(msg.replace(/^.*?:\s*/, ""));
  }

  // Audit log
  const { data: userRes } = await supabase.auth.getUser();
  const sbSale = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (k: string, v: string) => {
          maybeSingle: () => Promise<{
            data: { tenant_id: string; sale_number: number } | null;
          }>;
        };
      };
    };
  };
  const { data: saleRow } = await sbSale
    .from("sales")
    .select("tenant_id, sale_number")
    .eq("id", saleId)
    .maybeSingle();
  if (saleRow && userRes?.user) {
    await supabase.from("audit_log").insert({
      action: "sale.voided",
      entity_type: "sale",
      entity_id: saleId,
      tenant_id: saleRow.tenant_id,
      user_id: userRes.user.id,
      changes: {
        reason,
        sale_number: saleRow.sale_number,
        voided_by: userRes.user.id,
      },
    });
  }
}

export type SaleFilters = {
  from?: string;
  to?: string;
  paymentMethods?: PaymentMethod[];
  search?: string;
  salesPersonId?: string;
  onlyMine?: boolean;
};

export const SALES_PAGE_SIZE = 50;

export async function fetchSales(
  tenantId: string,
  filters: SaleFilters,
  page: number,
  currentUserId?: string,
): Promise<{ rows: SaleRow[]; total: number; sumTotal: number; sumProfit: number }> {
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string, opts?: { count?: "exact" }) => unknown;
    };
  };

  type Q = {
    eq: (k: string, v: unknown) => Q;
    gte: (k: string, v: string) => Q;
    lte: (k: string, v: string) => Q;
    in: (k: string, v: unknown[]) => Q;
    or: (s: string) => Q;
    order: (k: string, o: { ascending: boolean }) => Q;
    range: (a: number, b: number) => Promise<{
      data: SaleRow[] | null;
      error: { message: string } | null;
      count: number | null;
    }>;
  };

  let q = sb
    .from("sales")
    .select("*", { count: "exact" }) as unknown as Q;
  q = q.eq("tenant_id", tenantId);

  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);
  if (filters.paymentMethods && filters.paymentMethods.length > 0) {
    q = q.in("payment_method", filters.paymentMethods);
  }
  if (filters.salesPersonId) q = q.eq("created_by", filters.salesPersonId);
  if (filters.onlyMine && currentUserId) q = q.eq("created_by", currentUserId);
  if (filters.search && filters.search.trim()) {
    const s = filters.search.trim().replace(/[%_]/g, "");
    const asNum = Number(s);
    const parts: string[] = [];
    if (Number.isFinite(asNum)) parts.push(`sale_number.eq.${asNum}`);
    parts.push(`customer_name.ilike.%${s}%`);
    q = q.or(parts.join(","));
  }

  q = q.order("created_at", { ascending: false });
  const from = (page - 1) * SALES_PAGE_SIZE;
  const to = from + SALES_PAGE_SIZE - 1;
  const { data, error, count } = await q.range(from, to);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SaleRow[];

  // Manager footer summary: aggregate over current page only
  let sumTotal = 0;
  let sumProfit = 0;
  for (const r of rows) {
    if (r.status === "voided") continue;
    sumTotal += Number(r.total);
    sumProfit += Number(r.profit);
  }

  return { rows, total: count ?? 0, sumTotal, sumProfit };
}

export async function fetchSaleById(
  id: string,
  tenantId: string,
): Promise<SaleWithItems | null> {
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => {
            maybeSingle: () => Promise<{
              data: (SaleRow & { items: SaleItem[] }) | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };
  const { data, error } = await sb
    .from("sales")
    .select("*, items:sale_items(*)")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as SaleWithItems;
}

/** Permission helpers */
export function canViewProfit(role: string | null | undefined): boolean {
  return role === "tenant_owner" || role === "gerente" || role === "super_admin";
}

export function canVoidSale(role: string | null | undefined, isOwn: boolean): boolean {
  if (role === "tenant_owner" || role === "gerente" || role === "super_admin") return true;
  if (isOwn && (role === "vendedor" || role === "cajero")) return true;
  return false;
}

export function canSell(role: string | null | undefined): boolean {
  return (
    role === "tenant_owner" ||
    role === "gerente" ||
    role === "vendedor" ||
    role === "cajero" ||
    role === "super_admin"
  );
}

export function canSeeAllSales(role: string | null | undefined): boolean {
  return role === "tenant_owner" || role === "gerente" || role === "super_admin";
}

/** Server function caller for PDF generation. */
export async function generateSalePdfClient(saleId: string): Promise<{ signedUrl: string; pdfPath: string }> {
  const { generateSalePdfFn } = await import("@/utils/sales.functions");
  return generateSalePdfFn({ data: { saleId } });
}