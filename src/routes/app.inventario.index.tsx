import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Plus,
  Minus,
  AlertTriangle,
  PackageX,
  CircleDollarSign,
  Activity,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchInventoryDashboardData,
  MOVEMENT_LABELS,
  INBOUND_TYPES,
  canWriteInventory,
  type DashboardData,
} from "@/utils/inventory";
import {
  formatCurrency,
  formatNumber,
  getTenantCurrency,
  type CurrencyCode,
} from "@/utils/currency";

export const Route = createFileRoute("/app/inventario/")({
  component: InventoryHubPage,
});

function InventoryHubPage() {
  const navigate = useNavigate();
  const { currentTenantId, currentMembership, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role;
  const canWrite = canWriteInventory(role);

  const [data, setData] = useState<DashboardData | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>("MXN");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [dash, t] = await Promise.all([
          fetchInventoryDashboardData(tenantId),
          supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle(),
        ]);
        if (cancelled) return;
        setData(dash);
        setCurrency(getTenantCurrency(t.data?.settings ?? {}));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Inventario</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Estado actual y últimos movimientos
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void navigate({ to: "/app/inventario/entrada" })}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Entrada
            </button>
            <button
              onClick={() => void navigate({ to: "/app/inventario/salida" })}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <Minus className="h-4 w-4" /> Salida
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="warning"
          label="Stock bajo"
          value={loading ? "…" : formatNumber(data?.lowStockCount ?? 0, 0)}
        />
        <Metric
          icon={<PackageX className="h-4 w-4" />}
          tone="danger"
          label="Sin stock"
          value={loading ? "…" : formatNumber(data?.outOfStockCount ?? 0, 0)}
        />
        <Metric
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone="ok"
          label="Valor de inventario"
          value={loading ? "…" : formatCurrency(data?.inventoryValue ?? 0, currency)}
        />
        <Metric
          icon={<Activity className="h-4 w-4" />}
          tone="neutral"
          label="Movimientos hoy"
          value={loading ? "…" : formatNumber(data?.movementsToday ?? 0, 0)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Necesitan reorden</h2>
            <Link
              to="/app/productos"
              search={{}}
              className="text-xs text-primary hover:underline"
            >
              Ver todos
            </Link>
          </header>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">Cargando…</div>
            ) : data && data.lowStockProducts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Todos los productos están por encima de su punto de reorden ✓
              </div>
            ) : (
              data?.lowStockProducts.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <Link
                      to="/app/productos/$productId"
                      params={{ productId: p.id }}
                      className="truncate font-medium text-foreground hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                  </div>
                  <div className="flex items-center gap-4 text-right tabular-nums">
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Stock</div>
                      <div className="font-medium text-destructive">
                        {formatNumber(p.current_stock, 0)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Reorden</div>
                      <div className="text-muted-foreground">{formatNumber(p.reorder_point, 0)}</div>
                    </div>
                    {canWrite && (
                      <button
                        onClick={() =>
                          void navigate({
                            to: "/app/inventario/entrada",
                            search: { productId: p.id },
                          })
                        }
                        className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-accent"
                      >
                        Entrada
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-md border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Últimos movimientos</h2>
            <Link to="/app/inventario/movimientos" className="text-xs text-primary hover:underline">
              Ver todos
            </Link>
          </header>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">Cargando…</div>
            ) : data && data.recentMovements.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Aún no hay movimientos registrados.
              </div>
            ) : (
              data?.recentMovements.map((m) => {
                const inbound = INBOUND_TYPES.has(m.movement_type);
                return (
                  <Link
                    key={m.id}
                    to="/app/inventario/movimientos"
                    className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/40"
                  >
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        inbound
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {inbound ? (
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground">
                        {m.product?.name ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type} · {relativeTime(m.created_at)}
                      </div>
                    </div>
                    <div
                      className={`tabular-nums text-sm font-medium ${
                        inbound ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {inbound ? "+" : "−"}
                      {formatNumber(m.quantity, 0)}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

type Tone = "ok" | "warning" | "danger" | "neutral";

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: Tone;
}) {
  const toneClass: Record<Tone, string> = {
    ok: "bg-green-50 text-green-800 border-green-200",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
    danger: "bg-red-50 text-red-800 border-red-200",
    neutral: "bg-muted text-foreground border-border",
  };
  return (
    <div className={`rounded-md border p-4 ${toneClass[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString("es-MX");
}
