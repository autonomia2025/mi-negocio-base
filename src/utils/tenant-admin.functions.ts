import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TENANT_ADMIN_ROLES = ["tenant_owner"];
const AUDIT_VIEWER_ROLES = ["tenant_owner", "gerente"];
const ASSIGNABLE_ROLES = ["gerente", "vendedor", "almacenista", "cajero"] as const;

async function isSuperAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_tenants")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .eq("is_active", true)
    .limit(1);
  return !!(data && data.length);
}

async function getRoleInTenant(userId: string, tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_tenants")
    .select("role, is_active")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  return data?.role ?? null;
}

async function assertTenantOwner(callerId: string, tenantId: string) {
  if (await isSuperAdmin(callerId)) return;
  const role = await getRoleInTenant(callerId, tenantId);
  if (!role || !TENANT_ADMIN_ROLES.includes(role)) {
    throw new Error("No autorizado");
  }
}

async function assertCanViewAudit(callerId: string, tenantId: string) {
  if (await isSuperAdmin(callerId)) return;
  const role = await getRoleInTenant(callerId, tenantId);
  if (!role || !AUDIT_VIEWER_ROLES.includes(role)) {
    throw new Error("No autorizado");
  }
}

async function findUserByEmail(email: string) {
  // Paginate through up to ~2000 users
  for (let page = 1; page <= 4; page++) {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 500 });
    const found = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (!data?.users.length || data.users.length < 500) break;
  }
  return null;
}

// ─── inviteUserToTenant ──────────────────────────────────────────────────────
const InviteSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().email("Escribe un correo válido").max(255),
  role: z.enum(ASSIGNABLE_ROLES),
  fullName: z.string().trim().min(2).max(160).optional(),
});

export const inviteUserToTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertTenantOwner(context.userId, data.tenantId);

    const origin = process.env.PUBLIC_APP_URL || process.env.SITE_URL || "";
    const redirectTo = origin
      ? `${origin.replace(/\/$/, "")}/accept-invitation`
      : undefined;

    let userId: string | null = null;
    let alreadyExisted = false;

    const existing = await findUserByEmail(data.email);
    if (existing) {
      userId = existing.id;
      alreadyExisted = true;
    } else {
      const { data: invited, error: invErr } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
          data: {
            full_name: data.fullName ?? null,
            tenant_id: data.tenantId,
          },
          redirectTo,
        });
      if (invErr) {
        const msg = invErr.message?.toLowerCase() ?? "";
        if (msg.includes("already") || msg.includes("registered")) {
          const found = await findUserByEmail(data.email);
          if (!found) throw new Error(invErr.message);
          userId = found.id;
          alreadyExisted = true;
        } else {
          throw new Error(invErr.message);
        }
      } else {
        userId = invited.user?.id ?? null;
      }
    }
    if (!userId) throw new Error("No se obtuvo el id del usuario");

    const { error: utErr } = await supabaseAdmin.from("user_tenants").upsert(
      {
        user_id: userId,
        tenant_id: data.tenantId,
        role: data.role,
        is_active: true,
        invited_by: context.userId,
      },
      { onConflict: "user_id,tenant_id" },
    );
    if (utErr) throw new Error(utErr.message);

    await supabaseAdmin.from("audit_log").insert({
      tenant_id: data.tenantId,
      user_id: context.userId,
      action: "tenant_member.invited",
      entity_type: "user_tenant",
      entity_id: userId,
      changes: {
        email: data.email,
        role: data.role,
        invited_by: context.userId,
        already_existed: alreadyExisted,
      } as never,
    });

    return { ok: true, userId, alreadyExisted };
  });

