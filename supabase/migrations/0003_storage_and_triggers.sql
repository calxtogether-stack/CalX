-- 0003_storage_and_triggers.sql
-- Triggers, RPCs, Realtime publication, and private Storage bucket policies

-- 1. Update conversation.last_message_at on new message
create or replace function public.handle_new_message_timestamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at, updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_messages_update_conv on public.messages;
create trigger trg_messages_update_conv
  after insert on public.messages
  for each row execute function public.handle_new_message_timestamp();

-- 2. RPC to find or create a 1:1 direct conversation atomically
create or replace function public.create_direct_conversation(p_peer_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv_id uuid;
  v_me uuid := auth.uid();
begin
  if v_me is null or v_me = p_peer_user_id then
    raise exception 'Invalid peer user';
  end if;

  -- Check if blocked
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_me and blocked_id = p_peer_user_id)
       or (blocker_id = p_peer_user_id and blocked_id = v_me)
  ) then
    raise exception 'Cannot message blocked user';
  end if;

  select c.id into v_conv_id
  from public.conversations c
  join public.conversation_members m1 on m1.conversation_id = c.id and m1.user_id = v_me
  join public.conversation_members m2 on m2.conversation_id = c.id and m2.user_id = p_peer_user_id
  where c.type = 'direct'
  limit 1;

  if v_conv_id is not null then
    return v_conv_id;
  end if;

  insert into public.conversations (type, created_by)
  values ('direct', v_me)
  returning id into v_conv_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conv_id, v_me, 'owner'), (v_conv_id, p_peer_user_id, 'member');

  return v_conv_id;
end;
$$;

-- 3. Enable Supabase Realtime on messaging tables
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.message_receipts;

-- 4. Private Storage Bucket for encrypted attachments (NEVER public!)
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault-attachments', 'vault-attachments', false, 26214400)
on conflict (id) do nothing;

create policy "vault_attachments_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vault-attachments'
    and public.is_conversation_member((storage.foldername(name))[1]::uuid)
  );

create policy "vault_attachments_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vault-attachments'
    and public.is_conversation_member((storage.foldername(name))[1]::uuid)
  );
