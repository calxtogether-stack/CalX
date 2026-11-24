# Database Architecture

PostgreSQL schema managed in `supabase/migrations/`:

1. `0001_initial_schema.sql`:
   - `profiles`, `devices`, `device_keys`, `key_bundles`
   - `conversations`, `conversation_members`
   - `messages` (ciphertext only, `encrypted_payload jsonb`), `message_reactions`, `message_receipts`
   - `contacts`, `user_blocks`
   - `attachments`, `push_tokens`, `user_settings`
2. `0002_rls_policies.sql`:
   - Enables Row Level Security on all 14 tables.
   - Uses `security definer` helpers `is_conversation_member(uuid)` and `is_conversation_admin(uuid)` to enforce strict membership and role boundaries.
3. `0003_storage_and_triggers.sql`:
   - `trg_messages_update_conv` updates `conversations.last_message_at`.
   - `create_direct_conversation(p_peer_user_id)` RPC atomically creates or returns a 1:1 chat while enforcing block checks.
   - Enables Supabase Realtime publication on `messages`, `message_reactions`, and `message_receipts`.
   - Provisions private storage bucket `vault-attachments` (`public = false`, 25 MB limit) with member-only RLS.
