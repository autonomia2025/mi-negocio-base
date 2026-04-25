import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderSalePdfBuffer } from "./sales.pdf.server";

type SaleRowRecord = {
  id: string;
  tenant_id: string;
  sale_number: number;
  customer_name: string | null;
  customer_email: string | null;
  payment_method: string;
  subtotal: number;
  total: number;
  notes: string | null;
  created_at: string;
  created_by: string;
};

type SaleItemRecord = {
  id: string;
  product_sku_at_sale: string;
  product_name_at_sale: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
};

type TenantRecord = {
  id: string;
  name: string;
  settings: Record<string, unknown> | null;
};

export const generateSalePdfFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { saleId: string }) => {
    if (!data || typeof data.saleId !== "string" || data.saleId.length < 8) {
      throw new Error("saleId inválido");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const saleId = data.saleId;

    // 1. Fetch sale + items + tenant via admin (bypass RLS, but verify membership manually)
    const { data: sale, error: saleErr } = await supabaseAdmin
      .from("sales")
      .select("*")
      .eq("id", saleId)
      .maybeSingle();
    if (saleErr) throw new Error(saleErr.message);
    if (!sale) throw new Error("Venta no encontrada");
    const saleRec = sale as unknown as SaleRowRecord;

    // Verify the calling user belongs to that tenant
    const { data: membership } = await supabaseAdmin
      .from("user_tenants")
      .select("role, is_active")
      .eq("user_id", userId)
      .eq("tenant_id", saleRec.tenant_id)
      .eq("is_active", true)
      .maybeSingle();

    const { data: superAdmin } = await supabaseAdmin
      .from("user_tenants")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .eq("is_active", true)
      .maybeSingle();

    if (!membership && !superAdmin) {
      throw new Error("No autorizado");
    }

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("sale_items")
      .select("*")
      .eq("sale_id", saleId);
    if (itemsErr) throw new Error(itemsErr.message);
    const itemRecs = (items ?? []) as unknown as SaleItemRecord[];

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, name, settings")
      .eq("id", saleRec.tenant_id)
      .maybeSingle();
    const tenantRec = tenant as unknown as TenantRecord;

    // Salesperson email (best-effort)
    let salespersonName = saleRec.created_by;
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(saleRec.created_by);
      if (u?.user?.email) salespersonName = u.user.email;
    } catch {
      // fallthrough
    }

    // 2. Render PDF
    const pdfBuffer = await renderSalePdfBuffer({
      sale: saleRec,
      items: itemRecs,
      tenant: tenantRec,
      salespersonName,
    });

    // 3. Upload to storage
    const created = new Date(saleRec.created_at);
    const yyyy = created.getUTCFullYear();
    const mm = String(created.getUTCMonth() + 1).padStart(2, "0");
    const path = `${saleRec.tenant_id}/${yyyy}/${mm}/sale-${saleRec.sale_number}.pdf`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("receipts")
      .upload(path, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) throw new Error(uploadErr.message);

    // 4. Update sales.pdf_path
    await supabaseAdmin
      .from("sales")
      .update({ pdf_path: path })
      .eq("id", saleId);

    // 5. Return signed URL (1h)
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("receipts")
      .createSignedUrl(path, 60 * 60);
    if (signErr) throw new Error(signErr.message);

    return {
      signedUrl: signed?.signedUrl ?? "",
      pdfPath: path,
    };
  });

/** Generate a fresh signed URL for an existing pdf_path. */
export const getSalePdfUrlFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { saleId: string }) => {
    if (!data || typeof data.saleId !== "string") throw new Error("saleId inválido");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { data: sale } = await supabaseAdmin
      .from("sales")
      .select("tenant_id, pdf_path")
      .eq("id", data.saleId)
      .maybeSingle();
    const rec = sale as unknown as { tenant_id: string; pdf_path: string | null } | null;
    if (!rec || !rec.pdf_path) return { signedUrl: null };

    const { data: membership } = await supabaseAdmin
      .from("user_tenants")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", rec.tenant_id)
      .eq("is_active", true)
      .maybeSingle();
    const { data: superAdmin } = await supabaseAdmin
      .from("user_tenants")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .eq("is_active", true)
      .maybeSingle();
    if (!membership && !superAdmin) throw new Error("No autorizado");

    const { data: signed } = await supabaseAdmin.storage
      .from("receipts")
      .createSignedUrl(rec.pdf_path, 60 * 60);
    return { signedUrl: signed?.signedUrl ?? null };
  });