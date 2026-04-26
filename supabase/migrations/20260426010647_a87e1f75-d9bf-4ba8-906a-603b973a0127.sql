ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tenants_is_system
  ON public.tenants(is_system) WHERE is_system = true;

UPDATE public.tenants
  SET is_system = true
  WHERE slug = 'mexintli-hq';