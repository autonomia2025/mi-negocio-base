import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertCanInvite(callerId: string, tenantId: string) {
  // super_admin OR tenant_owner of the target tenant
  const { data: sa } = await supabaseAdmin
    .from("user_tenants")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "super_admin")
    .eq("is_active", true)
    .limit(1);
  if (sa && sa.length > 0) return;

  const { data: owner } = await supabaseAdmin
    .from("user_tenants")
    .select("role")
    .eq("user_id", callerId)
    .eq("tenant_id", tenantId)
    .eq("role", "tenant_owner")
    .eq("is_active", true)
    .limit(1);
  if (!owner || owner.length === 0) {
    throw new Error("No autorizado");
  }
}

const InviteSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().email().max(255),
  full_name: z.string().trim().min(2).max(160),
  role: z.enum(["gerente", "vendedor", "almacenista", "cajero"]),
});

const OnboardingSettingsPatch = z
  .object({
    onboarding_completed: z.boolean().optional(),
    onboarding_completed_at: z.string().nullable().optional(),
    onboarding_step: z.number().int().min(0).max(20).optional(),
    business: z
      .object({
        razon_social: z.string().trim().max(160).optional(),
        rfc: z.string().trim().max(20).nullable().optional(),
        direccion_fiscal: z.string().trim().max(500).optional(),
        telefono: z.string().trim().max(40).optional(),
        correo_contacto: z.string().trim().email().max(255).optional(),
        sitio_web: z.string().trim().max(255).nullable().optional(),
        logo_url: z.string().trim().max(500).nullable().optional(),
        catalog_description: z.string().trim().max(1000).optional(),
      })
      .partial()
      .optional(),
    operations: z
      .object({
        moneda: z.enum(["MXN", "USD", "EUR"]).optional(),
        usa_cfdi: z.boolean().optional(),
        punto_reorden_default: z.number().min(0).optional(),
        metodos_pago: z.array(z.string().trim().min(1).max(80)).optional(),
        zona_horaria: z.string().trim().max(80).optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

const SaveOnboardingSchema = z.object({
  tenantId: z.string().uuid(),
  patch: OnboardingSettingsPatch,
  nextStep: z.number().int().min(0).max(20),
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

export const saveOnboardingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveOnboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCanInvite(context.userId, data.tenantId);

    const { data: current, error: fetchErr } = await supabaseAdmin
      .from("tenants")
      .select("settings")
      .eq("id", data.tenantId)
      .single();
    if (fetchErr || !current) throw new Error(fetchErr?.message ?? "Tenant no encontrado");

    const settings = deepMerge(
      ((current.settings as Record<string, unknown>) ?? {}),
      { ...data.patch, onboarding_step: data.nextStep },
    );

    const { error: updateErr } = await supabaseAdmin
      .from("tenants")
      .update({ settings: settings as never })
      .eq("id", data.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    return { ok: true };
  });

export const inviteTenantUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCanInvite(context.userId, data.tenantId);

    // Determine redirect for the invitation email
    const origin =
      process.env.PUBLIC_APP_URL ||
      process.env.SITE_URL ||
      "";
    const redirectTo = origin
      ? `${origin.replace(/\/$/, "")}/accept-invitation`
      : undefined;

    let userId: string | null = null;

    const { data: invited, error: invErr } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
        data: { full_name: data.full_name, tenant_id: data.tenantId },
        redirectTo,
      });

    if (invErr) {
      const msg = invErr.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered")) {
        const { data: list, error: listErr } =
          await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
        if (listErr) throw new Error(listErr.message);
        const found = list.users.find(
          (u) => u.email?.toLowerCase() === data.email.toLowerCase(),
        );
        if (!found) throw new Error(invErr.message);
        userId = found.id;
      } else {
        throw new Error(invErr.message);
      }
    } else {
      userId = invited.user?.id ?? null;
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
      changes: { email: data.email, role: data.role, full_name: data.full_name } as never,
    });

    return { userId, invited: true };
  });
