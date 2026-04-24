import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  FileSpreadsheet,
  Search,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchProducts,
  fetchDefaultSchema,
  softDeleteProduct,
  stockTone,
  canEditProducts,
  canDeleteProducts,
  PAGE_SIZE,
  type ProductRow,
  type ProductSchema,
} from "@/utils/products";
import { formatCurrency, getTenantCurrency, formatNumber, type CurrencyCode } from "@/utils/currency";

export const Route = createFileRoute("/app/productos/")({
  component: ProductsListPage,
});

function ProductsListPage() {
  const navigate = useNavigate();
  const { currentTenantId, currentMembership, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role;
  const canEdit = canEditProducts(role);
  const canDelete = canDeleteProducts(role);

  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<ProductSchema | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>("MXN");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProductRow | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, onlyActive, lowStockOnly]);

  // Load schema + currency
  useEffect(() => {
    if (!tenantId) return;
    void fetchDefaultSchema(tenantId).then(setSchema);
    void supabase
      .from("tenants")
      .select("settings")
      .eq("id", tenantId)
      .maybeSingle()
      .then(({ data }) => {
        setCurrency(getTenantCurrency(data?.settings ?? {}));
      });
  }, [tenantId]);

  // Load products
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProducts(tenantId, { search, onlyActive, lowStockOnly }, page)
      .then(({ rows, total }) => {
        if (cancelled) return;
        setRows(rows);
        setTotal(total);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message ?? "Error al cargar productos");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, search, onlyActive, lowStockOnly, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fromRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toRow = Math.min(page * PAGE_SIZE, total);

  const attrLabels = useMemo(() => {
    const m = new Map<string, string>();
    schema?.attributes.forEach((a) => m.set(a.key, a.label));
    return m;
  }, [schema]);

  function renderAttributes(p: ProductRow) {
    const entries = Object.entries(p.attributes ?? {}).filter(
      ([, v]) => v !== null && v !== undefined && v !== "",
    );
    if (entries.length === 0) {
      return <span className="text-muted-foreground/60">—</span>;
    }
    const first = entries.slice(0, 2);
    const more = entries.length - first.length;
    return (
      <span className="text-muted-foreground">
        {first.map(([k, v], i) => (
          <span key={k}>
            {i > 0 && " · "}
            <span className="text-foreground/70">{attrLabels.get(k) ?? k}:</span>{" "}
            {String(v)}
          </span>
        ))}
        {more > 0 && <span className="ml-1 text-muted-foreground/70">+{more}</span>}
      </span>
    );
  }

  function stockDot(p: ProductRow) {
    const t = stockTone(p);
    const cls =
      t === "danger"
        ? "bg-destructive"
        : t === "warning"
          ? "bg-amber-500"
          : "bg-emerald-500";
    return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
  }

  async function doSoftDelete(p: ProductRow) {
    if (!tenantId) return;
    try {
      await softDeleteProduct(p.id, tenantId);
      setConfirmDelete(null);
      // refresh
      const { rows, total } = await fetchProducts(
        tenantId,
        { search, onlyActive, lowStockOnly },
        page,
      );
      setRows(rows);
      setTotal(total);
    } catch (e) {
      setError((e as Error).message ?? "No se pudo dar de baja");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Productos</h1>
          <p className="text-sm text-muted-foreground">Catálogo de tu empresa</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled
            title="Disponible próximamente"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground opacity-60"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Importar Excel
          </button>
          {canEdit && (
            <Link
              to="/app/productos/nuevo"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Nuevo producto
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por SKU o nombre"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Solo activos
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Stock bajo
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-md border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">SKU</th>
              <th className="px-4 py-2.5 font-medium">Nombre</th>
              <th className="px-4 py-2.5 font-medium">Atributos</th>
              <th className="px-4 py-2.5 font-medium tabular-nums">Stock</th>
              <th className="px-4 py-2.5 font-medium tabular-nums">Precio</th>
              <th className="px-4 py-2.5 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Aún no tienes productos. Agrega el primero para empezar.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                  onClick={() =>
                    void navigate({
                      to: "/app/productos/$productId",
                      params: { productId: p.id },
                    })
                  }
                >
                  <td className="px-4 py-3 font-mono text-xs text-foreground tabular-nums">{p.sku}</td>
                  <td className="px-4 py-3 text-foreground">
                    <div className="font-medium">{p.name}</div>
                    {!p.is_active && (
                      <div className="text-xs text-muted-foreground">Inactivo</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{renderAttributes(p)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className="inline-flex items-center gap-2">
                      {stockDot(p)}
                      <span className="text-foreground">{formatNumber(p.current_stock, 0)}</span>
                      <span className="text-xs text-muted-foreground">{p.unit}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {formatCurrency(p.price, currency)}
                  </td>
                  <td
                    className="relative px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Acciones"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {openMenuId === p.id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setOpenMenuId(null)}
                        />
                        <div className="absolute right-2 top-9 z-20 w-44 overflow-hidden rounded-md border border-border bg-popover shadow-md">
                          <Link
                            to="/app/productos/$productId"
                            params={{ productId: p.id }}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent"
                            onClick={() => setOpenMenuId(null)}
                          >
                            <Eye className="h-3.5 w-3.5" /> Ver
                          </Link>
                          {canEdit && (
                            <Link
                              to="/app/productos/$productId"
                              params={{ productId: p.id }}
                              className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent"
                              onClick={() => setOpenMenuId(null)}
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </Link>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                setConfirmDelete(p);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Dar de baja
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {loading ? (
          <div className="rounded-md border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            Aún no tienes productos. Agrega el primero para empezar.
          </div>
        ) : (
          rows.map((p) => (
            <Link
              key={p.id}
              to="/app/productos/$productId"
              params={{ productId: p.id }}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium tabular-nums text-foreground">
                  {formatCurrency(p.price, currency)}
                </div>
                <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  {stockDot(p)}
                  <span>{formatNumber(p.current_stock, 0)} {p.unit}</span>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Mostrando {fromRow}-{toRow} de {total}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
            <h2 className="text-base font-semibold text-foreground">Dar de baja producto</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Al dar de baja <strong className="text-foreground">{confirmDelete.name}</strong> dejará de aparecer en listados y ventas. El historial se conserva. ¿Continuar?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={() => void doSoftDelete(confirmDelete)}
                className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
              >
                Dar de baja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}