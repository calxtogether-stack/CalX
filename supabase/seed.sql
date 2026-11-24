-- Development Seed Data for CalX
-- Run after creating test users in Supabase Auth (or via local `supabase db reset`)
-- Note: In production, profiles are created during user registration.

-- Example: Insert default user settings for any existing profiles missing settings
insert into public.user_settings (user_id)
select id from public.profiles
on conflict (user_id) do nothing;
