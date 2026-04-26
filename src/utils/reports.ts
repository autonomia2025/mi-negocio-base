import { supabase } from "@/integrations/supabase/client";

// ───────── Types ─────────

export type DateRangeKey =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "last_30d"
  | "custom";

export type DateRange = { from: Date; to: Date };

export type DashboardKpis = {
  total_sales: number;
  total_profit: number;
  sale_count: number;
  voided_count: number;
  avg_ticket: number;
  unique_customers: number;
  inventory_value: number;
  active_products: number;
  low_stock_count: number;
  critical_stock_count: number;
  out_of_stock_count: number;
};

export type SalesByDayRow = {
  day: string; // ISO date (YYYY-MM-DD)
  total: number;
  sale_count: number;
  profit: number;
};

export type TopProduct = {
  product_id: string;
  sku: string;
  name: string;
  total_qty: number;
  total_revenue: number;
  total_profit: number;
};

export type SalesByPaymentRow = {
  payment_method: string;
  total: number;
  sale_count: number;
};

export type CashReconciliation = {
  by_method: Record<string, { total: number; count: number }>;
  total: number;
  count: number;
  voided_count: number;
  voided_total: number;
  first_sale: string | null;
  last_sale: string | null;
};

export type ReorderSeverity = "out" | "critical" | "warning" | "low_velocity_warning";

export type ReorderAlert = {
  product_id: string;
  sku: string;
  name: string;
  current_stock: number;
  reorder_point: number;
  min_stock: number;
  daily_velocity: number;
  days_remaining: number | null;
  severity: ReorderSeverity;
};

// ───────── Date range utility ─────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function dateRangeFromKey(
  key: DateRangeKey,
  customFrom?: Date,
  customTo?: Date,
): DateRange {
  const now = new Date();
  switch (key) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "this_week": {
      // Monday as first day
      const d = startOfDay(now);
      const day = d.getDay(); // 0 sun .. 6 sat
      const diffToMonday = (day + 6) % 7;
      d.setDate(d.getDate() - diffToMonday);
      return { from: d, to: endOfDay(now) };
    }
    case "this_month": {
      const f = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { from: f, to: endOfDay(now) };
    }
    case "last_30d": {
      const f = new Date(now);
      f.setDate(f.getDate() - 29);
      return { from: startOfDay(f), to: endOfDay(now) };
    }
    case "custom": {
      const f = customFrom ? startOfDay(customFrom) : startOfDay(now);
      const t = customTo ? endOfDay(customTo) : endOfDay(now);
      return { from: f, to: t };
    }
  }
}

export const DATE_RANGE_LABELS: Record<DateRangeKey, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  this_week: "Esta semana",
  this_month: "Este mes",
  last_30d: "Últimos 30 días",
  custom: "Personalizado",
};

// ───────── RPC wrappers ─────────

const EMPTY_KPIS: DashboardKpis = {
  total_sales: 0,
  total_profit: 0,
  sale_count: 0,
  voided_count: 0,
  avg_ticket: 0,
  unique_customers: 0,
  inventory_value: 0,
  active_products: 0,
  low_stock_count: 0,
  critical_stock_count: 0,
  out_of_stock_count: 0,
};

