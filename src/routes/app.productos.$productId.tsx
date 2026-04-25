import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchProductById,
  fetchSchemaById,
  updateProduct,
  softDeleteProduct,
  canEditProducts,
  canDeleteProducts,
  type ProductRow,
  type ProductSchema,
  type ProductInput,
} from "@/utils/products";
import { ProductForm } from "@/components/products/ProductForm";
import { formatCurrency, getTenantCurrency, formatNumber, type CurrencyCode } from "@/utils/currency";
import {
  fetchMovementsByProduct,
  MOVEMENT_LABELS,
  INBOUND_TYPES,
  type MovementWithProduct,
} from "@/utils/inventory";

export const Route = createFileRoute("/app/productos/$productId")({
  component: ProductDetailPage,
});

type Tab = "general" | "movimientos" | "precios";

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const navigate = useNavigate();
  const { currentTenantId, currentMembership, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role;
  const canEdit = canEditProducts(role);
  const canDelete = canDeleteProducts(role);

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [schema, setSchema] = useState<ProductSchema | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>("MXN");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("general");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [movements, setMovements] = useState<MovementWithProduct[] | null>(null);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [salesById, setSalesById] = useState<Record<string, { sale_number: number; status: string }>>({});

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    void fetchProductById(productId, tenantId).then(async (p) => {
      if (cancelled) return;
      setProduct(p);
      if (p) {
        const sch = await fetchSchemaById(p.schema_id);
        if (!cancelled) setSchema(sch);
      }
      const { data: t } = await supabase
        .from("tenants")
        .select("settings")
        .eq("id", tenantId)
        .maybeSingle();
      if (!cancelled) setCurrency(getTenantCurrency(t?.settings ?? {}));
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [productId, tenantId]);

  // Load movements lazily when entering the tab
  useEffect(() => {
    if (!tenantId || !product) return;
    if (tab !== "movimientos" && tab !== "precios") return;
    if (movements !== null) return;
    let cancelled = false;
    setMovementsLoading(true);
    void fetchMovementsByProduct(product.id, tenantId, 100)
      .then(async (rows) => {
        if (cancelled) return;
        setMovements(rows);
        const saleIds = Array.from(
          new Set(
            rows
              .filter((r) => r.movement_type === "sale" && r.reference_id)
              .map((r) => r.reference_id as string),
          ),
        );
        if (saleIds.length > 0) {
          const { data } = await supabase
            .from("sales")
            .select("id, sale_number, status")
            .in("id", saleIds);
          if (!cancelled && data) {
            const map: Record<string, { sale_number: number; status: string }> = {};
            for (const s of data as Array<{ id: string; sale_number: number; status: string }>) {
              map[s.id] = { sale_number: s.sale_number, status: s.status };
            }
            setSalesById(map);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setMovements([]);
      })
      .finally(() => {
        if (!cancelled) setMovementsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, product, tenantId, movements]);

  const margin = useMemo(() => {
    if (!product) return null;
    const p = Number(product.price);
    if (!p) return null;
    return ((p - Number(product.cost_avg)) / p) * 100;
  }, [product]);

  const inventoryValue = useMemo(() => {
    if (!product) return 0;
    return Number(product.current_stock) * Number(product.cost_avg);
  }, [product]);

  async function handleSave(data: ProductInput) {
    if (!tenantId || !product) return;
    setSubmitting(true);
    setError(null);
    try {
      // SKU is read-only on edit; keep original
      const patch: Partial<ProductInput> = { ...data, sku: product.sku };
      const updated = await updateProduct(product.id, tenantId, product, patch);
      setProduct(updated);
    } catch (e) {
      setError((e as Error).message ?? "No se pudo guardar");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!tenantId || !product) return;
    try {
      await softDeleteProduct(product.id, tenantId);
      void navigate({ to: "/app/productos" });
    } catch (e) {
      setError((e as Error).message ?? "No se pudo dar de baja");
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Cargando…</div>;
  }
  if (!product) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        Producto no encontrado.
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "general", label: "General" },
    { id: "movimientos", label: "Movimientos" },
    { id: "precios", label: "Historial de precios" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/app/productos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Productos
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {product.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="font-mono">{product.sku}</span>
              <span>•</span>
              <span>{product.unit}</span>
              {product.location && (
                <>
                  <span>•</span>
                  <span>{product.location}</span>
                </>
              )}
              {!product.is_active && (
                <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-foreground">
                  Inactivo
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-right text-xs sm:grid-cols-3">
            <Stat label="Precio" value={formatCurrency(product.price, currency)} />
            {margin !== null && (
              <Stat label="Margen bruto" value={`${formatNumber(margin, 1)}%`} />
            )}
            <Stat label="Valor inventario" value={formatCurrency(inventoryValue, currency)} />
          </div>
        </div>
      </div>

      <div className="border-b border-border">
        <nav className="flex gap-4 text-sm">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-1 py-2.5 transition-colors ${
                tab === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "general" &&
        (schema ? (
          <>
            <ProductForm
              tenantId={tenantId!}
              schema={schema}
              isEdit
              excludeProductId={product.id}
              initial={{
                schema_id: product.schema_id,
                sku: product.sku,
                name: product.name,
                attributes: product.attributes,
                unit: product.unit,
                cost_avg: Number(product.cost_avg),
                price: Number(product.price),
                current_stock: Number(product.current_stock),
                min_stock: Number(product.min_stock),
                reorder_point: Number(product.reorder_point),
                reorder_qty: Number(product.reorder_qty),
                location: product.location,
                is_active: product.is_active,
              }}
              submitting={submitting || !canEdit}
              errorMessage={error}
              onSubmit={(d) => void handleSave(d)}
              onCancel={() => void navigate({ to: "/app/productos" })}
            />

            {canDelete && (
              <section className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                <h3 className="text-sm font-semibold text-destructive">Zona de riesgo</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Al dar de baja este producto dejará de aparecer en listados y ventas. El historial se conserva.
                </p>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" /> Dar de baja
                </button>
              </section>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground">Cargando esquema…</div>
        ))}

      {tab === "movimientos" && (
        <ProductMovements
          rows={movements ?? []}
          loading={movementsLoading}
          productId={product.id}
          salesById={salesById}
        />
      )}
      {tab === "precios" && (
        <PriceHistory rows={movements ?? []} loading={movementsLoading} currency={currency} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
            <h2 className="text-base font-semibold text-foreground">Dar de baja producto</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Al dar de baja <strong className="text-foreground">{product.name}</strong> dejará de aparecer en listados y ventas. El historial se conserva. ¿Continuar?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Dar de baja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function ProductMovements({
  rows,
  loading,
  productId,
  salesById,
}: {
  rows: MovementWithProduct[];
  loading: boolean;
  productId: string;
  salesById: Record<string, { sale_number: number; status: string }>;
}) {
  if (loading) return <div className="text-sm text-muted-foreground">Cargando movimientos…</div>;
  if (rows.length === 0) {
    return <Placeholder text="Aún no hay movimientos para este producto." />;
  }
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2 text-right">Antes</th>
              <th className="px-3 py-2 text-right">Después</th>
              <th className="px-3 py-2 text-left">Notas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((m) => {
              const inbound = INBOUND_TYPES.has(m.movement_type);
              const sale = m.movement_type === "sale" && m.reference_id ? salesById[m.reference_id] : null;
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("es-MX")}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${inbound ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                      {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                    </span>
                    {sale && m.reference_id && (
                      <Link
                        to="/app/ventas/$saleId"
                        params={{ saleId: m.reference_id }}
                        className={`ml-2 text-xs text-primary hover:underline ${sale.status === "voided" ? "line-through text-muted-foreground" : ""}`}
                      >
                        Venta #{sale.sale_number}
                      </Link>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${inbound ? "text-green-700" : "text-red-700"}`}>
                    {inbound ? "+" : "−"}{formatNumber(m.quantity, 2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.stock_before, 2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(m.stock_after, 2)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <div className="line-clamp-1 max-w-xs" title={m.notes ?? ""}>{m.notes ?? ""}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Link
        to="/app/inventario/movimientos"
        className="inline-block text-xs text-primary hover:underline"
      >
        Ver más en el registro global →
      </Link>
      {/* productId reserved for future deep-link filter */}
      <span className="hidden">{productId}</span>
    </div>
  );
}

function PriceHistory({
  rows,
  loading,
  currency,
}: {
  rows: MovementWithProduct[];
  loading: boolean;
  currency: CurrencyCode;
}) {
  if (loading) return <div className="text-sm text-muted-foreground">Cargando…</div>;
  const purchases = rows
    .filter((r) => r.movement_type === "purchase" && r.unit_cost != null)
    .slice()
    .reverse();
  if (purchases.length < 2) {
    return <Placeholder text="Necesitas al menos 2 compras para ver el historial." />;
  }
  const max = Math.max(...purchases.map((p) => Number(p.unit_cost)));
  const min = Math.min(...purchases.map((p) => Number(p.unit_cost)));
  const range = Math.max(max - min, 0.01);
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex h-32 items-end gap-1">
          {purchases.map((p) => {
            const v = Number(p.unit_cost);
            const h = ((v - min) / range) * 100;
            return (
              <div
                key={p.id}
                title={`${formatCurrency(v, currency)} · ${new Date(p.created_at).toLocaleDateString("es-MX")}`}
                className="flex-1 rounded-t bg-primary/70"
                style={{ height: `${Math.max(h, 6)}%` }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>Mín {formatCurrency(min, currency)}</span>
          <span>Máx {formatCurrency(max, currency)}</span>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2 text-right">Costo unitario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {purchases.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString("es-MX")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(p.quantity, 2)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(p.unit_cost ?? 0, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}