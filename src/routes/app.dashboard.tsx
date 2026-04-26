import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import {
  dateRangeFromKey,
  fetchDashboardKpis,
  fetchSalesByDay,
  fetchTopProducts,
  fetchSalesByPaymentMethod,
  fetchReorderAlerts,
  severityLabel,
  type DateRangeKey,
  type DashboardKpis,
  type SalesByDayRow,
  type TopProduct,
  type SalesByPaymentRow,
  type ReorderAlert,
} from "@/utils/reports";
import { formatCurrency, formatNumber } from "@/utils/currency";
import { PAYMENT_LABELS, type PaymentMethod } from "@/utils/sales";

export const Route = createFileRoute("/app/dashboard")({
  component: DashboardPage,
});

const RANGE_KEYS: DateRangeKey[] = [
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "last_30d",
];
const RANGE_LABELS: Record<DateRangeKey, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  this_week: "Esta semana",
  this_month: "Este mes",
  last_30d: "Últimos 30 días",
  custom: "Personalizado",
};

const PIE_COLORS = ["#378ADD", "#7EBBF1", "#1E5A99", "#A8D5FF", "#5DA0E8", "#2D6FB5", "#94C9F9"];

function DashboardPage() {
  const { currentTenantId, currentMembership } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const navigate = useNavigate();
  const tenantId = impersonatingId ?? currentTenantId;

  const [rangeKey, setRangeKey] = useState<DateRangeKey>("this_month");
  const range = useMemo(() => dateRangeFromKey(rangeKey), [rangeKey]);

  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [series, setSeries] = useState<SalesByDayRow[]>([]);
  const [topMetric, setTopMetric] = useState<"revenue" | "quantity" | "profit">(
    "revenue",
  );
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [byMethod, setByMethod] = useState<SalesByPaymentRow[]>([]);
  const [alerts, setAlerts] = useState<ReorderAlert[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Role guard (UI-level — RPCs also check)
  const role = currentMembership?.role;
  const allowed =
    !!impersonatingId || role === "tenant_owner" || role === "gerente";

  useEffect(() => {
    if (!tenantId || !allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchDashboardKpis(tenantId, range),
      fetchSalesByDay(tenantId, range),
      fetchTopProducts(tenantId, range, topMetric),
      fetchSalesByPaymentMethod(tenantId, range),
      fetchReorderAlerts(tenantId, 14),
    ])
      .then(([k, s, t, m, a]) => {
        if (cancelled) return;
        setKpis(k);
        setSeries(s);
        setTopProducts(t);
        setByMethod(m);
        setAlerts(a);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Error al cargar dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, range, topMetric, allowed]);

  if (!allowed) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        No tienes permisos para ver el dashboard.
      </div>
    );
  }

  const totalAlertProducts =
    (kpis?.out_of_stock_count ?? 0) +
    (kpis?.critical_stock_count ?? 0) +
    (kpis?.low_stock_count ?? 0);

  const seriesData = series.map((r) => ({
    ...r,
    label: new Date(r.day + "T00:00:00").toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "2-digit",
    }),
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Visión general del negocio
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-md border border-border bg-card p-1">
          {RANGE_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setRangeKey(k)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                rangeKey === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {RANGE_LABELS[k]}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Row 1: KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Ventas totales"
          value={formatCurrency(kpis?.total_sales ?? 0)}
          loading={loading}
        />
        <KpiCard
          label="Utilidad"
          value={formatCurrency(kpis?.total_profit ?? 0)}
          valueClassName={
            (kpis?.total_profit ?? 0) > 0 ? "text-emerald-600" : "text-foreground"
          }
          loading={loading}
        />
        <KpiCard
          label="Tickets"
          value={formatNumber(kpis?.sale_count ?? 0, 0)}
          subtitle={`Promedio: ${formatCurrency(kpis?.avg_ticket ?? 0)}`}
          loading={loading}
        />
        <KpiCard
          label="Clientes únicos"
          value={formatNumber(kpis?.unique_customers ?? 0, 0)}
          loading={loading}
        />
      </section>

      {/* Row 2: Inventory health */}
      <button
        onClick={() => void navigate({ to: "/app/reportes/reorden" })}
        className="block w-full text-left"
      >
        <div className="rounded-md border border-border bg-card p-4 transition hover:border-primary hover:shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Salud del inventario
            </h2>
            <span className="text-xs text-primary">Ver alertas →</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Valor inventario
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {formatCurrency(kpis?.inventory_value ?? 0)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Productos activos
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {formatNumber(kpis?.active_products ?? 0, 0)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Productos en alerta
              </div>
              <div className="mt-1 flex items-baseline gap-3 text-sm">
                <span className="text-xl font-semibold tabular-nums text-foreground">
                  {formatNumber(totalAlertProducts, 0)}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  <Dot color="bg-red-500" />
                  {kpis?.out_of_stock_count ?? 0} agotados
                  <Dot color="bg-amber-500" />
                  {kpis?.critical_stock_count ?? 0} críticos
                  <Dot color="bg-yellow-400" />
                  {kpis?.low_stock_count ?? 0} bajos
                </span>
              </div>
            </div>
          </div>
        </div>
      </button>

      {/* Row 3: Sales over time */}
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Ventas en el tiempo
        </h2>
        {seriesData.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Sin ventas en este periodo
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <AreaChart data={seriesData}>
                <defs>
                  <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#378ADD" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#378ADD" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("es-MX", {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(Number(v))
                  }
                />
                <Tooltip content={<SalesTooltip />} />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Ventas"
                  stroke="#378ADD"
                  strokeWidth={2}
                  fill="url(#gSales)"
                />
                <Area
                  type="monotone"
                  dataKey="profit"
                  name="Utilidad"
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Row 4: Top products + Payment methods */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Top 10 productos
            </h2>
            <div className="flex gap-1 rounded-md border border-border p-1">
              {(["revenue", "quantity", "profit"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setTopMetric(m)}
                  className={`rounded px-2 py-1 text-[11px] font-medium ${
                    topMetric === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {m === "revenue"
                    ? "Ingresos"
                    : m === "quantity"
                      ? "Cantidad"
                      : "Utilidad"}
                </button>
              ))}
            </div>
          </div>
          {topProducts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Sin ventas en este periodo
            </p>
          ) : (
            <div style={{ height: Math.max(220, topProducts.length * 32) }}>
              <ResponsiveContainer>
                <BarChart
                  data={topProducts}
                  layout="vertical"
                  margin={{ top: 4, right: 12, bottom: 4, left: 8 }}
                  onClick={(e) => {
                    const item = e?.activePayload?.[0]?.payload as TopProduct | undefined;
                    if (item)
                      void navigate({
                        to: "/app/productos/$productId",
                        params: { productId: item.product_id },
                      });
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      topMetric === "quantity"
                        ? formatNumber(Number(v), 0)
                        : new Intl.NumberFormat("es-MX", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(Number(v))
                    }
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    width={140}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<TopProductTooltip metric={topMetric} />} />
                  <Bar
                    dataKey={
                      topMetric === "revenue"
                        ? "total_revenue"
                        : topMetric === "quantity"
                          ? "total_qty"
                          : "total_profit"
                    }
                    fill="#378ADD"
                    radius={[0, 4, 4, 0]}
                    cursor="pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Ventas por método de pago
          </h2>
          {byMethod.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Sin ventas en este periodo
            </p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={byMethod}
                    dataKey="total"
                    nameKey="payment_method"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {byMethod.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, _name, p) => [
                      formatCurrency(Number(value)),
                      PAYMENT_LABELS[(p?.payload as SalesByPaymentRow).payment_method as PaymentMethod] ??
                        (p?.payload as SalesByPaymentRow).payment_method,
                    ]}
                  />
                  <Legend
                    formatter={(_v, entry) => {
                      const r = entry?.payload as unknown as SalesByPaymentRow;
                      const label =
                        PAYMENT_LABELS[r.payment_method as PaymentMethod] ??
                        r.payment_method;
                      return (
                        <span className="text-xs text-foreground">
                          {label} · {formatCurrency(r.total)}
                        </span>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      {/* Row 5: Reorder preview */}
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Alertas de reorden
          </h2>
          <Link
            to="/app/reportes/reorden"
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver todas →
          </Link>
        </div>
        {alerts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            🎉 Todo bajo control. Sin alertas.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.slice(0, 5).map((a) => (
              <li
                key={a.product_id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <Link
                    to="/app/productos/$productId"
                    params={{ productId: a.product_id }}
                    className="block truncate text-sm font-medium text-foreground hover:text-primary"
                  >
                    {a.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    SKU {a.sku} · stock {formatNumber(a.current_stock, 2)}
                  </div>
                </div>
                <SeverityBadge a={a} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  subtitle,
  loading,
  valueClassName,
}: {
  label: string;
  value: string;
  subtitle?: string;
  loading?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            valueClassName ?? "text-foreground"
          }`}
        >
          {value}
        </div>
      )}
      {subtitle && (
        <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      )}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function SalesTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: SalesByDayRow & { label: string } }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-foreground">{label}</div>
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        <div>Ventas: {formatCurrency(r.total)}</div>
        <div>Utilidad: {formatCurrency(r.profit)}</div>
        <div>Tickets: {formatNumber(r.sale_count, 0)}</div>
      </div>
    </div>
  );
}

function TopProductTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ payload: TopProduct }>;
  metric: "revenue" | "quantity" | "profit";
}) {
  if (!active || !payload || payload.length === 0) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-foreground">{r.name}</div>
      <div className="text-muted-foreground">SKU {r.sku}</div>
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        <div>Ingresos: {formatCurrency(r.total_revenue)}</div>
        <div>Cantidad: {formatNumber(r.total_qty, 2)}</div>
        <div>Utilidad: {formatCurrency(r.total_profit)}</div>
        <div className="mt-1 text-[10px] uppercase tracking-wide">
          Ordenado por:{" "}
          {metric === "revenue"
            ? "Ingresos"
            : metric === "quantity"
              ? "Cantidad"
              : "Utilidad"}
        </div>
      </div>
    </div>
  );
}

function SeverityBadge({ a }: { a: ReorderAlert }) {
  const cls =
    a.severity === "out"
      ? "bg-red-100 text-red-700 border-red-200"
      : a.severity === "critical"
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : a.severity === "warning"
          ? "bg-yellow-100 text-yellow-800 border-yellow-200"
          : "bg-muted text-muted-foreground border-border";
  const text =
    a.severity === "out"
      ? "AGOTADO"
      : a.days_remaining != null
        ? `${severityLabel(a.severity)} · ${Math.max(
            0,
            Math.round(a.days_remaining),
          )} días`
        : severityLabel(a.severity);
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {text}
    </span>
  );
}
