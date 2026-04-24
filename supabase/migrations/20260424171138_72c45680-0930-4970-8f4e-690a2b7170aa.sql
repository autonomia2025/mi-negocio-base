-- product_schemas table
CREATE TABLE public.product_schemas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  UNIQUE (tenant_id, name)
);

CREATE INDEX idx_product_schemas_tenant
  ON public.product_schemas (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.product_schemas ENABLE ROW LEVEL SECURITY;

-- updated_at trigger (function already exists: public.set_updated_at)
CREATE TRIGGER trg_product_schemas_updated_at
BEFORE UPDATE ON public.product_schemas
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: SELECT for tenant members or super_admin
CREATE POLICY "members can view product schemas"
ON public.product_schemas
FOR SELECT
TO authenticated
USING (public.is_member_of_tenant(tenant_id) OR public.is_super_admin());

-- RLS: INSERT
CREATE POLICY "owners managers super_admin can insert product schemas"
ON public.product_schemas
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) IN ('tenant_owner','gerente')
);

-- RLS: UPDATE
CREATE POLICY "owners managers super_admin can update product schemas"
ON public.product_schemas
FOR UPDATE
TO authenticated
USING (
  public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) IN ('tenant_owner','gerente')
)
WITH CHECK (
  public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) IN ('tenant_owner','gerente')
);

-- RLS: DELETE
CREATE POLICY "owners managers super_admin can delete product schemas"
ON public.product_schemas
FOR DELETE
TO authenticated
USING (
  public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) IN ('tenant_owner','gerente')
);

-- Storage bucket for tenant branding (logos)
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-branding', 'tenant-branding', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "Public read tenant branding"
ON storage.objects
FOR SELECT
USING (bucket_id = 'tenant-branding');

-- Authenticated upload only into their tenant folder if owner/manager/super_admin
CREATE POLICY "Tenant managers can upload branding"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'tenant-branding'
  AND (
    public.is_super_admin()
    OR public.current_user_role_in_tenant(((storage.foldername(name))[1])::uuid) IN ('tenant_owner','gerente')
  )
);

CREATE POLICY "Tenant managers can update branding"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'tenant-branding'
  AND (
    public.is_super_admin()
    OR public.current_user_role_in_tenant(((storage.foldername(name))[1])::uuid) IN ('tenant_owner','gerente')
  )
);

CREATE POLICY "Tenant managers can delete branding"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'tenant-branding'
  AND (
    public.is_super_admin()
    OR public.current_user_role_in_tenant(((storage.foldername(name))[1])::uuid) IN ('tenant_owner','gerente')
  )
);