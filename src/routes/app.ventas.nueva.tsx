import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Trash2, Search, Plus, Minus } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import {
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  registerSale,
  generateSalePdfClient,
  canSell,
  type CartItem,
  type PaymentMethod,
} from "@/utils/sales";
import { formatCurrency, getTenantCurrency, type CurrencyCode } from "@/utils/currency";

export const Route = createFileRoute("/app/ventas/nueva")({
  component: NewSalePage,
});

const CART_KEY = "erp.sale.cart.draft";

function NewSalePage() {
  const navigate = useNavigate();
  const { currentTenantId, currentMembership, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role ?? null;
  const allowed = canSell(role);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(CART_KEY);
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("MXN");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<CartItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (!tenantId) return;
    void supabase
      .from("tenants")
      .select("settings")
      .eq("id", tenantId)
      .maybeSingle()
      .then(({ data }) => setCurrency(getTenantCurrency(data?.settings ?? {})));
  }, [tenantId]);

  // Live product search
  useEffect(() => {
    if (!tenantId) return;
    const term = search.trim();
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const safe = term.replace(/[%_]/g, "");
      const { data } = await supabase
        .from("products")
        .select("id, sku, name, current_stock, cost_avg, price, unit")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .or(`sku.ilike.%${safe}%,name.ilike.%${safe}%`)
        .limit(8);
      setSearchResults(
        (data ?? []).map((p) => ({
          product_id: p.id,
          sku: p.sku,
          name: p.name,
          quantity: 1,
          unit_price: Number(p.price ?? 0),
          current_stock: Number(p.current_stock ?? 0),
          cost_avg: Number(p.cost_avg ?? 0),
        })),
      );
      setSearching(false);
    }, 200);
    return () => clearTimeout(t);
  }, [search, tenantId]);

  const subtotal = cart.reduce((s, it) => s + it.quantity * it.unit_price, 0);

  const stockIssues = cart
    .filter((it) => it.quantity > it.current_stock)
    .map((it) => `${it.name}: solo ${it.current_stock} disponibles`);

  const addToCart = (item: CartItem) => {
    setCart((prev) => {
      const existing = prev.find((p) => p.product_id === item.product_id);
      if (existing) {
        if (existing.quantity + 1 > existing.current_stock) {
          setError(`Solo hay ${existing.current_stock} disponibles de ${existing.name}`);
          return prev;
        }
        return prev.map((p) =>
          p.product_id === item.product_id ? { ...p, quantity: p.quantity + 1 } : p,
        );
      }
      if (item.current_stock < 1) {
        setError(`${item.name} no tiene stock disponible`);
        return prev;
      }
      return [...prev, item];
    });
    setError(null);
    setSearch("");
    setSearchResults([]);
  };

  const updateQty = (id: string, qty: number) => {
    setCart((prev) =>
      prev.map((p) => {
        if (p.product_id !== id) return p;
        const safeQty = Math.max(0.01, qty);
        return { ...p, quantity: safeQty };
      }),
    );
  };

  const updatePrice = (id: string, price: number) => {
    setCart((prev) =>
      prev.map((p) => (p.product_id === id ? { ...p, unit_price: Math.max(0, price) } : p)),
    );
  };

  const removeFromCart = (id: string) =>
    setCart((prev) => prev.filter((p) => p.product_id !== id));

  const handleCancel = () => {
    if (cart.length > 0 && !window.confirm("¿Descartar la venta en curso?")) return;
    sessionStorage.removeItem(CART_KEY);
    void navigate({ to: "/app/ventas" });
  };

  const handleSubmit = async () => {
    if (!tenantId) return;
    setSubmitting(true);
    setError(null);
    try {
      const saleId = await registerSale({
        tenantId,
        paymentMethod,
        customerName: customerName.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        notes: notes.trim() || undefined,
        items: cart.map((it) => ({
          product_id: it.product_id,
          quantity: it.quantity,
          unit_price: it.unit_price,
        })),
      });
      sessionStorage.removeItem(CART_KEY);
      // Fire-and-forget PDF generation
      void generateSalePdfClient(saleId).catch((e) => console.warn("PDF gen failed", e));
      void navigate({ to: "/app/ventas/$saleId", params: { saleId } });
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  if (!allowed) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        No tienes permiso para registrar ventas.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/app/ventas"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Ventas
        </Link>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Paso {step} de 3</span>
        <div className="flex flex-1 gap-1">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">Productos</h1>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto por SKU o nombre…"
              className="w-full rounded-md border border-border bg-background py-2 pl-10 pr-3 text-sm outline-none focus:border-primary"
            />
            {searchResults.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                {searchResults.map((r) => (
                  <button
                    key={r.product_id}
                    onClick={() => addToCart(r)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{r.sku}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground tabular-nums">
                      <div>Stock: {r.current_stock}</div>
                      <div>{formatCurrency(r.unit_price, currency)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searching && (
              <div className="mt-1 text-xs text-muted-foreground">Buscando…</div>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              ↑ Aún no has agregado productos. Usa la búsqueda arriba para empezar.
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((item) => {
                const overstock = item.quantity > item.current_stock;
                return (
                  <div
                    key={item.product_id}
                    className={`rounded-md border ${overstock ? "border-red-300 bg-red-50" : "border-border bg-card"} p-3`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="text-xs font-mono text-muted-foreground">
                          {item.sku} · stock: {item.current_stock}
                        </div>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.product_id)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-red-600"
                        aria-label="Quitar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateQty(item.product_id, Math.max(1, item.quantity - 1))}
                          className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0.01}
                          step={0.01}
                          value={item.quantity}
                          onChange={(e) => updateQty(item.product_id, Number(e.target.value))}
                          className="h-9 w-16 rounded-md border border-border bg-background text-center text-sm tabular-nums outline-none focus:border-primary"
                        />
                        <button
                          onClick={() => updateQty(item.product_id, item.quantity + 1)}
                          className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1 text-sm">
                        <span className="text-muted-foreground">P.U.:</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.01}
                          value={item.unit_price}
                          onChange={(e) => updatePrice(item.product_id, Number(e.target.value))}
                          className="h-9 w-24 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-primary"
                        />
                      </div>
                      <div className="ml-auto text-sm">
                        <span className="text-muted-foreground">Subtotal: </span>
                        <span className="font-medium tabular-nums">
                          {formatCurrency(item.quantity * item.unit_price, currency)}
                        </span>
                      </div>
                    </div>
                    {overstock && (
                      <div className="mt-2 text-xs text-red-700">
                        Solo hay {item.current_stock} disponibles
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Subtotal: </span>
              <span className="text-lg font-semibold tabular-nums">
                {formatCurrency(subtotal, currency)}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (cart.length === 0) return;
                  if (stockIssues.length > 0) {
                    setError(stockIssues.join(" · "));
                    return;
                  }
                  setStep(2);
                }}
                disabled={cart.length === 0 || stockIssues.length > 0}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">Pago</h1>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="text-muted-foreground">Resumen del carrito</div>
            <div className="mt-1 flex items-center justify-between">
              <span>{cart.length} producto{cart.length === 1 ? "" : "s"}</span>
              <span className="font-semibold tabular-nums">{formatCurrency(subtotal, currency)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Método de pago</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`flex min-h-[60px] items-center justify-between rounded-md border px-4 py-3 text-left text-sm ${
                    paymentMethod === m
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-accent"
                  }`}
                >
                  <span className="font-medium">{PAYMENT_LABELS[m]}</span>
                  {paymentMethod === m && (
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Cliente (opcional)</span>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value.slice(0, 200))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Email del cliente</span>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Notas</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>

          <div className="flex justify-between border-t border-border pt-4">
            <button
              onClick={() => setStep(1)}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
            >
              Atrás
            </button>
            <button
              onClick={() => {
                if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
                  setError("Email del cliente no válido");
                  return;
                }
                setError(null);
                setStep(3);
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">Confirmación</h1>

          <div className="overflow-hidden rounded-md border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Producto</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                  <th className="px-3 py-2 text-right">P.U.</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cart.map((it) => (
                  <tr key={it.product_id}>
                    <td className="px-3 py-2">
                      <div>{it.name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{it.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{it.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(it.unit_price, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatCurrency(it.quantity * it.unit_price, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/20">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-medium">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums text-lg font-semibold">
                    {formatCurrency(subtotal, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded-md border border-border bg-card p-4 text-sm">
            <div><span className="text-muted-foreground">Pago: </span>{PAYMENT_LABELS[paymentMethod]}</div>
            <div><span className="text-muted-foreground">Cliente: </span>{customerName || "Público general"}</div>
            {customerEmail && <div><span className="text-muted-foreground">Email: </span>{customerEmail}</div>}
            {notes && <div className="mt-2 text-muted-foreground">{notes}</div>}
          </div>

          <div className="flex justify-between border-t border-border pt-4">
            <button
              onClick={() => setStep(2)}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              Atrás
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-md bg-primary px-6 py-2.5 text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Registrando…" : "Registrar venta"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}