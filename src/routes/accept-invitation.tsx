import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/accept-invitation")({
  component: AcceptInvitationPage,
});

function AcceptInvitationPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [tenantName, setTenantName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) {
        if (!cancelled) {
          setError(
            "El enlace de invitación no es válido o ha expirado. Pide a tu administrador que te envíe uno nuevo.",
          );
          setReady(true);
        }
        return;
      }
      if (cancelled) return;
      setEmail(session.user.email ?? "");
      const tenantId =
        (session.user.user_metadata as { tenant_id?: string } | null)?.tenant_id ?? null;
      if (tenantId) {
        const { data: t } = await supabase
          .from("tenants")
          .select("name")
          .eq("id", tenantId)
          .maybeSingle();
        if (!cancelled && t) setTenantName(t.name);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("La contraseña debe tener al menos 10 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setSubmitting(true);
    const { error: upErr } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    void navigate({ to: "/app" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {tenantName
              ? `Crea tu contraseña para acceder a ${tenantName}`
              : "Crea tu contraseña"}
          </h1>
          {email && (
            <p className="mt-1 text-sm text-muted-foreground">
              Cuenta: <span className="text-foreground">{email}</span>
            </p>
          )}
        </div>
        {!ready ? (
          <p className="text-center text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <form
            onSubmit={onSubmit}
            className="space-y-4 rounded-lg border border-border bg-card p-6"
          >
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Nueva contraseña
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">Mínimo 10 caracteres.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Confirmar contraseña
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              />
            </div>
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? "Creando…" : "Crear mi cuenta"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}