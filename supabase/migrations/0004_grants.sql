-- 0004_grants.sql
-- Ensure the authenticated role has table/function privileges before RLS is evaluated

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Allow authenticated users to resolve active recipient devices for E2EE key wrapping
drop policy if exists "devices_select_active_or_own" on public.devices;
create policy "devices_select_active_or_own" on public.devices
  for select to authenticated using (is_active = true or auth.uid() = user_id);
