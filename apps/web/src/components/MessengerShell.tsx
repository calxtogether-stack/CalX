'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type {
  ChatPersonalization,
  Contact,
  Conversation,
  ConversationMember,
  Device,
  LiveLocationSession,
  Message,
  PinnedMessage,
  Profile,
  ScheduledMessage,
  StarredMessage,
  UserSettings,
} from '@calx/shared';
import {
  ACCENT_PRESETS,
  CLEANUP_OPTIONS,
  DISAPPEARING_OPTIONS,
  WALLPAPER_PRESETS,
} from '@calx/shared';
import {
  canEditMessage,
  formatCountdown,
  getRemainingSeconds,
  MessagingService,
  OfflineMessageQueue,
  searchLocalDecryptedMessages,
  type LocalDeviceCredentials,
} from '@calx/messaging';
import { changeVaultPin } from '@/lib/vault-storage';
import {
  getConversationPersonalization,
  getFontSizeClass,
  playNotificationSound,
  resetConversationPersonalization,
  setConversationPersonalization,
  setGlobalPersonalization,
} from '@/lib/personalization';
import { RichMessageCard } from './RichMessageCard';
import { RichComposerModals, type ActiveComposerModal } from './RichComposerModals';
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCheck,
  CheckSquare,
  Clock,
  Edit3,
  Eye,
  Forward,
  Info,
  Lock,
  LogOut,
  MapPin,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Pin,
  Search,
  Send,
  Settings,
  Shield,
  Star,
  Timer,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

interface MessengerShellProps {
  supabase: SupabaseClient;
  userId: string;
  credentials: LocalDeviceCredentials;
  onLockVault: () => void;
}

type SidebarTab = 'chats' | 'contacts' | 'starred' | 'scheduled' | 'settings';

