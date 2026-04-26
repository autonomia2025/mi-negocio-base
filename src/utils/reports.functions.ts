import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertManagerOrSuper(userId: string, tenantId: string) {
  // super_admin?
  const { data: sa } = await supabaseAdmin
    .from("user_tenants")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .eq("is_active", true)
    .limit(1);
  if (sa && sa.length > 0) return;

  const { data, error } = await supabaseAdmin
    .from("user_tenants")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !["tenant_owner", "gerente"].includes(data.role)) {
    throw new Error("No autorizado");
  }
}

/**
 * Returns members of a tenant who can register sales (vendedor, cajero,
 * tenant_owner, gerente). Used by managers to filter cash reconciliation by
 * seller. Visible only to tenant_owner / gerente / super_admin.
 */
export const listSalesUsersInTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ tenantId: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    await assertManagerOrSuper(context.userId, data.tenantId);

    const { data: rows, error } = await supabaseAdmin
      .from("user_tenants")
      .select("user_id, role, is_active")
      .eq("tenant_id", data.tenantId)
      .eq("is_active", true)
      .in("role", ["tenant_owner", "gerente", "vendedor", "cajero"]);
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const meta = new Map<string, { email: string; full_name: string | null }>();
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
          });
        }
      }
    }

    return {
      users: (rows ?? []).map((r) => ({
        user_id: r.user_id,
        role: r.role,
        ...(meta.get(r.user_id) ?? { email: "", full_name: null }),
      })),
    };
  });
