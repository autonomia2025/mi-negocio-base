create or replace function public.dashboard_kpis(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_total_sales numeric := 0;
  v_total_profit numeric := 0;
  v_sale_count int := 0;
  v_voided_count int := 0;
  v_avg_ticket numeric := 0;
  v_unique_customers int := 0;
  v_inventory_value numeric := 0;
  v_low_stock_count int := 0;
  v_critical_stock_count int := 0;
  v_out_of_stock_count int := 0;
  v_active_products int := 0;
begin
  if not public.is_super_admin() then
    select role into v_role from public.user_tenants
    where user_id = auth.uid() and tenant_id = p_tenant_id and is_active = true;
    if v_role not in ('tenant_owner','gerente') then
      raise exception 'No autorizado';
    end if;
  end if;

  select
    coalesce(sum(total) filter (where status = 'completed'), 0),
    coalesce(sum(profit) filter (where status = 'completed'), 0),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'voided')
  into v_total_sales, v_total_profit, v_sale_count, v_voided_count
  from public.sales
  where tenant_id = p_tenant_id
    and created_at >= p_from
    and created_at <= p_to;

  if v_sale_count > 0 then
    v_avg_ticket := v_total_sales / v_sale_count;
  end if;

  select count(distinct customer_name) filter (where customer_name is not null)
  into v_unique_customers
  from public.sales
  where tenant_id = p_tenant_id
    and status = 'completed'
    and created_at >= p_from
    and created_at <= p_to;

  select
    coalesce(sum(current_stock * cost_avg), 0),
    count(*),
    count(*) filter (where current_stock > 0 and current_stock <= reorder_point),
    count(*) filter (where current_stock > reorder_point and current_stock <= min_stock * 1.5),
    count(*) filter (where current_stock <= 0)
  into v_inventory_value, v_active_products, v_critical_stock_count,
       v_low_stock_count, v_out_of_stock_count
  from public.products
  where tenant_id = p_tenant_id
    and is_active = true
    and deleted_at is null;

  return jsonb_build_object(
    'total_sales', v_total_sales,
    'total_profit', v_total_profit,
    'sale_count', v_sale_count,
    'voided_count', v_voided_count,
    'avg_ticket', v_avg_ticket,
    'unique_customers', v_unique_customers,
    'inventory_value', v_inventory_value,
    'active_products', v_active_products,
    'low_stock_count', v_low_stock_count,
    'critical_stock_count', v_critical_stock_count,
    'out_of_stock_count', v_out_of_stock_count
  );
end;
$$;

grant execute on function public.dashboard_kpis(uuid, timestamptz, timestamptz)
  to authenticated;

