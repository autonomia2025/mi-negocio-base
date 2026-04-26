import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PLAN_LABELS,
  PLAN_PRICES_MXN,
  STATUS_LABELS,
  STATUS_TONES,
  formatMXN,
  generatePassword,
  logAudit,
} from "@/lib/admin-utils";
import { ROLE_LABELS } from "@/lib/auth-context";
import {
  getTenantMembers,
  inviteUserToTenant,
  setUserActiveInTenant,
} from "@/utils/admin.functions";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";

export const Route = createFileRoute("/admin/tenants/$id")({
  component: TenantDetail,
});

type Tenant = {
  id: string;
  name: string;
  slug: string;
  business_type: string | null;
  subscription_plan: string | null;
  subscription_status: string;
  trial_ends_at: string | null;
  ai_ops_limit: number;
  ai_ops_used: number;
  ai_cycle_start: string;
  created_at: string;
};

type Member = {
  user_id: string;
  role: string;
  is_active: boolean;
  email: string;
  full_name: string | null;
  last_sign_in_at: string | null;
  created_at: string;
};

type AuditEntry = {
  id: string;
  action: string;
  user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
};

const TABS = [
  { id: "general", label: "General" },
  { id: "users", label: "Usuarios" },
  { id: "ai", label: "Uso de IA" },
  { id: "activity", label: "Actividad" },
  { id: "settings", label: "Configuración" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function TenantDetail() {
  const { id } = Route.useParams();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tab, setTab] = useState<TabId>("general");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!id || id === "undefined") return;
    const { data, error } = await supabase
      .from("tenants")
      .select(
        "id, name, slug, business_type, subscription_plan, subscription_status, trial_ends_at, ai_ops_limit, ai_ops_used, ai_cycle_start, created_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) setError(error.message);
    else setTenant(data as Tenant | null);
  };

  useEffect(() => {
    void load();
  }, [id]);

  if (!id || id === "undefined") {
    return (
      <div className="space-y-3">
        <Link
          to="/admin/tenants"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Volver a tenants
        </Link>
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive">
          ID de tenant inválido. Vuelve al listado y selecciona un tenant válido.
        </div>
      </div>
    );
  }

  if (error)
    return <div className="text-sm text-destructive">{error}</div>;
  if (!tenant)
    return <div className="text-sm text-muted-foreground">Cargando…</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/tenants" className="text-xs text-muted-foreground hover:text-foreground">
          ← Volver a tenants
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {tenant.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{tenant.slug}</span>
              <span>·</span>
              <span>
                {tenant.subscription_plan
                  ? PLAN_LABELS[tenant.subscription_plan]
                  : "Sin plan"}
              </span>
              <span>·</span>
              <span
                className={`inline-block rounded-full border px-2 py-0.5 ${STATUS_TONES[tenant.subscription_status]}`}
              >
                {STATUS_LABELS[tenant.subscription_status]}
              </span>
            </div>
          </div>
          <ImpersonateButton tenantId={tenant.id} tenantName={tenant.name} variant="primary" />
        </div>
      </div>

      <div className="border-b border-border">
        <nav className="flex flex-wrap gap-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-1 py-2 text-sm ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "general" && <GeneralTab tenant={tenant} onSaved={load} />}
      {tab === "users" && <UsersTab tenantId={tenant.id} />}
      {tab === "ai" && <AITab tenant={tenant} />}
      {tab === "activity" && <ActivityTab tenantId={tenant.id} />}
      {tab === "settings" && <SettingsTab tenant={tenant} onSaved={load} />}
    </div>
  );
}

