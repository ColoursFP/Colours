-- Colours Flex Printing: run this in Supabase SQL Editor.
create table if not exists public.invoices (
  id text primary key,
  invoice_date date not null default current_date,
  customer_name text not null default 'Walk-in Customer',
  customer_phone text not null default '',
  total numeric(12,2) not null default 0,
  collected numeric(12,2) not null default 0,
  pending numeric(12,2) not null default 0,
  invoice_data jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoices enable row level security;

drop policy if exists "Authenticated users can read invoices" on public.invoices;
create policy "Authenticated users can read invoices"
on public.invoices for select to authenticated using (true);

drop policy if exists "Authenticated users can create invoices" on public.invoices;
create policy "Authenticated users can create invoices"
on public.invoices for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update invoices" on public.invoices;
create policy "Authenticated users can update invoices"
on public.invoices for update to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can delete invoices" on public.invoices;
create policy "Authenticated users can delete invoices"
on public.invoices for delete to authenticated using (true);

grant select, insert, update, delete on public.invoices to authenticated;
