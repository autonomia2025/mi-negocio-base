import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import {
  dateRangeFromKey,
  fetchCashReconciliation,
  type DateRangeKey,
  type CashReconciliation,
} from "@/utils/reports";
import { formatCurrency, formatNumber } from "@/utils/currency";
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/utils/sales";
import { listSalesUsersInTenant } from "@/utils/reports.functions";

export const Route = createFileRoute("/app/reportes/cortes")({
  component: CortesPage,
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

function CortesPage() {
  const { user, currentTenantId, currentMembership } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const tenantId = impersonatingId ?? currentTenantId;
  const role = currentMembership?.role;
  const allowed =
    !!impersonatingId || role === "tenant_owner" || role === "gerente";

  const [rangeKey, setRangeKey] = useState<DateRangeKey>("today");
  const [shiftMode, setShiftMode] = useState(false);
  const range = useMemo(() => {
    if (shiftMode) {
      const now = new Date();
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      return { from, to: now };
    }
    return dateRangeFromKey(rangeKey);
  }, [rangeKey, shiftMode]);

  const [users, setUsers] = useState<
    Array<{ user_id: string; email: string; full_name: string | null; role: string }>
  >([]);
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [tenantName, setTenantName] = useState<string>("");
  const [data, setData] = useState<CashReconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const listSalesUsersFn = useServerFn(listSalesUsersInTenant);

  useEffect(() => {
    if (!tenantId) return;
    void supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle()
      .then(({ data }) => {
        setTenantName(data?.name ?? "");
      });
    void listSalesUsersFn({ data: { tenantId } })
      .then((r) => setUsers(r.users))
      .catch(() => setUsers([]));
  }, [tenantId, listSalesUsersFn]);

  useEffect(() => {
    if (!tenantId || !allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCashReconciliation(
      tenantId,
      range,
      selectedUser === "all" ? null : selectedUser,
    )
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Error al cargar corte");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, range, selectedUser, allowed]);

  if (!allowed) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        No tienes permisos para ver cortes de caja.
      </div>
    );
  }

  const sellerLabel =
    selectedUser === "all"
      ? "Todos"
      : (() => {
          const u = users.find((x) => x.user_id === selectedUser);
          return u ? u.full_name ?? u.email : "—";
        })();

  const handleNuevoCorte = () => {
    setRangeKey("today");
    setShiftMode(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePrint = () => {
    window.print();
  };

  const buildCsv = () => {
    const lines = ["payment_method,total,count"];
    for (const m of PAYMENT_METHODS) {
      const r = data?.by_method?.[m];
      lines.push(`${m},${(r?.total ?? 0).toFixed(2)},${r?.count ?? 0}`);
    }
    lines.push(`TOTAL,${(data?.total ?? 0).toFixed(2)},${data?.count ?? 0}`);
    return lines.join("\n");
  };

  const handleCsv = () => {
    const blob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `corte-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildPlainText = () => {
    const fmtDate = (d: Date) =>
      d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
    const fmtIso = (s: string | null) =>
      s
        ? new Date(s).toLocaleString("es-MX", {
            dateStyle: "short",
            timeStyle: "short",
          })
        : "—";
    const sep = "═══════════════════════════════════════";
    const sub = "──────────────────────────────────────";
    const lines = [
      sep,
      "CORTE DE CAJA",
      sep,
      `Empresa: ${tenantName}`,
      `Fecha:   ${fmtDate(new Date())}`,
      `Periodo: ${fmtDate(range.from)} a ${fmtDate(range.to)}`,
      `Vendedor: ${sellerLabel}`,
      sep,
      "VENTAS COMPLETADAS",
    ];
    for (const m of PAYMENT_METHODS) {
      const r = data?.by_method?.[m];
      const label = PAYMENT_LABELS[m].padEnd(22, ".");
      lines.push(
        `${label} ${formatCurrency(r?.total ?? 0)} (${r?.count ?? 0} tickets)`,
      );
    }
    lines.push(sub);
    lines.push(
      `TOTAL VENTAS .......... ${formatCurrency(
        data?.total ?? 0,
      )} (${data?.count ?? 0} tickets)`,
    );
    lines.push("");
    lines.push("VENTAS CANCELADAS");
    lines.push(
      `Cancelaciones ......... ${data?.voided_count ?? 0} tickets, ${formatCurrency(
        data?.voided_total ?? 0,
      )}`,
    );
    lines.push("");
    lines.push(`PRIMER TICKET: ${fmtIso(data?.first_sale ?? null)}`);
    lines.push(`ÚLTIMO TICKET: ${fmtIso(data?.last_sale ?? null)}`);
    lines.push(sep);
    lines.push(`Generado por: ${user?.email ?? "—"}`);
    lines.push(`Generado el:  ${fmtDate(new Date())}`);
    lines.push(sep);
    return lines.join("\n");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainText());
      toast.success("Corte copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #corte-print, #corte-print * { visibility: visible !important; }
          #corte-print {
            position: absolute !important;
            left: 0; top: 0; width: 100%;
            background: white; color: black;
            font-family: 'Courier New', monospace;
            padding: 24px;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <header className="no-print flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Cortes de caja
          </h1>
          <p className="text-sm text-muted-foreground">
            Reconciliación de ventas por método de pago
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleNuevoCorte}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Nuevo corte
          </button>
        </div>
      </header>

      {/* Filters */}
      <section className="no-print rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1 rounded-md border border-border bg-background p-1">
            {RANGE_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => {
                  setRangeKey(k);
                  setShiftMode(false);
                }}
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  !shiftMode && rangeKey === k
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {RANGE_LABELS[k]}
              </button>
            ))}
            <button
              onClick={() => setShiftMode(true)}
              className={`rounded px-3 py-1.5 text-xs font-medium ${
                shiftMode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              title="Desde 00:00 hasta ahora"
            >
              Turno actual
            </button>
          </div>

          <div>
            <label className="mr-2 text-xs text-muted-foreground">Vendedor</label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="all">Todos los vendedores</option>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name ?? u.email}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={handlePrint}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
            >
              Imprimir
            </button>
            <button
              onClick={handleCsv}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
            >
              Descargar CSV
            </button>
            <button
              onClick={handleCopy}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
            >
              Copiar
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="no-print rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Receipt card */}
      <section
        id="corte-print"
        className="mx-auto max-w-2xl rounded-md border border-border bg-card p-6 font-mono text-sm text-foreground"
      >
        <div className="text-center">
          <div className="text-xs tracking-[0.3em] text-muted-foreground">
            ═══════════════════════════════════
          </div>
          <h2 className="mt-1 text-lg font-bold tracking-wide">CORTE DE CAJA</h2>
          <div className="text-xs tracking-[0.3em] text-muted-foreground">
            ═══════════════════════════════════
          </div>
        </div>

        <dl className="mt-4 space-y-1 text-xs">
          <Row label="Empresa" value={tenantName || "—"} />
          <Row
            label="Fecha"
            value={new Date().toLocaleString("es-MX", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          />
          <Row
            label="Periodo"
            value={`${range.from.toLocaleString("es-MX", {
              dateStyle: "short",
              timeStyle: "short",
            })} a ${range.to.toLocaleString("es-MX", {
              dateStyle: "short",
              timeStyle: "short",
            })}`}
          />
          <Row label="Vendedor" value={sellerLabel} />
        </dl>

        <hr className="my-4 border-dashed border-border" />

        <div className="text-xs font-semibold uppercase tracking-wider">
          Ventas completadas
        </div>
        <div className="mt-2 space-y-1 text-xs tabular-nums">
          {loading ? (
            <div className="h-24 animate-pulse rounded bg-muted/40" />
          ) : (
            <>
              {PAYMENT_METHODS.map((m) => {
                const r = data?.by_method?.[m];
                return (
                  <Line
                    key={m}
                    label={PAYMENT_LABELS[m as PaymentMethod]}
                    amount={formatCurrency(r?.total ?? 0)}
                    sub={`${r?.count ?? 0} tickets`}
                  />
                );
              })}
              <div className="my-2 border-t border-dashed border-border" />
              <Line
                bold
                label="TOTAL VENTAS"
                amount={formatCurrency(data?.total ?? 0)}
                sub={`${data?.count ?? 0} tickets`}
              />
            </>
          )}
        </div>

        <hr className="my-4 border-dashed border-border" />

        <div className="text-xs font-semibold uppercase tracking-wider">
          Ventas canceladas
        </div>
        <div className="mt-2 text-xs tabular-nums">
          <Line
            label="Cancelaciones"
            amount={formatCurrency(data?.voided_total ?? 0)}
            sub={`${data?.voided_count ?? 0} tickets`}
          />
        </div>

        <hr className="my-4 border-dashed border-border" />

        <dl className="space-y-1 text-xs">
          <Row
            label="Primer ticket"
            value={
              data?.first_sale
                ? new Date(data.first_sale).toLocaleString("es-MX", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : "—"
            }
          />
          <Row
            label="Último ticket"
            value={
              data?.last_sale
                ? new Date(data.last_sale).toLocaleString("es-MX", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : "—"
            }
          />
        </dl>

        <div className="mt-4 text-center text-xs tracking-[0.3em] text-muted-foreground">
          ═══════════════════════════════════
        </div>
        <div className="text-center text-xs text-muted-foreground">
          Generado por {user?.email ?? "—"}
          <br />
          {new Date().toLocaleString("es-MX")}
        </div>
        <div className="text-center text-xs tracking-[0.3em] text-muted-foreground">
          ═══════════════════════════════════
        </div>
      </section>

      {/* Quick stats below */}
      <section className="no-print grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total" value={formatCurrency(data?.total ?? 0)} loading={loading} />
        <Stat label="Tickets" value={formatNumber(data?.count ?? 0, 0)} loading={loading} />
        <Stat
          label="Cancelados"
          value={formatNumber(data?.voided_count ?? 0, 0)}
          loading={loading}
        />
        <Stat
          label="Monto cancelado"
          value={formatCurrency(data?.voided_total ?? 0)}
          loading={loading}
        />
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}

function Line({
  label,
  amount,
  sub,
  bold,
}: {
  label: string;
  amount: string;
  sub?: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${bold ? "font-bold" : ""}`}>
      <span className="text-foreground">{label}</span>
      <span className="flex items-baseline gap-2 text-foreground">
        <span>{amount}</span>
        {sub && (
          <span className="text-[10px] text-muted-foreground">({sub})</span>
        )}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {loading ? (
        <div className="mt-2 h-6 w-20 animate-pulse rounded bg-muted" />
      ) : (
        <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
          {value}
        </div>
      )}
    </div>
  );
}
