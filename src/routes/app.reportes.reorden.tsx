import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import {
  fetchReorderAlerts,
  severityLabel,
  severityRank,
  type ReorderAlert,
  type ReorderSeverity,
} from "@/utils/reports";
import { formatNumber } from "@/utils/currency";

export const Route = createFileRoute("/app/reportes/reorden")({
  component: ReordenPage,
});

const SEVERITIES: ReorderSeverity[] = [
  "out",
  "critical",
  "warning",
  "low_velocity_warning",
];

function ReordenPage() {
  const { currentTenantId, currentMembership } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const tenantId = impersonatingId ?? currentTenantId;
  const role = currentMembership?.role;
  const allowed =
    !!impersonatingId || role === "tenant_owner" || role === "gerente";

  const [horizon, setHorizon] = useState(14);
  const [activeSev, setActiveSev] = useState<Set<ReorderSeverity>>(
    new Set(SEVERITIES),
  );
  const [alerts, setAlerts] = useState<ReorderAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReorderAlerts(tenantId, horizon)
      .then((rs) => {
        if (!cancelled) setAlerts(rs);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Error al cargar alertas");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, horizon, allowed]);

  const filtered = useMemo(
    () =>
      alerts
        .filter((a) => activeSev.has(a.severity))
        .sort(
          (a, b) =>
            severityRank(a.severity) - severityRank(b.severity) ||
            (a.days_remaining ?? Infinity) - (b.days_remaining ?? Infinity),
        ),
    [alerts, activeSev],
  );

  const toggleSev = (s: ReorderSeverity) => {
    const next = new Set(activeSev);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setActiveSev(next);
  };

  if (!allowed) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        No tienes permisos para ver alertas de reorden.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Alertas de reorden
        </h1>
        <p className="text-sm text-muted-foreground">
          Productos que requieren reabastecimiento, basado en velocidad de venta
          de los últimos 30 días.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Filtrar por severidad
          </div>
          <div className="flex flex-wrap gap-2">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                onClick={() => toggleSev(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  activeSev.has(s)
                    ? severityChipActive(s)
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                {severityLabel(s)}
              </button>
            ))}
          </div>
        </div>
        <div className="md:w-72">
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
            Horizonte: {horizon} días
          </label>
          <input
            type="range"
            min={7}
            max={30}
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Cargando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          🎉 Todo bajo control. No hay productos en alerta de reorden.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-md border border-border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">Producto</th>
                  <th className="px-3 py-2 text-right font-medium">Stock actual</th>
                  <th className="px-3 py-2 text-right font-medium">Velocidad (uds/día)</th>
                  <th className="px-3 py-2 text-right font-medium">Días restantes</th>
                  <th className="px-3 py-2 font-medium">Severidad</th>
                  <th className="px-3 py-2 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((a) => (
                  <tr key={a.product_id} className="hover:bg-accent/30">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{a.sku}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{a.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(a.current_stock, 2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(a.daily_velocity, 2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.days_remaining != null
                        ? Math.max(0, Math.round(a.days_remaining))
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <SeverityBadge s={a.severity} days={a.days_remaining} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Link
                          to="/app/productos/$productId"
                          params={{ productId: a.product_id }}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                        >
                          Ver
                        </Link>
                        <Link
                          to="/app/inventario/entrada"
                          search={{ productId: a.product_id }}
                          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
                        >
                          Registrar entrada
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {filtered.map((a) => (
              <div
                key={a.product_id}
                className="rounded-md border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {a.name}
                    </div>
                    <div className="text-xs text-muted-foreground">SKU {a.sku}</div>
                  </div>
                  <SeverityBadge s={a.severity} days={a.days_remaining} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Stock</dt>
                    <dd className="tabular-nums">{formatNumber(a.current_stock, 2)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Velocidad</dt>
                    <dd className="tabular-nums">
                      {formatNumber(a.daily_velocity, 2)} /día
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Días</dt>
                    <dd className="tabular-nums">
                      {a.days_remaining != null
                        ? Math.max(0, Math.round(a.days_remaining))
                        : "—"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex gap-2">
                  <Link
                    to="/app/productos/$productId"
                    params={{ productId: a.product_id }}
                    className="flex-1 rounded-md border border-border px-3 py-1.5 text-center text-xs hover:bg-accent"
                  >
                    Ver producto
                  </Link>
                  <Link
                    to="/app/inventario/entrada"
                    search={{ productId: a.product_id }}
                    className="flex-1 rounded-md bg-primary px-3 py-1.5 text-center text-xs text-primary-foreground hover:opacity-90"
                  >
                    Registrar entrada
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function severityChipActive(s: ReorderSeverity): string {
  switch (s) {
    case "out":
      return "border-red-300 bg-red-100 text-red-700";
    case "critical":
      return "border-amber-300 bg-amber-100 text-amber-800";
    case "warning":
      return "border-yellow-300 bg-yellow-100 text-yellow-800";
    case "low_velocity_warning":
      return "border-border bg-muted text-foreground";
  }
}

function SeverityBadge({
  s,
  days,
}: {
  s: ReorderSeverity;
  days: number | null;
}) {
  const base =
    "whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";
  let cls = "";
  switch (s) {
    case "out":
      cls = "bg-red-100 text-red-700 border-red-200";
      break;
    case "critical":
      cls = "bg-amber-100 text-amber-800 border-amber-200";
      break;
    case "warning":
      cls = "bg-yellow-100 text-yellow-800 border-yellow-200";
      break;
    case "low_velocity_warning":
      cls = "bg-muted text-muted-foreground border-border";
      break;
  }
  const text =
    s === "out"
      ? "AGOTADO"
      : days != null
        ? `${severityLabel(s)} · ${Math.max(0, Math.round(days))} días`
        : severityLabel(s);
  return <span className={`${base} ${cls}`}>{text}</span>;
}
