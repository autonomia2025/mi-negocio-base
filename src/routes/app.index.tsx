import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";

export const Route = createFileRoute("/app/")({
  component: AppHome,
});

function AppHome() {
  const navigate = useNavigate();
  const { user, currentMembership } = useAuth();
  const impersonatingId = useImpersonatingTenantId();

  useEffect(() => {
    if (impersonatingId) return; // impersonation lands on /app dashboard
    const role = currentMembership?.role;
    if (!role) return;
    if (role === "vendedor" || role === "cajero") {
      void navigate({ to: "/app/consulta", replace: true });
    } else if (role === "almacenista") {
      void navigate({ to: "/app/inventario", replace: true });
    }
  }, [currentMembership, impersonatingId, navigate]);

  if (!user || !currentMembership) return null;
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Bienvenido, {user.email}
      </h1>
      <p className="text-sm text-muted-foreground">
        Rol: {ROLE_LABELS[currentMembership.role] ?? currentMembership.role}
      </p>
    </div>
  );
}