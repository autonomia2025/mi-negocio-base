import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchDefaultSchema,
  createProduct,
  canEditProducts,
  type ProductSchema,
  type ProductInput,
} from "@/utils/products";
import { ProductForm } from "@/components/products/ProductForm";
import type { OnboardingSettings } from "@/lib/onboarding";

export const Route = createFileRoute("/app/productos/nuevo")({
  component: NewProductPage,
});

function NewProductPage() {
  const navigate = useNavigate();
  const { currentTenantId, currentMembership, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role;
  const allowed = canEditProducts(role);

  const [schema, setSchema] = useState<ProductSchema | null>(null);
  const [defaultReorder, setDefaultReorder] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void Promise.all([
      fetchDefaultSchema(tenantId),
      supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle(),
    ]).then(([sch, t]) => {
      if (cancelled) return;
      setSchema(sch);
      const s = (t.data?.settings ?? {}) as OnboardingSettings;
      setDefaultReorder(Number(s.operations?.punto_reorden_default ?? 0));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (!allowed) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
        No tienes permiso para crear productos.
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Cargando…</div>;
  }

  if (!schema) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          No se encontró un esquema de catálogo predeterminado.
        </div>
        <p className="mt-1">
          Configura tu catálogo en el onboarding antes de crear productos.
        </p>
      </div>
    );
  }

  async function handleSubmit(data: ProductInput) {
    if (!tenantId) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createProduct(tenantId, data);
      void navigate({
        to: "/app/productos/$productId",
        params: { productId: created.id },
      });
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "No se pudo crear el producto";
      setError(
        msg.includes("duplicate")
          ? "Este SKU ya existe en tu catálogo"
          : msg,
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          to="/app/productos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Productos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Nuevo producto
        </h1>
      </div>

      <ProductForm
        tenantId={tenantId!}
        schema={schema}
        defaultReorderPoint={defaultReorder}
        submitting={submitting}
        errorMessage={error}
        onSubmit={(d) => void handleSubmit(d)}
        onCancel={() => void navigate({ to: "/app/productos" })}
      />
    </div>
  );
}