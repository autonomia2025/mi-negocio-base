-- Step 1: sales table
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sale_number bigint NOT NULL,
  customer_name text,
  customer_email text,
  payment_method text NOT NULL CHECK (payment_method IN (
    'efectivo','transferencia','tarjeta_debito','tarjeta_credito',
    'credito','mixto','otro'
  )),
  subtotal numeric(12,2) NOT NULL,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL,
  profit numeric(12,2) NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  void_reason text,
  pdf_path text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_tenant_number_unique UNIQUE (tenant_id, sale_number)
);

CREATE INDEX idx_sales_tenant_date ON public.sales (tenant_id, created_at DESC);
CREATE INDEX idx_sales_tenant_user_date ON public.sales (tenant_id, created_by, created_at DESC);
CREATE INDEX idx_sales_tenant_number ON public.sales (tenant_id, sale_number);
CREATE INDEX idx_sales_tenant_status ON public.sales (tenant_id, status);

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view sales"
ON public.sales FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.is_member_of_tenant(tenant_id)
    AND (
      public.current_user_role_in_tenant(tenant_id) IN ('tenant_owner','gerente')
      OR created_by = auth.uid()
    )
  )
);

CREATE POLICY "sellers can create sales"
ON public.sales FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR public.current_user_role_in_tenant(tenant_id) IN
     ('tenant_owner','gerente','vendedor','cajero')
);

-- Step 2: sale_items table
CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_at_sale text NOT NULL,
  product_sku_at_sale text NOT NULL,
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL,
  unit_cost_at_sale numeric(12,2) NOT NULL,
  line_subtotal numeric(12,2) NOT NULL,
  line_profit numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sale_items_sale ON public.sale_items (sale_id);
CREATE INDEX idx_sale_items_product ON public.sale_items (product_id);

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view sale items via parent sale"
ON public.sale_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (
        public.is_super_admin()
        OR (
          public.is_member_of_tenant(s.tenant_id)
          AND (
            public.current_user_role_in_tenant(s.tenant_id) IN ('tenant_owner','gerente')
            OR s.created_by = auth.uid()
          )
        )
      )
  )
);

-- Step 3: register_sale RPC
CREATE OR REPLACE FUNCTION public.register_sale(
  p_tenant_id uuid,
  p_payment_method text,
  p_customer_name text,
  p_customer_email text,
  p_notes text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_sale_id uuid := gen_random_uuid();
  v_sale_number bigint;
  v_subtotal numeric(12,2) := 0;
  v_total_profit numeric(12,2) := 0;
  v_item jsonb;
  v_product record;
  v_qty numeric(12,2);
  v_price numeric(12,2);
  v_line_subtotal numeric(12,2);
  v_line_profit numeric(12,2);
  v_unit_cost numeric(12,2);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_super_admin() THEN
    SELECT role INTO v_role FROM public.user_tenants
    WHERE user_id = v_user_id AND tenant_id = p_tenant_id AND is_active = true;
    IF v_role IS NULL OR v_role NOT IN
       ('tenant_owner','gerente','vendedor','cajero') THEN
      RAISE EXCEPTION 'No autorizado para registrar ventas';
    END IF;
  END IF;

  IF p_payment_method NOT IN
     ('efectivo','transferencia','tarjeta_debito','tarjeta_credito',
      'credito','mixto','otro') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos una línea';
  END IF;

  SELECT COALESCE(MAX(sale_number), 0) + 1 INTO v_sale_number
  FROM public.sales WHERE tenant_id = p_tenant_id;

  INSERT INTO public.sales (
    id, tenant_id, sale_number, customer_name, customer_email,
    payment_method, subtotal, total, profit, notes, created_by
  ) VALUES (
    v_sale_id, p_tenant_id, v_sale_number, p_customer_name, p_customer_email,
    p_payment_method, 0, 0, 0, p_notes, v_user_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida en una línea';
    END IF;
    IF v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'Precio inválido en una línea';
    END IF;

    SELECT id, sku, name, cost_avg INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
      AND tenant_id = p_tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado en una línea';
    END IF;

    v_unit_cost := v_product.cost_avg;
    v_line_subtotal := v_qty * v_price;
    v_line_profit := v_qty * (v_price - v_unit_cost);

    PERFORM public.record_inventory_movement(
      p_tenant_id := p_tenant_id,
      p_product_id := v_product.id,
      p_movement_type := 'sale',
      p_quantity := v_qty,
      p_unit_price := v_price,
      p_reference_type := 'sale',
      p_reference_id := v_sale_id,
      p_notes := 'Venta #' || v_sale_number
    );

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name_at_sale, product_sku_at_sale,
      quantity, unit_price, unit_cost_at_sale, line_subtotal, line_profit
    ) VALUES (
      v_sale_id, v_product.id, v_product.name, v_product.sku,
      v_qty, v_price, v_unit_cost, v_line_subtotal, v_line_profit
    );

    v_subtotal := v_subtotal + v_line_subtotal;
    v_total_profit := v_total_profit + v_line_profit;
  END LOOP;

  UPDATE public.sales
  SET subtotal = v_subtotal,
      total = v_subtotal,
      profit = v_total_profit
  WHERE id = v_sale_id;

  RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_sale(uuid,text,text,text,text,jsonb)
  TO authenticated;

-- Step 4: void_sale RPC
CREATE OR REPLACE FUNCTION public.void_sale(
  p_sale_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_sale record;
  v_role text;
  v_item record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_sale FROM public.sales
  WHERE id = p_sale_id FOR UPDATE;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF v_sale.status = 'voided' THEN
    RAISE EXCEPTION 'La venta ya está cancelada';
  END IF;

  IF NOT public.is_super_admin() THEN
    SELECT role INTO v_role FROM public.user_tenants
    WHERE user_id = v_user_id AND tenant_id = v_sale.tenant_id
      AND is_active = true;
    IF v_role NOT IN ('tenant_owner','gerente')
       AND v_sale.created_by != v_user_id THEN
      RAISE EXCEPTION 'No autorizado para cancelar esta venta';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id = p_sale_id
  LOOP
    PERFORM public.record_inventory_movement(
      p_tenant_id := v_sale.tenant_id,
      p_product_id := v_item.product_id,
      p_movement_type := 'return_in',
      p_quantity := v_item.quantity,
      p_reference_type := 'sale_void',
      p_reference_id := p_sale_id,
      p_notes := 'Cancelación venta #' || v_sale.sale_number ||
                 ' · ' || COALESCE(p_reason, '')
    );
  END LOOP;

  UPDATE public.sales
  SET status = 'voided',
      voided_at = now(),
      voided_by = v_user_id,
      void_reason = p_reason
  WHERE id = p_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale(uuid,text) TO authenticated;

-- Storage bucket: receipts (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "members can read receipts of their tenant"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'receipts'
  AND (
    public.is_super_admin()
    OR public.is_member_of_tenant(((storage.foldername(name))[1])::uuid)
  )
);