function asNumber(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchDashboardKpis(
  tenantId: string,
  range: DateRange,
): Promise<DashboardKpis> {
  const { data, error } = await supabase.rpc("dashboard_kpis", {
    p_tenant_id: tenantId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error) throw error;
  const obj = (data ?? {}) as Record<string, unknown>;
  return {
    total_sales: asNumber(obj.total_sales),
    total_profit: asNumber(obj.total_profit),
    sale_count: asNumber(obj.sale_count),
    voided_count: asNumber(obj.voided_count),
    avg_ticket: asNumber(obj.avg_ticket),
    unique_customers: asNumber(obj.unique_customers),
    inventory_value: asNumber(obj.inventory_value),
    active_products: asNumber(obj.active_products),
    low_stock_count: asNumber(obj.low_stock_count),
    critical_stock_count: asNumber(obj.critical_stock_count),
    out_of_stock_count: asNumber(obj.out_of_stock_count),
  } satisfies DashboardKpis;
}

export { EMPTY_KPIS };

export async function fetchSalesByDay(
  tenantId: string,
  range: DateRange,
): Promise<SalesByDayRow[]> {
  const { data, error } = await supabase.rpc("sales_by_day", {
    p_tenant_id: tenantId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    day: String(r.day),
    total: asNumber(r.total),
    sale_count: asNumber(r.sale_count),
    profit: asNumber(r.profit),
  }));
}

export async function fetchTopProducts(
  tenantId: string,
  range: DateRange,
  metric: "revenue" | "quantity" | "profit",
): Promise<TopProduct[]> {
  const { data, error } = await supabase.rpc("top_products", {
    p_tenant_id: tenantId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_metric: metric,
  });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    product_id: String(r.product_id),
    sku: String(r.sku ?? ""),
    name: String(r.name ?? ""),
    total_qty: asNumber(r.total_qty),
    total_revenue: asNumber(r.total_revenue),
    total_profit: asNumber(r.total_profit),
  }));
}

export async function fetchSalesByPaymentMethod(
  tenantId: string,
  range: DateRange,
): Promise<SalesByPaymentRow[]> {
  const { data, error } = await supabase.rpc("sales_by_payment_method", {
    p_tenant_id: tenantId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    payment_method: String(r.payment_method ?? "otro"),
    total: asNumber(r.total),
    sale_count: asNumber(r.sale_count),
  }));
}

export async function fetchCashReconciliation(
  tenantId: string,
  range: DateRange,
  userId?: string | null,
): Promise<CashReconciliation> {
  const { data, error } = await supabase.rpc("cash_reconciliation", {
    p_tenant_id: tenantId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_user_id: userId ?? null,
  });
  if (error) throw error;
  const obj = (data ?? {}) as Record<string, unknown>;
  const byMethodRaw = (obj.by_method ?? {}) as Record<
    string,
    { total: unknown; count: unknown }
  >;
  const by_method: Record<string, { total: number; count: number }> = {};
  for (const [k, v] of Object.entries(byMethodRaw)) {
    by_method[k] = { total: asNumber(v.total), count: asNumber(v.count) };
  }
  return {
    by_method,
    total: asNumber(obj.total),
    count: asNumber(obj.count),
    voided_count: asNumber(obj.voided_count),
    voided_total: asNumber(obj.voided_total),
    first_sale: (obj.first_sale as string) ?? null,
    last_sale: (obj.last_sale as string) ?? null,
  };
}

export async function fetchReorderAlerts(
  tenantId: string,
  daysHorizon = 14,
): Promise<ReorderAlert[]> {
  const { data, error } = await supabase.rpc("reorder_alerts", {
    p_tenant_id: tenantId,
    p_days_horizon: daysHorizon,
  });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    product_id: String(r.product_id),
    sku: String(r.sku ?? ""),
    name: String(r.name ?? ""),
    current_stock: asNumber(r.current_stock),
    reorder_point: asNumber(r.reorder_point),
    min_stock: asNumber(r.min_stock),
    daily_velocity: asNumber(r.daily_velocity),
    days_remaining:
      r.days_remaining === null || r.days_remaining === undefined
        ? null
        : asNumber(r.days_remaining),
    severity: (r.severity as ReorderSeverity) ?? "warning",
  }));
}

// ───────── Display helpers ─────────

export function severityLabel(s: ReorderSeverity): string {
  switch (s) {
    case "out":
      return "AGOTADO";
    case "critical":
      return "CRÍTICO";
    case "warning":
      return "ATENCIÓN";
    case "low_velocity_warning":
      return "BAJO STOCK";
  }
}

export function severityRank(s: ReorderSeverity): number {
  switch (s) {
    case "out":
      return 0;
    case "critical":
      return 1;
    case "warning":
      return 2;
    case "low_velocity_warning":
      return 3;
  }
}
