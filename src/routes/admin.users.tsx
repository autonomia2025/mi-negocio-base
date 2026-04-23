import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { listAllUsers } from "@/utils/admin.functions";
import { ROLE_LABELS } from "@/lib/auth-context";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  memberships: { tenant_id: string; tenant_name: string; role: string; is_active: boolean }[];
};

function UsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void listAllUsers()
      .then((r) => setUsers(r.users as UserRow[]))
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users ?? [];
    return (users ?? []).filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.full_name ?? "").toLowerCase().includes(q),
    );
  }, [users, search]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Usuarios
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todos los usuarios de la plataforma y sus tenants.
        </p>
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Buscar por correo o nombre…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Usuario</th>
              <th className="px-4 py-2.5 font-medium">Tenants</th>
              <th className="px-4 py-2.5 font-medium">Último acceso</th>
              <th className="px-4 py-2.5 font-medium">Creado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users === null ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Sin resultados.
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {u.full_name ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {u.memberships.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.memberships.map((m) => (
                          <Link
                            key={m.tenant_id}
                            to="/admin/tenants/$id"
                            params={{ id: m.tenant_id }}
                            className={`rounded-full border px-2 py-0.5 text-xs ${m.is_active ? "border-border text-foreground hover:bg-accent" : "border-border bg-muted text-muted-foreground"}`}
                            title={ROLE_LABELS[m.role] ?? m.role}
                          >
                            {m.tenant_name}{" "}
                            <span className="text-muted-foreground">
                              · {ROLE_LABELS[m.role] ?? m.role}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.last_sign_in_at
                      ? new Date(u.last_sign_in_at).toLocaleString("es-MX")
                      : "Nunca"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("es-MX")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}