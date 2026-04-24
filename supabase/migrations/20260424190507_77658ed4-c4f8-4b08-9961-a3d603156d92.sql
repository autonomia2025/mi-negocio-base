-- Create products table
CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  schema_id uuid NOT NULL REFERENCES public.product_schemas(id),
  sku text NOT NULL,
  name text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  unit text NOT NULL DEFAULT 'pieza',
  cost_avg numeric(12,2) NOT NULL DEFAULT 0,
  price numeric(12,2) NOT NULL DEFAULT 0,
  current_stock numeric(12,2) NOT NULL DEFAULT 0,
  min_stock numeric(12,2) NOT NULL DEFAULT 0,
  reorder_point numeric(12,2) NOT NULL DEFAULT 0,
  reorder_qty numeric(12,2) NOT NULL DEFAULT 0,
  location text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Unique SKU per tenant
CREATE UNIQUE INDEX products_tenant_sku_unique
  ON public.products (tenant_id, sku);

-- Indexes
CREATE INDEX idx_products_tenant
  ON public.products (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_products_sku
  ON public.products (tenant_id, sku);

CREATE INDEX idx_products_low_stock
  ON public.products (tenant_id, current_stock)
  WHERE current_stock <= reorder_point AND deleted_at IS NULL AND is_active = true;

-- Updated_at trigger
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY "members can view products"
  ON public.products FOR SELECT
  TO authenticated
  USING (public.is_member_of_tenant(tenant_id) OR public.is_super_admin());

-- INSERT
CREATE POLICY "owners managers warehousers can insert products"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.current_user_role_in_tenant(tenant_id) = ANY (ARRAY['tenant_owner','gerente','almacenista'])
  );

-- UPDATE
CREATE POLICY "owners managers warehousers can update products"
  ON public.products FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.current_user_role_in_tenant(tenant_id) = ANY (ARRAY['tenant_owner','gerente','almacenista'])
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.current_user_role_in_tenant(tenant_id) = ANY (ARRAY['tenant_owner','gerente','almacenista'])
  );

-- DELETE (hard delete — UI uses soft delete)
CREATE POLICY "owners managers can delete products"
  ON public.products FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.current_user_role_in_tenant(tenant_id) = ANY (ARRAY['tenant_owner','gerente'])
  );