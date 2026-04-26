import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, UserCog, UserMinus, UserCheck } from "lucide-react";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import {
  inviteUserToTenant,
  updateMemberRole,
  deactivateMember,
  reactivateMember,
  listTenantMembers,
} from "@/utils/tenant-admin.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/app/equipo")({
  component: EquipoPage,
});

const ROLE_OPTIONS = [
  { value: "gerente", label: "👔 Gerente", help: "Acceso completo excepto gestión de usuarios." },
  { value: "vendedor", label: "💰 Vendedor", help: "Solo registra ventas y consulta productos." },
  { value: "almacenista", label: "📦 Almacenista", help: "Maneja inventario y entradas." },
  { value: "cajero", label: "💳 Cajero", help: "Solo registra ventas." },
] as const;

type Member = {
  user_id: string;
  role: string;
  is_active: boolean;
  email: string;
  full_name: string | null;
  last_sign_in_at: string | null;
  created_at: string;
};

function EquipoPage() {
  const { currentTenantId, currentMembership, memberships, user } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role ?? null;

  const listFn = useServerFn(listTenantMembers);
  const inviteFn = useServerFn(inviteUserToTenant);
  const updateRoleFn = useServerFn(updateMemberRole);
  const deactivateFn = useServerFn(deactivateMember);
  const reactivateFn = useServerFn(reactivateMember);

  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleEdit, setRoleEdit] = useState<Member | null>(null);
  const [deactivate, setDeactivate] = useState<Member | null>(null);
  const [reactivate, setReactivate] = useState<Member | null>(null);

  useEffect(() => {
    if (role !== "tenant_owner") return;
    if (!tenantId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, role]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await listFn({ data: { tenantId } });
      setMembers(res.members as Member[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar el equipo");
    } finally {
      setLoading(false);
    }
  };

  if (role !== "tenant_owner") {
    return (
      <div className="rounded-md border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold">Acceso restringido</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Solo el propietario de la empresa puede gestionar el equipo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Equipo</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona los usuarios de tu empresa.
          </p>
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Invitar usuario
        </button>
      </div>

      <div className="rounded-md border border-border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !members || members.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Solo estás tú. Invita a tu equipo para empezar.
            </p>
            <button
              onClick={() => setInviteOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" /> Invitar primer usuario
            </button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Usuario</th>
                    <th className="px-4 py-2">Rol</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2">Último acceso</th>
                    <th className="px-4 py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <MemberRow
                      key={m.user_id}
                      member={m}
                      isSelf={m.user_id === user?.id}
                      onChangeRole={() => setRoleEdit(m)}
                      onDeactivate={() => setDeactivate(m)}
                      onReactivate={() => setReactivate(m)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="space-y-2 p-3 md:hidden">
              {members.map((m) => (
                <MemberCard
                  key={m.user_id}
                  member={m}
                  isSelf={m.user_id === user?.id}
                  onChangeRole={() => setRoleEdit(m)}
                  onDeactivate={() => setDeactivate(m)}
                  onReactivate={() => setReactivate(m)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <InviteModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSubmit={async (email, fullName, roleVal) => {
          if (!tenantId) return;
          try {
            const res = await inviteFn({
              data: { tenantId, email, fullName: fullName || undefined, role: roleVal as "gerente" | "vendedor" | "almacenista" | "cajero" },
            });
            toast.success(
              res.alreadyExisted
                ? `${email} ya tenía cuenta. Acceso agregado.`
                : `Invitación enviada a ${email}`,
            );
            setInviteOpen(false);
            void load();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error al invitar");
          }
        }}
      />

      <RoleEditModal
        member={roleEdit}
        onOpenChange={(o) => !o && setRoleEdit(null)}
        onSubmit={async (newRole) => {
          if (!tenantId || !roleEdit) return;
          try {
            await updateRoleFn({
              data: {
                tenantId,
                userId: roleEdit.user_id,
                newRole: newRole as "gerente" | "vendedor" | "almacenista" | "cajero",
              },
            });
            toast.success("Rol actualizado");
            setRoleEdit(null);
            void load();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error al actualizar rol");
          }
        }}
      />

      <ConfirmDialog
        open={!!deactivate}
        onOpenChange={(o) => !o && setDeactivate(null)}
        title="Desactivar usuario"
        message={
          <>
            ¿Desactivar a{" "}
            <strong>{deactivate?.full_name || deactivate?.email}</strong>? Perderá
            acceso al sistema pero su historial se conserva. Puedes reactivarlo
            después.
          </>
        }
        confirmLabel="Desactivar"
        confirmVariant="danger"
        onConfirm={async () => {
          if (!tenantId || !deactivate) return;
          try {
            await deactivateFn({
              data: { tenantId, userId: deactivate.user_id },
            });
            toast.success("Usuario desactivado");
            void load();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error al desactivar");
          }
        }}
      />

      <ConfirmDialog
        open={!!reactivate}
        onOpenChange={(o) => !o && setReactivate(null)}
        title="Reactivar usuario"
        message={
          <>
            Volverás a dar acceso a{" "}
            <strong>{reactivate?.full_name || reactivate?.email}</strong>.
          </>
        }
        confirmLabel="Reactivar"
        onConfirm={async () => {
          if (!tenantId || !reactivate) return;
          try {
            await reactivateFn({
              data: { tenantId, userId: reactivate.user_id },
            });
            toast.success("Usuario reactivado");
            void load();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error al reactivar");
          }
        }}
      />
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  onChangeRole,
  onDeactivate,
  onReactivate,
}: {
  member: Member;
  isSelf: boolean;
  onChangeRole: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const isOwner = member.role === "tenant_owner";
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-3">
        <div className="font-medium">
          {member.full_name || member.email}
          {isSelf && (
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              tú
            </span>
          )}
        </div>
        {member.full_name && (
          <div className="text-xs text-muted-foreground">{member.email}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
          {ROLE_LABELS[member.role] ?? member.role}
        </span>
      </td>
      <td className="px-4 py-3">
        {member.is_active ? (
          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
            Activo
          </span>
        ) : (
          <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs text-rose-800">
            Inactivo
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
        {member.last_sign_in_at
          ? new Date(member.last_sign_in_at).toLocaleDateString("es-MX", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "—"}
      </td>
      <td className="px-4 py-3">
        {isSelf || isOwner ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex justify-end gap-1.5">
            <button
              onClick={onChangeRole}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
              title="Cambiar rol"
            >
              <UserCog className="h-3.5 w-3.5" /> Rol
            </button>
            {member.is_active ? (
              <button
                onClick={onDeactivate}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
              >
                <UserMinus className="h-3.5 w-3.5" /> Desactivar
              </button>
            ) : (
              <button
                onClick={onReactivate}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
              >
                <UserCheck className="h-3.5 w-3.5" /> Reactivar
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function MemberCard(props: {
  member: Member;
  isSelf: boolean;
  onChangeRole: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const { member, isSelf, onChangeRole, onDeactivate, onReactivate } = props;
  const isOwner = member.role === "tenant_owner";
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">
            {member.full_name || member.email}
            {isSelf && (
              <span className="ml-2 text-[10px] uppercase text-muted-foreground">(tú)</span>
            )}
          </div>
          {member.full_name && (
            <div className="text-xs text-muted-foreground">{member.email}</div>
          )}
        </div>
        {member.is_active ? (
          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
            Activo
          </span>
        ) : (
          <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] text-rose-800">
            Inactivo
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
          {ROLE_LABELS[member.role] ?? member.role}
        </span>
        {!isSelf && !isOwner && (
          <div className="flex gap-1.5">
            <button
              onClick={onChangeRole}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
            >
              Rol
            </button>
            {member.is_active ? (
              <button
                onClick={onDeactivate}
                className="rounded-md border border-border px-2 py-1 text-xs text-rose-700"
              >
                Desactivar
              </button>
            ) : (
              <button
                onClick={onReactivate}
                className="rounded-md border border-border px-2 py-1 text-xs text-emerald-700"
              >
                Reactivar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InviteModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (email: string, fullName: string, role: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleVal, setRoleVal] = useState<string>("vendedor");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setFullName("");
      setRoleVal("vendedor");
    }
  }, [open]);

  const submit = async () => {
    if (!email.trim()) {
      toast.error("Escribe un correo válido");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(email.trim(), fullName.trim(), roleVal);
    } finally {
      setBusy(false);
    }
  };

  const helpText = ROLE_OPTIONS.find((r) => r.value === roleVal)?.help;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitar usuario</DialogTitle>
          <DialogDescription>
            Recibirá un correo para crear su contraseña.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Correo electrónico *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="usuario@empresa.com"
            />
          </div>
          <div>
            <label className="text-xs font-medium">Nombre completo (opcional)</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium">Rol</label>
            <select
              value={roleVal}
              onChange={(e) => setRoleVal(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {helpText && (
              <p className="mt-1 text-xs text-muted-foreground">{helpText}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Enviando…" : "Enviar invitación"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleEditModal({
  member,
  onOpenChange,
  onSubmit,
}: {
  member: Member | null;
  onOpenChange: (o: boolean) => void;
  onSubmit: (role: string) => Promise<void>;
}) {
  const [val, setVal] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (member) setVal(member.role);
  }, [member]);

  const submit = async () => {
    if (!val) return;
    setBusy(true);
    try {
      await onSubmit(val);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar rol</DialogTitle>
          <DialogDescription>
            {member?.full_name || member?.email} — rol actual:{" "}
            <strong>{ROLE_LABELS[member?.role ?? ""] ?? member?.role}</strong>
          </DialogDescription>
        </DialogHeader>
        <div>
          <label className="text-xs font-medium">Nuevo rol</label>
          <select
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={busy || !val || val === member?.role}
            onClick={() => void submit()}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Guardar cambio"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
