-- Tenants table
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  business_type TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial','active','suspended','cancelled')),
  subscription_plan TEXT CHECK (subscription_plan IN ('basico','profesional','empresarial')),
  trial_ends_at TIMESTAMPTZ,
  ai_ops_limit INT NOT NULL DEFAULT 200,
  ai_ops_used INT NOT NULL DEFAULT 0,
  ai_cycle_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User <-> tenant membership
CREATE TABLE public.user_tenants (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin','implementer','tenant_owner','gerente','vendedor','almacenista','cajero')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

-- Audit log (append-only)
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  changes JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger for tenants
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER tenants_set_updated_at
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: role in given tenant for current user
CREATE OR REPLACE FUNCTION public.current_user_role_in_tenant(tenant_uuid UUID)
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.user_tenants
  WHERE user_id = auth.uid() AND tenant_id = tenant_uuid AND is_active = true
  LIMIT 1
$$;

-- Helper: is super_admin in any tenant
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_tenants
    WHERE user_id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
$$;

-- Helper: is member of tenant
CREATE OR REPLACE FUNCTION public.is_member_of_tenant(tenant_uuid UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_tenants
    WHERE user_id = auth.uid() AND tenant_id = tenant_uuid AND is_active = true
  )
$$;

-- Enable RLS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- TENANTS policies
CREATE POLICY "members can view their tenants"
ON public.tenants FOR SELECT TO authenticated
USING (public.is_member_of_tenant(id) OR public.is_super_admin());

CREATE POLICY "super_admin can insert tenants"
ON public.tenants FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin());

CREATE POLICY "super_admin can update tenants"
ON public.tenants FOR UPDATE TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

CREATE POLICY "super_admin can delete tenants"
ON public.tenants FOR DELETE TO authenticated
USING (public.is_super_admin());

-- USER_TENANTS policies
CREATE POLICY "users see their own membership"
ON public.user_tenants FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) = 'tenant_owner'
);

CREATE POLICY "owners and super_admin can insert memberships"
ON public.user_tenants FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) = 'tenant_owner'
);

CREATE POLICY "owners and super_admin can update memberships"
ON public.user_tenants FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) = 'tenant_owner'
)
WITH CHECK (
  public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) = 'tenant_owner'
);

CREATE POLICY "owners and super_admin can delete memberships"
ON public.user_tenants FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) = 'tenant_owner'
);

-- AUDIT_LOG policies (insert only; immutable)
CREATE POLICY "authenticated can insert audit entries"
ON public.audit_log FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (tenant_id IS NULL OR public.is_member_of_tenant(tenant_id) OR public.is_super_admin())
);

CREATE POLICY "members and super_admin can view audit entries"
ON public.audit_log FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR (tenant_id IS NOT NULL AND public.is_member_of_tenant(tenant_id))
);
-- Intentionally no UPDATE or DELETE policies => immutable.

-- Indexes
CREATE INDEX idx_user_tenants_user ON public.user_tenants(user_id);
CREATE INDEX idx_user_tenants_tenant ON public.user_tenants(tenant_id);
CREATE INDEX idx_audit_log_tenant ON public.audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_user ON public.audit_log(user_id, created_at DESC);