function GeneralTab({
  tenant,
  onSaved,
}: {
  tenant: Tenant;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(tenant.name);
  const [businessType, setBusinessType] = useState(tenant.business_type ?? "");
  const [plan, setPlan] = useState(tenant.subscription_plan ?? "");
  const [status, setStatus] = useState(tenant.subscription_status);
  const [trial, setTrial] = useState<string>(
    tenant.trial_ends_at ? tenant.trial_ends_at.slice(0, 10) : "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const payload = {
      name: name.trim(),
      business_type: businessType.trim() || null,
      subscription_plan: plan || null,
      subscription_status: status,
      trial_ends_at:
        status === "trial" && trial
          ? new Date(trial + "T23:59:59Z").toISOString()
          : null,
    };
    const { error } = await supabase.from("tenants").update(payload).eq("id", tenant.id);
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    await logAudit({
      tenantId: tenant.id,
      action: "tenant.updated",
      entityType: "tenant",
      entityId: tenant.id,
      changes: payload as never,
    });
    setMsg("Cambios guardados");
    await onSaved();
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6 max-w-2xl">
      <Row label="Nombre">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </Row>
      <Row label="Tipo de negocio">
        <input
          value={businessType}
          onChange={(e) => setBusinessType(e.target.value)}
          maxLength={120}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </Row>
      <Row label="Plan">
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Sin plan</option>
          <option value="basico">Básico</option>
          <option value="profesional">Profesional</option>
          <option value="empresarial">Empresarial</option>
        </select>
      </Row>
      <Row label="Estado">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="trial">Prueba</option>
          <option value="active">Activo</option>
          <option value="suspended">Suspendido</option>
          <option value="cancelled">Cancelado</option>
        </select>
      </Row>
      {status === "trial" && (
        <Row label="Fin del trial">
          <input
            type="date"
            value={trial}
            onChange={(e) => setTrial(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Row>
      )}
      <Row label="MRR">
        <div className="text-sm text-foreground">
          {formatMXN(
            status === "active" && plan ? PLAN_PRICES_MXN[plan] ?? 0 : 0,
          )}
        </div>
      </Row>
      {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      <div className="pt-2">
        <button
          disabled={busy}
          onClick={() => void save()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

function UsersTab({ tenantId }: { tenantId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const load = async () => {
    try {
      const r = await getTenantMembers({ data: { tenantId } });
      setMembers(r.members as Member[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  };
  useEffect(() => {
    void load();
  }, [tenantId]);

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <h2 className="text-base font-medium text-foreground">Usuarios del tenant</h2>
        <button
          onClick={() => setShowInvite(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Invitar usuario
        </button>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Usuario</th>
              <th className="px-4 py-2.5 font-medium">Rol</th>
              <th className="px-4 py-2.5 font-medium">Estado</th>
              <th className="px-4 py-2.5 font-medium">Último acceso</th>
              <th className="px-4 py-2.5 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Sin usuarios.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.user_id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {m.full_name ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {ROLE_LABELS[m.role] ?? m.role}
                  </td>
                  <td className="px-4 py-3">
                    {m.is_active ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                        Activo
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {m.last_sign_in_at
                      ? new Date(m.last_sign_in_at).toLocaleString("es-MX")
                      : "Nunca"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={async () => {
                        await setUserActiveInTenant({
                          data: {
                            userId: m.user_id,
                            tenantId,
                            isActive: !m.is_active,
                          },
                        });
                        await load();
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {m.is_active ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {showInvite && (
        <InviteModal
          tenantId={tenantId}
          onClose={() => setShowInvite(false)}
          onInvited={async () => {
            setShowInvite(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function InviteModal({
  tenantId,
  onClose,
  onInvited,
}: {
  tenantId: string;
  onClose: () => void;
  onInvited: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("vendedor");
  const [password, setPassword] = useState(() => generatePassword(16));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await inviteUserToTenant({
        data: {
          tenantId,
          email: email.trim(),
          full_name: name.trim(),
          role: role as "tenant_owner" | "gerente" | "vendedor" | "almacenista" | "cajero" | "implementer",
          password,
        },
      });
      await onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-lg border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">Invitar usuario</h3>
        <Row label="Correo">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={255}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Row>
        <Row label="Nombre completo">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Row>
        <Row label="Rol">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="tenant_owner">Propietario</option>
            <option value="gerente">Gerente</option>
            <option value="vendedor">Vendedor</option>
            <option value="almacenista">Almacenista</option>
            <option value="cajero">Cajero</option>
            <option value="implementer">Implementador</option>
          </select>
        </Row>
        <Row label="Contraseña">
          <div className="flex gap-2">
            <input
              readOnly
              value={password}
              className="flex-1 rounded-md border border-input bg-muted px-3 py-2 text-sm font-mono"
            />
            <button
              onClick={() => setPassword(generatePassword(16))}
              className="rounded-md border border-input bg-background px-3 text-xs hover:bg-accent"
            >
              Regenerar
            </button>
          </div>
        </Row>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            disabled={busy}
            onClick={onClose}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Invitando…" : "Invitar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AITab({ tenant }: { tenant: Tenant }) {
  const [aiQuota, setAiQuota] = useState<{
    limit_monthly: number;
    used_current_month: number;
    reset_date: string;
  } | null>(null);
  const [editLimit, setEditLimit] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ingestions, setIngestions] = useState<
    Array<{
      id: string;
      created_at: string;
      mode: string;
      intent: string;
      status: string;
      cost_usd: number | null;
      user_id: string;
    }>
  >([]);

  const loadQuota = async () => {
    const { data } = await supabase
      .from("tenants")
      .select("settings")
      .eq("id", tenant.id)
      .maybeSingle();
    const settings = (data?.settings ?? {}) as { ai?: { limit_monthly?: number; used_current_month?: number; reset_date?: string } };
    const ai = settings.ai ?? {};
    const q = {
      limit_monthly: Number(ai.limit_monthly ?? 500),
      used_current_month: Number(ai.used_current_month ?? 0),
      reset_date: String(ai.reset_date ?? ""),
    };
    setAiQuota(q);
    setEditLimit(q.limit_monthly);
  };

  useEffect(() => {
    void loadQuota();
    void supabase
      .from("ai_ingestions")
      .select("id, created_at, mode, intent, status, cost_usd, user_id")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setIngestions((data ?? []) as never));
  }, [tenant.id]);

  const saveLimit = async () => {
    if (!aiQuota) return;
    setBusy(true);
    setMsg(null);
    const newAi = {
      limit_monthly: editLimit,
      used_current_month: aiQuota.used_current_month,
      reset_date: aiQuota.reset_date,
    };
    // Read settings, merge ai, write back
    const { data: cur } = await supabase
      .from("tenants")
      .select("settings")
      .eq("id", tenant.id)
      .maybeSingle();
    const curSettings = (cur?.settings ?? {}) as Record<string, unknown>;
    const settings = { ...curSettings, ai: newAi } as never;
    const { error } = await supabase
      .from("tenants")
      .update({ settings })
      .eq("id", tenant.id);
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    await logAudit({
      tenantId: tenant.id,
      action: "tenant.ai_monthly_limit_updated",
      entityType: "tenant",
      entityId: tenant.id,
      changes: { from: aiQuota.limit_monthly, to: editLimit },
    });
    setMsg("Límite actualizado");
    await loadQuota();
  };

  const pct = aiQuota && aiQuota.limit_monthly > 0
    ? Math.min(100, Math.round((aiQuota.used_current_month / aiQuota.limit_monthly) * 100))
    : 0;

  const modeIcon: Record<string, string> = { photo: "📸", audio: "🎤", text: "💬" };
  const intentIcon: Record<string, string> = {
    inventory_in: "📦",
    inventory_out: "📤",
    sale: "💰",
    catalog: "➕",
    unknown: "❓",
  };
  const statusTone: Record<string, string> = {
    pending: "border-amber-300 bg-amber-50 text-amber-800",
    confirmed: "border-emerald-300 bg-emerald-50 text-emerald-800",
    discarded: "border-slate-300 bg-slate-100 text-slate-700",
    failed: "border-rose-300 bg-rose-50 text-rose-800",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Consumo de IA este mes
            </div>
            <div className="mt-1 text-2xl font-semibold text-foreground">
              {aiQuota?.used_current_month.toLocaleString("es-MX") ?? "—"}{" "}
              <span className="text-base font-normal text-muted-foreground">
                / {aiQuota?.limit_monthly.toLocaleString("es-MX") ?? "—"}
              </span>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">{pct}%</div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {aiQuota?.reset_date && (
          <div className="mt-3 text-xs text-muted-foreground">
            Próximo reset: {aiQuota.reset_date}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h3 className="text-sm font-medium text-foreground">Configuración IA</h3>
        <Row label="Límite mensual de operaciones">
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={editLimit}
              onChange={(e) => setEditLimit(parseInt(e.target.value || "0", 10))}
              className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              disabled={busy}
              onClick={() => void saveLimit()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              Guardar
            </button>
          </div>
        </Row>
        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Últimas 10 ingestas</h3>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Fecha</th>
                <th className="px-4 py-2.5 font-medium">Modo</th>
                <th className="px-4 py-2.5 font-medium">Intent</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Costo (USD)</th>
                <th className="px-4 py-2.5 font-medium">Usuario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ingestions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Sin ingestas todavía.
                  </td>
                </tr>
              ) : (
                ingestions.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("es-MX")}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {modeIcon[r.mode] ?? "?"} {r.mode}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {intentIcon[r.intent] ?? ""} {r.intent}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${statusTone[r.status] ?? ""}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-foreground">
                      ${(r.cost_usd ?? 0).toFixed(4)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {r.user_id.slice(0, 8)}…
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ActivityTab({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, action, user_id, entity_type, entity_id, changes, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) setError(error.message);
      else setRows(data as AuditEntry[]);
    })();
  }, [tenantId]);

  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (rows === null) return <div className="text-sm text-muted-foreground">Cargando…</div>;
  if (rows.length === 0)
    return (
      <div className="text-sm text-muted-foreground">Sin actividad registrada.</div>
    );

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Fecha</th>
            <th className="px-4 py-2.5 font-medium">Acción</th>
            <th className="px-4 py-2.5 font-medium">Entidad</th>
            <th className="px-4 py-2.5 font-medium">Detalles</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                {new Date(r.created_at).toLocaleString("es-MX")}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-foreground">
                {r.action}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                {r.entity_type ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[400px] truncate">
                {r.changes ? JSON.stringify(r.changes) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsTab({
  tenant,
  onSaved,
}: {
  tenant: Tenant;
  onSaved: () => Promise<void>;
}) {
  const [limit, setLimit] = useState<number>(tenant.ai_ops_limit);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const saveLimit = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase
      .from("tenants")
      .update({ ai_ops_limit: limit })
      .eq("id", tenant.id);
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    await logAudit({
      tenantId: tenant.id,
      action: "tenant.ai_limit_updated",
      entityType: "tenant",
      entityId: tenant.id,
      changes: { from: tenant.ai_ops_limit, to: limit },
    });
    setMsg("Límite actualizado");
    await onSaved();
  };

  const resetCycle = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase
      .from("tenants")
      .update({ ai_ops_used: 0, ai_cycle_start: new Date().toISOString() })
      .eq("id", tenant.id);
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    await logAudit({
      tenantId: tenant.id,
      action: "tenant.ai_cycle_reset",
      entityType: "tenant",
      entityId: tenant.id,
    });
    setMsg("Ciclo de IA reiniciado");
    await onSaved();
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h3 className="text-sm font-medium text-foreground">Límite de AI ops</h3>
        <p className="text-xs text-muted-foreground">
          Útil para casos de overage o ajustes manuales.
        </p>
        <input
          type="number"
          min={0}
          value={limit}
          onChange={(e) => setLimit(parseInt(e.target.value || "0", 10))}
          className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div>
          <button
            disabled={busy}
            onClick={() => void saveLimit()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            Guardar
          </button>
        </div>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h3 className="text-sm font-medium text-foreground">Reiniciar ciclo de IA</h3>
        <p className="text-xs text-muted-foreground">
          Restablece el contador de uso y marca el inicio de un nuevo ciclo.
        </p>
        <button
          disabled={busy}
          onClick={() => void resetCycle()}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
        >
          Reiniciar ahora
        </button>
      </div>
      {msg && <div className="md:col-span-2 text-sm text-muted-foreground">{msg}</div>}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}