export function MessengerShell({
  supabase,
  userId,
  credentials,
  onLockVault,
}: MessengerShellProps) {
  const service = useMemo(() => new MessagingService(supabase), [supabase]);
  const offlineQueue = useMemo(() => new OfflineMessageQueue(), []);

  const [tab, setTab] = useState<SidebarTab>('chats');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [starred, setStarred] = useState<StarredMessage[]>([]);
  const [scheduledList, setScheduledList] = useState<ScheduledMessage[]>([]);

  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);
  const [liveLocations, setLiveLocations] = useState<LiveLocationSession[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<Profile[]>([]);
  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [inChatQuery, setInChatQuery] = useState('');

  const [draft, setDraft] = useState('');
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [perMsgExpirySec, setPerMsgExpirySec] = useState<number | null>(null);
  const [isViewOnce, setIsViewOnce] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeModal, setActiveModal] = useState<ActiveComposerModal>(null);
  const [forwardSource, setForwardSource] = useState<Message | null>(null);

  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [personalization, setPersonalization] = useState<ChatPersonalization>(() =>
    getConversationPersonalization(null),
  );

  // Group creation modal state
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);

  // Settings / PIN change state
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteTypingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1-second tick for expiration countdowns & auto-purge of expired messages
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      setMessages((prev) =>
        prev.filter((m) => !m.expires_at || new Date(m.expires_at).getTime() > now),
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-lock on inactivity
  const resetAutoLock = useCallback(() => {
    if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    const timeoutMs = (settings?.auto_lock_seconds ?? 300) * 1000;
    autoLockTimerRef.current = setTimeout(() => {
      onLockVault();
    }, timeoutMs);
  }, [settings?.auto_lock_seconds, onLockVault]);

  useEffect(() => {
    resetAutoLock();
    const events = ['mousedown', 'keydown', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetAutoLock));
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetAutoLock));
      if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    };
  }, [resetAutoLock]);

  const loadInitialData = useCallback(async () => {
    const [prof, sett, devs, convs, conts, stars, scheds] = await Promise.all([
      service.getMyProfile(userId),
      service.getUserSettings(userId),
      service.listMyDevices(userId),
      service.listConversations(),
      service.listContacts(userId),
      service.listStarredMessages(userId),
      service.listScheduledMessages(userId, credentials),
    ]);
    setProfile(prof);
    setSettings(sett);
    setDevices(devs);
    setConversations(convs);
    setContacts(conts);
    setStarred(stars);
    setScheduledList(scheds);
  }, [service, userId, credentials]);

  useEffect(() => {
    void loadInitialData();
    void service.setPresence(userId, true);
    void service.deliverDueScheduledMessages(userId);
    const schedInterval = setInterval(() => {
      void service.deliverDueScheduledMessages(userId);
    }, 30_000);
    const onUnload = () => {
      void service.setPresence(userId, false);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(schedInterval);
      window.removeEventListener('beforeunload', onUnload);
      void service.setPresence(userId, false);
    };
  }, [loadInitialData, service, userId]);

  useEffect(() => {
    if (profile?.status_text !== undefined) {
      setStatusInput(profile.status_text);
    }
  }, [profile?.status_text]);

  // Flush offline queue on reconnect
  useEffect(() => {
    const handleOnline = () => {
      void offlineQueue.flush(async (item) => {
        await service.sendEncryptedMessage({
          conversationId: item.conversationId,
          senderId: userId,
          credentials,
          plaintext: item.plaintext,
          messageType: item.messageType,
          clientMessageId: item.clientMessageId,
          replyToId: item.replyToId,
          expiresAt: item.expiresAt,
        });
      });
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [offlineQueue, service, userId, credentials]);

  // Load selected conversation + Realtime
  useEffect(() => {
    if (!selectedConv) {
      setPersonalization(getConversationPersonalization(null));
      return;
    }
    setPersonalization(getConversationPersonalization(selectedConv.id));
    setSelectedIds([]);
    let cancelled = false;

    const loadConversation = async () => {
      setLoadingMsgs(true);
      try {
        await service.purgeExpiredMessages(selectedConv.id).catch(() => 0);
        const [memList, rawMsgs, pinList, liveList] = await Promise.all([
          service.getConversationMembers(selectedConv.id),
          service.fetchMessagesPaginated(selectedConv.id, 40),
          service.listPinnedMessages(selectedConv.id),
          service.listActiveLiveLocations(selectedConv.id, credentials),
        ]);
        const decrypted = await service.decryptMessages(rawMsgs, credentials);
        if (!cancelled) {
          setMembers(memList);
          setMessages(decrypted);
          setPinned(pinList);
          setLiveLocations(liveList);
        }
        if (settings?.read_receipts_enabled !== false) {
          for (const m of decrypted) {
            if (m.sender_id !== userId) {
              void service.markRead(m.id, userId);
            }
          }
        }
      } finally {
        if (!cancelled) setLoadingMsgs(false);
      }
    };

    void loadConversation();

    channelRef.current?.unsubscribe();
    const channel = service.subscribeToConversation(selectedConv.id, {
      onMessage: async (msg) => {
        const [decrypted] = await service.decryptMessages([msg], credentials);
        if (!decrypted) return;
        setMessages((prev) => {
          if (prev.some((m) => m.client_message_id === decrypted.client_message_id)) {
            return prev.map((m) =>
              m.client_message_id === decrypted.client_message_id
                ? { ...decrypted, status: m.status ?? 'sent' }
                : m,
            );
          }
          return [...prev, { ...decrypted, status: 'sent' }];
        });
        if (decrypted.sender_id !== userId) {
          const prefs = getConversationPersonalization(selectedConv.id);
          playNotificationSound(prefs.notificationSound, prefs.customSoundUri);
          if (settings?.read_receipts_enabled !== false) {
            void service.markRead(decrypted.id, userId);
          } else {
            void service.markDelivered(decrypted.id, userId);
          }
        }
      },
      onMessageUpdate: async (msg) => {
        if (msg.deleted_at) {
          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
          return;
        }
        const [decrypted] = await service.decryptMessages([msg], credentials);
        if (!decrypted) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === decrypted.id ? { ...decrypted, status: m.status } : m)),
        );
      },
      onReceipt: (receipt) => {
        if (receipt.user_id === userId) return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== receipt.message_id) return m;
            const nextStatus = receipt.read_at
              ? 'read'
              : receipt.delivered_at
                ? 'delivered'
                : m.status;
            return { ...m, status: nextStatus };
          }),
        );
      },
      onPinChange: () => {
        void service.listPinnedMessages(selectedConv.id).then(setPinned);
      },
      onLiveLocationChange: () => {
        void service.listActiveLiveLocations(selectedConv.id, credentials).then(setLiveLocations);
      },
      onTyping: (typerId, isTyping) => {
        if (typerId === userId) return;
        const existingTimer = remoteTypingTimersRef.current.get(typerId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          remoteTypingTimersRef.current.delete(typerId);
        }
        if (isTyping) {
          setTypingUsers((prev) => Array.from(new Set([...prev, typerId])));
          const expiry = setTimeout(() => {
            setTypingUsers((prev) => prev.filter((id) => id !== typerId));
            remoteTypingTimersRef.current.delete(typerId);
          }, 3000);
          remoteTypingTimersRef.current.set(typerId, expiry);
        } else {
          setTypingUsers((prev) => prev.filter((id) => id !== typerId));
        }
      },
    });
    channelRef.current = channel;

    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [selectedConv, service, credentials, userId, settings?.read_receipts_enabled]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedConv || !draft.trim()) return;
    const plaintext = draft.trim();

    if (editingMsg) {
      const updated = await service.editEncryptedMessage({
        message: editingMsg,
        senderId: userId,
        credentials,
        newPlaintext: plaintext,
      });
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditingMsg(null);
      setDraft('');
      return;
    }

    const clientMessageId = crypto.randomUUID();
    const effectiveExpirySec = perMsgExpirySec ?? selectedConv.disappearing_seconds ?? null;
    const expiresAt = effectiveExpirySec
      ? new Date(Date.now() + effectiveExpirySec * 1000).toISOString()
      : null;

    const optimistic: Message = {
      id: clientMessageId,
      conversation_id: selectedConv.id,
      sender_id: userId,
      sender_device_id: credentials.deviceId,
      client_message_id: clientMessageId,
      message_type: 'text',
      encrypted_payload: {
        ciphertext: '',
        iv: '',
        sender_device_id: credentials.deviceId,
        key_version: 1,
        algorithm: 'ECDH-P256-HKDF-AES256GCM',
      },
      reply_to_id: replyTo?.id ?? null,
      expires_at: expiresAt,
      deleted_at: null,
      is_view_once: isViewOnce,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      decrypted_text: plaintext,
      status: 'sending',
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setReplyTo(null);
    setIsViewOnce(false);
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (channelRef.current) {
      void service.sendTypingIndicator(channelRef.current, userId, false);
    }

    try {
      const sent = await service.sendEncryptedMessage({
        conversationId: selectedConv.id,
        senderId: userId,
        credentials,
        plaintext,
        clientMessageId,
        replyToId: optimistic.reply_to_id,
        expiresAt,
        isViewOnce,
      });
      setMessages((prev) =>
        prev.map((m) => (m.client_message_id === clientMessageId ? sent : m)),
      );
    } catch {
      await offlineQueue.enqueue({
        clientMessageId,
        conversationId: selectedConv.id,
        plaintext,
        messageType: 'text',
        replyToId: optimistic.reply_to_id,
        expiresAt,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.client_message_id === clientMessageId ? { ...m, status: 'failed' } : m,
        ),
      );
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!selectedConv) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const msgType = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'document';

    const msg = await service.sendEncryptedMessage({
      conversationId: selectedConv.id,
      senderId: userId,
      credentials,
      plaintext: `[Encrypted ${msgType}: ${file.name}]`,
      messageType: msgType,
      isViewOnce,
    });
    setIsViewOnce(false);

    await service.uploadEncryptedAttachment({
      conversationId: selectedConv.id,
      messageId: msg.id,
      uploaderId: userId,
      bytes,
      mimeType: file.type || 'application/octet-stream',
      onProgress: (pct) => setUploadPct(pct === 100 ? null : pct),
    });
  };

  const toggleVoiceRecording = async () => {
    if (!selectedConv) return;
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    audioChunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      await handleFileUpload(file);
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  };

  const handleSearchUsers = async (q: string) => {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setUserSearchResults([]);
      return;
    }
    const results = await service.searchUsersByUsername(q);
    setUserSearchResults(results.filter((u) => u.id !== userId));
  };

  const startDirectChat = async (peerId: string) => {
    const conv = await service.getOrCreateDirectConversation(userId, peerId);
    setConversations((prev) =>
      prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev],
    );
    setSelectedConv(conv);
    setTab('chats');
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupTitle.trim() || groupMemberIds.length === 0) return;
    const conv = await service.createGroupConversation(userId, groupTitle, groupMemberIds);
    setConversations((prev) => [conv, ...prev]);
    setSelectedConv(conv);
    setShowNewGroup(false);
    setGroupTitle('');
    setGroupMemberIds([]);
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await changeVaultPin(currentPin, newPin);
    setSettingsMsg(ok ? 'Vault PIN updated.' : 'Current PIN is incorrect.');
    if (ok) {
      setCurrentPin('');
      setNewPin('');
    }
  };

  const handleLogout = async () => {
    await service.setPresence(userId, false);
    await supabase.auth.signOut();
    onLockVault();
  };

  const scrollToMessage = (messageId: string) => {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const displayedMessages = useMemo(() => {
    if (!inChatSearchOpen || !inChatQuery.trim()) return messages;
    return searchLocalDecryptedMessages(messages, inChatQuery);
  }, [messages, inChatSearchOpen, inChatQuery]);

  const wallpaperStyle: React.CSSProperties = useMemo(() => {
    if (personalization.wallpaperType === 'solid') {
      return { backgroundColor: personalization.wallpaperValue };
    }
    if (personalization.wallpaperType === 'gradient') {
      return { backgroundImage: personalization.wallpaperValue };
    }
    if (personalization.wallpaperType === 'image' && personalization.wallpaperValue) {
      return {
        backgroundImage: `url(${personalization.wallpaperValue})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    return {};
  }, [personalization]);

  const fontSizeCls = getFontSizeClass(personalization.fontSize);

  return (
    <div
      className={`flex h-full w-full overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] ${
        personalization.themeOverride === 'dark'
          ? 'dark'
          : personalization.themeOverride === 'light'
            ? 'light'
            : ''
      }`}
    >
      {/* LEFT SIDEBAR */}
      <aside
        className={`flex h-full w-full flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)] md:w-80 ${
          selectedConv ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[var(--text-primary)]" />
            <span className="text-sm font-semibold tracking-tight">CalX</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowNewGroup(true)}
              title="New Group"
              className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onLockVault}
              title="Lock Vault"
              className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
            >
              <Lock className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 border-b border-[var(--border-subtle)] text-[11px] font-medium">
          {(['chats', 'contacts', 'starred', 'scheduled', 'settings'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`py-2.5 capitalize transition-colors ${
                tab === t
                  ? 'border-b-2 border-[var(--accent)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'chats' && (
            <div className="space-y-1">
              {conversations.length === 0 ? (
                <div className="px-3 py-10 text-center text-xs text-[var(--text-tertiary)]">
                  No conversations yet. Find a user in Contacts to start an encrypted chat.
                </div>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => setSelectedConv(conv)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors ${
                      selectedConv?.id === conv.id
                        ? 'bg-[var(--bg-secondary)]'
                        : 'hover:bg-[var(--bg-secondary)]/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {conv.title ?? (conv.type === 'direct' ? 'Direct Chat' : 'Group')}
                      </div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">
                        {conv.type === 'group' ? 'Group • E2EE' : 'Private • E2EE'}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === 'contacts' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => void handleSearchUsers(e.target.value)}
                  placeholder="Search @username..."
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] py-2 pl-9 pr-3 text-xs outline-none"
                />
              </div>

              {userSearchResults.length > 0 && (
                <div className="space-y-1">
                  {userSearchResults.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] px-3 py-2"
                    >
                      <div>
                        <div className="text-xs font-medium">{u.display_name}</div>
                        <div className="text-[11px] text-[var(--text-tertiary)]">@{u.username}</div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void service.addContact(userId, u.id).then(loadInitialData)}
                          className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-[11px]"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void startDirectChat(u.id)}
                          className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11px] text-[var(--accent-fg)]"
                        >
                          Chat
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <div className="px-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Contacts ({contacts.length})
                </div>
                {contacts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--bg-secondary)]"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {c.profile?.display_name ?? c.nickname ?? 'Contact'}
                      </div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">
                        @{c.profile?.username}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void startDirectChat(c.contact_user_id)}
                      className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-xs"
                    >
                      Message
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'starred' && (
            <div className="space-y-2 text-xs">
              <div className="px-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                Starred Messages ({starred.length})
              </div>
              {starred.length === 0 ? (
                <p className="py-6 text-center text-[var(--text-tertiary)]">No starred messages.</p>
              ) : (
                starred.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] p-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const conv = conversations.find((c) => c.id === s.conversation_id);
                        if (conv) setSelectedConv(conv);
                      }}
                      className="text-left hover:underline"
                    >
                      Message in {s.conversation_id.slice(0, 8)}
                    </button>
                    <button
                      type="button"
                      onClick={() => void service.unstarMessage(userId, s.message_id).then(loadInitialData)}
                      className="text-[var(--text-tertiary)] hover:text-red-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'scheduled' && (
            <div className="space-y-2 text-xs">
              <div className="px-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                Scheduled ({scheduledList.length})
              </div>
              {scheduledList.length === 0 ? (
                <p className="py-6 text-center text-[var(--text-tertiary)]">No pending scheduled messages.</p>
              ) : (
                scheduledList.map((sc) => (
                  <div
                    key={sc.id}
                    className="space-y-1 rounded-xl border border-[var(--border-subtle)] p-2.5"
                  >
                    <div className="font-medium">{sc.decrypted_text ?? 'Encrypted message'}</div>
                    <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                      <span>{new Date(sc.scheduled_for).toLocaleString()}</span>
                      <button
                        type="button"
                        onClick={() => void service.cancelScheduledMessage(sc.id).then(loadInitialData)}
                        className="text-red-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'settings' && (
            <div className="space-y-4 p-1 text-xs">
              <div className="rounded-xl border border-[var(--border-subtle)] p-3">
                <div className="text-sm font-medium">{profile?.display_name ?? 'User'}</div>
                <div className="text-[var(--text-tertiary)]">@{profile?.username ?? '...'}</div>
              </div>

              <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] p-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Status & Privacy
                </div>
                <input
                  type="text"
                  value={statusInput}
                  onChange={(e) => setStatusInput(e.target.value)}
                  placeholder="Your status..."
                  maxLength={140}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const updated = await service.updateMyProfile(userId, { status_text: statusInput });
                    setProfile(updated);
                    setSettingsMsg('Status updated.');
                  }}
                  className="w-full rounded-lg border border-[var(--border-subtle)] py-1.5 text-xs font-medium"
                >
                  Save Status
                </button>
                <label className="flex items-center justify-between pt-1">
                  <span className="text-[var(--text-secondary)]">Read Receipts</span>
                  <input
                    type="checkbox"
                    checked={settings?.read_receipts_enabled !== false}
                    onChange={async (e) => {
                      const updated = await service.updateUserSettings(userId, {
                        read_receipts_enabled: e.target.checked,
                      });
                      setSettings(updated);
                    }}
                  />
                </label>
              </div>

              <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] p-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Global Chat Appearance
                </div>
                <select
                  value={personalization.fontSize}
                  onChange={(e) => {
                    const next = setGlobalPersonalization({
                      fontSize: e.target.value as ChatPersonalization['fontSize'],
                    });
                    setPersonalization(next);
                  }}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs"
                >
                  <option value="sm">Font: Small</option>
                  <option value="md">Font: Medium</option>
                  <option value="lg">Font: Large</option>
                  <option value="xl">Font: Extra Large</option>
                </select>
                <select
                  value={personalization.notificationSound}
                  onChange={(e) => {
                    const next = setGlobalPersonalization({
                      notificationSound: e.target.value as ChatPersonalization['notificationSound'],
                    });
                    setPersonalization(next);
                    playNotificationSound(next.notificationSound);
                  }}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs"
                >
                  <option value="default">Sound: Default</option>
                  <option value="chime">Sound: Chime</option>
                  <option value="pulse">Sound: Pulse</option>
                  <option value="muted">Sound: Muted</option>
                </select>
              </div>

              <form onSubmit={handleChangePin} className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Change Calculator PIN
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="Current PIN"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 font-mono outline-none"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="New PIN (4–8 digits)"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 font-mono outline-none"
                />
                <button
                  type="submit"
                  className="w-full rounded-xl bg-[var(--accent)] py-2 font-medium text-[var(--accent-fg)]"
                >
                  Update PIN
                </button>
                {settingsMsg && <p className="text-[11px] text-[var(--text-secondary)]">{settingsMsg}</p>}
              </form>

              <div className="space-y-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Active Devices ({devices.filter((d) => d.is_active).length})
                </div>
                {devices
                  .filter((d) => d.is_active)
                  .map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] px-3 py-2"
                    >
                      <div>
                        <div className="font-medium">{d.device_name}</div>
                        <div className="text-[10px] text-[var(--text-tertiary)]">
                          {d.id === credentials.deviceId ? 'This device' : d.platform}
                        </div>
                      </div>
                      {d.id !== credentials.deviceId && (
                        <button
                          type="button"
                          onClick={() => void service.revokeDevice(d.id).then(loadInitialData)}
                          className="text-red-500 hover:underline"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
              </div>

              <button
                type="button"
                onClick={() => void handleLogout()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] py-2.5 font-medium text-red-600 hover:bg-red-500/10"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* CENTER CONVERSATION PANEL */}
      <section
        className={`flex h-full flex-1 flex-col bg-[var(--bg-primary)] ${
          selectedConv ? 'flex' : 'hidden md:flex'
        }`}
        style={wallpaperStyle}
      >
        {!selectedConv ? (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <Settings className="mb-3 h-8 w-8 text-[var(--text-tertiary)]" strokeWidth={1.25} />
            <h3 className="text-sm font-medium">End-to-End Encrypted Workspace</h3>
            <p className="mt-1 max-w-xs text-xs text-[var(--text-tertiary)]">
              Select a conversation or search for a contact to begin.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 px-4 py-3 backdrop-blur-xs">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedConv(null)}
                  className="rounded-lg p-1 text-[var(--text-secondary)] md:hidden"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                  <div className="text-sm font-semibold">
                    {selectedConv.title ??
                      (selectedConv.type === 'direct'
                        ? members.find((m) => m.user_id !== userId)?.profile?.display_name ??
                          'Private Chat'
                        : 'Group Chat')}
                  </div>
                  <div className="text-[11px] text-[var(--text-tertiary)]">
                    {typingUsers.length > 0
                      ? 'Typing...'
                      : (() => {
                          if (selectedConv.type === 'direct') {
                            const peer = members.find((m) => m.user_id !== userId)?.profile;
                            if (peer?.is_online) return 'Online • End-to-end encrypted';
                            if (peer?.last_seen_at) {
                              return `Last seen ${new Date(peer.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • E2EE`;
                            }
                          }
                          return `End-to-end encrypted • ${members.length} member${members.length === 1 ? '' : 's'}`;
                        })()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInChatSearchOpen((v) => !v)}
                  title="Search Local Decrypted Messages"
                  className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                  <Search className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowInfoPanel((v) => !v)}
                  title="Conversation Info & Personalization"
                  className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                  <Info className="h-4 w-4" />
                </button>
              </div>
            </header>

            {/* Local Encrypted Search Bar */}
            {inChatSearchOpen && (
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 text-xs">
                <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  value={inChatQuery}
                  onChange={(e) => setInChatQuery(e.target.value)}
                  placeholder="Search locally decrypted messages..."
                  className="flex-1 bg-transparent outline-none"
                />
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {displayedMessages.length} loaded
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setInChatSearchOpen(false);
                    setInChatQuery('');
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Pinned Message Banner */}
            {pinned.length > 0 && (
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => scrollToMessage(pinned[0]!.message_id)}
                  className="flex items-center gap-1.5 truncate text-[var(--text-secondary)] hover:underline"
                >
                  <Pin className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    Pinned ({pinned.length}):{' '}
                    {messages.find((m) => m.id === pinned[0]!.message_id)?.decrypted_text ??
                      'Jump to pinned message'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void service
                      .unpinMessage(selectedConv.id, pinned[0]!.message_id)
                      .then(() => service.listPinnedMessages(selectedConv.id).then(setPinned))
                  }
                  className="text-[10px] text-[var(--text-tertiary)] hover:text-red-500"
                >
                  Unpin
                </button>
              </div>
            )}

            {/* Multi-Message Selection Bar */}
            {selectedIds.length > 0 && (
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 text-xs">
                <span className="font-medium">{selectedIds.length} selected</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      for (const id of selectedIds) {
                        await service.starMessage(userId, id, selectedConv.id);
                      }
                      await loadInitialData();
                      setSelectedIds([]);
                    }}
                    className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-1"
                  >
                    Star
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Delete ${selectedIds.length} selected message(s)?`)) return;
                      for (const id of selectedIds) {
                        const target = messages.find((m) => m.id === id);
                        if (target?.sender_id === userId) {
                          await service.softDeleteMessage(id);
                        }
                      }
                      setMessages((prev) => prev.filter((m) => !selectedIds.includes(m.id)));
                      setSelectedIds([]);
                    }}
                    className="rounded-lg border border-red-500/30 px-2.5 py-1 text-red-500"
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setSelectedIds([])}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Message Feed */}
            <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
              {loadingMsgs ? (
                <div className="space-y-2">
                  <div className="h-10 w-48 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
                  <div className="ml-auto h-10 w-56 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
                </div>
              ) : (
                displayedMessages.map((m) => {
                  const mine = m.sender_id === userId;
                  const isSelected = selectedIds.includes(m.id);
                  const remainingSec = getRemainingSeconds(m.expires_at, nowTick);
                  const quoted = m.reply_to_id
                    ? messages.find((r) => r.id === m.reply_to_id)
                    : undefined;
                  const isRich =
                    m.is_view_once ||
                    m.message_type === 'location' ||
                    m.message_type === 'live_location' ||
                    m.message_type === 'contact_card' ||
                    m.message_type === 'event' ||
                    m.message_type === 'checklist';

                  return (
                    <div
                      key={m.client_message_id}
                      data-msg-id={m.id}
                      onClick={() => {
                        if (selectedIds.length > 0) {
                          setSelectedIds((prev) =>
                            prev.includes(m.id) ? prev.filter((i) => i !== m.id) : [...prev, m.id],
                          );
                        }
                      }}
                      className={`group flex flex-col ${mine ? 'items-end' : 'items-start'} ${
                        isSelected ? 'rounded-xl bg-[var(--accent)]/10 p-1' : ''
                      }`}
                    >
                      <div
                        style={
                          mine && personalization.accentColor !== '#18181B'
                            ? { backgroundColor: personalization.accentColor, color: '#FAFAFA' }
                            : undefined
                        }
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${fontSizeCls} ${
                          mine
                            ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                            : 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                        }`}
                      >
                        {m.reply_to_id && (
                          <button
                            type="button"
                            onClick={() => scrollToMessage(m.reply_to_id!)}
                            className="mb-1.5 block w-full rounded-lg border-l-2 border-current/40 bg-black/10 px-2 py-1 text-left text-[11px] opacity-80"
                          >
                            {quoted?.decrypted_text ?? 'Original message unavailable'}
                          </button>
                        )}

                        {isRich ? (
                          <RichMessageCard
                            message={m}
                            userId={userId}
                            credentials={credentials}
                            service={service}
                            liveSessions={liveLocations}
                            onRefreshLive={() =>
                              void service
                                .listActiveLiveLocations(selectedConv.id, credentials)
                                .then(setLiveLocations)
                            }
                          />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">
                            {m.decrypted_text ?? m.decryption_error ?? 'Encrypted message'}
                          </p>
                        )}

                        <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] opacity-65 tabular-nums">
                          {remainingSec !== null && (
                            <span className="flex items-center gap-0.5">
                              <Timer className="h-2.5 w-2.5" />
                              {formatCountdown(remainingSec)}
                            </span>
                          )}
                          {m.edited_at && <span>Edited</span>}
                          <span>
                            {new Date(m.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {mine &&
                            (m.status === 'read' ? (
                              <CheckCheck className="h-3.5 w-3.5 text-sky-400" />
                            ) : m.status === 'delivered' ? (
                              <CheckCheck className="h-3.5 w-3.5 opacity-70" />
                            ) : (
                              <Check className="h-3 w-3 opacity-70" />
                            ))}
                        </div>
                      </div>

                      {/* Hover Action Bar */}
                      <div className="mt-0.5 hidden gap-2.5 px-1 text-[10px] text-[var(--text-tertiary)] group-hover:flex">
                        <button type="button" onClick={() => setReplyTo(m)}>
                          Reply
                        </button>
                        {canEditMessage(m, userId) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMsg(m);
                              setDraft(m.decrypted_text ?? '');
                            }}
                          >
                            <Edit3 className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setForwardSource(m);
                            setActiveModal('forward');
                          }}
                        >
                          <Forward className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void service
                              .pinMessage(selectedConv.id, m.id, userId)
                              .then(() => service.listPinnedMessages(selectedConv.id).then(setPinned))
                          }
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void service
                              .starMessage(userId, m.id, selectedConv.id)
                              .then(loadInitialData)
                          }
                        >
                          <Star className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedIds((prev) => [...prev, m.id])}
                        >
                          Select
                        </button>
                        {mine && (
                          <button
                            type="button"
                            onClick={() => void service.softDeleteMessage(m.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reply / Edit / Upload Bar */}
            {(replyTo || editingMsg) && (
              <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2 text-xs">
                <span className="truncate text-[var(--text-secondary)]">
                  {editingMsg
                    ? `Editing: ${editingMsg.decrypted_text ?? ''}`
                    : `Replying to: ${replyTo?.decrypted_text ?? 'Message'}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setReplyTo(null);
                    setEditingMsg(null);
                    setDraft('');
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {uploadPct !== null && (
              <div className="bg-[var(--bg-secondary)] px-4 py-1 text-[11px] text-[var(--text-secondary)]">
                Encrypting & uploading attachment: {uploadPct}%
              </div>
            )}

            {/* Rich Tools Strip */}
            <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 pt-2 text-[11px] text-[var(--text-secondary)]">
              <button
                type="button"
                onClick={() => setActiveModal('location')}
                className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--bg-secondary)]"
              >
                <MapPin className="h-3 w-3" /> Location
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('contact')}
                className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--bg-secondary)]"
              >
                <UserCheck className="h-3 w-3" /> Contact
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('event')}
                className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--bg-secondary)]"
              >
                <Calendar className="h-3 w-3" /> Event
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('checklist')}
                className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--bg-secondary)]"
              >
                <CheckSquare className="h-3 w-3" /> Checklist
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('schedule')}
                className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--bg-secondary)]"
              >
                <Clock className="h-3 w-3" /> Schedule
              </button>
              <button
                type="button"
                onClick={() => setIsViewOnce((v) => !v)}
                className={`flex items-center gap-1 rounded-lg px-2 py-1 ${
                  isViewOnce ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'hover:bg-[var(--bg-secondary)]'
                }`}
              >
                <Eye className="h-3 w-3" /> View-once
              </button>
              <select
                value={perMsgExpirySec ?? ''}
                onChange={(e) =>
                  setPerMsgExpirySec(e.target.value === '' ? null : Number(e.target.value))
                }
                title="Per-message expiry"
                className="ml-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px]"
              >
                {DISAPPEARING_OPTIONS.map((o) => (
                  <option key={o.label} value={o.seconds ?? ''}>
                    Timer: {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Composer */}
            <form
              onSubmit={handleSend}
              className="flex items-center gap-2 bg-[var(--bg-elevated)] p-3"
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileUpload(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void toggleVoiceRecording()}
                className={`rounded-xl p-2 ${
                  recording
                    ? 'bg-red-500/15 text-red-500'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                <Mic className="h-4 w-4" />
              </button>
              <input
                type="text"
                value={draft}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setDraft(nextVal);
                  if (!channelRef.current) return;
                  if (typingStopTimerRef.current) {
                    clearTimeout(typingStopTimerRef.current);
                    typingStopTimerRef.current = null;
                  }
                  const hasText = nextVal.trim().length > 0;
                  void service.sendTypingIndicator(channelRef.current, userId, hasText);
                  if (hasText) {
                    typingStopTimerRef.current = setTimeout(() => {
                      if (channelRef.current) {
                        void service.sendTypingIndicator(channelRef.current, userId, false);
                      }
                    }, 1800);
                  }
                }}
                placeholder="Write an encrypted message..."
                className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3.5 py-2 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="rounded-xl bg-[var(--accent)] p-2.5 text-[var(--accent-fg)] disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </section>

      {/* RIGHT INFO & PERSONALIZATION PANEL */}
      {selectedConv && showInfoPanel && (
        <aside className="hidden w-72 flex-col overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 lg:flex">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              Info & Personalization
            </span>
            <button type="button" onClick={() => setShowInfoPanel(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="mb-1 block font-medium text-[var(--text-secondary)]">
                Disappearing Messages
              </label>
              <select
                value={selectedConv.disappearing_seconds ?? ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? null : Number(e.target.value);
                  void service.setDisappearingMessages(selectedConv.id, val);
                }}
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 outline-none"
              >
                {DISAPPEARING_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.seconds ?? ''}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-medium text-[var(--text-secondary)]">
                Auto-Cleanup Policy
              </label>
              <select
                value={selectedConv.cleanup_seconds ?? ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? null : Number(e.target.value);
                  void service.setCleanupPolicy(selectedConv.id, val, true);
                }}
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 outline-none"
              >
                {CLEANUP_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.seconds ?? ''}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                Pinned & starred messages are preserved automatically.
              </p>
            </div>

            <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
              <div className="font-medium text-[var(--text-secondary)]">Chat Wallpaper</div>
              <div className="grid grid-cols-3 gap-1">
                {WALLPAPER_PRESETS.map((wp) => (
                  <button
                    key={wp.id}
                    type="button"
                    onClick={() =>
                      setPersonalization(
                        setConversationPersonalization(selectedConv.id, {
                          wallpaperType: wp.type,
                          wallpaperValue: wp.value,
                        }),
                      )
                    }
                    className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-[10px] hover:bg-[var(--bg-secondary)]"
                  >
                    {wp.label}
                  </button>
                ))}
              </div>

              <div className="pt-1 font-medium text-[var(--text-secondary)]">Accent Color</div>
              <div className="flex gap-2">
                {ACCENT_PRESETS.map((acc) => (
                  <button
                    key={acc.hex}
                    type="button"
                    title={acc.name}
                    onClick={() =>
                      setPersonalization(
                        setConversationPersonalization(selectedConv.id, {
                          accentColor: acc.hex,
                        }),
                      )
                    }
                    style={{ backgroundColor: acc.hex }}
                    className="h-5 w-5 rounded-full border border-[var(--border-strong)]"
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setPersonalization(resetConversationPersonalization(selectedConv.id))
                }
                className="w-full rounded-lg border border-[var(--border-subtle)] py-1 text-[10px] text-[var(--text-secondary)]"
              >
                Reset Chat Appearance
              </button>
            </div>

            <div className="border-t border-[var(--border-subtle)] pt-3">
              <div className="mb-2 flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
                <Users className="h-3.5 w-3.5" />
                <span>Members ({members.length})</span>
              </div>
              <div className="space-y-1.5">
                {members.map((m) => (
                  <div
                    key={m.user_id}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5"
                  >
                    <span>{m.profile?.display_name ?? m.user_id.slice(0, 8)}</span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">{m.role}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* RICH COMPOSER MODALS */}
      {selectedConv && (
        <RichComposerModals
          modal={activeModal}
          conversations={conversations}
          forwardSource={forwardSource}
          onClose={() => {
            setActiveModal(null);
            setForwardSource(null);
          }}
          onSendLocation={async ({ lat, lng, label, liveSeconds }) => {
            if (liveSeconds) {
              await service.startLiveLocation({
                conversationId: selectedConv.id,
                senderId: userId,
                credentials,
                lat,
                lng,
                durationSeconds: liveSeconds,
              });
            } else {
              await service.sendEncryptedMessage({
                conversationId: selectedConv.id,
                senderId: userId,
                credentials,
                plaintext: JSON.stringify({ kind: 'location', lat, lng, label }),
                messageType: 'location',
              });
            }
          }}
          onSendContactCard={async (card) => {
            await service.sendEncryptedMessage({
              conversationId: selectedConv.id,
              senderId: userId,
              credentials,
              plaintext: JSON.stringify({ kind: 'contact_card', ...card }),
              messageType: 'contact_card',
            });
          }}
          onSendEvent={async (ev) => {
            await service.sendEncryptedMessage({
              conversationId: selectedConv.id,
              senderId: userId,
              credentials,
              plaintext: JSON.stringify({ kind: 'event', ...ev }),
              messageType: 'event',
            });
          }}
          onSendChecklist={async ({ title, initialItems }) => {
            const msg = await service.sendEncryptedMessage({
              conversationId: selectedConv.id,
              senderId: userId,
              credentials,
              plaintext: JSON.stringify({ kind: 'checklist', title }),
              messageType: 'checklist',
            });
            for (let i = 0; i < initialItems.length; i++) {
              await service.addChecklistItem({
                conversationId: selectedConv.id,
                messageId: msg.id,
                userId,
                credentials,
                text: initialItems[i]!,
                position: i,
              });
            }
          }}
          onScheduleMessage={async ({ plaintext, scheduledForIso }) => {
            await service.scheduleEncryptedMessage({
              conversationId: selectedConv.id,
              senderId: userId,
              credentials,
              plaintext,
              scheduledForIso,
              expiresAfterSeconds: perMsgExpirySec,
            });
            await loadInitialData();
          }}
          onForwardToConversation={async (destConvId) => {
            if (!forwardSource) return;
            await service.forwardMessage({
              sourceMessage: forwardSource,
              destinationConversationId: destConvId,
              senderId: userId,
              credentials,
            });
          }}
        />
      )}

      {/* NEW GROUP MODAL */}
      {showNewGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleCreateGroup}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Create Encrypted Group</h3>
              <button type="button" onClick={() => setShowNewGroup(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Group name"
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none"
              required
            />
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {contacts.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={groupMemberIds.includes(c.contact_user_id)}
                    onChange={(e) =>
                      setGroupMemberIds((prev) =>
                        e.target.checked
                          ? [...prev, c.contact_user_id]
                          : prev.filter((id) => id !== c.contact_user_id),
                      )
                    }
                  />
                  <span>{c.profile?.display_name ?? c.contact_user_id}</span>
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--accent)] py-2 text-sm font-medium text-[var(--accent-fg)]"
            >
              Create Group
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
