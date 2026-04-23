import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftRight } from "lucide-react";
import { setImpersonatingTenantId } from "@/lib/impersonation";
import { logAudit } from "@/lib/admin-utils";

export function ImpersonateButton({
  tenantId,
  tenantName,
  variant = "ghost",
}: {
  tenantId: string;
  tenantName: string;
  variant?: "ghost" | "primary";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const onConfirm = async () => {
    setBusy(true);
    try {
      await logAudit({
        tenantId,
        action: "super_admin.impersonate",
        entityType: "tenant",
        entityId: tenantId,
      });
      setImpersonatingTenantId(tenantId);
      setOpen(false);
      void navigate({ to: "/app" });
    } finally {
      setBusy(false);
    }
  };

  const cls =
    variant === "primary"
      ? "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      : "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground";

  return (
    <>
      <button onClick={() => setOpen(true)} className={cls}>
        <ArrowLeftRight className="h-3.5 w-3.5" />
        Impersonar
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">
              Iniciar impersonación
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Vas a entrar al tenant <strong className="text-foreground">{tenantName}</strong>{" "}
              como super admin. Esta acción quedará registrada en el log de auditoría.
              ¿Continuar?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                disabled={busy}
                onClick={() => void onConfirm()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? "Procesando…" : "Continuar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}