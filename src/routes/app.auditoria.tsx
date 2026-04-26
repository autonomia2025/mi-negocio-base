import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import {
  fetchAuditLog,
  listTenantMembers,
} from "@/utils/tenant-admin.functions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/auditoria")({
  component: AuditoriaPage,
});

const KNOWN_ACTIONS = [
  "tenant.created",
  "tenant.settings_updated",
  "tenant_member.invited",
  "tenant_member.role_changed",
  "tenant_member.deactivated",
  "tenant_member.reactivated",
  "user.invited",
  "user.activated",
  "user.deactivated",
  "sale.voided",
  "product.deleted",
];

type Row = {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changes: unknown;
};

function actionTone(action: string): string {
  if (/(deleted|voided|deactivated)$/.test(action))
    return "bg-rose-50 text-rose-800 border-rose-200";
  if (/(role_changed|settings_updated)$/.test(action))
    return "bg-amber-50 text-amber-800 border-amber-200";
  if (/(invited|created|activated|reactivated)$/.test(action))
    return "bg-blue-50 text-blue-800 border-blue-200";
  return "bg-muted text-foreground border-border";
}

function todayInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function AuditoriaPage() {
  const { currentTenantId, currentMembership, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role ?? null;

  const fetchFn = useServerFn(fetchAuditLog);
  const listMembersFn = useServerFn(listTenantMembers);

  const today = useMemo(() => new Date(), []);
  const monthAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const [from, setFrom] = useState(todayInputDate(monthAgo));
  const [to, setTo] = useState(todayInputDate(today));
  const [actionFilter, setActionFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Array<{ user_id: string; email: string; full_name: string | null }>>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const canView = role === "tenant_owner" || role === "gerente";

  useEffect(() => {
    if (!tenantId || !canView) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, canView, page, from, to, actionFilter, userFilter]);

  useEffect(() => {
    if (!tenantId || !canView) return;
    void listMembersFn({ data: { tenantId } }).then((res) => {
      setMembers(
        res.members.map((m) => ({
          user_id: m.user_id,
          email: m.email,
          full_name: m.full_name,
        })),
      );
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, canView]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : undefined;
      const toIso = to ? new Date(`${to}T23:59:59`).toISOString() : undefined;
      const res = await fetchFn({
        data: {
          tenantId,
          page,
          pageSize,
          filters: {
            action: actionFilter || undefined,
            userId: userFilter || undefined,
            fromDate: fromIso,
            toDate: toIso,
          },
        },
      });
      setRows(res.rows as Row[]);
      setTotal(res.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar la bitácora");
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const header = [
      "timestamp",
      "user_email",
      "action",
      "entity_type",
      "entity_id",
      "changes_json",
    ].join(",");
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = rows
      .map((r) =>
        [
          r.created_at,
          r.user_email,
          r.action,
          r.entity_type ?? "",
          r.entity_id ?? "",
          escape(JSON.stringify(r.changes ?? null)),
        ]
          .map(escape)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canView) {
    return (
      <div className="rounded-md border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold">Acceso restringido</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Solo el propietario y los gerentes pueden ver la auditoría.
        </p>
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Auditoría</h1>
          <p className="text-sm text-muted-foreground">
            Registro de actividad del sistema.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> Descargar CSV
        </button>
      </div>

      {/* Filters */}
      <div className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-4">
        <div>
          <label className="text-xs font-medium">Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium">Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium">Acción</label>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            {KNOWN_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium">Usuario</label>
          <select
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              setPage(1);
            }}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name || m.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Sin actividad en el periodo seleccionado.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Fecha/hora</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Acción</th>
                <th className="px-3 py-2">Entidad</th>
                <th className="px-3 py-2">Detalles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("es-MX")}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.user_email || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[11px] ${actionTone(r.action)}`}
                    >
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.entity_type ?? "—"}
                    {r.entity_id && (
                      <span className="block text-[10px] text-muted-foreground font-mono">
                        {r.entity_id.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.changes ? (
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === r.id ? null : r.id)
                        }
                        className="text-primary hover:underline"
                      >
                        {expandedId === r.id ? "Ocultar" : "Ver"}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {expandedId === r.id && (
                      <pre className="mt-2 max-w-md whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-[10px]">
                        {JSON.stringify(r.changes, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total === 0 ? "0 resultados" : `Página ${page} de ${pages} · ${total} eventos`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-50"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
          </button>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages || loading}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-50"
          >
            Siguiente <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
