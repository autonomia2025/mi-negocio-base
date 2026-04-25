import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import {
  fetchMovements,
  MOVEMENT_LABELS,
  INBOUND_TYPES,
  MOVEMENTS_PAGE_SIZE,
  type MovementWithProduct,
} from "@/utils/inventory";
import { formatNumber } from "@/utils/currency";

export const Route = createFileRoute("/app/inventario/movimientos")({
  component: MovementsPage,
});

type RangePreset = "today" | "week" | "month" | "30days" | "custom";

function isoDay(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function endIso(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

function rangeFor(preset: RangePreset): { from: string; to: string } | null {
  const now = new Date();
  if (preset === "today") return { from: isoDay(now), to: endIso(now) };
  if (preset === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    return { from: isoDay(d), to: endIso(now) };
  }
  if (preset === "month") {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: isoDay(d), to: endIso(now) };
  }
  if (preset === "30days") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return { from: isoDay(d), to: endIso(now) };
  }
  return null;
}

function MovementsPage() {
  const { currentTenantId, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;

  const [preset, setPreset] = useState<RangePreset>("30days");
  const [types, setTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<MovementWithProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MovementWithProduct | null>(null);

  const range = useMemo(() => rangeFor(preset), [preset]);

  useEffect(() => {
    setPage(1);
  }, [preset, types]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchMovements(
      tenantId,
      {
        from: range?.from,
        to: range?.to,
        types: types.length > 0 ? types : undefined,
      },
      page,
    )
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTotal(res.total);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, range, types, page]);

  const totalPages = Math.max(1, Math.ceil(total / MOVEMENTS_PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * MOVEMENTS_PAGE_SIZE + 1;
  const to = Math.min(page * MOVEMENTS_PAGE_SIZE, total);

  function toggleType(t: string) {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  return (
    <div className="space-y-5">
      <div>
        <Link to="/app/inventario" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Inventario
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Movimientos</h1>
        <p className="mt-1 text-sm text-muted-foreground">Registro completo e inalterable de todos los movimientos de inventario</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ["today", "Hoy"],
          ["week", "Esta semana"],
          ["month", "Este mes"],
          ["30days", "Últimos 30 días"],
        ] as Array<[RangePreset, string]>).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setPreset(k)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              preset === k
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(MOVEMENT_LABELS).map(([k, label]) => {
          const active = types.includes(k);
          const inbound = INBOUND_TYPES.has(k);
          return (
            <button
              key={k}
              onClick={() => toggleType(k)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                active
                  ? inbound
                    ? "border-green-300 bg-green-100 text-green-800"
                    : "border-red-300 bg-red-100 text-red-800"
                  : "border-border bg-card text-muted-foreground hover:bg-accent"
              }`}
            >
              {label}
            </button>
          );
        })}
        {types.length > 0 && (
          <button
            onClick={() => setTypes([])}
            className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            Limpiar
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Fecha/hora</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Stock antes</th>
                <th className="px-3 py-2 text-right">Stock después</th>
                <th className="px-3 py-2 text-left">Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Sin movimientos en este período</td></tr>
              ) : (
                rows.map((m) => {
                  const inbound = INBOUND_TYPES.has(m.movement_type);
                  return (
                    <tr key={m.id} onClick={() => setSelected(m)} className="cursor-pointer hover:bg-accent/40">
                      <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("es-MX")}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{m.product?.name ?? "—"}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{m.product?.sku ?? ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                          inbound ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                        }`}>
                          {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${inbound ? "text-green-700" : "text-red-700"}`}>
                        {inbound ? "+" : "−"}{formatNumber(m.quantity, 2)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.stock_before, 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(m.stock_after, 2)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground" title={m.notes ?? ""}>
                        <div className="line-clamp-1 max-w-xs">{m.notes ?? ""}</div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="divide-y divide-border md:hidden">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Sin movimientos</div>
          ) : (
            rows.map((m) => {
              const inbound = INBOUND_TYPES.has(m.movement_type);
              return (
                <button key={m.id} onClick={() => setSelected(m)} className="block w-full px-4 py-3 text-left hover:bg-accent/40">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{m.product?.name ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {MOVEMENT_LABELS[m.movement_type]} · {new Date(m.created_at).toLocaleString("es-MX")}
                      </div>
                    </div>
                    <div className={`tabular-nums text-sm font-semibold ${inbound ? "text-green-700" : "text-red-700"}`}>
                      {inbound ? "+" : "−"}{formatNumber(m.quantity, 2)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{total === 0 ? "Sin resultados" : `Mostrando ${from}-${to} de ${total}`}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
          </button>
          <span>Pág. {page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Siguiente <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-foreground/30 sm:items-center sm:justify-center" onClick={() => setSelected(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-lg border border-border bg-card p-5 shadow-xl sm:rounded-lg">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Movimiento</div>
                <div className="mt-0.5 text-sm font-semibold">{MOVEMENT_LABELS[selected.movement_type]}</div>
              </div>
              <button onClick={() => setSelected(null)} className="rounded p-1 text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Producto" value={selected.product ? `${selected.product.name} (${selected.product.sku})` : "—"} />
              <Row label="Fecha" value={new Date(selected.created_at).toLocaleString("es-MX")} />
              <Row label="Cantidad" value={`${INBOUND_TYPES.has(selected.movement_type) ? "+" : "−"}${formatNumber(selected.quantity, 2)}`} />
              <Row label="Stock antes" value={formatNumber(selected.stock_before, 2)} />
              <Row label="Stock después" value={formatNumber(selected.stock_after, 2)} />
              {selected.unit_cost != null && <Row label="Costo unitario" value={`$${formatNumber(selected.unit_cost, 2)}`} />}
              {selected.unit_price != null && <Row label="Precio unitario" value={`$${formatNumber(selected.unit_price, 2)}`} />}
              {selected.reference_type && <Row label="Referencia" value={`${selected.reference_type} ${selected.reference_id ?? ""}`} />}
              {selected.notes && (
                <div>
                  <div className="text-xs text-muted-foreground">Notas</div>
                  <div className="mt-0.5 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-xs">{selected.notes}</div>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
