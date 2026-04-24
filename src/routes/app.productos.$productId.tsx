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
        <Placeholder text="Los movimientos de inventario estarán disponibles en la siguiente fase." />
      )}
      {tab === "precios" && (
        <Placeholder text="El historial de precios estará disponible próximamente." />
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