import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Menu, X } from "lucide-react";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  setImpersonatingTenantId,
  useImpersonatingTenantId,
} from "@/lib/impersonation";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

const MENU = [
  { label: "Dashboard", to: "/app" as const },
  { label: "Inventario", placeholder: true },
  { label: "Ventas", placeholder: true },
];

function AppLayout() {
  const navigate = useNavigate();
  const { loading, session, currentTenantId, currentMembership, memberships, signOut } =
    useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = useMemo(
    () => memberships.some((m) => m.role === "super_admin" && m.is_active),
    [memberships],
  );
  const [impersonatedTenant, setImpersonatedTenant] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Load impersonated tenant info when active
  useEffect(() => {
    if (!impersonatingId || !isSuperAdmin) {
      setImpersonatedTenant(null);
      return;
    }
    void supabase
      .from("tenants")
      .select("id, name")
      .eq("id", impersonatingId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setImpersonatedTenant(data as { id: string; name: string });
      });
  }, [impersonatingId, isSuperAdmin]);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      void navigate({ to: "/login" });
      return;
    }
    // Impersonation overrides tenant selection
    if (impersonatingId && isSuperAdmin) return;
    if (!currentTenantId) {
      if (memberships.length === 0) return;
      void navigate({ to: "/select-tenant" });
    }
  }, [loading, session, currentTenantId, memberships, navigate, impersonatingId, isSuperAdmin]);

  const isImpersonating = !!impersonatingId && isSuperAdmin && !!impersonatedTenant;
  const effectiveTenantName = isImpersonating
    ? impersonatedTenant!.name
    : currentMembership?.tenants.name;
  const effectiveRoleLabel = isImpersonating
    ? "Propietario (impersonado)"
    : currentMembership
      ? ROLE_LABELS[currentMembership.role] ?? currentMembership.role
      : "";

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  if (!isImpersonating && !currentMembership) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Empresa
        </div>
        <div className="mt-1 truncate text-sm font-medium text-foreground">
          {effectiveTenantName}
        </div>
        {!isImpersonating && memberships.length > 1 && (
          <button
            onClick={() => void navigate({ to: "/select-tenant" })}
            className="mt-1 text-xs text-primary hover:underline"
          >
            Cambiar empresa
          </button>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-3">
        {MENU.map((item) =>
          item.placeholder ? (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground"
              title="Próximamente"
            >
              <span>{item.label}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Próximamente
              </span>
            </div>
          ) : (
            <Link
              key={item.label}
              to={item.to!}
              activeOptions={{ exact: true }}
              activeProps={{ className: "bg-accent text-accent-foreground" }}
              className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent"
              onClick={() => setSidebarOpen(false)}
            >
              {item.label}
            </Link>
          ),
        )}
      </nav>
      <div className="border-t border-border px-3 py-3">
        <button
          onClick={() => void signOut()}
          className="block w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <div className="truncate text-sm font-medium">
          {currentMembership.tenants.name}
        </div>
        <button
          onClick={() => setSidebarOpen((s) => !s)}
          className="rounded-md p-2 text-foreground hover:bg-accent"
          aria-label="Abrir menú"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Desktop sidebar */}
      <div className="hidden md:block">{sidebar}</div>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/20"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full">{sidebar}</div>
        </div>
      )}

      <main className="flex-1 px-6 pb-10 pt-20 md:pt-10">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}