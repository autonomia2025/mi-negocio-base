import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Loader2, CheckCircle2 } from "lucide-react";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import { ProductPicker, type PickerProduct } from "@/components/inventory/ProductPicker";
import { recordMovement, canWriteInventory } from "@/utils/inventory";
import { formatNumber } from "@/utils/currency";

const searchSchema = z.object({
  productId: z.string().optional(),
});

export const Route = createFileRoute("/app/inventario/entrada")({
  validateSearch: (s) => searchSchema.parse(s),
  component: EntradaPage,
});

function EntradaPage() {
  const navigate = useNavigate();
  const { productId: prefillProductId } = Route.useSearch();
  const { currentTenantId, currentMembership, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role;

  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [quantity, setQuantity] = useState<string>("");
  const [unitCost, setUnitCost] = useState<string>("");
  const [proveedor, setProveedor] = useState("");
  const [folio, setFolio] = useState("");
  const [notas, setNotas] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ stockAfter: number } | null>(null);

  // Pre-fill product from URL search param
  useEffect(() => {
    if (!prefillProductId || !tenantId || product) return;
    void supabase
      .from("products")
      .select("id, sku, name, current_stock, cost_avg, unit")
      .eq("id", prefillProductId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setProduct(data as PickerProduct);
          setUnitCost(String(data.cost_avg));
        }
      });
  }, [prefillProductId, tenantId, product]);

  // Pre-fill unit cost when product changes
  useEffect(() => {
    if (product && !unitCost) {
      setUnitCost(String(product.cost_avg));
    }
  }, [product, unitCost]);

  const qtyNum = Number(quantity);
  const costNum = Number(unitCost);
  const validQty = Number.isFinite(qtyNum) && qtyNum > 0;
  const validCost = !unitCost || (Number.isFinite(costNum) && costNum >= 0);

  const preview = useMemo(() => {
    if (!product || !validQty) return null;
    const before = Number(product.current_stock);
    const after = before + qtyNum;
    let newAvg = Number(product.cost_avg);
    if (validCost && costNum > 0) {
      if (before <= 0) newAvg = costNum;
      else newAvg = (before * Number(product.cost_avg) + qtyNum * costNum) / (before + qtyNum);
    }
    return { before, after, newAvg };
  }, [product, qtyNum, costNum, validQty, validCost]);

  const canSubmit = !!product && validQty && validCost && !submitting && canWriteInventory(role);

  function resetForm() {
    setProduct(null);
    setQuantity("");
    setUnitCost("");
    setProveedor("");
    setFolio("");
    setNotas("");
    setSuccess(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !product || !tenantId) return;
    setSubmitting(true);
    setError(null);
    try {
      const noteParts = [
        proveedor && `Proveedor: ${proveedor}`,
        folio && `Folio: ${folio}`,
        notas && `Notas: ${notas}`,
      ].filter(Boolean);
      const fullNote = noteParts.length > 0 ? noteParts.join(" | ") : null;
      await recordMovement({
        tenantId,
        productId: product.id,
        movementType: "purchase",
        quantity: qtyNum,
        unitCost: validCost && costNum > 0 ? costNum : null,
        notes: fullNote,
      });
      const stockAfter = Number(product.current_stock) + qtyNum;
      setSuccess({ stockAfter });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!canWriteInventory(role)) {
    return <NoPermission />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/app/inventario" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Inventario
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Registrar entrada de mercancía</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cuando recibes producto de un proveedor</p>
      </div>

      {success ? (
        <div className="rounded-md border border-green-200 bg-green-50 p-5 text-sm text-green-900">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-5 w-5" /> Entrada registrada
          </div>
          <p className="mt-1">Stock actual: <span className="font-semibold tabular-nums">{formatNumber(success.stockAfter, 0)}</span></p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={resetForm}
              className="rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-900 hover:bg-green-100"
            >
              Registrar otra entrada
            </button>
            <button
              onClick={() => void navigate({ to: "/app/inventario" })}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Volver al inventario
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Section title="Producto">
            {tenantId && (
              <ProductPicker tenantId={tenantId} value={product} onChange={setProduct} disabled={submitting} />
            )}
          </Section>

          <Section title="Detalles de la entrada">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Cantidad recibida" required>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={inputClass(!quantity || validQty)}
                />
              </Field>
              <Field label="Costo unitario">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  className={inputClass(validCost)}
                  placeholder="Recomendado para promedio"
                />
              </Field>
              <Field label="Proveedor">
                <input
                  type="text"
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                  className={inputClass(true)}
                />
              </Field>
              <Field label="Número de factura/folio">
                <input
                  type="text"
                  value={folio}
                  onChange={(e) => setFolio(e.target.value)}
                  className={inputClass(true)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notas">
                  <textarea
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    rows={2}
                    className={inputClass(true)}
                  />
                </Field>
              </div>
            </div>
          </Section>

          {preview && (
            <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 tabular-nums">
                <Stat label="Stock antes" value={formatNumber(preview.before, 0)} />
                <Stat label="Cantidad" value={`+ ${formatNumber(qtyNum, 0)}`} tone="ok" />
                <Stat label="Stock después" value={formatNumber(preview.after, 0)} />
                <Stat label="Costo prom. nuevo" value={`$${formatNumber(preview.newAvg, 2)}`} />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void navigate({ to: "/app/inventario" })}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Registrar entrada
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" }) {
  const toneClass = tone === "ok" ? "text-green-700" : tone === "danger" ? "text-destructive" : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}

function inputClass(valid: boolean): string {
  return `w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:border-primary ${
    valid ? "border-border" : "border-destructive"
  }`;
}

function NoPermission() {
  return (
    <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
      No tienes permiso para registrar movimientos de inventario.
    </div>
  );
}