// ─── updateMemberRole ────────────────────────────────────────────────────────
const UpdateRoleSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  newRole: z.enum(ASSIGNABLE_ROLES),
});

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertTenantOwner(context.userId, data.tenantId);
    if (data.userId === context.userId) {
      throw new Error("No puedes cambiar tu propio rol");
    }
    const { data: target } = await supabaseAdmin
      .from("user_tenants")
      .select("role")
      .eq("user_id", data.userId)
      .eq("tenant_id", data.tenantId)
      .maybeSingle();
    if (!target) throw new Error("Usuario no encontrado en esta empresa");
    if (target.role === "tenant_owner") {
      throw new Error("No puedes cambiar el rol de otro propietario");
    }

    const { error } = await supabaseAdmin
      .from("user_tenants")
      .update({ role: data.newRole })
      .eq("user_id", data.userId)
      .eq("tenant_id", data.tenantId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_log").insert({
      tenant_id: data.tenantId,
      user_id: context.userId,
      action: "tenant_member.role_changed",
      entity_type: "user_tenant",
      entity_id: data.userId,
      changes: { from: target.role, to: data.newRole } as never,
    });

    return { ok: true };
  });

// ─── deactivate / reactivate ────────────────────────────────────────────────
const ToggleSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
});

async function toggleMember(
  callerId: string,
  tenantId: string,
  userId: string,
  isActive: boolean,
) {
  if (userId === callerId) {
    throw new Error("No puedes desactivar tu propio acceso");
  }
  const { data: target } = await supabaseAdmin
    .from("user_tenants")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!target) throw new Error("Usuario no encontrado en esta empresa");
  if (target.role === "tenant_owner") {
    throw new Error("No puedes desactivar a otro propietario");
  }
  const { error } = await supabaseAdmin
    .from("user_tenants")
    .update({ is_active: isActive })
    .eq("user_id", userId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: callerId,
    action: isActive ? "tenant_member.reactivated" : "tenant_member.deactivated",
    entity_type: "user_tenant",
    entity_id: userId,
  });
}

export const deactivateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ToggleSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertTenantOwner(context.userId, data.tenantId);
    await toggleMember(context.userId, data.tenantId, data.userId, false);
    return { ok: true };
  });

export const reactivateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ToggleSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertTenantOwner(context.userId, data.tenantId);
    await toggleMember(context.userId, data.tenantId, data.userId, true);
    return { ok: true };
  });

// ─── listTenantMembers (with email/last_sign_in) ────────────────────────────
export const listTenantMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ tenantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCanViewAudit(context.userId, data.tenantId);
    const { data: rows, error } = await supabaseAdmin
      .from("user_tenants")
      .select("user_id, role, is_active, created_at")
      .eq("tenant_id", data.tenantId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const meta = new Map<
      string,
      { email: string; full_name: string | null; last_sign_in_at: string | null }
    >();
    if (userIds.length) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 500,
      });
      for (const u of list?.users ?? []) {
        if (userIds.includes(u.id)) {
          meta.set(u.id, {
            email: u.email ?? "",
            full_name:
              (u.user_metadata as { full_name?: string } | null)?.full_name ?? null,
            last_sign_in_at: u.last_sign_in_at ?? null,
          });
        }
      }
    }

    return {
      members: (rows ?? []).map((r) => ({
        user_id: r.user_id,
        role: r.role,
        is_active: r.is_active,
        created_at: r.created_at,
        email: meta.get(r.user_id)?.email ?? "",
        full_name: meta.get(r.user_id)?.full_name ?? null,
        last_sign_in_at: meta.get(r.user_id)?.last_sign_in_at ?? null,
      })),
    };
  });

// ─── updateTenantSettings ───────────────────────────────────────────────────
const SettingsPatch = z.object({
  business: z
    .object({
      razon_social: z.string().trim().max(160).optional(),
      rfc: z.string().trim().max(20).nullable().optional(),
      direccion_fiscal: z.string().trim().max(500).optional(),
      telefono: z.string().trim().max(40).optional(),
      correo_contacto: z.string().trim().email().max(255).optional().or(z.literal("")),
      sitio_web: z.string().trim().max(255).nullable().optional(),
      logo_url: z.string().trim().max(500).nullable().optional(),
      brand_color: z.string().trim().max(20).optional(),
    })
    .partial()
    .optional(),
  operations: z
    .object({
      moneda: z.enum(["MXN", "USD", "EUR"]).optional(),
      zona_horaria: z.string().trim().max(80).optional(),
      price_rounding: z.enum(["0.01", "0.05", "0.10", "1.00"]).optional(),
    })
    .partial()
    .optional(),
});

