import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, Printer, XCircle, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSaleById,
  voidSale,
  generateSalePdfClient,
  getSalePdfSignedUrl,
  getSalespersonEmail,
  canViewProfit,
  canVoidSale,
  PAYMENT_LABELS,
  type SaleWithItems,
} from "@/utils/sales";
import { formatCurrency, formatNumber, getTenantCurrency, type CurrencyCode } from "@/utils/currency";

export const Route = createFileRoute("/app/ventas/$saleId")({
  component: SaleDetailPage,
});

function SaleDetailPage() {
  const { saleId } = Route.useParams();
  const { currentTenantId, currentMembership, memberships, user } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role ?? null;

  const [sale, setSale] = useState<SaleWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState<CurrencyCode>("MXN");
  const [salespersonEmail, setSalespersonEmail] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfPolling, setPdfPolling] = useState(false);
  const [pdfFailed, setPdfFailed] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const pollAttempts = useRef(0);

  const reload = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const s = await fetchSaleById(saleId, tenantId);
      setSale(s);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    void fetchSaleById(saleId, tenantId).then(async (s) => {
      if (cancelled) return;
      setSale(s);
      setLoading(false);
      const { data: t } = await supabase
        .from("tenants")
        .select("settings")
        .eq("id", tenantId)
        .maybeSingle();
      if (!cancelled) setCurrency(getTenantCurrency(t?.settings ?? {}));
      // Resolve salesperson email best-effort
      try {
        const email = await getSalespersonEmail(saleId);
        if (!cancelled) setSalespersonEmail(email);
      } catch {
        // ignore
      }
    });
    return () => {
      cancelled = true;
    };
  }, [saleId, tenantId]);

  // PDF: if pdf_path exists, fetch signed URL; otherwise poll up to 10x.
  useEffect(() => {
    if (!sale) return;
    let cancelled = false;
    pollAttempts.current = 0;
    setPdfFailed(false);
    setPdfUrl(null);

    const fetchUrl = async () => {
      try {
        const url = await getSalePdfSignedUrl(sale.id);
        if (!cancelled && url) {
          setPdfUrl(url);
          setPdfPolling(false);
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    };

    if (sale.pdf_path) {
      void fetchUrl();
      return () => {
        cancelled = true;
      };
    }

    setPdfPolling(true);
    const interval = setInterval(async () => {
      pollAttempts.current += 1;
      const ok = await fetchUrl();
      if (ok || cancelled) {
        clearInterval(interval);
      } else if (pollAttempts.current >= 10) {
        clearInterval(interval);
        if (!cancelled) {
          setPdfPolling(false);
          setPdfFailed(true);
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sale]);

  async function handleDownload() {
    if (!sale) return;
    setActionError(null);
    try {
      const url = await getSalePdfSignedUrl(sale.id);
      if (url) {
        window.open(url, "_blank");
      } else {
        setActionError("El PDF aún no está disponible.");
      }
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function handlePrintTicket() {
    if (!sale) return;
    setActionError(null);
    try {
      const url = await getSalePdfSignedUrl(sale.id);
      if (!url) {
        toast.error("PDF aún se está generando, intenta en unos segundos");
        return;
      }
      const win = window.open(url, "_blank");
      setTimeout(() => win?.print(), 1000);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleRegenerate() {
    if (!sale) return;
    setActionError(null);
    setRegenerating(true);
    setPdfFailed(false);
    try {
      const r = await generateSalePdfClient(sale.id);
      setPdfUrl(r.signedUrl);
      // Refetch sale to update pdf_path
      void reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleVoidSubmit() {
    if (!sale) return;
    if (voidReason.trim().length < 5) {
      setVoidError("El motivo debe tener al menos 5 caracteres.");
      return;
    }
    setVoidError(null);
    setVoidSubmitting(true);
    try {
      await voidSale(sale.id, voidReason.trim());
      setVoidOpen(false);
      setVoidReason("");
      await reload();
    } catch (e) {
      setVoidError((e as Error).message);
    } finally {
      setVoidSubmitting(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Cargando…</div>;
  }
  if (!sale) {
    return (
      <div className="space-y-3">
        <Link
          to="/app/ventas"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Ventas
        </Link>
        <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          Venta no encontrada.
        </div>
      </div>
    );
  }

  const isOwn = sale.created_by === user?.id;
  const showVoid = sale.status === "completed" && canVoidSale(role, isOwn);
  const showRegen = role === "tenant_owner" || role === "gerente" || role === "super_admin" || isSuperAdmin;
  const showProfit = canViewProfit(role);
  const voided = sale.status === "voided";

  return (
    <div className="space-y-6 print:space-y-3">
      <Link
        to="/app/ventas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ChevronLeft className="h-4 w-4" /> Ventas
      </Link>

      {voided && (
        <div className="rounded-md border border-red-200 border-l-4 border-l-red-500 bg-red-50 p-4 text-sm">
          <div className="font-semibold text-red-900">
            Venta cancelada el {sale.voided_at ? new Date(sale.voided_at).toLocaleString("es-MX") : "—"}
          </div>
          <div className="mt-1 text-red-800">
            Motivo: {sale.void_reason ?? "—"}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tabular-nums">#{sale.sale_number}</h1>
            {voided ? (
              <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800">
                Cancelada
              </span>
            ) : (
              <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">
                Completada
              </span>
            )}
          </div>
          <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <span className="text-foreground">Fecha:</span>{" "}
              {new Date(sale.created_at).toLocaleString("es-MX")}
            </div>
            <div>
              <span className="text-foreground">Vendedor:</span>{" "}
              {salespersonEmail ?? `${sale.created_by.slice(0, 8)}…`}
            </div>
            <div>
              <span className="text-foreground">Cliente:</span>{" "}
              {sale.customer_name ?? "Público general"}
            </div>
            <div>
              <span className="text-foreground">Pago:</span>{" "}
              {PAYMENT_LABELS[sale.payment_method]}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
          <div className="text-3xl font-bold tabular-nums">
            {formatCurrency(sale.total, currency)}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 print:hidden">
        <button
          onClick={() => void handleDownload()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
        >
          <Download className="h-4 w-4" /> Descargar PDF
        </button>
        <button
          onClick={() => void handlePrintTicket()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
        >
          <Printer className="h-4 w-4" /> Imprimir ticket
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
        >
          <Printer className="h-4 w-4" /> Imprimir
        </button>
        {showRegen && (
          <button
            onClick={() => void handleRegenerate()}
            disabled={regenerating}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
          >
            {regenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Regenerar PDF
          </button>
        )}
        {showVoid && (
          <button
            onClick={() => setVoidOpen(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            <XCircle className="h-4 w-4" /> Cancelar venta
          </button>
        )}
      </div>

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {actionError}
        </div>
      )}

      {/* Items */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Productos
        </h2>
        <div className="hidden overflow-hidden rounded-md border border-border bg-card md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2 text-right">P.U.</th>
                <th className="px-3 py-2 text-right">Subtotal</th>
                {showProfit && <th className="px-3 py-2 text-right">Utilidad</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sale.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-2 font-mono text-xs">{it.product_sku_at_sale}</td>
                  <td className="px-3 py-2">{it.product_name_at_sale}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(it.quantity, 2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(it.unit_price, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {formatCurrency(it.line_subtotal, currency)}
                  </td>
                  {showProfit && (
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        Number(it.line_profit) >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {formatCurrency(it.line_profit, currency)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-muted/20 text-sm">
              <tr>
                <td colSpan={showProfit ? 4 : 4} className="px-3 py-2 text-right font-medium">
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {formatCurrency(sale.total, currency)}
                </td>
                {showProfit && (
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      Number(sale.profit) >= 0 ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {formatCurrency(sale.profit, currency)}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="space-y-2 md:hidden">
          {sale.items.map((it) => (
            <div key={it.id} className="rounded-md border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{it.product_name_at_sale}</div>
                  <div className="font-mono text-xs text-muted-foreground">{it.product_sku_at_sale}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">
                    {formatCurrency(it.line_subtotal, currency)}
                  </div>
                  {showProfit && (
                    <div
                      className={`text-xs tabular-nums ${
                        Number(it.line_profit) >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      Util. {formatCurrency(it.line_profit, currency)}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {formatNumber(it.quantity, 2)} × {formatCurrency(it.unit_price, currency)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Payment / details */}
      <section className="rounded-md border border-border bg-card p-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Método: </span>
            {PAYMENT_LABELS[sale.payment_method]}
          </div>
          <div>
            <span className="text-muted-foreground">Cliente: </span>
            {sale.customer_name ?? "Público general"}
          </div>
          <div>
            <span className="text-muted-foreground">Email: </span>
            {sale.customer_email ?? "—"}
          </div>
          <div className="sm:col-span-2">
            <span className="text-muted-foreground">Notas: </span>
            {sale.notes ?? "—"}
          </div>
        </div>
      </section>

      {/* PDF */}
      <section className="print:hidden">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Comprobante
        </h2>
        {pdfUrl ? (
          <div className="space-y-2">
            <iframe
              title={`Comprobante venta #${sale.sale_number}`}
              src={pdfUrl}
              className="w-full rounded-md border border-border bg-card"
              style={{ height: 600 }}
            />
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-xs text-muted-foreground hover:text-foreground"
            >
              Tu navegador no muestra el PDF embebido. Descárgalo aquí.
            </a>
          </div>
        ) : pdfPolling ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Generando PDF…
          </div>
        ) : pdfFailed ? (
          <div className="space-y-2 rounded-md border border-border bg-card p-4 text-sm">
            <p className="text-muted-foreground">El PDF aún no está disponible.</p>
            <button
              onClick={() => void handleRegenerate()}
              disabled={regenerating}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
            >
              {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Regenerar PDF
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-sm text-muted-foreground">
            Sin comprobante.
          </div>
        )}
      </section>

      {/* Void modal */}
      {voidOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
            <h2 className="text-base font-semibold text-foreground">Cancelar venta #{sale.sale_number}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Esta acción devolverá el inventario al stock. No se puede deshacer.
            </p>
            <label className="mt-3 block text-xs font-medium text-foreground">
              Motivo (mínimo 5 caracteres)
            </label>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              placeholder="Ej. Error de captura en cantidades"
            />
            {voidError && (
              <div className="mt-2 text-sm text-destructive">{voidError}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setVoidOpen(false);
                  setVoidError(null);
                }}
                disabled={voidSubmitting}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-60"
              >
                Cerrar
              </button>
              <button
                onClick={() => void handleVoidSubmit()}
                disabled={voidSubmitting}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-60"
              >
                {voidSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar cancelación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}