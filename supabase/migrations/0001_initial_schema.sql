-- 0001_initial_schema.sql
-- Calculator Vault PostgreSQL Schema

create extension if not exists "pgcrypto";

-- 1. Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  avatar_url text,
  status_text text not null default 'Available',
  last_seen_at timestamptz,
  is_online boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,32}$')
);

create index if not exists idx_profiles_username on public.profiles (username);

-- 2. Devices
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_name text not null,
  platform text not null check (platform in ('android', 'ios', 'web')),
  is_active boolean not null default true,
  last_active_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_devices_user_active on public.devices (user_id, is_active);

-- 3. Device Keys (Public keys only; private keys NEVER leave client devices)
create table if not exists public.device_keys (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null unique references public.devices(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  identity_public_key text not null,
  signing_public_key text not null,
  key_algorithm text not null default 'ECDH-P256-HKDF-AES256GCM',
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create index if not exists idx_device_keys_user on public.device_keys (user_id);

-- 4. Key Bundles (Prekeys for asynchronous session setup / future Signal upgrade)
create table if not exists public.key_bundles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  signed_prekey text not null,
  signed_prekey_signature text not null,
  one_time_prekey text,
  created_at timestamptz not null default now()
);

create index if not exists idx_key_bundles_device on public.key_bundles (device_id);

-- 5. Conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  title text,
  avatar_url text,
  created_by uuid references public.profiles(id) on delete set null,
  disappearing_seconds integer check (disappearing_seconds is null or disappearing_seconds > 0),
  is_locked boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_last_msg on public.conversations (last_message_at desc nulls last);

-- 6. Conversation Members
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  muted_until timestamptz,
  is_locked boolean not null default false,
  primary key (conversation_id, user_id)
);

create index if not exists idx_conversation_members_user on public.conversation_members (user_id);

-- 7. Messages (Ciphertext only — no plaintext column!)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_device_id uuid not null references public.devices(id) on delete restrict,
  client_message_id uuid not null,
  message_type text not null check (message_type in ('text', 'image', 'video', 'audio', 'voice', 'document', 'system')),
  encrypted_payload jsonb not null,
  reply_to_id uuid references public.messages(id) on delete set null,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, client_message_id)
);

create index if not exists idx_messages_conv_created on public.messages (conversation_id, created_at desc);
create index if not exists idx_messages_expires on public.messages (expires_at) where expires_at is not null;

-- 8. Message Reactions
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

-- 9. Message Receipts
create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);

-- 10. Contacts
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text,
  created_at timestamptz not null default now(),
  unique (user_id, contact_user_id),
  check (user_id <> contact_user_id)
);

create index if not exists idx_contacts_user on public.contacts (user_id);

-- 11. User Blocks
create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists idx_user_blocks_blocker on public.user_blocks (blocker_id);

-- 12. Attachments (Encrypted binary metadata)
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  encrypted_file_key text not null,
  file_iv text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 26214400),
  encrypted_metadata text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_attachments_message on public.attachments (message_id);

-- 13. Push Tokens
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null unique references public.devices(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 14. User Settings
create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_visibility text not null default 'contacts' check (last_seen_visibility in ('everyone', 'contacts', 'nobody')),
  read_receipts_enabled boolean not null default true,
  notification_preview_enabled boolean not null default false,
  default_disappearing_seconds integer,
  auto_lock_seconds integer not null default 300 check (auto_lock_seconds >= 15 and auto_lock_seconds <= 86400),
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  updated_at timestamptz not null default now()
);
