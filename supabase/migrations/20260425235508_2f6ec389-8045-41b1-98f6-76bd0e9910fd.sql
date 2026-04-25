-- 1. Backfill tenants.settings.ai
UPDATE public.tenants
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{ai}',
  jsonb_build_object(
    'limit_monthly', 500,
    'used_current_month', 0,
    'reset_date', to_char(date_trunc('month', now()) + interval '1 month', 'YYYY-MM-DD')
  ),
  true
)
WHERE settings->'ai' IS NULL;

-- 2. ai_ingestions table
CREATE TABLE public.ai_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('photo','audio','text')),
  intent text NOT NULL CHECK (intent IN ('inventory_in','inventory_out','sale','catalog','unknown')),
  input_text text,
  input_image_path text,
  raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  final_data jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','discarded','failed')),
  confirmed_at timestamptz,
  confirmed_by uuid,
  error_message text,
  tokens_input integer DEFAULT 0,
  tokens_output integer DEFAULT 0,
  cost_usd numeric(10,6) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_ingestions_tenant_date ON public.ai_ingestions (tenant_id, created_at DESC);
CREATE INDEX idx_ai_ingestions_tenant_status ON public.ai_ingestions (tenant_id, status);

ALTER TABLE public.ai_ingestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view ai ingestions"
ON public.ai_ingestions FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.is_member_of_tenant(tenant_id)
    AND (
      public.current_user_role_in_tenant(tenant_id) IN ('tenant_owner','gerente')
      OR user_id = auth.uid()
    )
  )
);

-- No INSERT/UPDATE/DELETE policies for clients. Only SECURITY DEFINER server functions write.

-- 3. Storage bucket ai-ingestions (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-ingestions', 'ai-ingestions', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "members can view ai ingestion files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ai-ingestions'
  AND (
    public.is_super_admin()
    OR public.is_member_of_tenant(((storage.foldername(name))[1])::uuid)
  )
);

CREATE POLICY "members can upload ai ingestion files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ai-ingestions'
  AND (
    public.is_super_admin()
    OR public.is_member_of_tenant(((storage.foldername(name))[1])::uuid)
  )
);

-- 4. increment_ai_usage RPC
CREATE OR REPLACE FUNCTION public.increment_ai_usage(
  p_tenant_id uuid,
  p_amount integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings jsonb;
  v_ai jsonb;
  v_used integer;
  v_limit integer;
  v_reset_date date;
  v_today date := current_date;
BEGIN
  SELECT settings INTO v_settings
  FROM public.tenants
  WHERE id = p_tenant_id
  FOR UPDATE;

  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'Tenant no encontrado';
  END IF;

  v_ai := COALESCE(v_settings->'ai', '{}'::jsonb);
  v_used := COALESCE((v_ai->>'used_current_month')::integer, 0);
  v_limit := COALESCE((v_ai->>'limit_monthly')::integer, 500);
  v_reset_date := COALESCE((v_ai->>'reset_date')::date, date_trunc('month', now())::date + interval '1 month');

  -- Reset counter if past reset date
  IF v_today >= v_reset_date THEN
    v_used := 0;
    v_reset_date := (date_trunc('month', now()) + interval '1 month')::date;
  END IF;

  -- Check quota
  IF v_used + p_amount > v_limit THEN
    RETURN false;
  END IF;

  v_used := v_used + p_amount;

  UPDATE public.tenants
  SET settings = jsonb_set(
    settings,
    '{ai}',
    jsonb_build_object(
      'limit_monthly', v_limit,
      'used_current_month', v_used,
      'reset_date', to_char(v_reset_date, 'YYYY-MM-DD')
    ),
    true
  ),
  updated_at = now()
  WHERE id = p_tenant_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_ai_usage(uuid, integer) TO authenticated;