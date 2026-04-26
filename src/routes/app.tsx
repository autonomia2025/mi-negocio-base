import { createFileRoute, Outlet, useNavigate, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Menu, X, ArrowLeftRight, Zap, Sparkles } from "lucide-react";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  setImpersonatingTenantId,
  useImpersonatingTenantId,
} from "@/lib/impersonation";
import { isOnboardingCompleted } from "@/lib/onboarding";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

type MenuLink = {
  label: string;
  to:
    | "/app"
    | "/app/productos"
    | "/app/inventario"
    | "/app/consulta"
    | "/app/ventas"
    | "/app/ingesta-ia";
  roles: string[];
  placeholder?: false;
  highlight?: boolean;
  icon?: "zap" | "sparkles";
};
type MenuPlaceholder = {
  label: string;
  placeholder: true;
  roles: string[];
};
type MenuItem = MenuLink | MenuPlaceholder;

const ALL_ROLES = ["tenant_owner", "gerente", "vendedor", "almacenista", "cajero"];
const STAFF_ROLES = ["tenant_owner", "gerente", "almacenista"];
const MANAGER_ROLES = ["tenant_owner", "gerente"];

const MENU: MenuItem[] = [
  { label: "Consulta rápida", to: "/app/consulta", roles: ALL_ROLES, highlight: true, icon: "zap" },
  {
    label: "Ingesta IA",
    to: "/app/ingesta-ia",
    roles: ALL_ROLES,
    highlight: true,
    icon: "sparkles",
  },
  { label: "Dashboard", to: "/app", roles: MANAGER_ROLES },
  { label: "Catálogo", to: "/app/productos", roles: ALL_ROLES },
  { label: "Inventario", to: "/app/inventario", roles: STAFF_ROLES },
  {
    label: "Ventas",
    to: "/app/ventas",
    roles: ["tenant_owner", "gerente", "vendedor", "cajero"],
  },
];

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
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
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

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

  // Determine effective tenant id (impersonation aware)
  const effectiveTenantId =
    impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;

  // Onboarding gate: fetch settings.onboarding_completed for the active tenant
  useEffect(() => {
    let cancelled = false;
    setOnboardingChecked(false);
    if (!session || !effectiveTenantId) return;
    void supabase
      .from("tenants")
      .select("settings")
      .eq("id", effectiveTenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const done = isOnboardingCompleted(data?.settings ?? {});
        setOnboardingDone(done);
        setOnboardingChecked(true);
        if (!done && location.pathname !== "/app/onboarding") {
          void navigate({ to: "/app/onboarding" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, effectiveTenantId, location.pathname, navigate]);

  const isImpersonating = !!impersonatingId && isSuperAdmin && !!impersonatedTenant;
  const effectiveTenantName = isImpersonating
    ? impersonatedTenant!.name
    : currentMembership?.tenants.name;
  const effectiveRoleLabel = isImpersonating
    ? "Propietario (impersonado)"
    : currentMembership
      ? ROLE_LABELS[currentMembership.role] ?? currentMembership.role
      : "";
  const effectiveRole = isImpersonating
    ? "tenant_owner"
    : currentMembership?.role ?? "";
  const visibleMenu = MENU.filter((m) => m.roles.includes(effectiveRole));

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

  const onOnboardingRoute = location.pathname === "/app/onboarding";

  // While we check onboarding for non-onboarding routes, show loader to prevent flash
  if (!onboardingChecked && !onOnboardingRoute) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  const impersonationBanner = isImpersonating ? (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="flex items-center gap-2">
        <ArrowLeftRight className="h-4 w-4" />
        <span>
          Estás impersonando a <strong>{impersonatedTenant!.name}</strong>
        </span>
      </div>
      <button
        onClick={() => {
          setImpersonatingTenantId(null);
          void navigate({ to: "/admin" });
        }}
        className="rounded-md border border-amber-400 bg-white/60 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-white"
      >
        Salir de impersonación
      </button>
    </div>
  ) : null;

  // Onboarding view: full-bleed, no sidebar, with optional banner above
  if (onOnboardingRoute || !onboardingDone) {
    return (
      <div className="min-h-screen bg-background">
        {impersonationBanner}
        <Outlet />
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
        {visibleMenu.map((item) =>
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
              to={item.to}
              activeOptions={{ exact: item.to === "/app" }}
              activeProps={{ className: "bg-accent text-accent-foreground" }}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent ${
                item.highlight ? "font-semibold" : ""
              }`}
              onClick={() => setSidebarOpen(false)}
            >
              {item.highlight && item.icon === "sparkles" ? (
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : item.highlight ? (
                <Zap className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : null}
              {item.label}
            </Link>
          ),
        )}
      </nav>
      <div className="border-t border-border px-3 py-3">
        <div className="px-3 pb-2 text-[11px] text-muted-foreground">
          {effectiveRoleLabel}
        </div>
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
          {effectiveTenantName}
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