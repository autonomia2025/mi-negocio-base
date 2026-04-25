import { supabase } from "@/integrations/supabase/client";

export const MOVEMENT_LABELS: Record<string, string> = {
  purchase: "Compra",
  sale: "Venta",
  adjustment_in: "Ajuste +",
  adjustment_out: "Ajuste −",
  return_in: "Devolución de cliente",
  return_out: "Devolución a proveedor",
  transfer_in: "Entrada por transferencia",
  transfer_out: "Salida por transferencia",
  initial: "Inventario inicial",
};

export const INBOUND_TYPES = new Set([
  "purchase",
  "adjustment_in",
  "return_in",
  "transfer_in",
  "initial",
]);

export type MovementType = keyof typeof MOVEMENT_LABELS;

export type InventoryMovement = {
  id: string;
  tenant_id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  signed_quantity: number;
  unit_cost: number | null;
  unit_price: number | null;
  reference_type: string | null;
  reference_id: string | null;
  stock_before: number;
  stock_after: number;
  notes: string | null;
  created_by: string;
  created_at: string;
};

export type MovementWithProduct = InventoryMovement & {
  product?: { id: string; sku: string; name: string } | null;
  user_email?: string | null;
};

export type RecordMovementInput = {
  tenantId: string;
  productId: string;
  movementType: string;
  quantity: number;
  unitCost?: number | null;
  unitPrice?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
};

/**
 * Calls the atomic record_inventory_movement RPC.
 * Returns the new movement id on success, or throws a friendly error.
 */
