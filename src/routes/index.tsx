import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { loading, session, currentTenantId, memberships } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      void navigate({ to: "/login" });
      return;
    }
    if (currentTenantId) {
      void navigate({ to: "/app" });
    } else if (memberships.length === 0) {
      // user without tenants — keep them on a simple message
      return;
    } else {
      void navigate({ to: "/select-tenant" });
    }
  }, [loading, session, currentTenantId, memberships, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Cargando…</p>
    </div>
  );
}
