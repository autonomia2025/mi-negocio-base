import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSales,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  SALES_PAGE_SIZE,
  canSell,
  canSeeAllSales,
  type PaymentMethod,
  type SaleRow,
  type SaleFilters,
} from "@/utils/sales";
import { formatCurrency, getTenantCurrency, type CurrencyCode } from "@/utils/currency";

export const Route = createFileRoute("/app/ventas/")({
  component: SalesListPage,
});

type Range = "today" | "week" | "month" | "30d" | "custom";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // monday-first
  x.setDate(x.getDate() - day);
  return x;
}
function startOfMonth(d: Date) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function rangeToFilter(r: Range, customFrom?: string, customTo?: string): { from?: string; to?: string } {
  const now = new Date();
  if (r === "today") return { from: startOfDay(now).toISOString() };
  if (r === "week") return { from: startOfWeek(now).toISOString() };
  if (r === "month") return { from: startOfMonth(now).toISOString() };
  if (r === "30d") {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return { from: startOfDay(d).toISOString() };
  }
  return {
    from: customFrom ? new Date(customFrom).toISOString() : undefined,
    to: customTo ? new Date(customTo + "T23:59:59").toISOString() : undefined,
  };
}

function SalesListPage() {
  const { currentTenantId, currentMembership, memberships, user } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role ?? null;
  const isManager = canSeeAllSales(role);
  const showSell = canSell(role);

  const [rows, setRows] = useState<SaleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sumTotal, setSumTotal] = useState(0);
  const [sumProfit, setSumProfit] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<Range>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [search, setSearch] = useState("");
  const [salesPersonId, setSalesPersonId] = useState<string>("");
  const [tenantUsers, setTenantUsers] = useState<Array<{ user_id: string; label: string }>>([]);
  const [currency, setCurrency] = useState<CurrencyCode>("MXN");

  // Load tenant currency + users (managers only)
  useEffect(() => {
    if (!tenantId) return;
    void supabase
      .from("tenants")
      .select("settings")
      .eq("id", tenantId)
      .maybeSingle()
      .then(({ data }) => setCurrency(getTenantCurrency(data?.settings ?? {})));

    if (isManager) {
      void supabase
        .from("user_tenants")
        .select("user_id, role")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .then(({ data }) => {
          if (!data) return;
          setTenantUsers(
            data.map((m) => ({
              user_id: m.user_id,
              label: `${m.user_id.slice(0, 8)}… (${m.role})`,
            })),
          );
        });
    }
  }, [tenantId, isManager]);

  const filters = useMemo<SaleFilters>(() => {
    const r = rangeToFilter(range, customFrom, customTo);
    return {
      from: r.from,
      to: r.to,
      paymentMethods: methods,
      search: search.trim() || undefined,
      salesPersonId: salesPersonId || undefined,
      onlyMine: !isManager,
    };
  }, [range, customFrom, customTo, methods, search, salesPersonId, isManager]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSales(tenantId, filters, page, user?.id)
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTotal(res.total);
        setSumTotal(res.sumTotal);
        setSumProfit(res.sumProfit);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tenantId, filters, page, user?.id]);

  const totalPages = Math.max(1, Math.ceil(total / SALES_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{isManager ? "Ventas" : "Mis ventas"}</h1>
        {showSell && (
          <Link
            to="/app/ventas/nueva"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Nueva venta
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {(["today", "week", "month", "30d", "custom"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => {
                setRange(r);
                setPage(1);
              }}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                range === r
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-accent"
              }`}
            >
              {r === "today" && "Hoy"}
              {r === "week" && "Esta semana"}
              {r === "month" && "Este mes"}
              {r === "30d" && "Últimos 30 días"}
              {r === "custom" && "Personalizado"}
            </button>
          ))}
          {range === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
              <span className="text-xs text-muted-foreground">a</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="self-center text-xs text-muted-foreground">Pago:</span>
          {PAYMENT_METHODS.map((m) => {
            const active = methods.includes(m);
            return (
              <button
                key={m}
                onClick={() => {
                  setMethods((prev) => (active ? prev.filter((x) => x !== m) : [...prev, m]));
                  setPage(1);
                }}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {PAYMENT_LABELS[m]}
              </button>
            );
          })}
          {methods.length > 0 && (
            <button
              onClick={() => setMethods([])}
              className="text-[11px] text-muted-foreground hover:underline"
            >
              limpiar
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Folio o cliente"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-7 text-sm outline-none focus:border-primary"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {isManager && tenantUsers.length > 0 && (
            <select
              value={salesPersonId}
              onChange={(e) => {
                setSalesPersonId(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Todos los vendedores</option>
              {tenantUsers.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-md border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Folio</th>
              <th className="px-3 py-2 text-left">Fecha</th>
              {isManager && <th className="px-3 py-2 text-left">Vendedor</th>}
              <th className="px-3 py-2 text-left">Cliente</th>
              <th className="px-3 py-2 text-left">Pago</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-left">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && (
              <tr>
                <td colSpan={isManager ? 7 : 6} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={isManager ? 7 : 6} className="px-3 py-10 text-center text-muted-foreground">
                  Aún no has registrado ventas.{" "}
                  {showSell && (
                    <Link to="/app/ventas/nueva" className="text-primary hover:underline">
                      Registra la primera con + Nueva venta.
                    </Link>
                  )}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <SaleRowItem
                key={r.id}
                row={r}
                isManager={isManager}
                currency={currency}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {loading && <div className="text-sm text-muted-foreground">Cargando…</div>}
        {!loading && rows.length === 0 && (
          <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Aún no hay ventas.
          </div>
        )}
        {rows.map((r) => (
          <Link
            key={r.id}
            to="/app/ventas/$saleId"
            params={{ saleId: r.id }}
            className={`block rounded-md border border-border p-3 ${
              r.status === "voided" ? "bg-muted/40 opacity-70" : "bg-card hover:bg-accent"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">#{r.sale_number}</span>
              {r.status === "voided" ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
                  Cancelada
                </span>
              ) : (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">
                  Completada
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {new Date(r.created_at).toLocaleString("es-MX")}
            </div>
            <div className="mt-1 text-sm">{r.customer_name ?? "Público general"}</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{PAYMENT_LABELS[r.payment_method]}</span>
              <span className="font-semibold tabular-nums">
                {formatCurrency(r.total, currency)}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* Manager footer summary */}
      {isManager && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
          <div className="text-muted-foreground">
            {rows.length} venta{rows.length === 1 ? "" : "s"} en esta página · Total {total}
          </div>
          <div className="flex gap-6">
            <div>
              <span className="text-muted-foreground">Suma página: </span>
              <span className="font-semibold tabular-nums">{formatCurrency(sumTotal, currency)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Utilidad: </span>
              <span className="font-semibold tabular-nums">{formatCurrency(sumProfit, currency)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SaleRowItem({
  row,
  isManager,
  currency,
}: {
  row: SaleRow;
  isManager: boolean;
  currency: CurrencyCode;
}) {
  const navigate = useNavigate();
  const voided = row.status === "voided";
  return (
    <tr
      onClick={() => navigate({ to: "/app/ventas/$saleId", params: { saleId: row.id } })}
      className={`cursor-pointer ${voided ? "bg-muted/40 opacity-70" : "hover:bg-accent"}`}
    >
      <td className="px-3 py-2 font-medium tabular-nums">#{row.sale_number}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {new Date(row.created_at).toLocaleString("es-MX")}
      </td>
      {isManager && (
        <td className="px-3 py-2 text-xs text-muted-foreground">{row.created_by.slice(0, 8)}…</td>
      )}
      <td className="px-3 py-2">{row.customer_name ?? <span className="text-muted-foreground">Público general</span>}</td>
      <td className="px-3 py-2 text-xs">{PAYMENT_LABELS[row.payment_method]}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium">
        {formatCurrency(row.total, currency)}
      </td>
      <td className="px-3 py-2">
        {voided ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
            Cancelada
          </span>
        ) : (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">
            Completada
          </span>
        )}
      </td>
    </tr>
  );
}