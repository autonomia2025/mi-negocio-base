import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PLAN_LABELS,
  PLAN_PRICES_MXN,
  STATUS_LABELS,
  STATUS_TONES,
  formatMXN,
  logAudit,
} from "@/lib/admin-utils";
import { getTenantOwners } from "@/utils/admin.functions";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";

export const Route = createFileRoute("/admin/tenants/")({
  component: TenantsList,
});

type Tenant = {
  id: string;
  name: string;
  slug: string;
  subscription_plan: string | null;
  subscription_status: string;
  ai_ops_used: number;
  ai_ops_limit: number;
  created_at: string;
};

function TenantsList() {
  const [rows, setRows] = useState<Tenant[] | null>(null);
  const [owners, setOwners] = useState<Record<string, { email: string }[]>>({});
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");

  const reload = async () => {
    const { data, error } = await supabase
      .from("tenants")
      .select(
        "id, name, slug, subscription_plan, subscription_status, ai_ops_used, ai_ops_limit, created_at",
      )
      .eq("is_system", false)
      .order("created_at", { ascending: false });
    if (error) {
      setError(error.message);
      return;
    }
    setRows(data as Tenant[]);
  };

  useEffect(() => {
    void reload();
    void getTenantOwners()
      .then((r) => setOwners(r.ownersByTenant))
      .catch((e) => {
        setOwners({});
        setOwnersError(
          e instanceof Error ? e.message : "No se pudieron cargar los dueños",
        );
      });
  }, []);

  const filtered = useMemo(() => {
    return (rows ?? []).filter((t) => {
      if (
        search &&
        !t.name.toLowerCase().includes(search.toLowerCase()) &&
        !t.slug.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (statusFilter !== "all" && t.subscription_status !== statusFilter)
        return false;
      if (planFilter !== "all" && t.subscription_plan !== planFilter) return false;
      return true;
    });
  }, [rows, search, statusFilter, planFilter]);

  const toggleStatus = async (t: Tenant) => {
    const next = t.subscription_status === "suspended" ? "active" : "suspended";
    const { error } = await supabase
      .from("tenants")
      .update({ subscription_status: next })
      .eq("id", t.id);
    if (error) {
      alert(error.message);
      return;
    }
    await logAudit({
      tenantId: t.id,
      action: next === "suspended" ? "tenant.suspended" : "tenant.activated",
      entityType: "tenant",
      entityId: t.id,
      changes: { from: t.subscription_status, to: next },
    });
    await reload();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Tenants
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Todos los clientes en la plataforma.
          </p>
        </div>
        <Link
          to="/admin/tenants/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Nuevo tenant
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Buscar por nombre o slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">Todos los estados</option>
          <option value="trial">Prueba</option>
          <option value="active">Activo</option>
          <option value="suspended">Suspendido</option>
          <option value="cancelled">Cancelado</option>
        </select>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">Todos los planes</option>
          <option value="basico">Básico</option>
          <option value="profesional">Profesional</option>
          <option value="empresarial">Empresarial</option>
        </select>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {ownersError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No se pudieron cargar los dueños de cada tenant. La lista sigue funcional.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Cliente</th>
              <th className="px-4 py-2.5 font-medium">Plan</th>
              <th className="px-4 py-2.5 font-medium">Estado</th>
              <th className="px-4 py-2.5 font-medium">Uso IA</th>
              <th className="px-4 py-2.5 font-medium">MRR</th>
              <th className="px-4 py-2.5 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No hay resultados.
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const ownerList =
                  owners && typeof owners === "object" ? owners[t.id] : null;
                const ownerEmail = ownerList?.[0]?.email ?? "—";
                const pct =
                  t.ai_ops_limit > 0
                    ? Math.min(100, Math.round((t.ai_ops_used / t.ai_ops_limit) * 100))
                    : 0;
                const mrr =
                  t.subscription_status === "active" && t.subscription_plan
                    ? PLAN_PRICES_MXN[t.subscription_plan] ?? 0
                    : 0;
                return (
                  <tr key={t.id} className="hover:bg-accent/30">
                    <td className="px-4 py-3">
                      <Link
                        to="/admin/tenants/$id"
                        params={{ id: t.id }}
                        className="font-medium text-foreground hover:underline"
                      >
                        {t.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{ownerEmail}</div>
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {t.subscription_plan ? PLAN_LABELS[t.subscription_plan] : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STATUS_TONES[t.subscription_status]}`}
                      >
                        {STATUS_LABELS[t.subscription_status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-muted-foreground">
                        {t.ai_ops_used.toLocaleString("es-MX")} /{" "}
                        {t.ai_ops_limit.toLocaleString("es-MX")}
                      </div>
                      <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-primary"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground">{formatMXN(mrr)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          to="/admin/tenants/$id"
                          params={{ id: t.id }}
                          className="text-xs text-primary hover:underline"
                        >
                          Abrir
                        </Link>
                        <ImpersonateButton tenantId={t.id} tenantName={t.name} />
                        <button
                          onClick={() => void toggleStatus(t)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {t.subscription_status === "suspended"
                            ? "Activar"
                            : "Suspender"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}