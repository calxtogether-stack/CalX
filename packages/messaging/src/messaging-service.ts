import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type {
  Attachment,
  ChecklistItem,
  Contact,
  Conversation,
  ConversationMember,
  Device,
  DeviceKey,
  EventRsvp,
  LiveLocationSession,
  Message,
  MessageReaction,
  MessageReceipt,
  MessageType,
  PinnedMessage,
  PlatformType,
  Profile,
  RsvpStatus,
  ScheduledMessage,
  StarredMessage,
  UserBlock,
  UserSettings,
} from '@calx/shared';
import {
  defaultEncryptionProvider,
  type DeviceIdentityBundle,
  type EncryptionProvider,
  type RecipientDeviceKey,
} from '@calx/crypto';
import {
  attachmentValidationSchema,
  createGroupConversationSchema,
  profileUpdateSchema,
  reactionSchema,
  scheduleMessageSchema,
  sendMessageSchema,
  userSettingsUpdateSchema,
} from '@calx/validation';
import { canEditMessage } from './rich-content.js';

export interface LocalDeviceCredentials {
  deviceId: string;
  identityPrivateKey: string;
  signingPrivateKey: string;
}

export class MessagingService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly crypto: EncryptionProvider = defaultEncryptionProvider,
  ) {}

  // =========================================================================
  // Profiles & Devices
  // =========================================================================

  async getMyProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async updateMyProfile(
    userId: string,
    updates: { display_name?: string; status_text?: string; avatar_url?: string | null },
  ): Promise<Profile> {
    const parsed = profileUpdateSchema.parse(updates);
    const { data, error } = await this.supabase
      .from('profiles')
      .update({ ...parsed, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async setPresence(userId: string, isOnline: boolean): Promise<void> {
    await this.supabase
      .from('profiles')
      .update({
        is_online: isOnline,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
  }

  async registerDevice(
    userId: string,
    deviceName: string,
    platform: PlatformType,
  ): Promise<{ device: Device; bundle: DeviceIdentityBundle }> {
    const bundle = await this.crypto.generateDeviceIdentity();
    const { data: device, error: devErr } = await this.supabase
      .from('devices')
      .insert({
        user_id: userId,
        device_name: deviceName,
        platform,
        is_active: true,
      })
      .select()
      .single();
    if (devErr) throw devErr;

    const { error: keyErr } = await this.supabase.from('device_keys').insert({
      device_id: device.id,
      user_id: userId,
      identity_public_key: bundle.identityPublicKey,
      signing_public_key: bundle.signingPublicKey,
      key_algorithm: bundle.algorithm,
    });
    if (keyErr) throw keyErr;

    return { device, bundle };
  }

  async listMyDevices(userId: string): Promise<Device[]> {
    const { data, error } = await this.supabase
      .from('devices')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const { error } = await this.supabase
      .from('devices')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', deviceId);
    if (error) throw error;
  }

  // =========================================================================
  // Contacts & Blocks
  // =========================================================================

  async searchUsersByUsername(query: string): Promise<Profile[]> {
    const cleaned = query.trim().toLowerCase().replace(/^@/, '');
    if (cleaned.length < 2) return [];
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .ilike('username', `%${cleaned}%`)
      .limit(20);
    if (error) throw error;
    return data ?? [];
  }

  async listContacts(userId: string): Promise<Contact[]> {
    const { data, error } = await this.supabase
      .from('contacts')
      .select('*, profile:profiles!contacts_contact_user_id_fkey(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Contact[];
  }

  async addContact(userId: string, contactUserId: string, nickname?: string): Promise<Contact> {
    const { data, error } = await this.supabase
      .from('contacts')
      .upsert(
        { user_id: userId, contact_user_id: contactUserId, nickname: nickname ?? null },
        { onConflict: 'user_id,contact_user_id' },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async removeContact(userId: string, contactUserId: string): Promise<void> {
    const { error } = await this.supabase
      .from('contacts')
      .delete()
      .eq('user_id', userId)
      .eq('contact_user_id', contactUserId);
    if (error) throw error;
  }

  async listBlockedUsers(userId: string): Promise<UserBlock[]> {
    const { data, error } = await this.supabase
      .from('user_blocks')
      .select('*')
      .eq('blocker_id', userId);
    if (error) throw error;
    return data ?? [];
  }

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_blocks')
      .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id' });
    if (error) throw error;
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);
    if (error) throw error;
  }

  // =========================================================================
  // Conversations & Groups
  // =========================================================================

  async listConversations(): Promise<Conversation[]> {
    const { data, error } = await this.supabase
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data ?? [];
  }

  async getConversationMembers(conversationId: string): Promise<ConversationMember[]> {
    const { data, error } = await this.supabase
      .from('conversation_members')
      .select('*, profile:profiles(*)')
      .eq('conversation_id', conversationId);
    if (error) throw error;
    return (data ?? []) as ConversationMember[];
  }

  async getOrCreateDirectConversation(currentUserId: string, peerUserId: string): Promise<Conversation> {
    const { data: rpcId, error: rpcErr } = await this.supabase.rpc('create_direct_conversation', {
      p_peer_user_id: peerUserId,
    });
    if (!rpcErr && rpcId) {
      const { data, error } = await this.supabase
        .from('conversations')
        .select('*')
        .eq('id', rpcId)
        .single();
      if (error) throw error;
      return data;
    }

    // Fallback: direct insert if RPC is not deployed
    const { data: conv, error: convErr } = await this.supabase
      .from('conversations')
      .insert({ type: 'direct', created_by: currentUserId })
      .select()
      .single();
    if (convErr) throw convErr;

    const { error: memErr } = await this.supabase.from('conversation_members').insert([
      { conversation_id: conv.id, user_id: currentUserId, role: 'owner' },
      { conversation_id: conv.id, user_id: peerUserId, role: 'member' },
    ]);
    if (memErr) throw memErr;
    return conv;
  }

  async createGroupConversation(
    currentUserId: string,
    title: string,
    memberIds: string[],
  ): Promise<Conversation> {
    const parsed = createGroupConversationSchema.parse({ title, memberIds });
    const { data: conv, error: convErr } = await this.supabase
      .from('conversations')
      .insert({ type: 'group', title: parsed.title, created_by: currentUserId })
      .select()
      .single();
    if (convErr) throw convErr;

    const uniqueMembers = Array.from(new Set(parsed.memberIds.filter((id) => id !== currentUserId)));
    const rows = [
      { conversation_id: conv.id, user_id: currentUserId, role: 'owner' },
      ...uniqueMembers.map((id) => ({
        conversation_id: conv.id,
        user_id: id,
        role: 'member' as const,
      })),
    ];

    const { error: memErr } = await this.supabase.from('conversation_members').insert(rows);
    if (memErr) throw memErr;
    return conv;
  }

  async addGroupMember(conversationId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('conversation_members')
      .insert({ conversation_id: conversationId, user_id: userId, role: 'member' });
    if (error) throw error;
  }

  async removeGroupMember(conversationId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async setDisappearingMessages(conversationId: string, seconds: number | null): Promise<void> {
    const { error } = await this.supabase
      .from('conversations')
      .update({ disappearing_seconds: seconds })
      .eq('id', conversationId);
    if (error) throw error;
  }

  async toggleConversationLock(
    conversationId: string,
    userId: string,
    isLocked: boolean,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('conversation_members')
      .update({ is_locked: isLocked })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  // =========================================================================
  // Encryption Key Resolution & Messaging
  // =========================================================================

  async getRecipientDeviceKeys(conversationId: string): Promise<RecipientDeviceKey[]> {
    const members = await this.getConversationMembers(conversationId);
    const userIds = members.map((m) => m.user_id);
    if (userIds.length === 0) return [];

    const { data: keys, error } = await this.supabase
      .from('device_keys')
      .select('device_id, identity_public_key, devices!inner(is_active)')
      .in('user_id', userIds)
      .eq('devices.is_active', true);

    if (error) throw error;
    return (keys ?? []).map((k: { device_id: string; identity_public_key: string }) => ({
      deviceId: k.device_id,
      identityPublicKey: k.identity_public_key,
    }));
  }

  async fetchMessagesPaginated(
    conversationId: string,
    limit = 40,
    beforeIso?: string,
  ): Promise<Message[]> {
    let query = this.supabase
      .from('messages')
      .select('*, reactions:message_reactions(*), attachments(*), receipts:message_receipts(*)')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (beforeIso) {
      query = query.lt('created_at', beforeIso);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = ((data ?? []) as Message[]).reverse();
    return rows.map((m) => {
      const otherReceipts = (m.receipts ?? []).filter((r) => r.user_id !== m.sender_id);
      const isRead = otherReceipts.some((r) => Boolean(r.read_at));
      const isDelivered = otherReceipts.some((r) => Boolean(r.delivered_at));
      return {
        ...m,
        status: isRead ? 'read' : isDelivered ? 'delivered' : 'sent',
      };
    });
  }

  async decryptMessages(
    messages: Message[],
    credentials: LocalDeviceCredentials,
  ): Promise<Message[]> {
    if (messages.length === 0) return [];

    const senderDeviceIds = Array.from(
      new Set(messages.map((m) => m.encrypted_payload?.sender_device_id).filter(Boolean)),
    );

    const keyMap = new Map<string, string>();
    if (senderDeviceIds.length > 0) {
      const { data: deviceKeys } = await this.supabase
        .from('device_keys')
        .select('device_id, identity_public_key')
        .in('device_id', senderDeviceIds);
      for (const row of (deviceKeys ?? []) as Pick<
        DeviceKey,
        'device_id' | 'identity_public_key'
      >[]) {
        keyMap.set(row.device_id, row.identity_public_key);
      }
    }

    return Promise.all(
      messages.map(async (msg) => {
        if (!msg.encrypted_payload) return msg;
        const senderPub = keyMap.get(msg.encrypted_payload.sender_device_id);
        if (!senderPub) {
          return { ...msg, decryption_error: 'Missing sender device public key' };
        }
        try {
          const plaintext = await this.crypto.decryptMessage({
            payload: msg.encrypted_payload,
            conversationId: msg.conversation_id,
            clientMessageId: msg.client_message_id,
            recipientDeviceId: credentials.deviceId,
            recipientPrivateKey: credentials.identityPrivateKey,
            senderPublicKey: senderPub,
          });
          return { ...msg, decrypted_text: plaintext };
        } catch (err) {
          return {
            ...msg,
            decryption_error: err instanceof Error ? err.message : 'Unable to decrypt',
          };
        }
      }),
    );
  }

  async sendEncryptedMessage(params: {
    conversationId: string;
    senderId: string;
    credentials: LocalDeviceCredentials;
    plaintext: string;
    messageType?: MessageType;
    clientMessageId?: string;
    replyToId?: string | null;
    expiresAt?: string | null;
    isViewOnce?: boolean;
  }): Promise<Message> {
    const clientMessageId = params.clientMessageId ?? globalThis.crypto.randomUUID();
    const recipientDevices = await this.getRecipientDeviceKeys(params.conversationId);

    const encryptedPayload = await this.crypto.encryptMessage({
      plaintext: params.plaintext,
      conversationId: params.conversationId,
      clientMessageId,
      senderDeviceId: params.credentials.deviceId,
      senderPrivateKey: params.credentials.identityPrivateKey,
      recipientDevices,
    });

    const validated = sendMessageSchema.parse({
      conversationId: params.conversationId,
      clientMessageId,
      messageType: params.messageType ?? 'text',
      encryptedPayload,
      replyToId: params.replyToId ?? null,
      expiresAt: params.expiresAt ?? null,
      isViewOnce: params.isViewOnce ?? false,
    });

    const { data, error } = await this.supabase
      .from('messages')
      .upsert(
        {
          conversation_id: validated.conversationId,
          sender_id: params.senderId,
          sender_device_id: params.credentials.deviceId,
          client_message_id: validated.clientMessageId,
          message_type: validated.messageType,
          encrypted_payload: validated.encryptedPayload,
          reply_to_id: validated.replyToId ?? null,
          expires_at: validated.expiresAt ?? null,
          is_view_once: validated.isViewOnce ?? false,
        },
        { onConflict: 'conversation_id,client_message_id' },
      )
      .select()
      .single();

    if (error) throw error;
    return { ...(data as Message), decrypted_text: params.plaintext, status: 'sent' };
  }

  async editEncryptedMessage(params: {
    message: Message;
    senderId: string;
    credentials: LocalDeviceCredentials;
    newPlaintext: string;
  }): Promise<Message> {
    if (!canEditMessage(params.message, params.senderId)) {
      throw new Error('Edit window expired or not authorized');
    }
    const recipientDevices = await this.getRecipientDeviceKeys(params.message.conversation_id);
    const encryptedPayload = await this.crypto.encryptMessage({
      plaintext: params.newPlaintext,
      conversationId: params.message.conversation_id,
      clientMessageId: params.message.client_message_id,
      senderDeviceId: params.credentials.deviceId,
      senderPrivateKey: params.credentials.identityPrivateKey,
      recipientDevices,
    });

    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('messages')
      .update({
        encrypted_payload: encryptedPayload,
        sender_device_id: params.credentials.deviceId,
        edited_at: now,
        edit_count: (params.message.edit_count ?? 0) + 1,
        updated_at: now,
      })
      .eq('id', params.message.id)
      .eq('sender_id', params.senderId)
      .select()
      .single();
    if (error) throw error;
    return { ...(data as Message), decrypted_text: params.newPlaintext, status: params.message.status };
  }

  async forwardMessage(params: {
    sourceMessage: Message;
    destinationConversationId: string;
    senderId: string;
    credentials: LocalDeviceCredentials;
  }): Promise<Message> {
    const text = params.sourceMessage.decrypted_text;
    if (!text) {
      throw new Error('Cannot forward undecrypted or empty message');
    }
    return this.sendEncryptedMessage({
      conversationId: params.destinationConversationId,
      senderId: params.senderId,
      credentials: params.credentials,
      plaintext: text,
      messageType: params.sourceMessage.message_type,
    });
  }

  // =========================================================================
  // Pinning & Starring
  // =========================================================================

  async listPinnedMessages(conversationId: string): Promise<PinnedMessage[]> {
    const { data, error } = await this.supabase
      .from('pinned_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('pinned_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as PinnedMessage[];
  }

  async pinMessage(conversationId: string, messageId: string, pinnedBy: string): Promise<void> {
    const { error } = await this.supabase.from('pinned_messages').upsert(
      { conversation_id: conversationId, message_id: messageId, pinned_by: pinnedBy },
      { onConflict: 'conversation_id,message_id' },
    );
    if (error) throw error;
  }

  async unpinMessage(conversationId: string, messageId: string): Promise<void> {
    const { error } = await this.supabase
      .from('pinned_messages')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('message_id', messageId);
    if (error) throw error;
  }

  async listStarredMessages(userId: string): Promise<StarredMessage[]> {
    const { data, error } = await this.supabase
      .from('starred_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as StarredMessage[];
  }

  async starMessage(userId: string, messageId: string, conversationId: string): Promise<void> {
    const { error } = await this.supabase.from('starred_messages').upsert(
      { user_id: userId, message_id: messageId, conversation_id: conversationId },
      { onConflict: 'user_id,message_id' },
    );
    if (error) throw error;
  }

  async unstarMessage(userId: string, messageId: string): Promise<void> {
    const { error } = await this.supabase
      .from('starred_messages')
      .delete()
      .eq('user_id', userId)
      .eq('message_id', messageId);
    if (error) throw error;
  }

  // =========================================================================
  // View-Once, Expiry & Automatic Cleanup
  // =========================================================================

  async consumeViewOnceMessage(message: Message): Promise<{
    ok: boolean;
    attachmentBytes?: Uint8Array;
    mimeType?: string;
  }> {
    const { data, error } = await this.supabase.rpc('consume_view_once_message', {
      p_message_id: message.id,
    });
    if (error) throw error;
    if (!data) return { ok: false };

    let attachmentBytes: Uint8Array | undefined;
    let mimeType: string | undefined;

    if (message.attachments && message.attachments.length > 0) {
      const first = message.attachments[0]!;
      try {
        attachmentBytes = await this.downloadAndDecryptAttachment(first);
        mimeType = first.mime_type;
      } finally {
        const paths = message.attachments.map((a) => a.storage_path);
        await this.supabase.storage.from('vault-attachments').remove(paths);
      }
    }
    return { ok: true, attachmentBytes, mimeType };
  }

  async setCleanupPolicy(
    conversationId: string,
    cleanupSeconds: number | null,
    excludePinnedStarred = true,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('conversations')
      .update({
        cleanup_seconds: cleanupSeconds,
        cleanup_exclude_pinned_starred: excludePinnedStarred,
      })
      .eq('id', conversationId);
    if (error) throw error;
  }

  async purgeExpiredMessages(conversationId: string): Promise<number> {
    const { data, error } = await this.supabase.rpc('purge_expired_messages', {
      p_conversation_id: conversationId,
    });
    if (error) throw error;
    return Number(data ?? 0);
  }

  // =========================================================================
  // Live Location Sharing (E2EE Coordinates)
  // =========================================================================

  async startLiveLocation(params: {
    conversationId: string;
    senderId: string;
    credentials: LocalDeviceCredentials;
    lat: number;
    lng: number;
    durationSeconds: number;
  }): Promise<LiveLocationSession> {
    const sessionId = globalThis.crypto.randomUUID();
    const expiresAt = new Date(Date.now() + params.durationSeconds * 1000).toISOString();
    const recipientDevices = await this.getRecipientDeviceKeys(params.conversationId);
    const encryptedCoords = await this.crypto.encryptMessage({
      plaintext: JSON.stringify({ lat: params.lat, lng: params.lng }),
      conversationId: params.conversationId,
      clientMessageId: sessionId,
      senderDeviceId: params.credentials.deviceId,
      senderPrivateKey: params.credentials.identityPrivateKey,
      recipientDevices,
    });

    const msg = await this.sendEncryptedMessage({
      conversationId: params.conversationId,
      senderId: params.senderId,
      credentials: params.credentials,
      plaintext: JSON.stringify({
        kind: 'location',
        lat: params.lat,
        lng: params.lng,
        isLive: true,
        sessionId,
        expiresAt,
      }),
      messageType: 'live_location',
      expiresAt,
    });

    const { data, error } = await this.supabase
      .from('live_location_sessions')
      .insert({
        id: sessionId,
        conversation_id: params.conversationId,
        sender_id: params.senderId,
        message_id: msg.id,
        encrypted_coords: encryptedCoords,
        is_active: true,
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (error) throw error;
    return { ...(data as LiveLocationSession), decrypted_coords: { lat: params.lat, lng: params.lng } };
  }

  async updateLiveLocation(params: {
    sessionId: string;
    conversationId: string;
    credentials: LocalDeviceCredentials;
    lat: number;
    lng: number;
  }): Promise<void> {
    const recipientDevices = await this.getRecipientDeviceKeys(params.conversationId);
    const encryptedCoords = await this.crypto.encryptMessage({
      plaintext: JSON.stringify({ lat: params.lat, lng: params.lng }),
      conversationId: params.conversationId,
      clientMessageId: params.sessionId,
      senderDeviceId: params.credentials.deviceId,
      senderPrivateKey: params.credentials.identityPrivateKey,
      recipientDevices,
    });

    const { error } = await this.supabase
      .from('live_location_sessions')
      .update({ encrypted_coords: encryptedCoords, updated_at: new Date().toISOString() })
      .eq('id', params.sessionId);
    if (error) throw error;
  }

  async stopLiveLocation(sessionId: string): Promise<void> {
    const { error } = await this.supabase
      .from('live_location_sessions')
      .update({ is_active: false, stopped_at: new Date().toISOString() })
      .eq('id', sessionId);
    if (error) throw error;
  }

  async listActiveLiveLocations(
    conversationId: string,
    credentials: LocalDeviceCredentials,
  ): Promise<LiveLocationSession[]> {
    const { data, error } = await this.supabase
      .from('live_location_sessions')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString());
    if (error) throw error;

    const sessions = (data ?? []) as LiveLocationSession[];
    return Promise.all(
      sessions.map(async (s) => {
        try {
          const { data: keyRow } = await this.supabase
            .from('device_keys')
            .select('identity_public_key')
            .eq('device_id', s.encrypted_coords.sender_device_id)
            .maybeSingle();
          if (!keyRow) return s;
          const json = await this.crypto.decryptMessage({
            payload: s.encrypted_coords,
            conversationId: s.conversation_id,
            clientMessageId: s.id,
            recipientDeviceId: credentials.deviceId,
            recipientPrivateKey: credentials.identityPrivateKey,
            senderPublicKey: keyRow.identity_public_key,
          });
          return { ...s, decrypted_coords: JSON.parse(json) as { lat: number; lng: number } };
        } catch {
          return s;
        }
      }),
    );
  }

  // =========================================================================
  // Event RSVPs (E2EE)
  // =========================================================================

  async upsertEventRsvp(params: {
    conversationId: string;
    messageId: string;
    userId: string;
    credentials: LocalDeviceCredentials;
    status: RsvpStatus;
  }): Promise<void> {
    const recipientDevices = await this.getRecipientDeviceKeys(params.conversationId);
    const encryptedRsvp = await this.crypto.encryptMessage({
      plaintext: JSON.stringify({ status: params.status }),
      conversationId: params.conversationId,
      clientMessageId: `${params.messageId}:${params.userId}`,
      senderDeviceId: params.credentials.deviceId,
      senderPrivateKey: params.credentials.identityPrivateKey,
      recipientDevices,
    });

    const { error } = await this.supabase.from('event_rsvps').upsert(
      {
        conversation_id: params.conversationId,
        message_id: params.messageId,
        user_id: params.userId,
        encrypted_rsvp: encryptedRsvp,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'message_id,user_id' },
    );
    if (error) throw error;
  }

  async listEventRsvps(
    messageId: string,
    credentials: LocalDeviceCredentials,
  ): Promise<EventRsvp[]> {
    const { data, error } = await this.supabase
      .from('event_rsvps')
      .select('*')
      .eq('message_id', messageId);
    if (error) throw error;

    const rows = (data ?? []) as EventRsvp[];
    return Promise.all(
      rows.map(async (r) => {
        try {
          const { data: keyRow } = await this.supabase
            .from('device_keys')
            .select('identity_public_key')
            .eq('device_id', r.encrypted_rsvp.sender_device_id)
            .maybeSingle();
          if (!keyRow) return r;
          const json = await this.crypto.decryptMessage({
            payload: r.encrypted_rsvp,
            conversationId: r.conversation_id,
            clientMessageId: `${r.message_id}:${r.user_id}`,
            recipientDeviceId: credentials.deviceId,
            recipientPrivateKey: credentials.identityPrivateKey,
            senderPublicKey: keyRow.identity_public_key,
          });
          const parsed = JSON.parse(json) as { status: RsvpStatus };
          return { ...r, decrypted_status: parsed.status };
        } catch {
          return r;
        }
      }),
    );
  }

  // =========================================================================
  // Shared Checklists (E2EE Items + Optimistic Concurrency)
  // =========================================================================

  async listChecklistItems(
    messageId: string,
    credentials: LocalDeviceCredentials,
  ): Promise<ChecklistItem[]> {
    const { data, error } = await this.supabase
      .from('checklist_items')
      .select('*')
      .eq('message_id', messageId)
      .order('position', { ascending: true });
    if (error) throw error;

    const items = (data ?? []) as ChecklistItem[];
    return Promise.all(
      items.map(async (item) => {
        try {
          const { data: keyRow } = await this.supabase
            .from('device_keys')
            .select('identity_public_key')
            .eq('device_id', item.encrypted_text.sender_device_id)
            .maybeSingle();
          if (!keyRow) return item;
          const text = await this.crypto.decryptMessage({
            payload: item.encrypted_text,
            conversationId: item.conversation_id,
            clientMessageId: item.id,
            recipientDeviceId: credentials.deviceId,
            recipientPrivateKey: credentials.identityPrivateKey,
            senderPublicKey: keyRow.identity_public_key,
          });
          return { ...item, decrypted_text: text };
        } catch {
          return item;
        }
      }),
    );
  }

  async addChecklistItem(params: {
    conversationId: string;
    messageId: string;
    userId: string;
    credentials: LocalDeviceCredentials;
    text: string;
    position: number;
  }): Promise<ChecklistItem> {
    const itemId = globalThis.crypto.randomUUID();
    const recipientDevices = await this.getRecipientDeviceKeys(params.conversationId);
    const encryptedText = await this.crypto.encryptMessage({
      plaintext: params.text,
      conversationId: params.conversationId,
      clientMessageId: itemId,
      senderDeviceId: params.credentials.deviceId,
      senderPrivateKey: params.credentials.identityPrivateKey,
      recipientDevices,
    });

    const { data, error } = await this.supabase
      .from('checklist_items')
      .insert({
        id: itemId,
        conversation_id: params.conversationId,
        message_id: params.messageId,
        created_by: params.userId,
        encrypted_text: encryptedText,
        position: params.position,
      })
      .select()
      .single();
    if (error) throw error;
    return { ...(data as ChecklistItem), decrypted_text: params.text };
  }

  async toggleChecklistItem(item: ChecklistItem, userId: string): Promise<void> {
    const nextCompleted = !item.is_completed;
    const { data, error } = await this.supabase
      .from('checklist_items')
      .update({
        is_completed: nextCompleted,
        completed_by: nextCompleted ? userId : null,
        completed_at: nextCompleted ? new Date().toISOString() : null,
        version: item.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('version', item.version)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('Checklist item was modified by another participant. Refreshing.');
    }
  }

  async deleteChecklistItem(itemId: string): Promise<void> {
    const { error } = await this.supabase.from('checklist_items').delete().eq('id', itemId);
    if (error) throw error;
  }

  // =========================================================================
  // Scheduled Messages (E2EE at Rest + Idempotent Delivery)
  // =========================================================================

  async scheduleEncryptedMessage(params: {
    conversationId: string;
    senderId: string;
    credentials: LocalDeviceCredentials;
    plaintext: string;
    scheduledForIso: string;
    expiresAfterSeconds?: number | null;
  }): Promise<ScheduledMessage> {
    const parsed = scheduleMessageSchema.parse({
      conversationId: params.conversationId,
      scheduledFor: params.scheduledForIso,
      plaintext: params.plaintext,
      expiresAfterSeconds: params.expiresAfterSeconds ?? null,
    });

    const idempotencyKey = globalThis.crypto.randomUUID();
    const recipientDevices = await this.getRecipientDeviceKeys(params.conversationId);
    const encryptedPayload = await this.crypto.encryptMessage({
      plaintext: parsed.plaintext,
      conversationId: params.conversationId,
      clientMessageId: idempotencyKey,
      senderDeviceId: params.credentials.deviceId,
      senderPrivateKey: params.credentials.identityPrivateKey,
      recipientDevices,
    });

    const { data, error } = await this.supabase
      .from('scheduled_messages')
      .insert({
        conversation_id: params.conversationId,
        sender_id: params.senderId,
        sender_device_id: params.credentials.deviceId,
        idempotency_key: idempotencyKey,
        message_type: 'text',
        encrypted_payload: encryptedPayload,
        expires_after_seconds: parsed.expiresAfterSeconds ?? null,
        scheduled_for: parsed.scheduledFor,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw error;
    return { ...(data as ScheduledMessage), decrypted_text: parsed.plaintext };
  }

  async listScheduledMessages(
    senderId: string,
    credentials: LocalDeviceCredentials,
  ): Promise<ScheduledMessage[]> {
    const { data, error } = await this.supabase
      .from('scheduled_messages')
      .select('*')
      .eq('sender_id', senderId)
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as ScheduledMessage[];
    return Promise.all(
      rows.map(async (s) => {
        try {
          const { data: keyRow } = await this.supabase
            .from('device_keys')
            .select('identity_public_key')
            .eq('device_id', s.encrypted_payload.sender_device_id)
            .maybeSingle();
          if (!keyRow) return s;
          const text = await this.crypto.decryptMessage({
            payload: s.encrypted_payload,
            conversationId: s.conversation_id,
            clientMessageId: s.idempotency_key,
            recipientDeviceId: credentials.deviceId,
            recipientPrivateKey: credentials.identityPrivateKey,
            senderPublicKey: keyRow.identity_public_key,
          });
          return { ...s, decrypted_text: text };
        } catch {
          return s;
        }
      }),
    );
  }

  async cancelScheduledMessage(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('scheduled_messages')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async deliverDueScheduledMessages(senderId: string): Promise<number> {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await this.supabase
      .from('scheduled_messages')
      .select('*')
      .eq('sender_id', senderId)
      .eq('status', 'pending')
      .lte('scheduled_for', nowIso);
    if (error || !due || due.length === 0) return 0;

    let delivered = 0;
    for (const row of due as ScheduledMessage[]) {
      const expiresAt = row.expires_after_seconds
        ? new Date(Date.now() + row.expires_after_seconds * 1000).toISOString()
        : null;

      const { data: msg, error: insErr } = await this.supabase
        .from('messages')
        .upsert(
          {
            conversation_id: row.conversation_id,
            sender_id: row.sender_id,
            sender_device_id: row.sender_device_id,
            client_message_id: row.idempotency_key,
            message_type: row.message_type,
            encrypted_payload: row.encrypted_payload,
            reply_to_id: row.reply_to_id,
            expires_at: expiresAt,
          },
          { onConflict: 'conversation_id,client_message_id' },
        )
        .select('id')
        .single();

      if (!insErr && msg) {
        await this.supabase
          .from('scheduled_messages')
          .update({
            status: 'sent',
            sent_message_id: msg.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        delivered += 1;
      }
    }
    return delivered;
  }

  async markDelivered(messageId: string, userId: string): Promise<void> {
    const { error } = await this.supabase.from('message_receipts').upsert(
      {
        message_id: messageId,
        user_id: userId,
        delivered_at: new Date().toISOString(),
      },
      { onConflict: 'message_id,user_id' },
    );
    if (error) throw error;
  }

  async markRead(messageId: string, userId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase.from('message_receipts').upsert(
      {
        message_id: messageId,
        user_id: userId,
        delivered_at: now,
        read_at: now,
      },
      { onConflict: 'message_id,user_id' },
    );
    if (error) throw error;
  }

  async toggleReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const parsed = reactionSchema.parse({ messageId, emoji });
    const { data: existing } = await this.supabase
      .from('message_reactions')
      .select('id')
      .eq('message_id', parsed.messageId)
      .eq('user_id', userId)
      .eq('emoji', parsed.emoji)
      .maybeSingle();

    if (existing) {
      await this.supabase.from('message_reactions').delete().eq('id', existing.id);
    } else {
      await this.supabase.from('message_reactions').insert({
        message_id: parsed.messageId,
        user_id: userId,
        emoji: parsed.emoji,
      });
    }
  }

  async softDeleteMessage(messageId: string): Promise<void> {
    const { error } = await this.supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId);
    if (error) throw error;
  }

  // =========================================================================
  // Encrypted Attachments
  // =========================================================================

  async uploadEncryptedAttachment(params: {
    conversationId: string;
    messageId: string;
    uploaderId: string;
    bytes: Uint8Array;
    mimeType: string;
    durationMs?: number | null;
    onProgress?: (pct: number) => void;
  }): Promise<Attachment> {
    attachmentValidationSchema.parse({
      mimeType: params.mimeType,
      byteSize: params.bytes.byteLength,
      durationMs: params.durationMs ?? null,
    });

    params.onProgress?.(15);
    const encrypted = await this.crypto.encryptAttachment(params.bytes);
    params.onProgress?.(45);

    const storagePath = `${params.conversationId}/${params.messageId}/${globalThis.crypto.randomUUID()}.enc`;
    const { error: uploadErr } = await this.supabase.storage
      .from('vault-attachments')
      .upload(storagePath, encrypted.encryptedBytes, {
        contentType: 'application/octet-stream',
        upsert: false,
      });
    if (uploadErr) throw uploadErr;
    params.onProgress?.(85);

    const { data, error: dbErr } = await this.supabase
      .from('attachments')
      .insert({
        message_id: params.messageId,
        conversation_id: params.conversationId,
        uploader_id: params.uploaderId,
        storage_path: storagePath,
        encrypted_file_key: encrypted.fileKeyBase64,
        file_iv: encrypted.ivBase64,
        mime_type: params.mimeType,
        byte_size: params.bytes.byteLength,
        duration_ms: params.durationMs ?? null,
      })
      .select()
      .single();

    if (dbErr) throw dbErr;
    params.onProgress?.(100);
    return data as Attachment;
  }

  async downloadAndDecryptAttachment(attachment: Attachment): Promise<Uint8Array> {
    const { data, error } = await this.supabase.storage
      .from('vault-attachments')
      .download(attachment.storage_path);
    if (error || !data) throw error ?? new Error('Attachment download failed');

    const buffer = await data.arrayBuffer();
    return this.crypto.decryptAttachment(
      new Uint8Array(buffer),
      attachment.encrypted_file_key,
      attachment.file_iv,
    );
  }

  // =========================================================================
  // Realtime & Settings & Push Tokens
  // =========================================================================

  subscribeToConversation(
    conversationId: string,
    handlers: {
      onMessage?: (msg: Message) => void;
      onMessageUpdate?: (msg: Message) => void;
      onReaction?: (reaction: MessageReaction) => void;
      onReceipt?: (receipt: MessageReceipt) => void;
      onPinChange?: () => void;
      onChecklistChange?: (messageId: string) => void;
      onRsvpChange?: (messageId: string) => void;
      onLiveLocationChange?: () => void;
      onTyping?: (userId: string, isTyping: boolean) => void;
    },
  ): RealtimeChannel {
    const channel = this.supabase.channel(`conversation:${conversationId}`);

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        handlers.onMessage?.(payload.new as Message);
      },
    );

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        handlers.onMessageUpdate?.(payload.new as Message);
      },
    );

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pinned_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => handlers.onPinChange?.(),
    );

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'checklist_items',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const row = (payload.new || payload.old) as { message_id?: string } | undefined;
        if (row?.message_id) handlers.onChecklistChange?.(row.message_id);
      },
    );

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'event_rsvps',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const row = (payload.new || payload.old) as { message_id?: string } | undefined;
        if (row?.message_id) handlers.onRsvpChange?.(row.message_id);
      },
    );

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'live_location_sessions',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => handlers.onLiveLocationChange?.(),
    );

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'message_reactions',
      },
      (payload) => {
        if (payload.new) {
          handlers.onReaction?.(payload.new as MessageReaction);
        }
      },
    );

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'message_receipts',
      },
      (payload) => {
        if (payload.new) {
          handlers.onReceipt?.(payload.new as MessageReceipt);
        }
      },
    );

    channel.on('broadcast', { event: 'typing' }, (payload) => {
      const p = payload.payload as { userId?: string; isTyping?: boolean } | undefined;
      if (p?.userId) {
        handlers.onTyping?.(p.userId, Boolean(p.isTyping));
      }
    });

    channel.subscribe();
    return channel;
  }

  async sendTypingIndicator(
    channel: RealtimeChannel,
    userId: string,
    isTyping: boolean,
  ): Promise<void> {
    await channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId, isTyping },
    });
  }

  async getUserSettings(userId: string): Promise<UserSettings | null> {
    const { data, error } = await this.supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async updateUserSettings(
    userId: string,
    updates: Partial<Omit<UserSettings, 'user_id' | 'updated_at'>>,
  ): Promise<UserSettings> {
    const parsed = userSettingsUpdateSchema.parse(updates);
    const { data, error } = await this.supabase
      .from('user_settings')
      .upsert(
        { user_id: userId, ...parsed, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async registerPushToken(
    userId: string,
    deviceId: string,
    platform: PlatformType,
    token: string,
  ): Promise<void> {
    const { error } = await this.supabase.from('push_tokens').upsert(
      {
        user_id: userId,
        device_id: deviceId,
        platform,
        token,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'device_id' },
    );
    if (error) throw error;
  }
}