export async function recordMovement(input: RecordMovementInput): Promise<string> {
  // The RPC isn't in the generated types yet; cast through unknown.
  const client = supabase as unknown as {
    rpc: (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: string | null; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("record_inventory_movement", {
    p_tenant_id: input.tenantId,
    p_product_id: input.productId,
    p_movement_type: input.movementType,
    p_quantity: input.quantity,
    p_unit_cost: input.unitCost ?? null,
    p_unit_price: input.unitPrice ?? null,
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) {
    const msg = error.message ?? "No se pudo registrar el movimiento";
    // Strip Postgres prefixes
    throw new Error(msg.replace(/^.*?:\s*/, ""));
  }
  if (!data) throw new Error("No se pudo registrar el movimiento");
  return data;
}

export type MovementFilters = {
  from?: string; // ISO
  to?: string; // ISO
  types?: string[];
  productId?: string;
  userId?: string;
};

export const MOVEMENTS_PAGE_SIZE = 50;

export async function fetchMovements(
  tenantId: string,
  filters: MovementFilters,
  page: number,
): Promise<{ rows: MovementWithProduct[]; total: number }> {
  // Cast through unknown because inventory_movements isn't in generated types
  const sb = supabase as unknown as {
    from: (table: string) => {
      select: (
        cols: string,
        opts?: { count?: "exact" },
      ) => {
        eq: (k: string, v: unknown) => unknown;
      };
    };
  };
  let q = sb
    .from("inventory_movements")
    .select(
      "*, product:products(id, sku, name)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId) as {
      gte: (k: string, v: string) => unknown;
      lte: (k: string, v: string) => unknown;
      in: (k: string, v: string[]) => unknown;
      eq: (k: string, v: string) => unknown;
      order: (k: string, o: { ascending: boolean }) => unknown;
      range: (a: number, b: number) => Promise<{
        data: MovementWithProduct[] | null;
        error: { message: string } | null;
        count: number | null;
      }>;
    };

  if (filters.from) q = q.gte("created_at", filters.from) as typeof q;
  if (filters.to) q = q.lte("created_at", filters.to) as typeof q;
  if (filters.types && filters.types.length > 0)
    q = q.in("movement_type", filters.types) as typeof q;
  if (filters.productId) q = q.eq("product_id", filters.productId) as typeof q;
  if (filters.userId) q = q.eq("created_by", filters.userId) as typeof q;

  const from = (page - 1) * MOVEMENTS_PAGE_SIZE;
  const to = from + MOVEMENTS_PAGE_SIZE - 1;
  q = q.order("created_at", { ascending: false }) as typeof q;
  const { data, error, count } = await q.range(from, to);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as MovementWithProduct[], total: count ?? 0 };
}

export async function fetchMovementsByProduct(
  productId: string,
  tenantId: string,
  limit = 100,
): Promise<MovementWithProduct[]> {
  const sb = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => {
            order: (k: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{
                data: MovementWithProduct[] | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
  };
  const { data, error } = await sb
    .from("inventory_movements")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as MovementWithProduct[];
}

export type DashboardData = {
  lowStockCount: number;
  outOfStockCount: number;
  inventoryValue: number;
  movementsToday: number;
  lowStockProducts: Array<{
    id: string;
    sku: string;
    name: string;
    current_stock: number;
    reorder_point: number;
    reorder_qty: number;
  }>;
  recentMovements: MovementWithProduct[];
};

export async function fetchInventoryDashboardData(
  tenantId: string,
): Promise<DashboardData> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayIso = startOfToday.toISOString();

  const sbAny = supabase as unknown as {
    from: (t: string) => {
      // Used only for inventory_movements (not in generated types)
      select: (
        cols: string,
        opts?: { count?: "exact"; head?: boolean },
      ) => {
        eq: (k: string, v: string) => {
          gte: (k: string, v: string) => Promise<{ count: number | null }>;
          order: (k: string, o: { ascending: boolean }) => {
            limit: (n: number) => Promise<{
              data: MovementWithProduct[] | null;
            }>;
          };
        };
      };
    };
  };

  const [
    activeProductsRes,
    movementsTodayRes,
    lowStockRes,
    recentMovementsRes,
  ] = await Promise.all([
    supabase
      .from("products")
      .select("current_stock, cost_avg, reorder_point")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .is("deleted_at", null),
    sbAny
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", todayIso),
    supabase
      .from("products")
      .select("id, sku, name, current_stock, reorder_point, reorder_qty")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("current_stock", { ascending: true })
      .limit(20),
    sbAny
      .from("inventory_movements")
      .select("*, product:products(id, sku, name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const products = (activeProductsRes.data ?? []) as Array<{
    current_stock: number;
    cost_avg: number;
    reorder_point: number;
  }>;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let inventoryValue = 0;
  for (const p of products) {
    const stock = Number(p.current_stock);
    const reorder = Number(p.reorder_point);
    const cost = Number(p.cost_avg);
    inventoryValue += stock * cost;
    if (stock <= 0) outOfStockCount += 1;
    else if (stock <= reorder) lowStockCount += 1;
  }
  // outOfStockCount counts as low stock too in spec? Spec says separate metrics.
  // Include zero-stock in lowStockCount as well so the "low stock" KPI is not misleading.
  // Actually the spec's "Productos en stock bajo" says current_stock <= reorder_point,
  // which mathematically includes 0. Keep them separate for the KPI cards but use the
  // mathematical definition for lowStockCount:
  lowStockCount = products.filter(
    (p) => Number(p.current_stock) <= Number(p.reorder_point),
  ).length;

  const lowStockAll = (lowStockRes.data ?? []) as DashboardData["lowStockProducts"];
  const lowStockProducts = lowStockAll
    .filter((p) => Number(p.current_stock) <= Number(p.reorder_point))
    .sort((a, b) => {
      const ra = Number(a.reorder_point) > 0 ? Number(a.current_stock) / Number(a.reorder_point) : 0;
      const rb = Number(b.reorder_point) > 0 ? Number(b.current_stock) / Number(b.reorder_point) : 0;
      return ra - rb;
    });

  return {
    lowStockCount,
    outOfStockCount,
    inventoryValue,
    movementsToday: (movementsTodayRes as unknown as { count: number | null }).count ?? 0,
    lowStockProducts,
    recentMovements: (recentMovementsRes.data ?? []) as MovementWithProduct[],
  };
}

export function canWriteInventory(role: string | undefined | null): boolean {
  return role === "tenant_owner" || role === "gerente" || role === "almacenista";
}
