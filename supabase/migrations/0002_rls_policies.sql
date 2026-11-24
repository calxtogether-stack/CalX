-- 0002_rls_policies.sql
-- Strict Row Level Security on all user-accessible tables

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.device_keys enable row level security;
alter table public.key_bundles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_receipts enable row level security;
alter table public.contacts enable row level security;
alter table public.user_blocks enable row level security;
alter table public.attachments enable row level security;
alter table public.push_tokens enable row level security;
alter table public.user_settings enable row level security;

-- Helper: check if current user is a member of a conversation
create or replace function public.is_conversation_member(conv_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv_id and user_id = auth.uid()
  );
$$;

-- Helper: check if current user is owner/admin of a conversation
create or replace function public.is_conversation_admin(conv_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

-- Profiles
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Devices
create policy "devices_select_active_or_own" on public.devices
  for select to authenticated using (is_active = true or auth.uid() = user_id);
create policy "devices_manage_own" on public.devices
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Device Keys (public keys readable by authenticated users for E2EE key wrapping)
create policy "device_keys_select_authenticated" on public.device_keys
  for select to authenticated using (true);
create policy "device_keys_manage_own" on public.device_keys
  for insert to authenticated with check (auth.uid() = user_id);
create policy "device_keys_update_own" on public.device_keys
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "device_keys_delete_own" on public.device_keys
  for delete to authenticated using (auth.uid() = user_id);

-- Key Bundles
create policy "key_bundles_select_authenticated" on public.key_bundles
  for select to authenticated using (true);
create policy "key_bundles_manage_own" on public.key_bundles
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Conversations
create policy "conversations_select_member" on public.conversations
  for select to authenticated using (public.is_conversation_member(id));
create policy "conversations_insert_authenticated" on public.conversations
  for insert to authenticated with check (auth.uid() = created_by);
create policy "conversations_update_admin" on public.conversations
  for update to authenticated using (public.is_conversation_admin(id));

-- Conversation Members
create policy "members_select_member" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "members_insert_admin_or_creator" on public.conversation_members
  for insert to authenticated with check (
    public.is_conversation_admin(conversation_id)
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
  );
create policy "members_update_own_or_admin" on public.conversation_members
  for update to authenticated using (
    user_id = auth.uid() or public.is_conversation_admin(conversation_id)
  );
create policy "members_delete_own_or_admin" on public.conversation_members
  for delete to authenticated using (
    user_id = auth.uid() or public.is_conversation_admin(conversation_id)
  );

-- Messages
create policy "messages_select_member" on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "messages_insert_member" on public.messages
  for insert to authenticated with check (
    auth.uid() = sender_id
    and public.is_conversation_member(conversation_id)
  );
create policy "messages_update_sender" on public.messages
  for update to authenticated using (auth.uid() = sender_id);

-- Message Reactions
create policy "reactions_select_member" on public.message_reactions
  for select to authenticated using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_conversation_member(m.conversation_id)
    )
  );
create policy "reactions_insert_own" on public.message_reactions
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_conversation_member(m.conversation_id)
    )
  );
create policy "reactions_delete_own" on public.message_reactions
  for delete to authenticated using (auth.uid() = user_id);

-- Message Receipts
create policy "receipts_select_member" on public.message_receipts
  for select to authenticated using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_conversation_member(m.conversation_id)
    )
  );
create policy "receipts_upsert_own" on public.message_receipts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Contacts
create policy "contacts_manage_own" on public.contacts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- User Blocks
create policy "blocks_manage_own" on public.user_blocks
  for all to authenticated using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- Attachments
create policy "attachments_select_member" on public.attachments
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "attachments_insert_member" on public.attachments
  for insert to authenticated with check (
    auth.uid() = uploader_id and public.is_conversation_member(conversation_id)
  );

-- Push Tokens
create policy "push_tokens_manage_own" on public.push_tokens
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- User Settings
create policy "settings_manage_own" on public.user_settings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
