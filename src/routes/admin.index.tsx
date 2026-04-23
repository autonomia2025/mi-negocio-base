import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Panel super admin
      </h1>
      <p className="text-sm text-muted-foreground">Próximamente.</p>
    </div>
  );
}