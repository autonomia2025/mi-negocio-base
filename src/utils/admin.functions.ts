import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertSuperAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_tenants")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .eq("is_active", true)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("No autorizado");
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(error.message);
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const CreateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug inválido"),
  business_type: z.string().trim().max(120).optional().nullable(),
  subscription_plan: z.enum(["basico", "profesional", "empresarial"]),
  subscription_status: z.enum(["trial", "active"]),
  trial_ends_at: z.string().datetime().nullable().optional(),
  ai_ops_limit: z.number().int().min(0).max(1_000_000),
  owner: z.object({
    email: z.string().trim().email().max(255),
    full_name: z.string().trim().min(2).max(160),
    phone: z.string().trim().max(40).optional().nullable(),
    password: z.string().min(10).max(200),
  }),
});

export const createTenantWithOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateTenantSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);

    // Slug uniqueness pre-check (DB still enforces it)
    const { data: existing } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", data.slug)
      .limit(1);
    if (existing && existing.length > 0) {
      throw new Error("El slug ya está en uso");
    }

    // Create or reuse the auth user
    let ownerUserId: string | null = null;
    const { data: created, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email: data.owner.email,
        password: data.owner.password,
        email_confirm: true,
        user_metadata: {
          full_name: data.owner.full_name,
          phone: data.owner.phone ?? null,
        },
      });
    if (createErr) {
      // If already exists, look it up
      const msg = createErr.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered")) {
        const { data: list, error: listErr } =
          await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        if (listErr) throw new Error(listErr.message);
        const found = list.users.find(
          (u) => u.email?.toLowerCase() === data.owner.email.toLowerCase(),
        );
        if (!found)
          throw new Error("No se pudo crear ni localizar el usuario");
        ownerUserId = found.id;
      } else {
        throw new Error(createErr.message);
      }
    } else {
      ownerUserId = created.user?.id ?? null;
    }
    if (!ownerUserId) throw new Error("No se obtuvo el id del usuario");

    // Create tenant
    const { data: tenant, error: tErr } = await supabaseAdmin
      .from("tenants")
      .insert({
        name: data.name,
        slug: data.slug,
        business_type: data.business_type ?? null,
        subscription_plan: data.subscription_plan,
        subscription_status: data.subscription_status,
        trial_ends_at: data.trial_ends_at ?? null,
        ai_ops_limit: data.ai_ops_limit,
      })
      .select("id")
      .single();
    if (tErr || !tenant) throw new Error(tErr?.message ?? "Error creando tenant");

    // Link owner
    const { error: utErr } = await supabaseAdmin.from("user_tenants").insert({
      user_id: ownerUserId,
      tenant_id: tenant.id,
      role: "tenant_owner",
      is_active: true,
      invited_by: context.userId,
    });
    if (utErr) throw new Error(utErr.message);

    // Audit
    await supabaseAdmin.from("audit_log").insert({
      tenant_id: tenant.id,
      user_id: context.userId,
      action: "tenant.created",
      entity_type: "tenant",
      entity_id: tenant.id,
      changes: {
        name: data.name,
        slug: data.slug,
        plan: data.subscription_plan,
        status: data.subscription_status,
        owner_email: data.owner.email,
      } as never,
    });
    await supabaseAdmin.from("audit_log").insert({
      tenant_id: tenant.id,
      user_id: context.userId,
      action: "user.invited",
      entity_type: "user",
      entity_id: ownerUserId,
      changes: { role: "tenant_owner", email: data.owner.email } as never,
    });

    return { tenantId: tenant.id, ownerUserId };
  });

const InviteUserSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().email().max(255),
  full_name: z.string().trim().min(2).max(160),
  role: z.enum([
    "tenant_owner",
    "gerente",
    "vendedor",
    "almacenista",
    "cajero",
    "implementer",
  ]),
  password: z.string().min(10).max(200),
});

export const inviteUserToTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InviteUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);

    let userId: string | null = null;
    const { data: created, error: cErr } =
      await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: data.full_name },
      });
    if (cErr) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      const found = list?.users.find(
        (u) => u.email?.toLowerCase() === data.email.toLowerCase(),
      );
      if (!found) throw new Error(cErr.message);
      userId = found.id;
    } else {
      userId = created.user?.id ?? null;
    }
    if (!userId) throw new Error("No se obtuvo el id del usuario");

    const { error: utErr } = await supabaseAdmin
      .from("user_tenants")
      .upsert(
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
      action: "user.invited",
      entity_type: "user",
      entity_id: userId,
      changes: { email: data.email, role: data.role } as never,
    });

    return { userId };
  });

export const listAllUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 500,
    });
    if (error) throw new Error(error.message);

    const { data: memberships } = await supabaseAdmin
      .from("user_tenants")
      .select("user_id, role, is_active, tenant_id, tenants(id, name)");

    const byUser = new Map<
      string,
      Array<{ tenant_id: string; tenant_name: string; role: string; is_active: boolean }>
    >();
    for (const m of memberships ?? []) {
      const arr = byUser.get(m.user_id) ?? [];
      arr.push({
        tenant_id: m.tenant_id,
        tenant_name: (m as { tenants: { name: string } | null }).tenants?.name ?? "—",
        role: m.role,
        is_active: m.is_active,
      });
      byUser.set(m.user_id, arr);
    }

    return {
      users: list.users.map((u) => ({
        id: u.id,
        email: u.email ?? "",
        full_name:
          (u.user_metadata as { full_name?: string } | null)?.full_name ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        memberships: byUser.get(u.id) ?? [],
      })),
    };
  });

export const setUserActiveInTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      userId: z.string().uuid(),
      tenantId: z.string().uuid(),
      isActive: z.boolean(),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("user_tenants")
      .update({ is_active: data.isActive })
      .eq("user_id", data.userId)
      .eq("tenant_id", data.tenantId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_log").insert({
      tenant_id: data.tenantId,
      user_id: context.userId,
      action: data.isActive ? "user.activated" : "user.deactivated",
      entity_type: "user",
      entity_id: data.userId,
    });
    return { ok: true };
  });

export const getTenantOwners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    try {
      const { data, error } = await supabaseAdmin
        .from("user_tenants")
        .select("tenant_id, user_id, role")
        .eq("role", "tenant_owner")
        .eq("is_active", true);
      if (error) throw new Error(error.message);

      const userIds = Array.from(new Set((data ?? []).map((r) => r.user_id)));
      const emails = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 500,
        });
        for (const u of list?.users ?? []) {
          emails.set(u.id, u.email ?? "");
        }
      }

      const ownersByTenant: Record<string, { user_id: string; email: string }[]> = {};
      for (const r of data ?? []) {
        const arr = ownersByTenant[r.tenant_id] ?? [];
        arr.push({ user_id: r.user_id, email: emails.get(r.user_id) ?? "" });
        ownersByTenant[r.tenant_id] = arr;
      }
      return { ownersByTenant };
    } catch (e) {
      console.error("getTenantOwners failed:", e);
      return {
        ownersByTenant: {} as Record<string, { user_id: string; email: string }[]>,
        warning: "No se pudieron cargar los dueños",
      };
    }
  });

export const getTenantMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ tenantId: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
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
    if (userIds.length > 0) {
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
        ...(meta.get(r.user_id) ?? { email: "", full_name: null, last_sign_in_at: null }),
      })),
    };
  });