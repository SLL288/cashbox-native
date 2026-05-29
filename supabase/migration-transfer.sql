-- Run this if you already created the original prototype tables.

alter table public.transactions
  drop constraint if exists transactions_type_check;

alter table public.transactions
  add constraint transactions_type_check check (type in ('expense', 'cash_in', 'exchange', 'transfer'));

alter table public.transactions
  add column if not exists transfer_to_user_id text,
  add column if not exists transfer_from_user_id text,
  add column if not exists linked_transaction_id text,
  add column if not exists change_usd double precision,
  add column if not exists change_lrd double precision,
  add column if not exists photo_uri text;

insert into storage.buckets (id, name, public)
values ('transaction-photos', 'transaction-photos', false)
on conflict (id) do nothing;

drop policy if exists "prototype anon full access transaction photos" on storage.objects;
create policy "prototype anon full access transaction photos"
on storage.objects for all to anon
using (bucket_id = 'transaction-photos')
with check (bucket_id = 'transaction-photos');
