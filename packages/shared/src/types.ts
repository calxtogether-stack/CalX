export type PlatformType = 'android' | 'ios' | 'web';

export type ConversationType = 'direct' | 'group';

export type MemberRole = 'owner' | 'admin' | 'member';

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'system'
  | 'location'
  | 'live_location'
  | 'contact_card'
  | 'event'
  | 'checklist';

export type RsvpStatus = 'going' | 'maybe' | 'not_going';

export type FontSizeOption = 'sm' | 'md' | 'lg' | 'xl';

export type NotificationSoundOption = 'default' | 'chime' | 'pulse' | 'muted' | 'custom';

export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type VisibilityOption = 'everyone' | 'contacts' | 'nobody';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  status_text: string;
  last_seen_at: string | null;
  is_online: boolean;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  user_id: string;
  device_name: string;
  platform: PlatformType;
  is_active: boolean;
  last_active_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface DeviceKey {
  id: string;
  device_id: string;
  user_id: string;
  identity_public_key: string;
  signing_public_key: string;
  key_algorithm: string;
  created_at: string;
  rotated_at: string | null;
}

export interface KeyBundle {
  id: string;
  user_id: string;
  device_id: string;
  signed_prekey: string;
  signed_prekey_signature: string;
  one_time_prekey: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string | null;
  avatar_url: string | null;
  created_by: string | null;
  disappearing_seconds: number | null;
  cleanup_seconds?: number | null;
  cleanup_exclude_pinned_starred?: boolean;
  is_locked: boolean;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  muted_until: string | null;
  is_locked: boolean;
  profile?: Profile;
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  sender_device_id: string;
  key_version: number;
  algorithm: string;
  /** Per-recipient wrapped conversation/message keys keyed by deviceId */
  wrapped_keys?: Record<string, string>;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_device_id: string;
  client_message_id: string;
  message_type: MessageType;
  encrypted_payload: EncryptedPayload;
  reply_to_id: string | null;
  expires_at: string | null;
  deleted_at: string | null;
  edited_at?: string | null;
  edit_count?: number;
  is_view_once?: boolean;
  viewed_at?: string | null;
  viewed_by?: string | null;
  created_at: string;
  updated_at: string;
  /** Client-only decrypted content; never persisted on backend */
  decrypted_text?: string;
  decryption_error?: string;
  status?: DeliveryStatus;
  reactions?: MessageReaction[];
  receipts?: MessageReceipt[];
  attachments?: Attachment[];
}

export interface PinnedMessage {
  id: string;
  conversation_id: string;
  message_id: string;
  pinned_by: string;
  pinned_at: string;
}

export interface StarredMessage {
  id: string;
  user_id: string;
  message_id: string;
  conversation_id: string;
  created_at: string;
}

export interface LocationPayload {
  kind: 'location';
  lat: number;
  lng: number;
  label?: string;
  isLive?: boolean;
  sessionId?: string;
  expiresAt?: string;
}

export interface ContactCardPayload {
  kind: 'contact_card';
  name: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  fieldsShared: string[];
}

export interface EventPayload {
  kind: 'event';
  title: string;
  description?: string;
  startsAt: string;
  locationOrLink?: string;
  imageUrl?: string;
  cancelled?: boolean;
}

export interface ChecklistPayload {
  kind: 'checklist';
  title: string;
}

export interface LiveLocationSession {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_id: string | null;
  encrypted_coords: EncryptedPayload;
  is_active: boolean;
  expires_at: string;
  stopped_at: string | null;
  updated_at: string;
  created_at: string;
  decrypted_coords?: { lat: number; lng: number };
}

export interface EventRsvp {
  id: string;
  conversation_id: string;
  message_id: string;
  user_id: string;
  encrypted_rsvp: EncryptedPayload;
  updated_at: string;
  decrypted_status?: RsvpStatus;
}

export interface ChecklistItem {
  id: string;
  conversation_id: string;
  message_id: string;
  created_by: string;
  encrypted_text: EncryptedPayload;
  is_completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  position: number;
  version: number;
  updated_at: string;
  created_at: string;
  decrypted_text?: string;
}

export interface ScheduledMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_device_id: string;
  idempotency_key: string;
  message_type: MessageType;
  encrypted_payload: EncryptedPayload;
  reply_to_id: string | null;
  expires_after_seconds: number | null;
  scheduled_for: string;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  sent_message_id: string | null;
  error_reason: string | null;
  created_at: string;
  updated_at: string;
  decrypted_text?: string;
}

export interface ChatPersonalization {
  wallpaperType: 'default' | 'solid' | 'gradient' | 'image';
  wallpaperValue: string;
  accentColor: string;
  fontSize: FontSizeOption;
  themeOverride: 'system' | 'light' | 'dark';
  notificationSound: NotificationSoundOption;
  customSoundUri?: string;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface MessageReceipt {
  message_id: string;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface Contact {
  id: string;
  user_id: string;
  contact_user_id: string;
  nickname: string | null;
  created_at: string;
  profile?: Profile;
}

export interface UserBlock {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  message_id: string;
  conversation_id: string;
  uploader_id: string;
  storage_path: string;
  encrypted_file_key: string;
  file_iv: string;
  mime_type: string;
  byte_size: number;
  encrypted_metadata: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface PushToken {
  id: string;
  user_id: string;
  device_id: string;
  platform: PlatformType;
  token: string;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  user_id: string;
  last_seen_visibility: VisibilityOption;
  read_receipts_enabled: boolean;
  notification_preview_enabled: boolean;
  default_disappearing_seconds: number | null;
  auto_lock_seconds: number;
  theme: 'light' | 'dark' | 'system';
  updated_at: string;
}
