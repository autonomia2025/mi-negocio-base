import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  Users,
  LogOut,
  Menu,
  X,
  ArrowLeftRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  useImpersonatingTenantId,
  setImpersonatingTenantId,
} from "@/lib/impersonation";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const { loading, session, memberships, signOut, user } = useAuth();
  const impersonating = useImpersonatingTenantId();
  const [open, setOpen] = useState(false);

  const isSuperAdmin = useMemo(
    () => memberships.some((m) => m.role === "super_admin" && m.is_active),
    [memberships],
  );

  useEffect(() => {
    if (loading) return;
    if (!session) void navigate({ to: "/login" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-5xl font-semibold text-foreground">403</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            No tienes permisos para acceder a esta sección.
          </p>
        </div>
      </div>
    );
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          MEXINTLI
        </div>
        <div className="mt-1 text-sm font-medium text-foreground">
          Panel super admin
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-3">
        <NavItem to="/admin" icon={<LayoutDashboard className="h-4 w-4" />} exact>
          Dashboard
        </NavItem>
        <NavItem to="/admin/tenants" icon={<Building2 className="h-4 w-4" />}>
          Tenants
        </NavItem>
        <NavItem to="/admin/users" icon={<Users className="h-4 w-4" />}>
          Usuarios
        </NavItem>
      </nav>
      <div className="border-t border-border px-3 py-3 space-y-1">
        {impersonating && (
          <button
            onClick={() => {
              setImpersonatingTenantId(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-amber-800 hover:bg-amber-50"
          >
            <ArrowLeftRight className="h-4 w-4" />
            Salir de impersonación
          </button>
        )}
        <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Super admin · MEXINTLI HQ
        </div>
        <div className="px-3 py-1 text-xs text-muted-foreground truncate">
          {user?.email}
        </div>
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" /> Cerrar sesión
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <div className="text-sm font-medium">MEXINTLI · Admin</div>
        <button
          onClick={() => setOpen((s) => !s)}
          className="rounded-md p-2 text-foreground hover:bg-accent"
          aria-label="Abrir menú"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      <div className="hidden md:block">{sidebar}</div>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/20"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full" onClick={() => setOpen(false)}>
            {sidebar}
          </div>
        </div>
      )}

      <main className="flex-1 px-6 pb-10 pt-20 md:pt-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavItem({
  to,
  icon,
  children,
  exact,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: !!exact }}
      activeProps={{ className: "bg-accent text-accent-foreground font-medium" }}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent"
    >
      {icon}
      {children}
    </Link>
  );
}