const UpdateTenantSchema = z.object({
  tenantId: z.string().uuid(),
  updates: z.object({
    name: z.string().trim().min(2, "Mínimo 2 caracteres").max(120).optional(),
    settings_patch: SettingsPatch.optional(),
  }),
});

function deepMerge<T extends Record<string, unknown>>(a: T, b: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof out[k] === "object" &&
      out[k] !== null &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export const updateTenantSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateTenantSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertTenantOwner(context.userId, data.tenantId);

    const { data: current, error: fErr } = await supabaseAdmin
      .from("tenants")
      .select("name, settings")
      .eq("id", data.tenantId)
      .single();
    if (fErr || !current) throw new Error(fErr?.message ?? "Tenant no encontrado");

    const patch: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};

    if (data.updates.name && data.updates.name !== current.name) {
      patch.name = data.updates.name;
      changed.name = { from: current.name, to: data.updates.name };
    }
    if (data.updates.settings_patch) {
      const merged = deepMerge(
        (current.settings as Record<string, unknown>) ?? {},
        data.updates.settings_patch as Record<string, unknown>,
      );
      patch.settings = merged;
      changed.settings_patch = data.updates.settings_patch;
    }

    if (Object.keys(patch).length === 0) {
      return { ok: true, noop: true };
    }

    const { error: uErr } = await supabaseAdmin
      .from("tenants")
      // The patch object is built dynamically from validated input; Supabase's
      // generated update() type rejects a generic Record<string, unknown> even
      // though the keys are guaranteed to be valid columns. Cast to `never` to
      // satisfy the typecheck without rewriting the dynamic-merge logic.
      .update(patch as never)
      .eq("id", data.tenantId);
    if (uErr) throw new Error(uErr.message);

    await supabaseAdmin.from("audit_log").insert({
      tenant_id: data.tenantId,
      user_id: context.userId,
      action: "tenant.settings_updated",
      entity_type: "tenant",
      entity_id: data.tenantId,
      changes: changed as never,
    });

    return { ok: true };
  });

// ─── fetchAuditLog ──────────────────────────────────────────────────────────
const AuditFilterSchema = z.object({
  tenantId: z.string().uuid(),
  filters: z
    .object({
      action: z.string().trim().max(80).optional(),
      entityType: z.string().trim().max(40).optional(),
      userId: z.string().uuid().optional(),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
    })
    .optional(),
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const fetchAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AuditFilterSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCanViewAudit(context.userId, data.tenantId);

    let q = supabaseAdmin
      .from("audit_log")
      .select("id, created_at, user_id, action, entity_type, entity_id, changes", {
        count: "exact",
      })
      .eq("tenant_id", data.tenantId);

    if (data.filters?.action) q = q.eq("action", data.filters.action);
    if (data.filters?.entityType) q = q.eq("entity_type", data.filters.entityType);
    if (data.filters?.userId) q = q.eq("user_id", data.filters.userId);
    if (data.filters?.fromDate) q = q.gte("created_at", data.filters.fromDate);
    if (data.filters?.toDate) q = q.lte("created_at", data.filters.toDate);

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    const { data: rows, error, count } = await q
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);

    const userIds = Array.from(
      new Set((rows ?? []).map((r) => r.user_id).filter(Boolean) as string[]),
    );
    const emails = new Map<string, string>();
    if (userIds.length) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 500,
      });
      for (const u of list?.users ?? []) {
        if (userIds.includes(u.id)) emails.set(u.id, u.email ?? "");
      }
    }

    return {
      rows: (rows ?? []).map((r) => ({
        ...r,
        user_email: r.user_id ? emails.get(r.user_id) ?? "" : "",
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });
