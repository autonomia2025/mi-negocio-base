import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";

export const Route = createFileRoute("/select-tenant")({
  component: SelectTenantPage,
});

function SelectTenantPage() {
  const { loading, session, memberships, selectTenant, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) void navigate({ to: "/login" });
  }, [loading, session, navigate]);

  const onSelect = (tenantId: string) => {
    selectTenant(tenantId);
    void navigate({ to: "/app" });
  };

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Selecciona una empresa
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tienes acceso a varias empresas. Elige con cuál deseas trabajar.
            </p>
          </div>
          <button
            onClick={() => void signOut()}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cerrar sesión
          </button>
        </div>

        {memberships.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            No perteneces a ninguna empresa todavía.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {memberships.map((m) => (
              <button
                key={m.tenant_id}
                onClick={() => onSelect(m.tenant_id)}
                className="rounded-lg border border-border bg-card p-5 text-left transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <div className="text-base font-medium text-foreground">
                  {m.tenants.name}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {ROLE_LABELS[m.role] ?? m.role}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}