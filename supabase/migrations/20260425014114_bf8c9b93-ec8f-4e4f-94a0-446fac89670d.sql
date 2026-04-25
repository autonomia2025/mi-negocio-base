create table public.search_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid,
  query text not null,
  source text not null check (source in ('text','voice')),
  result_count int not null default 0,
  product_clicked uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_search_log_tenant_date on public.search_log(tenant_id, created_at desc);
create index idx_search_log_clicked on public.search_log(tenant_id, product_clicked, created_at desc) where product_clicked is not null;

alter table public.search_log enable row level security;

create policy "members can view search log"
on public.search_log for select to authenticated
using (public.is_member_of_tenant(tenant_id) or public.is_super_admin());

create policy "members can insert search log"
on public.search_log for insert to authenticated
with check (
  (user_id = auth.uid() or user_id is null)
  and (public.is_member_of_tenant(tenant_id) or public.is_super_admin())
);

create policy "members can update own search log click"
on public.search_log for update to authenticated
using (public.is_member_of_tenant(tenant_id) or public.is_super_admin())
with check (public.is_member_of_tenant(tenant_id) or public.is_super_admin());
