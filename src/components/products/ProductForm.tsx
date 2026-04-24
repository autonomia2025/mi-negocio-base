import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import {
  UNIT_OPTIONS,
  isSkuTaken,
  type ProductInput,
  type ProductSchema,
} from "@/utils/products";
import { formatNumber } from "@/utils/currency";

type Props = {
  tenantId: string;
  schema: ProductSchema;
  initial?: Partial<ProductInput>;
  isEdit?: boolean;
  defaultReorderPoint?: number;
  submitting?: boolean;
  errorMessage?: string | null;
  onSubmit: (data: ProductInput) => void;
  onCancel: () => void;
  excludeProductId?: string;
};

type SkuStatus = "idle" | "checking" | "valid" | "taken";

export function ProductForm({
  tenantId,
  schema,
  initial,
  isEdit = false,
  defaultReorderPoint = 0,
  submitting = false,
  errorMessage,
  onSubmit,
  onCancel,
  excludeProductId,
}: Props) {
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "pieza");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [attributes, setAttributes] = useState<Record<string, string | number | null>>(
    initial?.attributes ?? {},
  );
  const [stock, setStock] = useState<string>(String(initial?.current_stock ?? 0));
  const [costAvg, setCostAvg] = useState<string>(String(initial?.cost_avg ?? 0));
  const [price, setPrice] = useState<string>(String(initial?.price ?? 0));
  const [minStock, setMinStock] = useState<string>(String(initial?.min_stock ?? 0));
  const [reorderPoint, setReorderPoint] = useState<string>(
    String(initial?.reorder_point ?? defaultReorderPoint),
  );
  const [reorderQty, setReorderQty] = useState<string>(String(initial?.reorder_qty ?? 0));
  const [skuStatus, setSkuStatus] = useState<SkuStatus>(isEdit ? "valid" : "idle");
  const [validation, setValidation] = useState<Record<string, string>>({});

  // Debounced SKU check (skip for edit mode where SKU is read-only)
  useEffect(() => {
    if (isEdit) return;
    if (!sku.trim()) {
      setSkuStatus("idle");
      return;
    }
    setSkuStatus("checking");
    const t = setTimeout(() => {
      void isSkuTaken(tenantId, sku.trim(), excludeProductId).then((taken) => {
        setSkuStatus(taken ? "taken" : "valid");
      });
    }, 300);
    return () => clearTimeout(t);
  }, [sku, tenantId, isEdit, excludeProductId]);

  const margin = useMemo(() => {
    const p = Number(price);
    const c = Number(costAvg);
    if (!p || p <= 0) return null;
    return ((p - c) / p) * 100;
  }, [price, costAvg]);

  function setAttr(key: string, value: string | number | null) {
    setAttributes((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!sku.trim()) errs.sku = "Requerido";
    if (!name.trim()) errs.name = "Requerido";
    if (name.length > 200) errs.name = "Máximo 200 caracteres";
    if (!isEdit && skuStatus === "taken") errs.sku = "SKU duplicado";
    for (const a of schema.attributes) {
      if (a.required) {
        const v = attributes[a.key];
        if (v === undefined || v === null || v === "") {
          errs[`attr_${a.key}`] = "Requerido";
        }
      }
    }
    setValidation(errs);
    if (Object.keys(errs).length > 0) return;

    onSubmit({
      schema_id: schema.id,
      sku: sku.trim(),
      name: name.trim(),
      unit,
      location: location.trim() || null,
      attributes,
      current_stock: Number(stock) || 0,
      cost_avg: Number(costAvg) || 0,
      price: Number(price) || 0,
      min_stock: Number(minStock) || 0,
      reorder_point: Number(reorderPoint) || 0,
      reorder_qty: Number(reorderQty) || 0,
      is_active: true,
    });
  }

  const inputCls =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const labelCls = "block text-sm font-medium text-foreground";
  const helpCls = "mt-1 text-xs text-destructive";
  const required = (a: { required?: boolean }) =>
    a.required ? <span className="ml-0.5 text-destructive">*</span> : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {errorMessage && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Información básica</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>
              SKU<span className="ml-0.5 text-destructive">*</span>
            </label>
            <div className="relative mt-1">
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                disabled={isEdit}
                className={`${inputCls} pr-9 font-mono ${isEdit ? "bg-muted cursor-not-allowed" : ""}`}
                placeholder="Ej. ALM-PER-80-BL"
              />
              {!isEdit && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {skuStatus === "checking" && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {skuStatus === "valid" && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  )}
                  {skuStatus === "taken" && (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                </span>
              )}
            </div>
            {skuStatus === "taken" && (
              <p className={helpCls}>Este SKU ya existe en tu catálogo</p>
            )}
            {validation.sku && skuStatus !== "taken" && (
              <p className={helpCls}>{validation.sku}</p>
            )}
          </div>
          <div>
            <label className={labelCls}>
              Nombre<span className="ml-0.5 text-destructive">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className={`${inputCls} mt-1`}
              placeholder="Nombre comercial del producto"
            />
            {validation.name && <p className={helpCls}>{validation.name}</p>}
          </div>
          <div>
            <label className={labelCls}>Unidad</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className={`${inputCls} mt-1`}
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Ubicación en almacén</label>
            <input
              value={location ?? ""}
              onChange={(e) => setLocation(e.target.value)}
              className={`${inputCls} mt-1`}
              placeholder="Estante A3, pasillo 2"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Atributos</h2>
        {schema.attributes.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            Tu catálogo aún no tiene atributos definidos. Configúralos en Ajustes → Catálogo.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {schema.attributes.map((a) => {
              const v = attributes[a.key];
              const errKey = `attr_${a.key}`;
              return (
                <div key={a.key}>
                  <label className={labelCls}>
                    {a.label}
                    {required(a)}
                  </label>
                  {a.type === "enum" ? (
                    <select
                      value={(v as string) ?? ""}
                      onChange={(e) => setAttr(a.key, e.target.value || null)}
                      className={`${inputCls} mt-1`}
                    >
                      <option value="">— Seleccionar —</option>
                      {(a.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : a.type === "number" ? (
                    <input
                      type="number"
                      value={v === null || v === undefined ? "" : String(v)}
                      onChange={(e) =>
                        setAttr(a.key, e.target.value === "" ? null : Number(e.target.value))
                      }
                      className={`${inputCls} mt-1 tabular-nums`}
                    />
                  ) : (
                    <input
                      value={(v as string) ?? ""}
                      onChange={(e) => setAttr(a.key, e.target.value)}
                      className={`${inputCls} mt-1`}
                    />
                  )}
                  {validation[errKey] && <p className={helpCls}>{validation[errKey]}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Inventario y costo</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={labelCls}>Stock inicial</label>
            <input
              type="number"
              step="0.01"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className={`${inputCls} mt-1 tabular-nums`}
            />
          </div>
          <div>
            <label className={labelCls}>Costo unitario</label>
            <input
              type="number"
              step="0.01"
              value={costAvg}
              onChange={(e) => setCostAvg(e.target.value)}
              className={`${inputCls} mt-1 tabular-nums`}
            />
          </div>
          <div>
            <label className={labelCls}>Precio de venta</label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${inputCls} mt-1 tabular-nums`}
            />
          </div>
        </div>
        {margin !== null && (
          <p className="text-sm text-muted-foreground">
            Margen calculado:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatNumber(margin, 1)}%
            </span>
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Reorden</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={labelCls}>Stock mínimo</label>
            <input
              type="number"
              step="0.01"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              className={`${inputCls} mt-1 tabular-nums`}
            />
          </div>
          <div>
            <label className={labelCls}>Punto de reorden</label>
            <input
              type="number"
              step="0.01"
              value={reorderPoint}
              onChange={(e) => setReorderPoint(e.target.value)}
              className={`${inputCls} mt-1 tabular-nums`}
            />
          </div>
          <div>
            <label className={labelCls}>Cantidad sugerida</label>
            <input
              type="number"
              step="0.01"
              value={reorderQty}
              onChange={(e) => setReorderQty(e.target.value)}
              className={`${inputCls} mt-1 tabular-nums`}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between border-t border-border pt-5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting || (!isEdit && skuStatus === "taken")}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? "Guardar cambios" : "Guardar producto"}
        </button>
      </div>
    </form>
  );
}