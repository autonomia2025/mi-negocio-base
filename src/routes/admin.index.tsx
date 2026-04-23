import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PLAN_PRICES_MXN,
  formatMXN,
  PLAN_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
} from "@/lib/admin-utils";
import { DollarSign, Building2, FlaskConical, Sparkles } from "lucide-react";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  subscription_plan: string | null;
  subscription_status: string;
  ai_ops_used: number;
  ai_ops_limit: number;
  created_at: string;
};

function AdminHome() {
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, name, slug, subscription_plan, subscription_status, ai_ops_used, ai_ops_limit, created_at",
        )
        .order("created_at", { ascending: false });
      if (error) setError(error.message);
      else setRows(data as TenantRow[]);
    })();
  }, []);

  const mrr = (rows ?? [])
    .filter((t) => t.subscription_status === "active" && t.subscription_plan)
    .reduce((sum, t) => sum + (PLAN_PRICES_MXN[t.subscription_plan!] ?? 0), 0);
  const activos = (rows ?? []).filter((t) => t.subscription_status === "active").length;
  const trial = (rows ?? []).filter((t) => t.subscription_status === "trial").length;
  const aiOps = (rows ?? []).reduce((s, t) => s + (t.ai_ops_used ?? 0), 0);
  const recent = (rows ?? []).slice(0, 5);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Resumen general de la plataforma.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="MRR"
          value={formatMXN(mrr)}
          icon={<DollarSign className="h-4 w-4" />}
          tone="bg-emerald-50 text-emerald-700"
          loading={rows === null}
        />
        <Metric
          label="Tenants activos"
          value={String(activos)}
          icon={<Building2 className="h-4 w-4" />}
          tone="bg-sky-50 text-sky-700"
          loading={rows === null}
        />
        <Metric
          label="En trial"
          value={String(trial)}
          icon={<FlaskConical className="h-4 w-4" />}
          tone="bg-amber-50 text-amber-700"
          loading={rows === null}
        />
        <Metric
          label="AI ops este mes"
          value={aiOps.toLocaleString("es-MX")}
          icon={<Sparkles className="h-4 w-4" />}
          tone="bg-violet-50 text-violet-700"
          loading={rows === null}
        />
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-foreground">Tenants recientes</h2>
          <Link to="/admin/tenants" className="text-xs text-primary hover:underline">
            Ver todos
          </Link>
        </div>
        {rows === null ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">Cargando…</div>
        ) : recent.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            Aún no hay tenants. <Link to="/admin/tenants/new" className="text-primary hover:underline">Crear el primero</Link>.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <Link
                    to="/admin/tenants/$id"
                    params={{ id: t.id }}
                    className="text-sm font-medium text-foreground hover:underline"
                  >
                    {t.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {t.subscription_plan
                      ? PLAN_LABELS[t.subscription_plan]
                      : "Sin plan"}
                    {" · "}
                    Creado el{" "}
                    {new Date(t.created_at).toLocaleDateString("es-MX")}
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_TONES[t.subscription_status]}`}
                >
                  {STATUS_LABELS[t.subscription_status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  tone,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={`flex h-7 w-7 items-center justify-center rounded-md ${tone}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3 text-2xl font-semibold text-foreground">
        {loading ? "—" : value}
      </div>
    </div>
  );
}