import { createFileRoute } from "@tanstack/react-router";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";

export const Route = createFileRoute("/app/")({
  component: AppHome,
});

function AppHome() {
  const { user, currentMembership } = useAuth();
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