create or replace function public.sales_by_day(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table(day date, total numeric, sale_count int, profit numeric)
language sql
security definer
set search_path = public
as $$
  select
    date_trunc('day', created_at)::date as day,
    coalesce(sum(total), 0) as total,
    count(*)::int as sale_count,
    coalesce(sum(profit), 0) as profit
  from public.sales
  where tenant_id = p_tenant_id
    and status = 'completed'
    and created_at >= p_from
    and created_at <= p_to
    and (
      public.is_super_admin()
      or public.current_user_role_in_tenant(p_tenant_id) in ('tenant_owner','gerente')
    )
  group by date_trunc('day', created_at)::date
  order by day;
$$;

grant execute on function public.sales_by_day(uuid, timestamptz, timestamptz)
  to authenticated;

create or replace function public.top_products(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_metric text default 'revenue'
)
returns table(
  product_id uuid,
  sku text,
  name text,
  total_qty numeric,
  total_revenue numeric,
  total_profit numeric
)
language sql
security definer
set search_path = public
as $$
  select
    si.product_id,
    si.product_sku_at_sale as sku,
    si.product_name_at_sale as name,
    sum(si.quantity) as total_qty,
    sum(si.line_subtotal) as total_revenue,
    sum(si.line_profit) as total_profit
  from public.sale_items si
  inner join public.sales s on s.id = si.sale_id
  where s.tenant_id = p_tenant_id
    and s.status = 'completed'
    and s.created_at >= p_from
    and s.created_at <= p_to
    and (
      public.is_super_admin()
      or public.current_user_role_in_tenant(p_tenant_id) in ('tenant_owner','gerente')
    )
  group by si.product_id, si.product_sku_at_sale, si.product_name_at_sale
  order by
    case p_metric
      when 'quantity' then sum(si.quantity)
      when 'profit' then sum(si.line_profit)
      else sum(si.line_subtotal)
    end desc
  limit 10;
$$;

grant execute on function public.top_products(uuid, timestamptz, timestamptz, text)
  to authenticated;

create or replace function public.sales_by_payment_method(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table(payment_method text, total numeric, sale_count int)
language sql
security definer
set search_path = public
as $$
  select
    payment_method,
    sum(total) as total,
    count(*)::int as sale_count
  from public.sales
  where tenant_id = p_tenant_id
    and status = 'completed'
    and created_at >= p_from
    and created_at <= p_to
    and (
      public.is_super_admin()
      or public.current_user_role_in_tenant(p_tenant_id) in ('tenant_owner','gerente')
    )
  group by payment_method
  order by total desc;
$$;

grant execute on function public.sales_by_payment_method(
  uuid, timestamptz, timestamptz
) to authenticated;

create or replace function public.cash_reconciliation(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_by_method jsonb;
  v_total numeric := 0;
  v_count int := 0;
  v_voided_count int := 0;
  v_voided_total numeric := 0;
  v_first_sale timestamptz;
  v_last_sale timestamptz;
begin
  if not public.is_super_admin() then
    select role into v_role from public.user_tenants
    where user_id = auth.uid() and tenant_id = p_tenant_id and is_active = true;
    if v_role not in ('tenant_owner','gerente') then
      raise exception 'No autorizado';
    end if;
  end if;

  select
    jsonb_object_agg(payment_method, jsonb_build_object(
      'total', total,
      'count', sale_count
    )),
    sum(total),
    sum(sale_count)::int
  into v_by_method, v_total, v_count
  from (
    select payment_method, sum(total) as total, count(*)::int as sale_count
    from public.sales
    where tenant_id = p_tenant_id
      and status = 'completed'
      and created_at >= p_from
      and created_at <= p_to
      and (p_user_id is null or created_by = p_user_id)
    group by payment_method
  ) sub;

  select count(*), coalesce(sum(total), 0)
  into v_voided_count, v_voided_total
  from public.sales
  where tenant_id = p_tenant_id
    and status = 'voided'
    and voided_at >= p_from
    and voided_at <= p_to
    and (p_user_id is null or created_by = p_user_id);

  select min(created_at), max(created_at) into v_first_sale, v_last_sale
  from public.sales
  where tenant_id = p_tenant_id
    and status = 'completed'
    and created_at >= p_from
    and created_at <= p_to
    and (p_user_id is null or created_by = p_user_id);

  return jsonb_build_object(
    'by_method', coalesce(v_by_method, '{}'::jsonb),
    'total', coalesce(v_total, 0),
    'count', coalesce(v_count, 0),
    'voided_count', v_voided_count,
    'voided_total', v_voided_total,
    'first_sale', v_first_sale,
    'last_sale', v_last_sale
  );
end;
$$;

grant execute on function public.cash_reconciliation(
  uuid, timestamptz, timestamptz, uuid
) to authenticated;

create or replace function public.reorder_alerts(
  p_tenant_id uuid,
  p_days_horizon int default 14
)
returns table(
  product_id uuid,
  sku text,
  name text,
  current_stock numeric,
  reorder_point numeric,
  min_stock numeric,
  daily_velocity numeric,
  days_remaining numeric,
  severity text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not public.is_super_admin() then
    select role into v_role from public.user_tenants
    where user_id = auth.uid() and tenant_id = p_tenant_id and is_active = true;
    if v_role not in ('tenant_owner','gerente') then
      raise exception 'No autorizado';
    end if;
  end if;

  return query
  with velocity as (
    select
      si.product_id,
      sum(si.quantity) / 30.0 as daily_qty
    from public.sale_items si
    inner join public.sales s on s.id = si.sale_id
    where s.tenant_id = p_tenant_id
      and s.status = 'completed'
      and s.created_at >= now() - interval '30 days'
    group by si.product_id
  )
  select
    p.id as product_id,
    p.sku,
    p.name,
    p.current_stock,
    p.reorder_point,
    p.min_stock,
    coalesce(v.daily_qty, 0) as daily_velocity,
    case
      when coalesce(v.daily_qty, 0) > 0
        then p.current_stock / v.daily_qty
      else null
    end as days_remaining,
    case
      when p.current_stock <= 0 then 'out'
      when coalesce(v.daily_qty, 0) > 0
           and p.current_stock / v.daily_qty <= 7 then 'critical'
      when coalesce(v.daily_qty, 0) > 0
           and p.current_stock / v.daily_qty <= p_days_horizon then 'warning'
      when p.current_stock <= p.reorder_point then 'low_velocity_warning'
      else 'ok'
    end as severity
  from public.products p
  left join velocity v on v.product_id = p.id
  where p.tenant_id = p_tenant_id
    and p.is_active = true
    and p.deleted_at is null
    and (
      p.current_stock <= 0
      or p.current_stock <= p.reorder_point
      or (
        coalesce(v.daily_qty, 0) > 0
        and p.current_stock / v.daily_qty <= p_days_horizon
      )
    )
  order by
    case
      when p.current_stock <= 0 then 0
      when coalesce(v.daily_qty, 0) > 0
           and p.current_stock / v.daily_qty <= 7 then 1
      else 2
    end,
    days_remaining nulls last;
end;
$$;

grant execute on function public.reorder_alerts(uuid, int) to authenticated;