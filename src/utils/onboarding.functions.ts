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
