-- 1. Create inventory_movements table
CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN (
    'purchase','sale','adjustment_in','adjustment_out',
    'return_in','return_out','transfer_in','transfer_out','initial'
  )),
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  signed_quantity numeric(12,2) GENERATED ALWAYS AS (
    CASE
      WHEN movement_type IN ('purchase','adjustment_in','return_in','transfer_in','initial')
        THEN quantity
      ELSE -quantity
    END
  ) STORED,
  unit_cost numeric(12,2),
  unit_price numeric(12,2),
  reference_type text,
  reference_id uuid,
  stock_before numeric(12,2) NOT NULL,
  stock_after numeric(12,2) NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_inv_mov_tenant_date ON public.inventory_movements (tenant_id, created_at DESC);
CREATE INDEX idx_inv_mov_product_date ON public.inventory_movements (product_id, created_at DESC);
CREATE INDEX idx_inv_mov_reference ON public.inventory_movements (reference_type, reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX idx_inv_mov_type ON public.inventory_movements (tenant_id, movement_type);

-- 2. RLS - SELECT and INSERT only. No UPDATE / DELETE policies = blocked.
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view inventory movements"
  ON public.inventory_movements
  FOR SELECT
  TO authenticated
  USING (public.is_member_of_tenant(tenant_id) OR public.is_super_admin());

CREATE POLICY "owners managers warehousers can insert inventory movements"
  ON public.inventory_movements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.current_user_role_in_tenant(tenant_id) = ANY (ARRAY['tenant_owner','gerente','almacenista'])
  );

-- 3. Trigger to keep products.current_stock in sync
CREATE OR REPLACE FUNCTION public.update_product_stock_from_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET current_stock = NEW.stock_after,
      updated_at = now()
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inv_mov_update_stock
AFTER INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.update_product_stock_from_movement();

-- 4. Atomic RPC for movement creation
CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_tenant_id uuid,
  p_product_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_cost numeric DEFAULT NULL,
  p_unit_price numeric DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_stock_before numeric(12,2);
  v_cost_avg_before numeric(12,2);
  v_signed numeric(12,2);
  v_stock_after numeric(12,2);
  v_movement_id uuid;
  v_inbound_types text[] := ARRAY['purchase','adjustment_in','return_in','transfer_in','initial'];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_super_admin() THEN
    SELECT role INTO v_role
    FROM public.user_tenants
    WHERE user_id = v_user_id AND tenant_id = p_tenant_id AND is_active = true;
    IF v_role IS NULL OR v_role NOT IN ('tenant_owner','gerente','almacenista') THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  IF p_movement_type NOT IN ('purchase','sale','adjustment_in','adjustment_out',
      'return_in','return_out','transfer_in','transfer_out','initial') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido';
  END IF;

  -- Lock product row
  SELECT current_stock, cost_avg INTO v_stock_before, v_cost_avg_before
  FROM public.products
  WHERE id = p_product_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_stock_before IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  IF p_movement_type = ANY(v_inbound_types) THEN
    v_signed := p_quantity;
  ELSE
    v_signed := -p_quantity;
  END IF;

  v_stock_after := v_stock_before + v_signed;

  IF v_stock_after < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %, solicitado: %', v_stock_before, p_quantity;
  END IF;

  -- Recalculate weighted avg cost for purchases BEFORE inserting movement
  -- (so trigger update of current_stock doesn't conflict)
  IF p_movement_type = 'purchase' AND p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN
    UPDATE public.products
    SET cost_avg = CASE
      WHEN v_stock_before <= 0 THEN p_unit_cost
      ELSE ((v_stock_before * v_cost_avg_before) + (p_quantity * p_unit_cost)) / (v_stock_before + p_quantity)
    END,
    updated_at = now()
    WHERE id = p_product_id;
  END IF;

  -- Insert movement (trigger will update current_stock)
  INSERT INTO public.inventory_movements (
    tenant_id, product_id, movement_type, quantity,
    unit_cost, unit_price, reference_type, reference_id,
    stock_before, stock_after, notes, created_by
  ) VALUES (
    p_tenant_id, p_product_id, p_movement_type, p_quantity,
    p_unit_cost, p_unit_price, p_reference_type, p_reference_id,
    v_stock_before, v_stock_after, p_notes, v_user_id
  ) RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_inventory_movement(uuid,uuid,text,numeric,numeric,numeric,text,uuid,text) TO authenticated;

-- 5. Retroactive backfill: one 'initial' movement per existing product with stock > 0
DO $$
DECLARE
  r record;
  v_system_user uuid;
BEGIN
  SELECT user_id INTO v_system_user
  FROM public.user_tenants
  WHERE role = 'super_admin' AND is_active = true
  LIMIT 1;

  IF v_system_user IS NULL THEN
    -- Fallback: use the tenant owner of each tenant
    FOR r IN
      SELECT p.id, p.tenant_id, p.current_stock, p.cost_avg,
             (SELECT user_id FROM public.user_tenants
              WHERE tenant_id = p.tenant_id AND role = 'tenant_owner' AND is_active = true
              LIMIT 1) AS owner_id
      FROM public.products p
      WHERE p.deleted_at IS NULL AND p.current_stock > 0
    LOOP
      IF r.owner_id IS NOT NULL THEN
        INSERT INTO public.inventory_movements (
          tenant_id, product_id, movement_type, quantity,
          unit_cost, stock_before, stock_after, notes, created_by
        ) VALUES (
          r.tenant_id, r.id, 'initial', r.current_stock,
          r.cost_avg, 0, r.current_stock,
          'Inventario inicial migrado desde catálogo', r.owner_id
        );
      END IF;
    END LOOP;
  ELSE
    FOR r IN
      SELECT id, tenant_id, current_stock, cost_avg
      FROM public.products
      WHERE deleted_at IS NULL AND current_stock > 0
    LOOP
      INSERT INTO public.inventory_movements (
        tenant_id, product_id, movement_type, quantity,
        unit_cost, stock_before, stock_after, notes, created_by
      ) VALUES (
        r.tenant_id, r.id, 'initial', r.current_stock,
        r.cost_avg, 0, r.current_stock,
        'Inventario inicial migrado desde catálogo', v_system_user
      );
    END LOOP;
  END IF;
END $$;