import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { ProductPicker, type PickerProduct } from "@/components/inventory/ProductPicker";
import { recordMovement, canWriteInventory } from "@/utils/inventory";
import { formatNumber } from "@/utils/currency";

type ExitKind = "merma" | "devolucion" | "transferencia" | "ajuste";

const KIND_OPTIONS: Array<{ value: ExitKind; label: string; movementType: string; needsReason: boolean }> = [
  { value: "merma", label: "Merma o daño", movementType: "adjustment_out", needsReason: true },
  { value: "devolucion", label: "Devolución a proveedor", movementType: "return_out", needsReason: false },
  { value: "transferencia", label: "Transferencia a otra ubicación", movementType: "transfer_out", needsReason: false },
  { value: "ajuste", label: "Ajuste por conteo físico", movementType: "adjustment_out", needsReason: true },
];

export const Route = createFileRoute("/app/inventario/salida")({
  component: SalidaPage,
});

function SalidaPage() {
  const navigate = useNavigate();
  const { currentTenantId, currentMembership, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role;

  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [kind, setKind] = useState<ExitKind>("merma");
  const [quantity, setQuantity] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [notas, setNotas] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ stockAfter: number } | null>(null);

  const opt = KIND_OPTIONS.find((k) => k.value === kind)!;
  const qtyNum = Number(quantity);
  const validQty = Number.isFinite(qtyNum) && qtyNum > 0;

  const preview = useMemo(() => {
    if (!product || !validQty) return null;
    const before = Number(product.current_stock);
    const after = before - qtyNum;
    return { before, after, negative: after < 0 };
  }, [product, qtyNum, validQty]);

  const motivoRequired = opt.needsReason;
  const motivoOk = !motivoRequired || motivo.trim().length > 0;
  const stockOk = !preview || !preview.negative;
  const canSubmit = !!product && validQty && motivoOk && stockOk && !submitting && canWriteInventory(role);

  function resetForm() {
    setProduct(null);
    setKind("merma");
    setQuantity("");
    setMotivo("");
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
        `Tipo: ${opt.label}`,
        motivo && `Motivo: ${motivo}`,
        notas && `Notas: ${notas}`,
      ].filter(Boolean);
      await recordMovement({
        tenantId,
        productId: product.id,
        movementType: opt.movementType,
        quantity: qtyNum,
        notes: noteParts.join(" | "),
      });
      setSuccess({ stockAfter: Number(product.current_stock) - qtyNum });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!canWriteInventory(role)) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        No tienes permiso para registrar movimientos de inventario.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/app/inventario" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Inventario
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Registrar salida</h1>
        <p className="mt-1 text-sm text-muted-foreground">Mermas, daños, devoluciones y ajustes</p>
      </div>

      {success ? (
        <div className="rounded-md border border-green-200 bg-green-50 p-5 text-sm text-green-900">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-5 w-5" /> Salida registrada
          </div>
          <p className="mt-1">Stock actual: <span className="font-semibold tabular-nums">{formatNumber(success.stockAfter, 0)}</span></p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={resetForm}
              className="rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-900 hover:bg-green-100"
            >
              Registrar otra salida
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
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Producto</h2>
            {tenantId && (
              <ProductPicker tenantId={tenantId} value={product} onChange={setProduct} disabled={submitting} />
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Detalles de la salida</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-foreground">Tipo de salida <span className="text-destructive">*</span></span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ExitKind)}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-foreground">Cantidad <span className="text-destructive">*</span></span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={`w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:border-primary ${
                    !quantity || validQty ? "border-border" : "border-destructive"
                  }`}
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-foreground">
                  Motivo {motivoRequired && <span className="text-destructive">*</span>}
                </span>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-foreground">Notas adicionales</span>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>
          </section>

          {preview && (
            <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
              <div className="grid grid-cols-3 gap-3 tabular-nums">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Stock antes</div>
                  <div className="mt-0.5 font-medium">{formatNumber(preview.before, 0)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cantidad</div>
                  <div className="mt-0.5 font-medium text-destructive">− {formatNumber(qtyNum, 0)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Stock después</div>
                  <div className={`mt-0.5 font-medium ${preview.negative ? "text-destructive" : "text-foreground"}`}>
                    {formatNumber(preview.after, 0)}
                  </div>
                </div>
              </div>
              {preview.negative && (
                <p className="mt-3 text-xs text-destructive">
                  No tienes suficiente stock. Disponible: {formatNumber(preview.before, 0)}.
                </p>
              )}
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
              Registrar salida
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
