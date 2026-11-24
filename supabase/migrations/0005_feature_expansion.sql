-- 0005_feature_expansion.sql
-- Extends CalX schema for Message Management, Rich E2EE Content, Privacy, Personalization, and Scheduling.
-- All private content remains strictly client-side encrypted (no plaintext columns).

-- 1. Extend messages table for edits, view-once, and rich message types
alter table public.messages
  drop constraint if exists messages_message_type_check;

alter table public.messages
  add constraint messages_message_type_check check (
    message_type in (
      'text', 'image', 'video', 'audio', 'voice', 'document', 'system',
      'location', 'live_location', 'contact_card', 'event', 'checklist'
    )
  );

alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists edit_count integer not null default 0,
  add column if not exists is_view_once boolean not null default false,
  add column if not exists viewed_at timestamptz,
  add column if not exists viewed_by uuid references public.profiles(id) on delete set null;

-- 2. Extend conversations for automatic cleanup policies
alter table public.conversations
  add column if not exists cleanup_seconds integer check (cleanup_seconds is null or cleanup_seconds > 0),
  add column if not exists cleanup_exclude_pinned_starred boolean not null default true;

-- 3. Pinned Messages
create table if not exists public.pinned_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  unique (conversation_id, message_id)
);

create index if not exists idx_pinned_messages_conv on public.pinned_messages (conversation_id, pinned_at desc);

-- 4. Starred / Bookmarked Messages (private per user)
create table if not exists public.starred_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);

create index if not exists idx_starred_messages_user on public.starred_messages (user_id, created_at desc);

-- 5. Live Location Sessions (encrypted coordinates only)
create table if not exists public.live_location_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  encrypted_coords jsonb not null,
  is_active boolean not null default true,
  expires_at timestamptz not null,
  stopped_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_live_location_conv on public.live_location_sessions (conversation_id, is_active);

-- 6. Event RSVPs (encrypted response payload)
create table if not exists public.event_rsvps (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  encrypted_rsvp jsonb not null,
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists idx_event_rsvps_msg on public.event_rsvps (message_id);

-- 7. Shared Checklists & Concurrent Items (encrypted item titles)
create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  encrypted_text jsonb not null,
  is_completed boolean not null default false,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  position integer not null default 0,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_checklist_items_msg on public.checklist_items (message_id, position asc);

-- 8. Scheduled Messages (encrypted at rest; idempotency_key prevents duplicate delivery)
create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_device_id uuid not null references public.devices(id) on delete cascade,
  idempotency_key uuid not null unique,
  message_type text not null default 'text',
  encrypted_payload jsonb not null,
  reply_to_id uuid references public.messages(id) on delete set null,
  expires_after_seconds integer,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled', 'failed')),
  sent_message_id uuid references public.messages(id) on delete set null,
  error_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_messages_due
  on public.scheduled_messages (status, scheduled_for asc)
  where status = 'pending';

-- 9. Enable RLS & Grants on all new tables
grant select, insert, update, delete on all tables in schema public to authenticated;

alter table public.pinned_messages enable row level security;
alter table public.starred_messages enable row level security;
alter table public.live_location_sessions enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.checklist_items enable row level security;
alter table public.scheduled_messages enable row level security;

-- RLS: Pinned Messages
create policy "pinned_select_member" on public.pinned_messages
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "pinned_insert_member" on public.pinned_messages
  for insert to authenticated with check (
    auth.uid() = pinned_by and public.is_conversation_member(conversation_id)
  );
create policy "pinned_delete_member" on public.pinned_messages
  for delete to authenticated using (public.is_conversation_member(conversation_id));

-- RLS: Starred Messages (private to user)
create policy "starred_manage_own" on public.starred_messages
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- RLS: Live Location Sessions
create policy "live_loc_select_member" on public.live_location_sessions
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "live_loc_insert_sender" on public.live_location_sessions
  for insert to authenticated with check (
    auth.uid() = sender_id and public.is_conversation_member(conversation_id)
  );
create policy "live_loc_update_sender" on public.live_location_sessions
  for update to authenticated using (auth.uid() = sender_id);

-- RLS: Event RSVPs
create policy "rsvps_select_member" on public.event_rsvps
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "rsvps_manage_own" on public.event_rsvps
  for all to authenticated using (
    auth.uid() = user_id and public.is_conversation_member(conversation_id)
  ) with check (
    auth.uid() = user_id and public.is_conversation_member(conversation_id)
  );

-- RLS: Checklist Items
create policy "checklist_select_member" on public.checklist_items
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "checklist_insert_member" on public.checklist_items
  for insert to authenticated with check (
    auth.uid() = created_by and public.is_conversation_member(conversation_id)
  );
create policy "checklist_update_member" on public.checklist_items
  for update to authenticated using (public.is_conversation_member(conversation_id));
create policy "checklist_delete_member" on public.checklist_items
  for delete to authenticated using (public.is_conversation_member(conversation_id));

-- RLS: Scheduled Messages (private to sender)
create policy "scheduled_manage_own" on public.scheduled_messages
  for all to authenticated using (auth.uid() = sender_id) with check (auth.uid() = sender_id);

-- 10. Server-authoritative RPCs for View-Once, Expiry Purge, and Cleanup
create or replace function public.consume_view_once_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv_id uuid;
  v_sender_id uuid;
  v_viewed_at timestamptz;
begin
  select conversation_id, sender_id, viewed_at
  into v_conv_id, v_sender_id, v_viewed_at
  from public.messages
  where id = p_message_id and is_view_once = true
  for update;

  if v_conv_id is null or not public.is_conversation_member(v_conv_id) then
    return false;
  end if;

  if v_sender_id = auth.uid() then
    return false;
  end if;

  if v_viewed_at is not null then
    return false;
  end if;

  update public.messages
  set viewed_at = now(), viewed_by = auth.uid(), updated_at = now()
  where id = p_message_id;

  return true;
end;
$$;

create or replace function public.purge_expired_messages(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_cleanup_sec integer;
  v_exclude_protected boolean;
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not authorized';
  end if;

  -- 1. Delete per-message expired items
  delete from public.messages
  where conversation_id = p_conversation_id
    and expires_at is not null
    and expires_at <= now();
  get diagnostics v_deleted = row_count;

  -- 2. Apply conversation automatic cleanup policy if configured
  select cleanup_seconds, cleanup_exclude_pinned_starred
  into v_cleanup_sec, v_exclude_protected
  from public.conversations
  where id = p_conversation_id;

  if v_cleanup_sec is not null then
    delete from public.messages m
    where m.conversation_id = p_conversation_id
      and m.created_at <= now() - make_interval(secs => v_cleanup_sec)
      and (
        not v_exclude_protected
        or (
          not exists (select 1 from public.pinned_messages p where p.message_id = m.id)
          and not exists (select 1 from public.starred_messages s where s.message_id = m.id)
        )
      );
  end if;

  return v_deleted;
end;
$$;

-- 11. Realtime publications for new interactive tables
alter publication supabase_realtime add table public.pinned_messages;
alter publication supabase_realtime add table public.live_location_sessions;
alter publication supabase_realtime add table public.event_rsvps;
alter publication supabase_realtime add table public.checklist_items;
